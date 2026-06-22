import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link, useSearch } from "wouter";
import {
  Server,
  KeyRound,
  ChevronDown,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  Plus,
  ArrowUpCircle,
  ExternalLink,
} from "lucide-react";
import type { Service } from "@shared/schema";
import { computeOrderEstimate, priceForCycle } from "@shared/store-estimate";

/**
 * Open a blank tab SYNCHRONOUSLY inside a user click. Ordering/upgrading can't
 * know the invoice id until the POST returns, so the tab must be opened up-front
 * on the click (popup blockers only allow window.open in the click call stack)
 * and redirected later once the pay URL is known. Returns null when blocked.
 */
function openBlankTab(): Window | null {
  const win = window.open("about:blank", "_blank");
  if (win) {
    try {
      win.opener = null;
    } catch {
      // ignore — some browsers disallow reassigning opener
    }
  }
  return win;
}

/**
 * Send a previously-opened tab (`win`) to WHMCS's hosted payment page for a
 * freshly-created invoice. Mirrors billing-summary.tsx: asks the pay-link endpoint
 * to mint a single-use auto-login URL and redirects there; on ANY failure it falls
 * back to the direct pay URL so payment is never a dead end. Closes the tab when
 * there's nothing to pay. The minted URL is one-time and never persisted or logged.
 */
async function openWhmcsPay(invoiceId: number, directUrl: string | null, win: Window | null): Promise<void> {
  let target = directUrl ?? "";
  try {
    const res = await apiRequest("POST", `/api/billing/invoices/${invoiceId}/pay-link`);
    const body = await res.json().catch(() => null);
    if (body?.url) target = body.url as string;
  } catch {
    // SSO unavailable / not linked / unreachable — fall back to the direct link.
  }
  if (!target) {
    if (win) win.close();
    return;
  }
  if (win) {
    win.location.href = target;
  } else {
    window.open(target, "_blank", "noopener,noreferrer");
  }
}

interface OrderableProductCycle {
  cycle: string;
  label: string;
  price: string;
  setupFee: string | null;
}

interface OrderableProduct {
  pid: number;
  gid: number;
  name: string;
  description: string;
  currency: string | null;
  cycles: OrderableProductCycle[];
}

interface OrderableProductsPayload {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  unreachable: boolean;
  hasGateway: boolean;
  products: OrderableProduct[];
}

interface UpgradeOption {
  pid: number;
  name: string;
  billingCycle: string;
  billingCycleLabel: string;
  price: string;
  setupFee: string | null;
  proratedPrice: string | null;
}

interface UpgradeOptionsPayload {
  ok: boolean;
  message?: string;
  currentProductId?: number;
  currentName?: string;
  currentAmount?: string;
  currentBillingCycle?: string;
  currency?: string | null;
  options?: UpgradeOption[];
}

interface PayResult {
  ok: boolean;
  message?: string;
  invoiceId?: number | null;
  payUrl?: string | null;
}

interface DerivedServicesPayload {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  unreachable: boolean;
  services: Service[];
}

interface ActiveService {
  id: number;
  name: string;
  status: string;
  billingCycle: string;
  nextDueDate: string | null;
  amount: string;
  username: string;
  password: string;
  dns: string;
}

interface ActiveServicesPayload {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  unreachable: boolean;
  services: ActiveService[];
}

function formatServiceDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function statusLabel(status: string): string {
  switch (status) {
    case "operational": return "Operational";
    case "degraded": return "Degraded";
    case "outage": return "Outage";
    case "maintenance": return "Maintenance";
    default: return status || "—";
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "operational":
      return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
    case "degraded":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "outage":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "maintenance":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function ServiceCredentialRow({
  label,
  value,
  secret,
  serviceId,
  field,
}: {
  label: string;
  value: string;
  secret?: boolean;
  serviceId: number;
  field: "username" | "password" | "newpassword" | "dns";
}) {
  const { toast } = useToast();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasValue = value.trim().length > 0;
  const shown = !secret || revealed ? value : "••••••••••••";

  const copy = async () => {
    if (!hasValue) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: `Couldn't copy ${label.toLowerCase()}`, variant: "destructive" });
    }
  };

  return (
    <div className="flex items-center justify-between gap-3" data-testid={`row-service-${field}-${serviceId}`}>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={`text-sm ${hasValue ? "font-medium" : "text-muted-foreground"} ${secret ? "font-mono" : ""} truncate`}
          data-testid={`text-service-${field}-${serviceId}`}
        >
          {hasValue ? shown : "Not set"}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {secret && hasValue && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? "Hide password" : "Show password"}
            data-testid={`button-toggle-${field}-${serviceId}`}
          >
            {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </Button>
        )}
        {hasValue && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={copy}
            aria-label={`Copy ${label.toLowerCase()}`}
            data-testid={`button-copy-${field}-${serviceId}`}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
        )}
      </div>
    </div>
  );
}

