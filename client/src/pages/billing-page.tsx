import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { BillingSummaryView, type BillingSummary } from "@/components/billing-summary";
import { WhmcsProfileCard } from "@/components/whmcs-profile-card";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
} from "lucide-react";
import type { Service } from "@shared/schema";

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
  field: "username" | "password" | "newpassword";
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

function ActiveServiceCard({ service }: { service: ActiveService }) {
  const [open, setOpen] = useState(false);
  return (
    <Card data-testid={`card-active-service-${service.id}`}>
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
            <ResetPasswordAction service={service} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MyActiveServices() {
  const { data, isLoading } = useQuery<ActiveServicesPayload>({
    queryKey: ["/api/my/services"],
  });

  if (isLoading) return <Skeleton className="h-28 rounded-xl" data-testid="active-services-loading" />;
  // Only render the section when billing is live and the customer is linked.
  if (!data || !data.configured || !data.enabled || !data.linked) return null;

  const hasServices = !data.unreachable && data.services.length > 0;

  return (
    <div data-testid="my-active-services">
      <div className="flex items-center gap-2 mb-2">
        <KeyRound className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold" data-testid="heading-active-services">My Services</h2>
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
            <ActiveServiceCard key={s.id} service={s} />
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

export default function BillingPage() {
  const { data, isLoading } = useQuery<BillingSummary>({
    queryKey: ["/api/billing"],
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-billing-title">Billing</h1>
        <p className="text-sm text-muted-foreground mt-1">Your invoices, services, and account balance</p>
      </div>

      <MyActiveServices />

      <MyMonitoredServices />

      <BillingSummaryView data={data} isLoading={isLoading} context="customer" />

      <WhmcsProfileCard />
    </div>
  );
}