function ResetPasswordAction({ service }: { service: ActiveService }) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The freshly reset password, shown ONCE after a successful reset. Kept only in
  // component state — never persisted; refetching /api/my/services brings back
  // the WHMCS-stored value on the next page load.
  const [newPassword, setNewPassword] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/my/services/${service.id}/password`);
      return (await res.json()) as { ok: boolean; password: string; message: string };
    },
    onSuccess: async (data) => {
      setNewPassword(data.password);
      toast({ title: "Password reset", description: "Your new service password is shown below." });
      // Bring the rest of the page in sync (status / due date may shift in WHMCS).
      await queryClient.invalidateQueries({ queryKey: ["/api/my/services"] });
    },
    onError: (err: Error) => {
      // apiRequest throws "<status>: <body>"; pull the friendly message out of the
      // JSON body when present, otherwise fall back to a generic line.
      let description = "Please try again in a few minutes.";
      const match = err.message.match(/^\d+:\s*(.*)$/s);
      if (match) {
        try {
          const parsed = JSON.parse(match[1]);
          if (typeof parsed?.message === "string") description = parsed.message;
        } catch {
          /* non-JSON body — keep the generic message */
        }
      }
      toast({ title: "Couldn't reset password", description, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-3">
      {newPassword ? (
        <div
          className="rounded-md border border-green-500/30 bg-green-500/10 p-3 space-y-2"
          data-testid={`panel-new-password-${service.id}`}
        >
          <p className="text-xs font-medium text-green-700 dark:text-green-400">
            New password — copy it now, it won't be shown again.
          </p>
          <ServiceCredentialRow
            label="New password"
            value={newPassword}
            secret
            serviceId={service.id}
            field="newpassword"
          />
        </div>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        disabled={mutation.isPending}
        onClick={() => setConfirmOpen(true)}
        data-testid={`button-reset-password-${service.id}`}
      >
        {mutation.isPending ? (
          <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
        ) : (
          <RefreshCw className="w-3.5 h-3.5 mr-2" />
        )}
        {newPassword ? "Reset password again" : "Reset password"}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid={`dialog-reset-password-${service.id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset this service's password?</AlertDialogTitle>
            <AlertDialogDescription>
              This changes the live password for <span className="font-medium">{service.name}</span> right
              away. Anything using the old password will stop working until you update it. You'll see the new
              password once after it's reset.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-cancel-reset-password-${service.id}`}>
              Keep current password
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => mutation.mutate()}
              data-testid={`button-confirm-reset-password-${service.id}`}
            >
              Reset password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ActiveServiceCard({ service, autoOpen = false }: { service: ActiveService; autoOpen?: boolean }) {
  const [open, setOpen] = useState(autoOpen);
  const cardRef = useRef<HTMLDivElement>(null);
  // When deep-linked from a "your new service is ready" notification
  // (/my-services?service=<id>), expand this card and bring it into view so the
  // customer lands directly on their new login details + DNS.
  useEffect(() => {
    if (autoOpen) {
      setOpen(true);
      cardRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [autoOpen]);
  return (
    <Card ref={cardRef} data-testid={`card-active-service-${service.id}`}>
      <CardContent className="p-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-3 text-left hover-elevate active-elevate-2 -m-3 p-3 rounded-md"
          aria-expanded={open}
          data-testid={`button-toggle-service-${service.id}`}
        >
          <div className="min-w-0">
            <p className="font-medium text-sm truncate" data-testid={`text-active-service-name-${service.id}`}>
              {service.name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {service.billingCycle || "—"}
              {service.amount ? ` · ${service.amount}` : ""}
              {service.nextDueDate ? ` · Next due ${formatServiceDate(service.nextDueDate)}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge
              variant="outline"
              className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30"
              data-testid={`badge-active-service-status-${service.id}`}
            >
              Active
            </Badge>
            <ChevronDown
              className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </div>
        </button>
        {open && (
          <div className="mt-3 pt-3 border-t space-y-3" data-testid={`panel-service-credentials-${service.id}`}>
            <ServiceCredentialRow label="Username" value={service.username} serviceId={service.id} field="username" />
            <ServiceCredentialRow label="Password" value={service.password} secret serviceId={service.id} field="password" />
            {service.dns ? (
              <ServiceCredentialRow label="DNS" value={service.dns} serviceId={service.id} field="dns" />
            ) : null}
            <ResetPasswordAction service={service} />
            <UpgradePlanAction service={service} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Per-service "Upgrade / change plan" flow. Lazily loads the other products in the
 * same group (only when the dialog opens), lets the customer pick a target plan +
 * term, then submits the change. On success WHMCS raises an upgrade invoice and we
 * hand straight off to the SSO pay page; the active-services list is refreshed so
 * the new plan/price shows. Renders nothing when there are no other plans to move
 * to (e.g. a standalone product), so the button never dead-ends.
 */
function UpgradePlanAction({ service }: { service: ActiveService }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const { toast } = useToast();

  const { data, isLoading } = useQuery<UpgradeOptionsPayload>({
    queryKey: ["/api/billing/services", service.id, "upgrade-options"],
    enabled: open,
  });

  const options = data?.ok ? data.options ?? [] : [];
  const chosen = options.find((o) => String(o.pid) === selected) ?? null;

  const mutation = useMutation({
    mutationFn: async (_win: Window | null) => {
      if (!chosen) throw new Error("Pick a plan first.");
      const res = await apiRequest("POST", `/api/billing/services/${service.id}/upgrade`, {
        newProductId: chosen.pid,
        billingCycle: chosen.billingCycle,
      });
      return (await res.json()) as PayResult;
    },
    onSuccess: (result, win) => {
      setOpen(false);
      setSelected("");
      queryClient.invalidateQueries({ queryKey: ["/api/my/services"] });
      toast({ title: "Plan change submitted", description: result.message ?? "We've started your plan change." });
      if (result.invoiceId) {
        void openWhmcsPay(result.invoiceId, result.payUrl ?? null, win);
      } else if (win) {
        win.close();
      }
    },
    onError: (err: any, win) => {
      if (win) win.close();
      toast({
        variant: "destructive",
        title: "Couldn't change your plan",
        description: err?.message || "Please try again shortly.",
      });
    },
  });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setOpen(true)}
        data-testid={`button-open-upgrade-${service.id}`}
      >
        <ArrowUpCircle className="w-3.5 h-3.5 mr-2" />
        Upgrade / change plan
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSelected(""); }}>
        <DialogContent data-testid={`dialog-upgrade-${service.id}`}>
          <DialogHeader>
            <DialogTitle>Change plan for {service.name}</DialogTitle>
            <DialogDescription>
              Pick a different plan below. We'll prorate the difference and send you to a secure
              payment page to finish.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <Skeleton className="h-24 rounded-lg" data-testid={`upgrade-options-loading-${service.id}`} />
          ) : options.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2" data-testid={`text-no-upgrade-options-${service.id}`}>
              There are no other plans available for this service right now.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor={`upgrade-select-${service.id}`}>New plan</Label>
                <Select value={selected} onValueChange={setSelected}>
                  <SelectTrigger id={`upgrade-select-${service.id}`} data-testid={`select-upgrade-plan-${service.id}`}>
                    <SelectValue placeholder="Choose a plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((o) => (
                      <SelectItem key={o.pid} value={String(o.pid)} data-testid={`option-upgrade-plan-${o.pid}`}>
                        {o.name} — {o.price} / {o.billingCycleLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {chosen && (
                <div className="rounded-md border p-3 text-sm space-y-1" data-testid={`upgrade-summary-${service.id}`}>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">New recurring price</span>
                    <span className="font-medium">{chosen.price} / {chosen.billingCycleLabel}</span>
                  </div>
                  {chosen.proratedPrice && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Due now (prorated)</span>
                      <span className="font-medium" data-testid={`text-upgrade-prorated-${service.id}`}>{chosen.proratedPrice}</span>
                    </div>
                  )}
                  {chosen.setupFee && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Setup fee</span>
                      <span className="font-medium">{chosen.setupFee}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} data-testid={`button-cancel-upgrade-${service.id}`}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => mutation.mutate(openBlankTab())}
              disabled={!chosen || mutation.isPending}
              data-testid={`button-confirm-upgrade-${service.id}`}
            >
              {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5 mr-2" />}
              Continue to payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * "Order a new service" flow shown above the active-services list. Lazily loads
 * the orderable product catalogue when opened, lets the customer pick a product +
 * term, places the order, then hands off to the SSO pay page for the new invoice.
 * Refreshes the active-services list on success. Degrades quietly: hidden when the
 * catalogue is empty/unreachable, and surfaces a friendly note when no payment
 * method is configured (so the customer never hits a broken checkout).
 */
function AddServiceFlow() {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<string>("");
  const [cycle, setCycle] = useState<string>("");
  const { toast } = useToast();

  // Always pull a fresh catalogue each time the dialog opens so WHMCS changes
  // (newly hidden/added products, price edits) show instantly — the global
  // staleTime is Infinity, which would otherwise reuse a session-old copy.
  const { data, isLoading } = useQuery<OrderableProductsPayload>({
    queryKey: ["/api/billing/products"],
    enabled: open,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const products = data?.products ?? [];
  const product = products.find((p) => String(p.pid) === productId) ?? null;
  const cycleOpt = product?.cycles.find((c) => c.cycle === cycle) ?? null;

  const mutation = useMutation({
    mutationFn: async (_win: Window | null) => {
      if (!product || !cycleOpt) throw new Error("Pick a product and term first.");
      const res = await apiRequest("POST", "/api/billing/order", {
        pid: product.pid,
        billingCycle: cycleOpt.cycle,
      });
      return (await res.json()) as PayResult;
    },
    onSuccess: (result, win) => {
      setOpen(false);
      setProductId("");
      setCycle("");
      queryClient.invalidateQueries({ queryKey: ["/api/my/services"] });
      toast({ title: "Order placed", description: result.message ?? "We've created your order." });
      if (result.invoiceId) {
        void openWhmcsPay(result.invoiceId, result.payUrl ?? null, win);
      } else if (win) {
        win.close();
      }
    },
    onError: (err: any, win) => {
      if (win) win.close();
      toast({
        variant: "destructive",
        title: "Couldn't place your order",
        description: err?.message || "Please try again shortly.",
      });
    },
  });

  const noGateway = !!data && !data.unreachable && data.products.length > 0 && !data.hasGateway;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="button-open-add-service"
      >
        <Plus className="w-3.5 h-3.5 mr-2" />
        Order a new service
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setProductId(""); setCycle(""); } }}>
        <DialogContent data-testid="dialog-add-service">
          <DialogHeader>
            <DialogTitle>Order a new service</DialogTitle>
            <DialogDescription>
              Choose a product and billing term. We'll create the order and send you to a secure
              payment page to finish.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <Skeleton className="h-24 rounded-lg" data-testid="add-service-loading" />
          ) : data?.unreachable ? (
            <p className="text-sm text-muted-foreground py-2" data-testid="text-add-service-unreachable">
              We couldn't load the catalogue right now. Please try again in a few minutes.
            </p>
          ) : products.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2" data-testid="text-add-service-empty">
              There are no products available to order right now.
            </p>
          ) : noGateway ? (
            <p className="text-sm text-muted-foreground py-2" data-testid="text-add-service-no-gateway">
              Online ordering isn't available right now. Please contact support to place an order.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="add-service-product">Product</Label>
                <Select
                  value={productId}
                  onValueChange={(v) => { setProductId(v); setCycle(""); }}
                >
                  <SelectTrigger id="add-service-product" data-testid="select-order-product">
                    <SelectValue placeholder="Choose a product" />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    collisionPadding={{ top: 60, bottom: 24, left: 12, right: 12 }}
                    className="max-h-[min(60dvh,var(--radix-select-content-available-height))]"
                  >
                    {products.map((p) => {
                      // When a product offers exactly one billing cycle (common when each
                      // term is set up as its own WHMCS product, e.g. "Web Hosting Monthly"
                      // vs "Web Hosting Quarterly"), the bare names look identical. Append
                      // the term so each row is distinguishable in the list itself.
                      const term = p.cycles.length === 1 ? ` – ${p.cycles[0].label}` : "";
                      return (
                        <SelectItem key={p.pid} value={String(p.pid)} data-testid={`option-order-product-${p.pid}`}>
                          {p.name}{term}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {product && (
                <div className="space-y-1.5">
                  <Label htmlFor="add-service-cycle">Billing term</Label>
                  <Select value={cycle} onValueChange={setCycle}>
                    <SelectTrigger id="add-service-cycle" data-testid="select-order-cycle">
                      <SelectValue placeholder="Choose a term" />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      collisionPadding={{ top: 60, bottom: 24, left: 12, right: 12 }}
                      className="max-h-[min(60dvh,var(--radix-select-content-available-height))]"
                    >
                      {product.cycles.map((c) => (
                        <SelectItem key={c.cycle} value={c.cycle} data-testid={`option-order-cycle-${c.cycle}`}>
                          {c.label} — {c.price}
                          {c.setupFee ? ` (+ ${c.setupFee} setup)` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {product?.description && (
                <p className="text-xs text-muted-foreground" data-testid="text-order-product-description">
                  {product.description}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} data-testid="button-cancel-add-service">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => mutation.mutate(openBlankTab())}
              disabled={!product || !cycleOpt || mutation.isPending}
              data-testid="button-confirm-add-service"
            >
              {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5 mr-2" />}
              Continue to payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface StoreConfigOptionChoice {
  id: number;
  name: string;
  prices?: Record<string, string>;
}

/**
 * The extra price label to show next to a configurable-option choice for the
 * currently-selected billing cycle. WHMCS stores a one-time product's option
 * price under the recurring "monthly" key (same quirk as the product itself),
 * so the synthetic onetime/free cycles fall back to monthly. Returns "" when no
 * usable price is known (older WHMCS installs omit option pricing), "Free" for a
 * $0 option, or "+ <amount>" otherwise.
 */
function choicePriceLabel(prices: Record<string, string> | undefined, cycle: string): string {
  const raw = priceForCycle(prices, cycle);
  if (raw == null) return "";
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return "";
  return n === 0 ? "Free" : `+ ${raw}`;
}

interface StoreConfigOption {
  id: number;
  name: string;
  type: "dropdown" | "radio" | "yesno" | "quantity";
  required: boolean;
  choices: StoreConfigOptionChoice[];
}

interface StoreCustomField {
  id: number;
  name: string;
  description: string;
  fieldType: string;
  required: boolean;
  options: string[];
}

interface StoreCatalogueProduct {
  pid: number;
  name: string;
  description: string;
  imageUrl: string | null;
  category: string | null;
  sortOrder: number;
  currency: string | null;
  cycles: OrderableProductCycle[];
  configOptions: StoreConfigOption[];
  customFields: StoreCustomField[];
}

interface StoreCataloguePayload {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  unreachable: boolean;
  hasGateway: boolean;
  products: StoreCatalogueProduct[];
}

/**
 * "Order a new product" flow — the admin-curated WHMCS storefront (Task #518).
 * Mirrors AddServiceFlow but adds the configurable options + custom fields the
 * admin enabled for each product, grouped by category. Lazily loads the
 * catalogue when opened, validates required fields client-side, places the
 * order, then hands off to the SSO pay page for the new invoice. Hidden unless
 * billing is live, the customer is linked, and at least one product is curated.
 */
function AddProductFlow() {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<string>("");
  const [cycle, setCycle] = useState<string>("");
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const { data, isLoading } = useQuery<StoreCataloguePayload>({
    queryKey: ["/api/billing/store-products"],
    enabled: open,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const products = data?.products ?? [];
  const product = products.find((p) => String(p.pid) === productId) ?? null;
  const cycleOpt = product?.cycles.find((c) => c.cycle === cycle) ?? null;

  // Running estimate shown above the pay button so the customer sees the total
  // before the WHMCS handoff. Pure helper lives in @shared/store-estimate.
  const estimate = useMemo(
    () => (product && cycleOpt ? computeOrderEstimate(product, cycle, configValues) : null),
    [product, cycleOpt, cycle, configValues],
  );

  const reset = () => {
    setProductId("");
    setCycle("");
    setConfigValues({});
    setCustomValues({});
  };

  const buildOrderPayload = () => {
    if (!product || !cycleOpt) return null;
    const configOptions: Record<string, number> = {};
    for (const opt of product.configOptions) {
      const v = configValues[String(opt.id)];
      if (opt.type === "dropdown" || opt.type === "radio") {
        if (v) configOptions[String(opt.id)] = Number(v);
      } else if (opt.type === "quantity") {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) configOptions[String(opt.id)] = Math.trunc(n);
      } else {
        // yesno: only send when the customer opted in.
        if (v === "1") configOptions[String(opt.id)] = 1;
      }
    }
    const customFields: Record<string, string> = {};
    for (const f of product.customFields) {
      const v = (customValues[String(f.id)] ?? "").trim();
      if (v) customFields[String(f.id)] = v;
    }
    return { pid: product.pid, billingCycle: cycleOpt.cycle, configOptions, customFields };
  };

  // Client-side required check for immediate feedback (the server re-validates).
  const missingRequired = (): string | null => {
    if (!product) return null;
    for (const opt of product.configOptions) {
      if (!opt.required) continue;
      const v = configValues[String(opt.id)];
      if (opt.type === "dropdown" || opt.type === "radio") {
        if (!v) return `Please choose an option for "${opt.name}".`;
      } else if (opt.type === "quantity") {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return `Please enter a quantity for "${opt.name}".`;
      } else if (opt.type === "yesno") {
        if (v !== "1") return `"${opt.name}" is required.`;
      }
    }
    for (const f of product.customFields) {
      if (f.required && !(customValues[String(f.id)] ?? "").trim()) {
        return `Please fill in "${f.name}".`;
      }
    }
    return null;
  };

  const mutation = useMutation({
    mutationFn: async (_win: Window | null) => {
      const payload = buildOrderPayload();
      if (!payload) throw new Error("Pick a product and term first.");
      const res = await apiRequest("POST", "/api/billing/store-order", payload);
      return (await res.json()) as PayResult;
    },
    onSuccess: (result, win) => {
      setOpen(false);
      reset();
      queryClient.invalidateQueries({ queryKey: ["/api/my/services"] });
      toast({ title: "Order placed", description: result.message ?? "We've created your order." });
      if (result.invoiceId) {
        void openWhmcsPay(result.invoiceId, result.payUrl ?? null, win);
      } else if (win) {
        win.close();
      }
    },
    onError: (err: any, win) => {
      if (win) win.close();
      toast({
        variant: "destructive",
        title: "Couldn't place your order",
        description: err?.message || "Please try again shortly.",
      });
    },
  });

  const handleConfirm = () => {
    const problem = missingRequired();
    if (problem) {
      toast({ variant: "destructive", title: "Almost there", description: problem });
      return;
    }
    mutation.mutate(openBlankTab());
  };

  const noGateway = !!data && !data.unreachable && data.products.length > 0 && !data.hasGateway;
  const dropdownContentProps = {
    position: "popper" as const,
    collisionPadding: { top: 60, bottom: 24, left: 12, right: 12 },
    // Cap the menu width to the viewport so long option labels wrap (see the
    // wrapping SelectItems) instead of overflowing off-screen and getting clipped.
    className:
      "max-h-[min(60dvh,var(--radix-select-content-available-height))] max-w-[calc(100vw-1.5rem)]",
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="button-open-add-product"
      >
        <Plus className="w-3.5 h-3.5 mr-2" />
        Order new product
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent data-testid="dialog-add-product" className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Order a new product</DialogTitle>
            <DialogDescription>
              Choose a product and billing term, fill in any options, and we'll send you to a secure
              payment page to finish.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <Skeleton className="h-24 rounded-lg" data-testid="add-product-loading" />
          ) : data?.unreachable ? (
            <p className="text-sm text-muted-foreground py-2" data-testid="text-add-product-unreachable">
              We couldn't load the catalogue right now. Please try again in a few minutes.
            </p>
          ) : products.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2" data-testid="text-add-product-empty">
              There are no products available to order right now.
            </p>
          ) : noGateway ? (
            <p className="text-sm text-muted-foreground py-2" data-testid="text-add-product-no-gateway">
              Online ordering isn't available right now. Please contact support to place an order.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="add-product-product">Product</Label>
                <Select
                  value={productId}
                  onValueChange={(v) => {
                    setProductId(v);
                    // Auto-select the term when the product offers only one (e.g. a
                    // one-time or free product), so the customer needn't re-pick it.
                    const p = products.find((pp) => String(pp.pid) === v) ?? null;
                    setCycle(p && p.cycles.length === 1 ? p.cycles[0].cycle : "");
                    setConfigValues({});
                    setCustomValues({});
                  }}
                >
                  <SelectTrigger id="add-product-product" data-testid="select-store-product">
                    <SelectValue placeholder="Choose a product" />
                  </SelectTrigger>
                  <SelectContent {...dropdownContentProps}>
                    {products.map((p) => {
                      const term = p.cycles.length === 1 ? ` – ${p.cycles[0].label}` : "";
                      const cat = p.category ? `${p.category}: ` : "";
                      return (
                        <SelectItem key={p.pid} value={String(p.pid)} className="whitespace-normal break-words" data-testid={`option-store-product-${p.pid}`}>
                          {cat}{p.name}{term}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {product?.imageUrl && (
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  loading="lazy"
                  className="w-full max-h-48 rounded-lg border bg-muted object-contain"
                  data-testid="img-store-product"
                />
              )}

              {product?.description && (
                <p className="text-xs text-muted-foreground" data-testid="text-store-product-description">
                  {product.description}
                </p>
              )}

              {product && (
                <div className="space-y-1.5">
                  <Label htmlFor="add-product-cycle">Billing term</Label>
                  <Select value={cycle} onValueChange={setCycle}>
                    <SelectTrigger id="add-product-cycle" data-testid="select-store-cycle">
                      <SelectValue placeholder="Choose a term" />
                    </SelectTrigger>
                    <SelectContent {...dropdownContentProps}>
                      {product.cycles.map((c) => (
                        <SelectItem key={c.cycle} value={c.cycle} className="whitespace-normal break-words" data-testid={`option-store-cycle-${c.cycle}`}>
                          {c.label} — {c.price}
                          {c.setupFee ? ` (+ ${c.setupFee} setup)` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Configurable options */}
              {product && product.configOptions.length > 0 && (
                <div className="space-y-3 rounded-lg border p-3" data-testid="group-config-options">
                  <p className="text-xs font-medium text-muted-foreground">Options</p>
                  {product.configOptions.map((opt) => {
                    const key = String(opt.id);
                    const val = configValues[key] ?? "";
                    const setVal = (v: string) => setConfigValues((prev) => ({ ...prev, [key]: v }));
                    return (
                      <div key={opt.id} className="space-y-1.5" data-testid={`config-option-${opt.id}`}>
                        <Label htmlFor={`config-${opt.id}`}>
                          {opt.name}{opt.required ? " *" : ""}
                        </Label>
                        {(opt.type === "dropdown" || opt.type === "radio") ? (
                          <Select value={val} onValueChange={setVal}>
                            <SelectTrigger id={`config-${opt.id}`} data-testid={`select-config-${opt.id}`}>
                              <SelectValue placeholder="Choose…" />
                            </SelectTrigger>
                            <SelectContent {...dropdownContentProps}>
                              {opt.choices.map((ch) => {
                                const priceLabel = choicePriceLabel(ch.prices, cycle);
                                return (
                                  <SelectItem
                                    key={ch.id}
                                    value={String(ch.id)}
                                    className="whitespace-normal break-words"
                                    data-testid={`option-config-${opt.id}-${ch.id}`}
                                  >
                                    {ch.name}{priceLabel ? ` (${priceLabel})` : ""}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        ) : opt.type === "quantity" ? (
                          <Input
                            id={`config-${opt.id}`}
                            type="number"
                            min={0}
                            value={val}
                            onChange={(e) => setVal(e.target.value)}
                            data-testid={`input-config-${opt.id}`}
                          />
                        ) : (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Switch
                              checked={val === "1"}
                              onCheckedChange={(c) => setVal(c ? "1" : "0")}
                              data-testid={`switch-config-${opt.id}`}
                            />
                            <span className="text-sm text-muted-foreground">Add this option</span>
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Custom fields */}
              {product && product.customFields.length > 0 && (
                <div className="space-y-3 rounded-lg border p-3" data-testid="group-custom-fields">
                  <p className="text-xs font-medium text-muted-foreground">Additional details</p>
                  {product.customFields.map((f) => {
                    const key = String(f.id);
                    const val = customValues[key] ?? "";
                    const setVal = (v: string) => setCustomValues((prev) => ({ ...prev, [key]: v }));
                    const ft = f.fieldType.toLowerCase();
                    return (
                      <div key={f.id} className="space-y-1.5" data-testid={`custom-field-${f.id}`}>
                        <Label htmlFor={`custom-${f.id}`}>
                          {f.name}{f.required ? " *" : ""}
                        </Label>
                        {ft === "dropdown" && f.options.length > 0 ? (
                          <Select value={val} onValueChange={setVal}>
                            <SelectTrigger id={`custom-${f.id}`} data-testid={`select-custom-${f.id}`}>
                              <SelectValue placeholder="Choose…" />
                            </SelectTrigger>
                            <SelectContent {...dropdownContentProps}>
                              {f.options.map((o) => (
                                <SelectItem key={o} value={o} className="whitespace-normal break-words" data-testid={`option-custom-${f.id}-${o}`}>
                                  {o}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : ft === "textarea" ? (
                          <Textarea
                            id={`custom-${f.id}`}
                            value={val}
                            onChange={(e) => setVal(e.target.value)}
                            rows={3}
                            data-testid={`textarea-custom-${f.id}`}
                          />
                        ) : ft === "tickbox" ? (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              checked={val === "on"}
                              onCheckedChange={(c) => setVal(c ? "on" : "")}
                              data-testid={`checkbox-custom-${f.id}`}
                            />
                            <span className="text-sm text-muted-foreground">{f.description || "Yes"}</span>
                          </label>
                        ) : (
                          <Input
                            id={`custom-${f.id}`}
                            type={ft === "password" ? "password" : "text"}
                            value={val}
                            onChange={(e) => setVal(e.target.value)}
                            data-testid={`input-custom-${f.id}`}
                          />
                        )}
                        {f.description && ft !== "tickbox" && (
                          <p className="text-xs text-muted-foreground">{f.description}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {estimate && estimate.complete && cycleOpt && (
                <div className="rounded-lg border p-3 space-y-1" data-testid="group-order-estimate">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">Estimated total</span>
                    <span className="text-sm font-semibold" data-testid="text-order-estimate-total">
                      {estimate.recurringTotal.toFixed(2)}
                      {estimate.currency ? ` ${estimate.currency}` : ""}
                      {cycle !== "onetime" && cycle !== "free" ? ` / ${cycleOpt.label.toLowerCase()}` : ""}
                    </span>
                  </div>
                  {estimate.setupTotal > 0 && (
                    <p className="text-xs text-muted-foreground" data-testid="text-order-estimate-setup">
                      + {estimate.setupTotal.toFixed(2)}
                      {estimate.currency ? ` ${estimate.currency}` : ""} one-time setup
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Estimated — final taxes, fees, or promo codes are applied at checkout.
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} data-testid="button-cancel-add-product">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={!product || !cycleOpt || mutation.isPending}
              data-testid="button-confirm-add-product"
            >
              {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5 mr-2" />}
              Continue to payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MyActiveServices() {
  const { data, isLoading } = useQuery<ActiveServicesPayload>({
    queryKey: ["/api/my/services"],
  });

  // Deep-link target from a "your new service is ready" notification:
  // /my-services?service=<id> auto-expands and scrolls to that service's card.
  const search = useSearch();
  const deepLinkServiceId = new URLSearchParams(search).get("service");

  if (isLoading) return <Skeleton className="h-28 rounded-xl" data-testid="active-services-loading" />;
  // Only render the section when billing is live and the customer is linked.
  if (!data || !data.configured || !data.enabled || !data.linked) return null;

  const hasServices = !data.unreachable && data.services.length > 0;

  return (
    <div data-testid="my-active-services">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 mb-2">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold" data-testid="heading-active-services">Active services</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddServiceFlow />
          <AddProductFlow />
        </div>
      </div>
      {data.unreachable ? (
        <p className="text-sm text-muted-foreground px-1 py-3" data-testid="text-active-services-unreachable">
          We couldn't load your services right now. Please try again in a few minutes.
        </p>
      ) : !hasServices ? (
        <p className="text-sm text-muted-foreground px-1 py-3" data-testid="text-active-services-empty">
          You don't have any active services right now.
        </p>
      ) : (
        <div className="space-y-2">
          {data.services.map((s) => (
            <ActiveServiceCard key={s.id} service={s} autoOpen={String(s.id) === deepLinkServiceId} />
          ))}
        </div>
      )}
    </div>
  );
}

function MyMonitoredServices() {
  const { data, isLoading } = useQuery<DerivedServicesPayload>({
    queryKey: ["/api/my/whmcs-services"],
  });

  if (isLoading) return <Skeleton className="h-28 rounded-xl" data-testid="my-services-loading" />;
  // Only render when there's something to show — linked with mapped services.
  if (!data || !data.configured || !data.enabled || !data.linked) return null;
  if (data.unreachable || data.services.length === 0) return null;

  return (
    <div data-testid="my-monitored-services">
      <div className="flex items-center gap-2 mb-2">
        <Server className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold" data-testid="heading-my-services">Monitored services included with your products</h2>
      </div>
      <div className="space-y-2">
        {data.services.map((s) => (
          <Card key={s.id} data-testid={`card-my-service-${s.id}`}>
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate" data-testid={`text-my-service-name-${s.id}`}>{s.name}</p>
                {s.description && (
                  <p className="text-xs text-muted-foreground truncate">{s.description}</p>
                )}
              </div>
              <Badge variant="outline" className={`shrink-0 ${statusBadgeClass(s.status)}`} data-testid={`badge-my-service-status-${s.id}`}>
                {statusLabel(s.status)}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * Friendly notice shown when there are no services to display because WHMCS
 * isn't wired up for this account or the account isn't linked yet. Reads the same
 * /api/my/services AND /api/my/whmcs-services payloads as the two service sections
 * (react-query dedupes both requests) and renders ONLY when NEITHER section would
 * render anything, so the page is never blank and never double-renders. Never errors.
 */
function NoServicesNotice() {
  const { data, isLoading } = useQuery<ActiveServicesPayload>({
    queryKey: ["/api/my/services"],
  });
  const { data: monitored, isLoading: monitoredLoading } = useQuery<DerivedServicesPayload>({
    queryKey: ["/api/my/whmcs-services"],
  });

  if (isLoading || monitoredLoading) return null;
  // When linked + live, MyActiveServices owns the rendering (list / empty / error).
  if (data && data.configured && data.enabled && data.linked) return null;
  // When the monitored-services section has something to show, it owns the page.
  if (
    monitored &&
    monitored.configured &&
    monitored.enabled &&
    monitored.linked &&
    !monitored.unreachable &&
    monitored.services.length > 0
  ) {
    return null;
  }

  const needsLink = !!data && data.configured && data.enabled && !data.linked;

  return (
    <Card data-testid="card-no-services">
      <CardContent className="p-6 text-center">
        <KeyRound className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-base font-semibold" data-testid="text-no-services-title">
          {needsLink ? "Link your account to see your services" : "No services to show yet"}
        </p>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto" data-testid="text-no-services-description">
          {needsLink
            ? "Connect your billing account to view your active services, logins, and more."
            : "Your active services and logins will appear here once they're available."}
        </p>
        {needsLink && (
          <Button asChild variant="outline" size="sm" className="mt-4" data-testid="button-link-account">
            <Link href="/settings">Link your account</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function MyServicesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-my-services-title">My Services</h1>
        <p className="text-sm text-muted-foreground mt-1">Your active services, logins, and status</p>
      </div>

      <MyActiveServices />

      <MyMonitoredServices />

      <NoServicesNotice />
    </div>
  );
}
