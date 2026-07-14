import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation, useSearch, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { queryClient, apiRequest, uploadRequest, liveQueryOptions } from "@/lib/queryClient";
import { alertStatusLabel, alertSeverityLabel } from "@/lib/status-meta";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Edit, Users, Server, AlertTriangle, Newspaper, RotateCcw, Shield, ShieldCheck, ShieldOff, Mail, MailX, Send, Clock, Zap, FileText, RefreshCw, Bell, BellOff, MailOpen, Copy, Eye, EyeOff, RotateCw, MessageSquare, Crown, Tag, Tags, LifeBuoy, ChevronDown, ChevronRight, ScrollText, Search, ArrowLeft, Globe, Activity, Circle, ExternalLink, Pause, Play, Megaphone, Check, Minus, BookOpen, Hash, LayoutDashboard, Bug, CheckCircle2, Rocket, Sparkles, CreditCard, Link2, Unlink, Smartphone, Wallet, TrendingUp, ServerCog } from "lucide-react";
import AdminDashboard from "./admin-dashboard";
import { ImageCropDialog, type CropAspectKey } from "@/components/image-crop-dialog";
import { format, formatDistanceToNow } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useReconnectingWebSocket } from "@/hooks/use-reconnecting-websocket";
import { useGlobalSocket } from "@/contexts/global-socket-context";
import { LiveConnectionBanner } from "@/components/live-connection-banner";
import { ClickableImage, ClickableVideo } from "@/components/image-lightbox";
import { PollEditor, emptyPollDraft, isPollDraftValid, submitPollDraft } from "@/components/poll-composer";
import { TemplateMessageEditor } from "@/components/template-message-editor";
import { BillingSummaryView, type BillingSummary } from "@/components/billing-summary";
import { WhmcsTicketList, WhmcsTicketThread, type WhmcsTicketsListData, type WhmcsTicketDetail, type WhmcsAttachment } from "@/components/whmcs-tickets";
import { Download, ImagePlus, X as XIcon, Paperclip, GripVertical, Star, Package } from "lucide-react";
import { KbArticlePickerDialog, type KbArticleRef } from "@/components/kb-article-picker-dialog";
import type { User, Service, ServiceAlert, ServiceAlertWithServices, AlertUpdate, AlertDraft, NewsStory, QuickResponse, QuickResponseCategory, ReportRequest, ServiceUpdate, EmailTemplate, AdminRole, TicketCategory, Download as DownloadItem, UrlMonitor, MonitorIncident, Announcement, KbCategory, KbArticle } from "@shared/schema";
import { slugify } from "@shared/kb";
import { RichTextEditor, stripHtml, clearTiptapDraft } from "@/components/rich-text-editor";
import { RichTextContent } from "@/components/rich-text-content";
import { ANNOUNCEMENT_ROUTES, getAnnouncementRouteLabel } from "@shared/announcement-routes";
import { APP_VERSION } from "@shared/version";
import { countBulletsInBody } from "@shared/changelog-append";
import { ROLLING_DRAFT_VERSION } from "@shared/changelog-rollover";
import DOMPurify from "dompurify";
import { applySuggestionsToTemplate, findUnknownPlaceholders, suggestKnownVariable } from "@shared/quick-response-vars";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_GROUPS, countEnabledGroups, userWantsChannel, type NotificationPrefs } from "@shared/notification-categories";
import { parseAdminPortalQuery, computeInitialActiveSection, computeInitialUserAction, ADMIN_MENU_SENTINEL } from "./admin-portal-deeplink";
import { NOTIFICATION_PAGE_SIZE, nextNotificationPageOffset, buildNotificationPageQuery, resolveNotificationLink } from "./admin-portal-notifications";

// Human-readable labels for the in-app notification `type` column, used by the
// admin customer-notification history view + its type filter. Types don't map
// 1:1 to preference category keys (e.g. the `ticket_update` type covers several
// ticket categories), so this is a dedicated display map. Unknown types fall
// back to the raw value.
const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  whmcs_service_added: "New service added",
  whmcs_service_ready: "New service is ready",
  whmcs_service_status: "Service status change",
  whmcs_service_renewal: "Service renewal reminder",
  whmcs_ticket_reply: "Billing ticket reply",
  whmcs_invoice_due: "Invoice reminder",
  ticket_update: "Ticket update",
  service_status: "Service status change",
  service_update: "Service update",
  service_alert: "Service alert",
  private_message: "Private message",
  message: "Conversation reply",
  report_update: "Report update",
  news: "News story",
  warning: "Moderation notice",
};

// The type-filter dropdown options for the admin customer-notification view.
// WHMCS "new service" categories are surfaced first so the common support
// question ("did this customer get the new-service notification?") is one click.
const NOTIFICATION_TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "whmcs_service_added", label: "New service added" },
  { value: "whmcs_service_ready", label: "New service is ready" },
  { value: "whmcs_service_status", label: "Service status change" },
  { value: "whmcs_service_renewal", label: "Service renewal reminder" },
  { value: "whmcs_invoice_due", label: "Invoice reminder" },
  { value: "whmcs_ticket_reply", label: "Billing ticket reply" },
  { value: "ticket_update", label: "Ticket update" },
  { value: "service_status", label: "Service status change" },
  { value: "service_update", label: "Service update" },
  { value: "service_alert", label: "Service alert" },
  { value: "private_message", label: "Private message" },
  { value: "message", label: "Conversation reply" },
  { value: "report_update", label: "Report update" },
  { value: "news", label: "News story" },
];

function notificationTypeLabel(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? type;
}

interface AdminUserNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  referenceType: string | null;
  referenceId: string | null;
  url: string | null;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
}

// Admin read-only history of every in-app (bell) notification a customer was
// sent — INCLUDING dismissed rows (support needs the full record, unlike the
// customer's own feed). Newest-first, "load more" paginated, with a type filter
// to isolate a category. Strictly read-only.
export function CustomerNotificationsSection({ userId }: { userId: string }) {
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Offset-based pagination (constant page size). "Load more" advances the
  // offset and appends the next page, so histories longer than the API's
  // per-request cap (100) stay fully reachable — a growing `limit` would clamp
  // and loop on the first page forever. See admin-portal-notifications.ts.
  const { data, isLoading, isError, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } = useInfiniteQuery<{
    notifications: AdminUserNotification[];
    hasMore: boolean;
  }>({
    queryKey: ["/api/admin/users", userId, "notifications", typeFilter],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const qs = buildNotificationPageQuery(pageParam as number, typeFilter);
      const res = await fetch(`/api/admin/users/${userId}/notifications?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load notifications");
      return res.json();
    },
    getNextPageParam: (_lastPage, allPages) => nextNotificationPageOffset(allPages),
    ...liveQueryOptions,
  });

  const notifications = data?.pages.flatMap((p) => p.notifications) ?? [];

  return (
    <div className="border rounded-md" data-testid="panel-customer-notifications">
      <div className="flex flex-col gap-2 px-3 py-3 border-b sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">Notifications received</p>
          <p className="text-xs text-muted-foreground">
            Read-only history of the in-app (bell) notifications sent to this customer.
          </p>
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 text-xs w-full sm:w-56" data-testid="select-notification-type-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All notifications</SelectItem>
            {NOTIFICATION_TYPE_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="p-3">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isError && notifications.length === 0 ? (
          <div
            className="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3"
            data-testid="text-customer-notifications-error"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-destructive" />
              <p className="text-xs text-destructive">
                We couldn't load this customer's notification history. This doesn't mean they
                received nothing — try again.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => refetch()}
              data-testid="button-retry-customer-notifications"
            >
              <RotateCw className="w-3.5 h-3.5 mr-1.5" />
              Retry
            </Button>
          </div>
        ) : notifications.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="text-customer-notifications-empty">
            {typeFilter === "all"
              ? "This customer hasn't received any notifications yet."
              : "This customer hasn't received any notifications of this type yet."}
          </p>
        ) : (
          <>
            <ul className="space-y-2" data-testid="list-customer-notifications">
              {notifications.map((n) => {
                const when = new Date(n.createdAt);
                const linkTo = resolveNotificationLink(n);
                return (
                  <li
                    key={n.id}
                    className="flex items-start gap-2 text-sm border rounded-md px-2.5 py-2"
                    data-testid={`row-customer-notification-${n.id}`}
                  >
                    <Bell className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {linkTo ? (
                          <Link
                            href={linkTo}
                            className="font-medium truncate inline-flex items-center gap-1 text-primary hover:underline"
                            data-testid={`link-customer-notification-${n.id}`}
                          >
                            <span className="truncate">{n.title}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </Link>
                        ) : (
                          <span className="font-medium truncate">{n.title}</span>
                        )}
                        <Badge variant="outline" className="h-5 px-1.5 text-xs" data-testid={`badge-notification-type-${n.id}`}>
                          {notificationTypeLabel(n.type)}
                        </Badge>
                        {n.dismissedAt ? (
                          <Badge variant="outline" className="h-5 px-1.5 text-xs text-muted-foreground" data-testid={`badge-notification-status-${n.id}`}>Dismissed</Badge>
                        ) : n.readAt ? (
                          <Badge variant="outline" className="h-5 px-1.5 text-xs text-muted-foreground" data-testid={`badge-notification-status-${n.id}`}>Read</Badge>
                        ) : (
                          <Badge variant="outline" className="h-5 px-1.5 text-xs" data-testid={`badge-notification-status-${n.id}`}>Not yet seen</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                      <p
                        className="text-xs text-muted-foreground"
                        title={when.toLocaleString()}
                        data-testid={`text-notification-when-${n.id}`}
                      >
                        {formatDistanceToNow(when, { addSuffix: true })}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            {isError && (
              <div
                className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
                data-testid="text-customer-notifications-loadmore-error"
              >
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-destructive" />
                <p className="text-xs text-destructive">
                  We couldn't load older notifications. Some history may be missing — try again.
                </p>
              </div>
            )}
            {hasNextPage && (
              <div className="pt-3 flex justify-center">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={isFetchingNextPage}
                  onClick={() => fetchNextPage()}
                  data-testid="button-load-more-notifications"
                >
                  {isFetchingNextPage ? "Loading..." : isError ? "Retry" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Preserve the admin tile-menu scroll position across a menu → section →
// "Back to Admin Menu" round-trip. The menu and every section share App.tsx's
// single scroll container (the PullToRefresh wrapper, id below); opening a
// shorter section clamps that container's scrollTop, so the menu offset is lost
// on return. We capture the offset at the moment a tile is clicked (before the
// section renders and the clamp happens) and restore it once the menu view is
// back. Module-scoped so the value survives the query-param re-render; cleared
// on unmount so a fresh entry to /admin always starts at the top.
const ADMIN_SCROLL_CONTAINER_ID = "app-scroll-container";
let savedAdminMenuScroll: number | null = null;

function pillColorClass(enabled: number, total: number): string {
  if (total === 0) return "bg-muted text-muted-foreground border-transparent";
  if (enabled === 0) return "bg-muted text-muted-foreground border-transparent";
  if (enabled === total) return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
  return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
}

const createServiceSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  category: z.string().optional(),
  status: z.string().default("operational"),
  discordWebhookUrl: z.string().trim().url("Must be a valid URL").or(z.literal("")).optional(),
  isDefault: z.boolean().default(false),
});

const createAlertSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required").refine(
    (val) => val.replace(/<[^>]*>/g, "").trim().length > 0,
    "Description is required"
  ),
  severity: z.string().default("warning"),
  status: z.string().default("investigating"),
  serviceImpact: z.string().default("degraded"),
  serviceIds: z.array(z.string()).min(1, "Select at least one service"),
  sendPush: z.boolean().default(true),
  sendEmail: z.boolean().default(true),
  silent: z.boolean().default(false),
});

const addUpdateSchema = z.object({
  // Message is required for customer-facing updates, but a SILENT update may be
  // a pure status change (e.g. flip to Monitoring without notifying anyone) —
  // in that case an empty message is allowed and a default status note is
  // substituted at submit time.
  message: z.string().default(""),
  status: z.string().min(1, "Status is required"),
  // "no_change" leaves the alert's severity as-is; info/warning/critical
  // persist a new severity on the parent alert alongside the update.
  severity: z.string().default("no_change"),
  serviceImpact: z.string().default("no_change"),
  sendPush: z.boolean().default(true),
  sendEmail: z.boolean().default(true),
  silent: z.boolean().default(false),
}).superRefine((d, ctx) => {
  if (!d.silent && d.message.replace(/<[^>]*>/g, "").trim().length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["message"], message: "Message is required (or enable 'Send silently' for a status-only change)" });
  }
});

// Alert incident lifecycle. Active statuses progress investigating → identified
// → monitoring; "resolved" is a terminal state reached via the dedicated Resolve
// action (single obvious control), not this list.
const ALERT_ACTIVE_STATUSES = ["investigating", "identified", "monitoring"] as const;
const ALERT_STATUS_LABELS: Record<string, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};
const ALERT_SEVERITY_LABELS: Record<string, string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};
const ALERT_STATUS_COLORS: Record<string, string> = {
  investigating: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  identified: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  monitoring: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  resolved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
};

const createNewsSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required").refine(
    (val) => val.replace(/<[^>]*>/g, "").trim().length > 0,
    "Content is required"
  ),
});

const createUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  email: z.string().email("Invalid email"),
  fullName: z.string().min(1, "Full name is required"),
  role: z.string().default("customer"),
});

function UsersTab({ canManage = true, initialUserId = null }: { canManage?: boolean; initialUserId?: string | null }) {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const { isMasterAdmin } = useAuth();
  const [, navigateUsers] = useLocation();
  const pushUserUrl = useCallback((id: string | null) => {
    const sp = new URLSearchParams();
    sp.set("tab", "users");
    if (id) sp.set("user", id);
    navigateUsers(`/admin?${sp.toString()}`);
  }, [navigateUsers]);

  const forceDisable2faMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/admin/users/${id}/disable-2fa`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "2FA disabled for user" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [deleteTargetUser, setDeleteTargetUser] = useState<{ id: string; name: string } | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [isEditingDetail, setIsEditingDetail] = useState(false);
  const [notifPrefsExpanded, setNotifPrefsExpanded] = useState(false);
  const [editFullName, setEditFullName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editSubscribedServices, setEditSubscribedServices] = useState<string[]>([]);
  const [newUserIds, setNewUserIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    apiRequest("GET", "/api/content-notifications/unread-references/admin-users")
      .then(async (res) => {
        const ids = await res.json();
        setNewUserIds(ids);
        await apiRequest("POST", "/api/content-notifications/mark-read", { category: "admin-users" });
        queryClient.invalidateQueries({ queryKey: ["/api/content-notifications/counts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      })
      .catch(() => {});
  }, []);

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: pushStatus } = useQuery<Record<string, boolean>>({
    queryKey: ["/api/admin/users/push-status"],
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const form = useForm({
    resolver: zodResolver(createUserSchema),
    defaultValues: { username: "", password: "", email: "", fullName: "", role: "customer" },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof createUserSchema>) => {
      await apiRequest("POST", "/api/admin/users", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "User created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User deleted" });
    },
  });

  const toggleRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: string }) => {
      await apiRequest("PATCH", `/api/admin/users/${id}`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User role updated" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ id, password }: { id: string; password: string }) => {
      await apiRequest("PATCH", `/api/admin/users/${id}/password`, { password });
    },
    onSuccess: () => {
      setResetDialogOpen(false);
      setNewPassword("");
      setSelectedUser(null);
      toast({ title: "Password reset successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<User> }) => {
      await apiRequest("PATCH", `/api/admin/users/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      closeDetailDialog();
      toast({ title: "User updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resetPrefsMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/users/${id}/reset-notification-prefs`);
      return (await res.json()) as User;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setDetailUser((prev) => (prev && prev.id === updated.id ? updated : prev));
      toast({ title: "Notification preferences reset" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const fillDetailFields = (u: User) => {
    setEditFullName(u.fullName);
    setEditUsername(u.username);
    setEditEmail(u.email);
    setEditRole(u.role);
    setEditSubscribedServices(u.subscribedServices || []);
  };

  const openDetailDialog = (u: User) => {
    setDetailUser(u);
    fillDetailFields(u);
    setIsEditingDetail(false);
    pushUserUrl(u.id);
  };

  const closeDetailDialog = useCallback(() => {
    setDetailUser(null);
    setIsEditingDetail(false);
    // Always pop the ?user= param so the URL stays in lock-step with
    // dialog state, even if our local view of initialUserId hasn't
    // caught up yet (race between open → immediate close).
    pushUserUrl(null);
  }, [pushUserUrl]);

  // Reset the single-shot focus flag whenever the URL-driven user id
  // changes (fresh deep-link, remount, browser back/forward) so the
  // dialog opens / closes in lock-step with the URL.
  const [didFocusInitialUser, setDidFocusInitialUser] = useState(false);
  const lastSeenInitialUserIdRef = useRef<string | null | undefined>(initialUserId);
  useEffect(() => {
    if (lastSeenInitialUserIdRef.current === initialUserId) return;
    lastSeenInitialUserIdRef.current = initialUserId;
    setDidFocusInitialUser(false);
    if (!initialUserId) setDetailUser(null);
  }, [initialUserId]);

  useEffect(() => {
    const action = computeInitialUserAction({
      initialUserId,
      users: users ?? null,
      didFocus: didFocusInitialUser,
    });
    if (action.kind === "wait" || action.kind === "noop") {
      if (action.kind === "noop" && !didFocusInitialUser && initialUserId && users) {
        setDidFocusInitialUser(true);
      }
      return;
    }
    const target = action.target;
    setSearchQuery("");
    setDetailUser(target);
    fillDetailFields(target);
    setIsEditingDetail(false);
    setDidFocusInitialUser(true);
    if (typeof window !== "undefined") {
      requestAnimationFrame(() => {
        const row = document.querySelector(`[data-testid="row-user-${target.id}"]`);
        if (row && "scrollIntoView" in row) {
          (row as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
        }
      });
    }
  }, [initialUserId, users, didFocusInitialUser]);

  const handleSaveUser = () => {
    if (!detailUser) return;
    updateUserMutation.mutate({
      id: detailUser.id,
      data: {
        fullName: editFullName,
        username: editUsername,
        email: editEmail,
        role: editRole,
        subscribedServices: editSubscribedServices,
      },
    });
  };

  const toggleService = (serviceId: string) => {
    setEditSubscribedServices(prev =>
      prev.includes(serviceId) ? prev.filter(s => s !== serviceId) : [...prev, serviceId]
    );
  };

  const filteredUsers = users?.filter((u) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return u.fullName.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-wrap gap-4">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Users className="h-[18px] w-[18px]" />
            </span>
            Users ({filteredUsers?.length ?? 0}{searchQuery.trim() && users ? ` of ${users.length}` : ""})
          </h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full sm:w-48 h-9 pl-9 pr-9 text-xs bg-background"
                data-testid="input-search-users"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="button-clear-search"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          {canManage && <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-user"><Plus className="w-4 h-4 mr-1" /> Add User</Button>
          </DialogTrigger>}
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
            <DialogHeader><DialogTitle>Create User</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="space-y-3">
                <FormField control={form.control} name="fullName" render={({ field }) => (
                  <FormItem><FormLabel>Full Name</FormLabel><FormControl><Input data-testid="input-user-fullname" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" data-testid="input-user-email" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="username" render={({ field }) => (
                  <FormItem><FormLabel>Username</FormLabel><FormControl><Input data-testid="input-user-username" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="password" render={({ field }) => (
                  <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" data-testid="input-user-password" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="role" render={({ field }) => (
                  <FormItem><FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-user-role"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="customer">Customer</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  <FormMessage /></FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-submit-user">
                  {createMutation.isPending ? "Creating..." : "Create User"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
          </div>
        </div>

      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader><DialogTitle>Reset Password for {selectedUser?.fullName}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input
              type="password"
              placeholder="New password (min 6 characters)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              data-testid="input-new-password"
            />
            <Button
              className="w-full"
              disabled={newPassword.length < 6 || resetPasswordMutation.isPending}
              onClick={() => selectedUser && resetPasswordMutation.mutate({ id: selectedUser.id, password: newPassword })}
              data-testid="button-confirm-reset"
            >
              {resetPasswordMutation.isPending ? "Resetting..." : "Reset Password"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {(() => {
        const detailBody = detailUser && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Full Name</label>
                  <Input
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    readOnly={!isEditingDetail}
                    className={!isEditingDetail ? "bg-muted/50 cursor-default focus-visible:ring-0" : undefined}
                    data-testid="input-edit-fullname"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Username</label>
                  <Input
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    readOnly={!isEditingDetail}
                    className={!isEditingDetail ? "bg-muted/50 cursor-default focus-visible:ring-0" : undefined}
                    data-testid="input-edit-username"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium mb-1 block">Email</label>
                  <Input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    readOnly={!isEditingDetail}
                    className={!isEditingDetail ? "bg-muted/50 cursor-default focus-visible:ring-0" : undefined}
                    data-testid="input-edit-email"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Role</label>
                  <Select value={editRole} onValueChange={setEditRole} disabled={!isEditingDetail}>
                    <SelectTrigger data-testid="select-edit-role"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer">Customer</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col justify-end">
                  <label className="text-sm font-medium mb-1 block">Push Notifications</label>
                  <div className="flex items-center gap-2 text-sm" data-testid="text-push-status">
                    {pushStatus?.[detailUser.id] ? (
                      <><Bell className="w-4 h-4 text-green-500" /> <span className="text-green-600">Enabled</span></>
                    ) : (
                      <><BellOff className="w-4 h-4 text-muted-foreground/40" /> <span className="text-muted-foreground">Not registered</span></>
                    )}
                  </div>
                </div>
              </div>

              {detailUser.createdAt && (
                <div className="flex items-center gap-2 text-sm border rounded-md px-3 py-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Registered:</span>
                  <span className="font-medium" data-testid="text-user-registered-date">
                    {format(new Date(detailUser.createdAt), "MMM d, yyyy 'at' h:mm a")}
                  </span>
                </div>
              )}

              <WhmcsCustomerPanel userId={detailUser.id} />

              {detailUser.role === "customer" && (() => {
                const prefs: NotificationPrefs | null | undefined = detailUser.notificationPrefs;
                const ia = countEnabledGroups(prefs, "in_app");
                const p = countEnabledGroups(prefs, "push");
                const e = countEnabledGroups(prefs, "email");
                return (
                  <div className="border rounded-md">
                    <div className="flex flex-col gap-2 px-3 py-3 border-b sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Notification preferences</p>
                        <p className="text-xs text-muted-foreground">
                          Read-only view of the customer's per-category choices.
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className={`h-6 px-2 text-xs gap-1 ${pillColorClass(ia.enabled, ia.total)}`} title={`Customer has not muted ${ia.enabled} of ${ia.total} in-app bell groups.`} data-testid="badge-detail-in-app-prefs">
                          <Bell className="w-3 h-3" />Bell prefs {ia.enabled}/{ia.total} groups
                        </Badge>
                        <Badge variant="outline" className={`h-6 px-2 text-xs gap-1 ${pillColorClass(p.enabled, p.total)}`} title={`Customer has not opted out of ${p.enabled} of ${p.total} push groups. This is only delivered if their device is also subscribed (see Push Notifications above).`} data-testid="badge-detail-push-prefs">
                          <Smartphone className="w-3 h-3" />Push prefs {p.enabled}/{p.total} groups
                        </Badge>
                        <Badge variant="outline" className={`h-6 px-2 text-xs gap-1 ${pillColorClass(e.enabled, e.total)}`} title={`Customer has not opted out of ${e.enabled} of ${e.total} email groups.`} data-testid="badge-detail-email-prefs">
                          <Mail className="w-3 h-3" />Email prefs {e.enabled}/{e.total} groups
                        </Badge>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs ml-auto sm:ml-0"
                          disabled={resetPrefsMutation.isPending}
                          onClick={() => resetPrefsMutation.mutate(detailUser.id)}
                          data-testid="button-reset-notif-prefs"
                        >
                          <RotateCcw className="w-3 h-3 mr-1" /> Reset
                        </Button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNotifPrefsExpanded((v) => !v)}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-muted-foreground hover-elevate active-elevate-2 transition-colors min-h-[44px]"
                      data-testid="button-toggle-notif-prefs-grid"
                    >
                      <span>{notifPrefsExpanded ? "Hide" : "Show"} per-category breakdown</span>
                      {notifPrefsExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {notifPrefsExpanded && (
                      <div className="px-3 py-3 border-t space-y-4" data-testid="grid-notif-prefs">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pb-1 border-b">
                          <span className="flex-1">Category</span>
                          <span className="w-14 flex items-center justify-center gap-1"><Bell className="w-3 h-3" />Bell</span>
                          <span className="w-14 flex items-center justify-center gap-1"><Smartphone className="w-3 h-3" />Push</span>
                          <span className="w-14 flex items-center justify-center gap-1"><Mail className="w-3 h-3" />Email</span>
                        </div>
                        {NOTIFICATION_GROUPS.map((group) => {
                          const cats = NOTIFICATION_CATEGORIES.filter((c) => c.group === group);
                          return (
                            <div key={group} className="space-y-1">
                              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">{group}</p>
                              <div className="rounded-md border divide-y bg-card">
                                {cats.map((cat) => {
                                  const supportsInApp = cat.channels.includes("in_app");
                                  const supportsPush = cat.channels.includes("push");
                                  const supportsEmail = cat.channels.includes("email");
                                  const inAppOn = supportsInApp && userWantsChannel(prefs, cat.key, "in_app");
                                  const pushOn = supportsPush && userWantsChannel(prefs, cat.key, "push");
                                  const emailOn = supportsEmail && userWantsChannel(prefs, cat.key, "email");
                                  return (
                                    <div key={cat.key} className="flex items-center gap-2 text-xs px-2 py-2.5 min-h-[40px]" data-testid={`grid-row-${cat.key}`}>
                                      <span className="flex-1 min-w-0 leading-snug">{cat.label}</span>
                                      <span className="w-14 flex items-center justify-center" title={supportsInApp ? (inAppOn ? "In-app bell enabled" : "In-app bell disabled") : "In-app bell not applicable"}>
                                        {supportsInApp ? (
                                          inAppOn ? <Check className="w-4 h-4 text-green-600 dark:text-green-400" data-testid={`grid-in-app-on-${cat.key}`} /> : <Minus className="w-4 h-4 text-muted-foreground/50" data-testid={`grid-in-app-off-${cat.key}`} />
                                        ) : <span className="text-muted-foreground/30">—</span>}
                                      </span>
                                      <span className="w-14 flex items-center justify-center" title={supportsPush ? (pushOn ? "Push enabled" : "Push disabled") : "Push not applicable"}>
                                        {supportsPush ? (
                                          pushOn ? <Check className="w-4 h-4 text-green-600 dark:text-green-400" data-testid={`grid-push-on-${cat.key}`} /> : <Minus className="w-4 h-4 text-muted-foreground/50" data-testid={`grid-push-off-${cat.key}`} />
                                        ) : <span className="text-muted-foreground/30">—</span>}
                                      </span>
                                      <span className="w-14 flex items-center justify-center" title={supportsEmail ? (emailOn ? "Email enabled" : "Email disabled") : "Email not applicable"}>
                                        {supportsEmail ? (
                                          emailOn ? <Check className="w-4 h-4 text-green-600 dark:text-green-400" data-testid={`grid-email-on-${cat.key}`} /> : <Minus className="w-4 h-4 text-muted-foreground/50" data-testid={`grid-email-off-${cat.key}`} />
                                        ) : <span className="text-muted-foreground/30">—</span>}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {detailUser.role === "customer" && (
                <CustomerNotificationsSection userId={detailUser.id} />
              )}

              <div>
                <label className="text-sm font-medium mb-2 block">Subscribed Services</label>
                {services && services.length > 0 ? (
                  <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                    {services.map((s) => (
                      <label
                        key={s.id}
                        className={`flex items-center gap-3 px-3 py-2 transition-colors ${isEditingDetail ? "cursor-pointer hover:bg-accent/50" : "cursor-default"}`}
                        data-testid={`label-service-${s.id}`}
                      >
                        <input
                          type="checkbox"
                          checked={editSubscribedServices.includes(s.id)}
                          onChange={() => toggleService(s.id)}
                          disabled={!isEditingDetail}
                          className="rounded border-input h-4 w-4 accent-primary disabled:opacity-60"
                          data-testid={`checkbox-service-${s.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{s.name}</p>
                          {s.description && <p className="text-xs text-muted-foreground truncate">{s.description}</p>}
                        </div>
                        <Badge variant="secondary" className="text-xs capitalize shrink-0">{s.status}</Badge>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No services configured</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {editSubscribedServices.length} service{editSubscribedServices.length !== 1 ? 's' : ''} selected
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 sm:justify-between pt-2">
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs sm:text-sm"
                    onClick={() => {
                      const u = detailUser;
                      closeDetailDialog();
                      setSelectedUser(u);
                      setResetDialogOpen(true);
                    }}
                    data-testid="button-detail-reset-password"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" className="gap-1 text-destructive text-xs sm:text-sm" data-testid="button-detail-delete">
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete User?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete {detailUser.fullName}'s account. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => { deleteMutation.mutate(detailUser.id); closeDetailDialog(); }}
                          data-testid="button-confirm-delete-user"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  {isMasterAdmin && (detailUser.role === "admin" || detailUser.role === "master_admin") && !!(detailUser as any).totpEnabledAt && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="outline" className="gap-1 text-xs sm:text-sm" data-testid="button-detail-force-disable-2fa">
                          <ShieldOff className="w-3.5 h-3.5" />
                          Disable 2FA
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Force-disable 2FA?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove 2FA from {detailUser.fullName}'s account. They'll be able to sign in with just their password until they re-enable it. This action will be audit-logged.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => forceDisable2faMutation.mutate(detailUser.id)}
                            data-testid="button-confirm-force-disable-2fa"
                          >
                            Disable 2FA
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
                <div className="flex gap-2 justify-end">
                  {isEditingDetail ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { fillDetailFields(detailUser); setIsEditingDetail(false); }}
                        data-testid="button-detail-cancel-edit"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={updateUserMutation.isPending}
                        onClick={handleSaveUser}
                        data-testid="button-detail-save"
                      >
                        {updateUserMutation.isPending ? "Saving..." : "Save"}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" onClick={closeDetailDialog} data-testid="button-detail-cancel">
                        Close
                      </Button>
                      <Button
                        size="sm"
                        className="gap-1"
                        onClick={() => setIsEditingDetail(true)}
                        data-testid="button-detail-edit"
                      >
                        <Edit className="w-3.5 h-3.5" />
                        Edit
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        if (isMobile) {
          return (
            <Sheet open={!!detailUser} onOpenChange={(open) => { if (!open) closeDetailDialog(); }}>
              <SheetContent side="bottom" className="h-[92vh] p-0 flex flex-col rounded-t-2xl" data-testid="dialog-user-detail">
                <div className="flex justify-center pt-2 pb-1">
                  <div className="w-10 h-1.5 rounded-full bg-muted-foreground/30" />
                </div>
                <SheetHeader className="px-4 pb-2 text-left">
                  <SheetTitle data-testid="text-user-detail-title">{detailUser?.fullName}</SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto px-4 pb-6">{detailBody}</div>
              </SheetContent>
            </Sheet>
          );
        }
        return (
          <Dialog open={!!detailUser} onOpenChange={(open) => { if (!open) closeDetailDialog(); }}>
            <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-user-detail">
              <DialogHeader>
                <DialogTitle data-testid="text-user-detail-title">{detailUser?.fullName}</DialogTitle>
              </DialogHeader>
              {detailBody}
            </DialogContent>
          </Dialog>
        );
      })()}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search users by name, username, or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 pr-9"
          data-testid="input-search-users"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            data-testid="button-clear-search"
          >
            <XIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {isLoading ? (
        <ul className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="px-5 py-3.5 flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Skeleton className="h-8 w-8 rounded-md" />
                <Skeleton className="h-8 w-8 rounded-md" />
              </div>
            </li>
          ))}
        </ul>
      ) : filteredUsers?.length === 0 ? (
        <div className="px-5 py-8 text-center flex flex-col items-center justify-center">
          <Search className="w-8 h-8 mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {searchQuery.trim() ? `No users matching "${searchQuery.trim()}"` : "No users found"}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {filteredUsers?.map((u) => (
            <li
              key={u.id}
              className="px-5 py-3.5 flex items-center justify-between gap-4 hover-elevate tap-interactive group cursor-pointer"
              onClick={() => openDetailDialog(u)}
              data-testid={`row-user-${u.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {newUserIds.includes(u.id) && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" data-testid={`dot-new-user-${u.id}`} />}
                  <span className="font-medium text-sm truncate">{u.fullName}</span>
                  <Badge variant={u.role === "admin" || u.role === "master_admin" ? "default" : "secondary"} className="text-[10px] capitalize px-1.5 py-0 shrink-0 font-medium">
                    {u.role === "master_admin" ? "Master Admin" : u.role}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-1.5 min-w-0 text-xs text-muted-foreground">
                  <span className="truncate">@{u.username}</span>
                  <span className="w-1 h-1 rounded-full bg-border shrink-0" />
                  <span className="truncate">{u.email}</span>
                </div>
                
                {/* Notifications summary (mobile inline, desktop float) */}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <span title={pushStatus?.[u.id] ? "Push device registered" : "No push device registered"} data-testid={`icon-push-${u.id}`}>
                    {pushStatus?.[u.id] ? <Bell className="w-3.5 h-3.5 text-status-online" /> : <BellOff className="w-3.5 h-3.5 text-muted-foreground/40" />}
                  </span>
                  {u.role === "customer" && (() => {
                    const prefs: NotificationPrefs | null | undefined = u.notificationPrefs;
                    const p = countEnabledGroups(prefs, "push");
                    const e = countEnabledGroups(prefs, "email");
                    return (
                      <>
                        <Badge variant="outline" className={`h-5 px-1.5 text-[10px] gap-0.5 border-transparent ${p.enabled === p.total ? "bg-status-online/10 text-status-online" : "bg-muted text-muted-foreground"}`} title={`Customer has not opted out of ${p.enabled} of ${p.total} push groups`} data-testid={`badge-push-prefs-${u.id}`}>
                          <Smartphone className="w-2.5 h-2.5" />{p.enabled}/{p.total}
                        </Badge>
                        <Badge variant="outline" className={`h-5 px-1.5 text-[10px] gap-0.5 border-transparent ${e.enabled === e.total ? "bg-status-online/10 text-status-online" : "bg-muted text-muted-foreground"}`} title={`Customer has not opted out of ${e.enabled} of ${e.total} email groups`} data-testid={`badge-email-prefs-${u.id}`}>
                          <Mail className="w-2.5 h-2.5" />{e.enabled}/{e.total}
                        </Badge>
                      </>
                    );
                  })()}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 transition-opacity" onClick={(e) => e.stopPropagation()}>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openDetailDialog(u)} data-testid={`button-view-user-${u.id}`}>
                  <Edit className="w-4 h-4" />
                </Button>
                {canManage && u.role !== "master_admin" && (
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => toggleRoleMutation.mutate({ id: u.id, role: u.role === "admin" ? "customer" : "admin" })} data-testid={`button-toggle-role-${u.id}`}>
                    {u.role === "admin" ? <Shield className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                  </Button>
                )}
                {canManage && (
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => { setSelectedUser(u); setResetDialogOpen(true); }} data-testid={`button-reset-password-${u.id}`}>
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                )}
                {canManage && (
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTargetUser({ id: u.id, name: u.fullName || u.username })} data-testid={`button-delete-user-${u.id}`}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      </section>

      <AlertDialog open={!!deleteTargetUser} onOpenChange={(open) => { if (!open) setDeleteTargetUser(null); }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {deleteTargetUser?.name ?? "this user"} and their data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-user">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteTargetUser) deleteMutation.mutate(deleteTargetUser.id); setDeleteTargetUser(null); }}
              data-testid="button-confirm-delete-user"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ServicesTab({ canManage = true }: { canManage?: boolean }) {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTargetService, setDeleteTargetService] = useState<{ id: string; name: string } | null>(null);

  const { data: services, isLoading } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const form = useForm({
    resolver: zodResolver(createServiceSchema),
    defaultValues: { name: "", description: "", category: "", status: "operational", discordWebhookUrl: "", isDefault: false },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof createServiceSchema>) => {
      if (editId) {
        await apiRequest("PATCH", `/api/admin/services/${editId}`, data);
      } else {
        await apiRequest("POST", "/api/admin/services", data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setDialogOpen(false);
      setEditId(null);
      form.reset();
      toast({ title: editId ? "Service updated" : "Service created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/services/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      toast({ title: "Service deleted" });
    },
  });

  const openEdit = (s: Service) => {
    setEditId(s.id);
    form.reset({ name: s.name, description: s.description || "", category: s.category || "", status: s.status, discordWebhookUrl: s.discordWebhookUrl || "", isDefault: s.isDefault ?? false });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-wrap gap-4">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Server className="h-[18px] w-[18px]" />
            </span>
            Services ({services?.length || 0})
          </h2>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setEditId(null); form.reset(); } }}>
            {canManage && <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-service"><Plus className="w-4 h-4 mr-1" /> Add Service</Button>
            </DialogTrigger>}
            <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
              <DialogHeader><DialogTitle>{editId ? "Edit Service" : "Add Service"}</DialogTitle></DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="space-y-3">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem><FormLabel>Name</FormLabel><FormControl><Input data-testid="input-service-name" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea data-testid="input-service-desc" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="category" render={({ field }) => (
                    <FormItem><FormLabel>Category</FormLabel><FormControl><Input data-testid="input-service-category" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="status" render={({ field }) => (
                    <FormItem><FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger data-testid="select-service-status"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="operational">Operational</SelectItem>
                          <SelectItem value="degraded">Degraded</SelectItem>
                          <SelectItem value="outage">Outage</SelectItem>
                          <SelectItem value="maintenance">Maintenance</SelectItem>
                        </SelectContent>
                      </Select>
                    <FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="discordWebhookUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Discord Webhook URL (optional)</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-service-discord-webhook"
                          placeholder="https://discord.com/api/webhooks/..."
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">If set, Discord posts for this service (alerts, updates, service updates) go here. Otherwise the global webhook is used.</p>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="isDefault" render={({ field }) => (
                    <FormItem className="flex items-start justify-between gap-3 rounded-md border p-3">
                      <div className="space-y-0.5">
                        <FormLabel className="text-sm">Pre-check for new customers</FormLabel>
                        <p className="text-xs text-muted-foreground">When on, this service is ticked by default in the new-customer services picker. Existing customers are unaffected.</p>
                      </div>
                      <FormControl>
                        <Switch checked={!!field.value} onCheckedChange={field.onChange} data-testid="switch-service-default" />
                      </FormControl>
                    </FormItem>
                  )} />
                  <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-submit-service">
                    {createMutation.isPending ? "Saving..." : editId ? "Update Service" : "Add Service"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <ul className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="px-5 py-3.5 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-40" />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Skeleton className="h-8 w-8 rounded-md" />
                  <Skeleton className="h-8 w-8 rounded-md" />
                </div>
              </li>
            ))}
          </ul>
        ) : services?.length === 0 ? (
          <div className="px-5 py-8 text-center flex flex-col items-center justify-center">
            <Server className="w-8 h-8 mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No services defined</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {services?.map((s) => {
              const statusColors: Record<string, string> = {
                operational: "bg-status-online/10 text-status-online",
                degraded: "bg-status-degraded/10 text-status-degraded",
                outage: "bg-status-offline/10 text-status-offline",
                maintenance: "bg-status-maintenance/10 text-status-maintenance",
              };
              const sc = statusColors[s.status] || "bg-muted text-muted-foreground";

              return (
                <li key={s.id} className="px-5 py-3.5 flex items-center justify-between gap-4 hover-elevate transition-colors group" data-testid={`row-service-${s.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{s.name}</span>
                      {s.category && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.category}</span>}
                      <Badge variant="outline" className={`text-[10px] capitalize px-1.5 py-0 border-transparent font-medium ${sc}`}>{s.status}</Badge>
                      {s.isDefault && <Badge variant="outline" className="text-[10px] px-1.5 py-0" data-testid={`badge-service-default-${s.id}`}>Default</Badge>}
                    </div>
                    {s.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{s.description}</p>}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1 shrink-0 transition-opacity opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEdit(s)} data-testid={`button-edit-service-${s.id}`}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTargetService({ id: s.id, name: s.name })} data-testid={`button-delete-service-${s.id}`}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AlertDialog open={!!deleteTargetService} onOpenChange={(open) => { if (!open) setDeleteTargetService(null); }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete service?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {deleteTargetService?.name ?? "this service"} and remove it from the status page. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-service">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteTargetService) deleteMutation.mutate(deleteTargetService.id); setDeleteTargetService(null); }}
              data-testid="button-confirm-delete-service"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function AlertsTab({ canManage = true }: { canManage?: boolean }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [alertImageFile, setAlertImageFile] = useState<File | null>(null);
  const [updateImageFile, setUpdateImageFile] = useState<File | null>(null);
  const [editAlertDialogOpen, setEditAlertDialogOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState<ServiceAlertWithServices | null>(null);
  const [editAlertTitle, setEditAlertTitle] = useState("");
  const [editAlertDesc, setEditAlertDesc] = useState("");
  const [editAlertSeverity, setEditAlertSeverity] = useState("warning");
  const [editAlertServiceIds, setEditAlertServiceIds] = useState<string[]>([]);
  const [editAlertImageFile, setEditAlertImageFile] = useState<File | null>(null);
  const [editAlertRemoveImage, setEditAlertRemoveImage] = useState(false);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolveAlertId, setResolveAlertId] = useState<string | null>(null);
  const [resolveMessage, setResolveMessage] = useState("");
  const [resolveImageFile, setResolveImageFile] = useState<File | null>(null);
  const [resolveSilent, setResolveSilent] = useState(false);
  const [editUpdateDialogOpen, setEditUpdateDialogOpen] = useState(false);
  const [editingAlertUpdate, setEditingAlertUpdate] = useState<{ alertId: string; update: AlertUpdate } | null>(null);
  const [editUpdateMessage, setEditUpdateMessage] = useState("");
  const [editUpdateImageFile, setEditUpdateImageFile] = useState<File | null>(null);
  const [editUpdateRemoveImage, setEditUpdateRemoveImage] = useState(false);
  const [expandedAlertCardId, setExpandedAlertCardId] = useState<string | null>(null);
  // Draft currently being acted on (Review & publish / Post update / Resolve):
  // when the underlying alert action succeeds, the draft is marked published.
  const [activeDraft, setActiveDraft] = useState<AlertDraft | null>(null);
  // Streamlined post-update dialog: impact + notification controls stay collapsed
  // by default so a status update only needs a status + a message.
  const [showUpdateAdvanced, setShowUpdateAdvanced] = useState(false);

  const { data: alerts, isLoading } = useQuery<ServiceAlertWithServices[]>({
    queryKey: ["/api/alerts"],
  });
  const { data: pendingDrafts } = useQuery<AlertDraft[]>({
    queryKey: ["/api/admin/alert-drafts?status=pending"],
  });
  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const form = useForm({
    resolver: zodResolver(createAlertSchema),
    defaultValues: { title: "", description: "", severity: "warning", status: "investigating", serviceImpact: "degraded", serviceIds: [] as string[], sendPush: true, sendEmail: true, silent: false },
  });

  const updateForm = useForm({
    resolver: zodResolver(addUpdateSchema),
    defaultValues: { message: "", status: "investigating", severity: "no_change", serviceImpact: "no_change", sendPush: true, sendEmail: true, silent: false },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof createAlertSchema>) => {
      const formData = new FormData();
      Object.entries(data).forEach(([k, v]) => {
        if (k === "serviceIds") formData.append(k, JSON.stringify(v));
        else formData.append(k, String(v));
      });
      if (alertImageFile) formData.append("image", alertImageFile);
      const res = await uploadRequest("POST", "/api/admin/alerts", formData);
      if (!res.ok) throw new Error((await res.json()).message || "Failed to create alert");
      return (await res.json()) as ServiceAlert;
    },
    onSuccess: (created, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      if (activeDraft && created?.id) {
        markDraftMutation.mutate({ id: activeDraft.id, status: "published", relatedAlertId: created.id });
        setActiveDraft(null);
      }
      setDialogOpen(false);
      form.reset();
      setAlertImageFile(null);
      toast({ title: vars.silent ? "Alert created silently" : "Alert created", description: vars.silent ? "No notifications were sent." : undefined });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addUpdateMutation = useMutation({
    mutationFn: async (data: z.infer<typeof addUpdateSchema>) => {
      // Silent status-only change: substitute a default timeline note so the
      // alert history still records what happened and when.
      const isBlank = data.message.replace(/<[^>]*>/g, "").trim().length === 0;
      const severityLabel = data.severity !== "no_change" ? ALERT_SEVERITY_LABELS[data.severity] || data.severity : null;
      const defaultNote = severityLabel
        ? `<p>Status changed to ${alertStatusLabel(data.status)}. Severity changed to ${severityLabel}.</p>`
        : `<p>Status changed to ${alertStatusLabel(data.status)}.</p>`;
      const payload = data.silent && isBlank
        ? { ...data, message: defaultNote }
        : data;
      const formData = new FormData();
      Object.entries(payload).forEach(([k, v]) => formData.append(k, String(v)));
      if (updateImageFile) formData.append("image", updateImageFile);
      const res = await uploadRequest("POST", `/api/admin/alerts/${selectedAlertId}/updates`, formData);
      if (!res.ok) throw new Error((await res.json()).message || "Failed to post update");
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      if (selectedAlertId) queryClient.invalidateQueries({ queryKey: ["/api/alerts", selectedAlertId, "updates"] });
      if (activeDraft) {
        markDraftMutation.mutate({ id: activeDraft.id, status: "published" });
        setActiveDraft(null);
      }
      setUpdateDialogOpen(false);
      updateForm.reset();
      setUpdateImageFile(null);
      toast({ title: vars.silent ? "Update posted silently" : "Update posted", description: vars.silent ? "No notifications were sent." : undefined });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editAlertMutation = useMutation({
    mutationFn: async ({ id, data, imageFile, removeImage }: { id: string; data: { title: string; description: string; severity: string; serviceIds: string[] }; imageFile: File | null; removeImage: boolean }) => {
      const formData = new FormData();
      formData.append("title", data.title);
      formData.append("description", data.description);
      formData.append("severity", data.severity);
      formData.append("serviceIds", JSON.stringify(data.serviceIds));
      if (imageFile) formData.append("image", imageFile);
      if (removeImage) formData.append("removeImage", "true");
      const res = await uploadRequest("PATCH", `/api/admin/alerts/${id}`, formData);
      if (!res.ok) throw new Error((await res.json()).message || "Failed to update alert");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      setEditAlertDialogOpen(false);
      setEditingAlert(null);
      setEditAlertImageFile(null);
      setEditAlertRemoveImage(false);
      toast({ title: "Alert updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, message, imageFile, silent }: { id: string; message: string; imageFile: File | null; silent: boolean }) => {
      const formData = new FormData();
      if (message && stripHtml(message).trim()) formData.append("message", message);
      if (imageFile) formData.append("image", imageFile);
      if (silent) formData.append("silent", "true");
      const res = await uploadRequest("PATCH", `/api/admin/alerts/${id}/resolve`, formData);
      if (!res.ok) throw new Error((await res.json()).message || "Failed to resolve alert");
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      if (activeDraft) {
        markDraftMutation.mutate({ id: activeDraft.id, status: "published" });
        setActiveDraft(null);
      }
      setResolveDialogOpen(false);
      setResolveAlertId(null);
      setResolveMessage("");
      setResolveImageFile(null);
      setResolveSilent(false);
      toast({ title: vars.silent ? "Alert resolved silently" : "Alert resolved", description: vars.silent ? "No notifications were sent." : undefined });
    },
  });

  const editUpdateMutation = useMutation({
    mutationFn: async ({ alertId, updateId, message, imageFile, removeImage }: { alertId: string; updateId: string; message: string; imageFile: File | null; removeImage: boolean }) => {
      const formData = new FormData();
      formData.append("message", message);
      if (imageFile) formData.append("image", imageFile);
      if (removeImage) formData.append("removeImage", "true");
      const res = await uploadRequest("PATCH", `/api/admin/alerts/${alertId}/updates/${updateId}`, formData);
      if (!res.ok) throw new Error((await res.json()).message || "Failed to update");
    },
    onSuccess: () => {
      if (editingAlertUpdate) queryClient.invalidateQueries({ queryKey: ["/api/alerts", editingAlertUpdate.alertId, "updates"] });
      setEditUpdateDialogOpen(false);
      setEditingAlertUpdate(null);
      setEditUpdateImageFile(null);
      setEditUpdateRemoveImage(false);
      toast({ title: "Update edited" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/alerts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({ title: "Alert deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Draft lifecycle mutations: publishing an alert/update/resolve marks the
  // acting draft "published"; Dismiss marks it "dismissed". Never auto-posts.
  const markDraftMutation = useMutation({
    mutationFn: async ({ id, status, relatedAlertId }: { id: string; status: "published" | "dismissed"; relatedAlertId?: string }) => {
      await apiRequest("PATCH", `/api/admin/alert-drafts/${id}`, relatedAlertId ? { status, relatedAlertId } : { status });
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/alert-drafts?status=pending"] });
      if (vars.status === "dismissed") toast({ title: "Suggestion dismissed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openDraftReview = (draft: AlertDraft) => {
    setActiveDraft(draft);
    form.reset({
      title: draft.suggestedTitle,
      description: draft.suggestedDescription,
      severity: draft.suggestedSeverity,
      status: "investigating",
      serviceImpact: draft.suggestedServiceImpact,
      serviceIds: draft.serviceId ? [draft.serviceId] : [],
      sendPush: true,
      sendEmail: true,
      silent: false,
    });
    setDialogOpen(true);
  };

  const openDraftUpdate = (draft: AlertDraft) => {
    if (!draft.relatedAlertId) return;
    setActiveDraft(draft);
    setSelectedAlertId(draft.relatedAlertId);
    updateForm.reset({
      message: draft.suggestedDescription,
      status: "monitoring",
      severity: "no_change",
      serviceImpact: "no_change",
      sendPush: true,
      sendEmail: true,
      silent: false,
    });
    setUpdateImageFile(null);
    setShowUpdateAdvanced(false);
    setUpdateDialogOpen(true);
  };

  // Inline status control: open the streamlined post-update dialog pre-set to a
  // chosen status (message stays empty so the admin just types the essentials).
  // Goes through the same addUpdateMutation → same backend route, so status
  // recompute/broadcast + notifications + permission checks are all preserved.
  const openUpdateWithStatus = (alertId: string, status: string) => {
    setActiveDraft(null);
    setSelectedAlertId(alertId);
    updateForm.reset({
      message: "",
      status,
      severity: "no_change",
      serviceImpact: "no_change",
      sendPush: true,
      sendEmail: true,
      silent: false,
    });
    setUpdateImageFile(null);
    setShowUpdateAdvanced(false);
    setUpdateDialogOpen(true);
  };

  const openDraftResolve = (draft: AlertDraft) => {
    if (!draft.relatedAlertId) return;
    setActiveDraft(draft);
    setResolveAlertId(draft.relatedAlertId);
    setResolveMessage(draft.suggestedDescription);
    setResolveDialogOpen(true);
  };

  const serviceMap = new Map(services?.map((s) => [s.id, s.name]) || []);

  const openEditAlert = (alert: ServiceAlertWithServices) => {
    setEditingAlert(alert);
    setEditAlertTitle(alert.title);
    setEditAlertDesc(alert.description);
    setEditAlertSeverity(alert.severity);
    setEditAlertServiceIds(alert.serviceIds || []);
    setEditAlertImageFile(null);
    setEditAlertRemoveImage(false);
    setEditAlertDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      {canManage && (pendingDrafts?.length || 0) > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3" data-testid="section-suggested-drafts">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <h4 className="font-semibold text-sm">Suggested drafts</h4>
            <Badge variant="secondary" data-testid="badge-draft-count">{pendingDrafts!.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">Monitoring detected changes. Review and publish — nothing is posted automatically.</p>
          {pendingDrafts!.map((draft) => (
            <div key={draft.id} className="rounded-md border bg-background p-3 space-y-2" data-testid={`card-alert-draft-${draft.id}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={draft.kind === "outage" ? "destructive" : "secondary"} data-testid={`badge-draft-kind-${draft.id}`}>
                  {draft.kind === "outage" ? "Outage detected" : "Recovery detected"}
                </Badge>
                {draft.serviceId && <span className="text-xs text-muted-foreground">{serviceMap.get(draft.serviceId) || "Unknown service"}</span>}
              </div>
              <p className="text-sm font-medium" data-testid={`text-draft-title-${draft.id}`}>{draft.suggestedTitle}</p>
              <p className="text-xs text-muted-foreground line-clamp-2">{draft.suggestedDescription}</p>
              <div className="flex items-center gap-2 flex-wrap">
                {draft.kind === "outage" ? (
                  <Button size="sm" onClick={() => openDraftReview(draft)} data-testid={`button-review-draft-${draft.id}`}>Review & publish</Button>
                ) : (
                  <>
                    <Button size="sm" onClick={() => openDraftUpdate(draft)} disabled={!draft.relatedAlertId} data-testid={`button-draft-update-${draft.id}`}>Post update</Button>
                    <Button size="sm" variant="outline" onClick={() => openDraftResolve(draft)} disabled={!draft.relatedAlertId} data-testid={`button-draft-resolve-${draft.id}`}>Resolve alert</Button>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={() => markDraftMutation.mutate({ id: draft.id, status: "dismissed" })} disabled={markDraftMutation.isPending} data-testid={`button-dismiss-draft-${draft.id}`}>Dismiss</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold">Alerts ({alerts?.length || 0})</h3>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setAlertImageFile(null); setActiveDraft(null); } }}>
          {canManage && <DialogTrigger asChild>
            <Button size="sm" data-testid="button-create-alert"><Plus className="w-4 h-4 mr-1" /> Create Alert</Button>
          </DialogTrigger>}
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Service Alert</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="space-y-3">
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem><FormLabel>Title</FormLabel><FormControl><Input data-testid="input-alert-title" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem><FormLabel>Description</FormLabel><FormControl><RichTextEditor value={field.value} onChange={field.onChange} placeholder="Describe the issue..." testIdPrefix="input-alert-desc" hideImage /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="serviceIds" render={({ field }) => (
                  <FormItem><FormLabel>Services</FormLabel>
                    <div className="space-y-2 rounded-md border p-3 max-h-48 overflow-y-auto" data-testid="checkboxes-alert-services">
                      {services?.map((s) => {
                        const checked = field.value?.includes(s.id);
                        return (
                          <label key={s.id} className="flex items-center gap-2 cursor-pointer" data-testid={`label-alert-service-${s.id}`}>
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => {
                                const current: string[] = field.value || [];
                                field.onChange(v ? [...current, s.id] : current.filter((id) => id !== s.id));
                              }}
                              data-testid={`checkbox-alert-service-${s.id}`}
                            />
                            <span className="text-sm">{s.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  <FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="severity" render={({ field }) => (
                  <FormItem><FormLabel>Severity</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-alert-severity"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  <FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem><FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-alert-status"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="investigating">Investigating</SelectItem>
                        <SelectItem value="identified">Identified</SelectItem>
                        <SelectItem value="monitoring">Monitoring</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                      </SelectContent>
                    </Select>
                  <FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="serviceImpact" render={({ field }) => (
                  <FormItem><FormLabel>Service Impact</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-alert-service-impact"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="degraded">Degraded Performance</SelectItem>
                        <SelectItem value="outage">Full Outage</SelectItem>
                        <SelectItem value="maintenance">Maintenance</SelectItem>
                      </SelectContent>
                    </Select>
                  <FormMessage /></FormItem>
                )} />
                <div className="space-y-2">
                  <Label>Attach Image (optional)</Label>
                  <Input type="file" accept="image/*" onChange={(e) => setAlertImageFile(e.target.files?.[0] || null)} data-testid="input-alert-image" />
                  {alertImageFile && <img src={URL.createObjectURL(alertImageFile)} alt="Preview" className="max-h-24 rounded-md" />}
                </div>
                <FormField control={form.control} name="sendPush" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <FormLabel className="text-sm font-medium">Send Push Notification</FormLabel>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={form.watch("silent")} data-testid="switch-alert-push" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="sendEmail" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <FormLabel className="text-sm font-medium">Send Email to Subscribers</FormLabel>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={form.watch("silent")} data-testid="switch-alert-email" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="silent" render={({ field }) => (
                  <FormItem className="flex items-start justify-between gap-3 rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm font-medium">Send silently (no notifications)</FormLabel>
                      <p className="text-xs text-muted-foreground">Record the alert without sending any push, email, Discord, Telegram or in-app notifications.</p>
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-alert-silent" /></FormControl>
                  </FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-submit-alert">
                  {createMutation.isPending ? "Creating..." : form.watch("silent") ? "Create Silently" : "Create Alert"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={updateDialogOpen} onOpenChange={(open) => { setUpdateDialogOpen(open); if (!open) { setUpdateImageFile(null); setActiveDraft(null); setShowUpdateAdvanced(false); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Post Update</DialogTitle></DialogHeader>
          <Form {...updateForm}>
            <form onSubmit={updateForm.handleSubmit((d) => addUpdateMutation.mutate(d))} className="space-y-3">
              <FormField control={updateForm.control} name="status" render={({ field }) => (
                <FormItem><FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-update-status"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="investigating">Investigating</SelectItem>
                      <SelectItem value="identified">Identified</SelectItem>
                      <SelectItem value="monitoring">Monitoring</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                <FormMessage /></FormItem>
              )} />
              <FormField control={updateForm.control} name="severity" render={({ field }) => (
                <FormItem><FormLabel>Severity</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-update-severity"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="no_change">Keep current severity</SelectItem>
                      <SelectItem value="info">Info</SelectItem>
                      <SelectItem value="warning">Warning</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                <FormMessage /></FormItem>
              )} />
              <FormField control={updateForm.control} name="message" render={({ field }) => (
                <FormItem><FormLabel>Message{updateForm.watch("silent") ? " (optional for silent status changes)" : ""}</FormLabel><FormControl><RichTextEditor value={field.value} onChange={field.onChange} placeholder={updateForm.watch("silent") ? "Optional — leave blank to just record the status change" : "What's the latest?"} testIdPrefix="input-update-message" hideImage /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={updateForm.control} name="silent" render={({ field }) => (
                <FormItem className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm font-medium">Send silently (no notifications)</FormLabel>
                    <p className="text-xs text-muted-foreground">Change the status without sending any push, email, Discord, Telegram or in-app notifications.</p>
                  </div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-update-silent" /></FormControl>
                </FormItem>
              )} />
              <Button type="button" variant="ghost" size="sm" className="w-full justify-between px-2 text-muted-foreground" onClick={() => setShowUpdateAdvanced((v) => !v)} data-testid="button-toggle-update-advanced">
                <span className="text-xs">Impact &amp; notification options</span>
                {showUpdateAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </Button>
              {showUpdateAdvanced && (
                <div className="space-y-3 rounded-lg border p-3" data-testid="section-update-advanced">
                  <FormField control={updateForm.control} name="serviceImpact" render={({ field }) => (
                    <FormItem><FormLabel>Service Impact</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger data-testid="select-update-service-impact"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="no_change">No Change</SelectItem>
                          <SelectItem value="operational">Operational</SelectItem>
                          <SelectItem value="degraded">Degraded Performance</SelectItem>
                          <SelectItem value="outage">Full Outage</SelectItem>
                          <SelectItem value="maintenance">Maintenance</SelectItem>
                        </SelectContent>
                      </Select>
                    <FormMessage /></FormItem>
                  )} />
                  <div className="space-y-2">
                    <Label>Attach Image (optional)</Label>
                    <Input type="file" accept="image/*" onChange={(e) => setUpdateImageFile(e.target.files?.[0] || null)} data-testid="input-update-image" />
                    {updateImageFile && <img src={URL.createObjectURL(updateImageFile)} alt="Preview" className="max-h-24 rounded-md" />}
                  </div>
                  <FormField control={updateForm.control} name="sendPush" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <FormLabel className="text-sm font-medium">Send Push Notification</FormLabel>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={updateForm.watch("silent")} data-testid="switch-update-push" /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={updateForm.control} name="sendEmail" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <FormLabel className="text-sm font-medium">Send Email to Subscribers</FormLabel>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={updateForm.watch("silent")} data-testid="switch-update-email" /></FormControl>
                    </FormItem>
                  )} />
                </div>
              )}
              <Button type="submit" className="w-full" disabled={addUpdateMutation.isPending} data-testid="button-submit-update">
                {addUpdateMutation.isPending ? "Posting..." : updateForm.watch("silent") ? "Post Silently" : "Post Update"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={editAlertDialogOpen} onOpenChange={(open) => { if (!open) { setEditAlertDialogOpen(false); setEditingAlert(null); setEditAlertImageFile(null); setEditAlertRemoveImage(false); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Alert</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Services</Label>
              <div className="space-y-2 rounded-md border p-3 max-h-48 overflow-y-auto" data-testid="checkboxes-edit-alert-services">
                {services?.map((s) => {
                  const checked = editAlertServiceIds.includes(s.id);
                  return (
                    <label key={s.id} className="flex items-center gap-2 cursor-pointer" data-testid={`label-edit-alert-service-${s.id}`}>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => setEditAlertServiceIds((prev) => v ? [...prev, s.id] : prev.filter((id) => id !== s.id))}
                        data-testid={`checkbox-edit-alert-service-${s.id}`}
                      />
                      <span className="text-sm">{s.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={editAlertTitle} onChange={(e) => setEditAlertTitle(e.target.value)} data-testid="input-edit-alert-title" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <RichTextEditor value={editAlertDesc} onChange={setEditAlertDesc} testIdPrefix="input-edit-alert-desc" hideImage />
            </div>
            <div className="space-y-2">
              <Label>Severity</Label>
              <Select value={editAlertSeverity} onValueChange={setEditAlertSeverity}>
                <SelectTrigger data-testid="select-edit-alert-severity"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Image</Label>
              {editingAlert?.imageUrl && !editAlertRemoveImage && !editAlertImageFile && (
                <div className="flex items-center gap-2">
                  <img src={editingAlert.imageUrl} alt="Current" className="max-h-20 rounded-md" />
                  <Button variant="ghost" size="sm" onClick={() => setEditAlertRemoveImage(true)}>Remove</Button>
                </div>
              )}
              <Input type="file" accept="image/*" onChange={(e) => { setEditAlertImageFile(e.target.files?.[0] || null); setEditAlertRemoveImage(false); }} data-testid="input-edit-alert-image" />
              {editAlertImageFile && <img src={URL.createObjectURL(editAlertImageFile)} alt="Preview" className="max-h-20 rounded-md" />}
            </div>
            <Button
              className="w-full"
              disabled={editAlertMutation.isPending || !editAlertTitle.trim() || !stripHtml(editAlertDesc) || editAlertServiceIds.length === 0}
              onClick={() => editingAlert && editAlertMutation.mutate({ id: editingAlert.id, data: { title: editAlertTitle, description: editAlertDesc, severity: editAlertSeverity, serviceIds: editAlertServiceIds }, imageFile: editAlertImageFile, removeImage: editAlertRemoveImage })}
              data-testid="button-save-edit-alert"
            >
              {editAlertMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={resolveDialogOpen} onOpenChange={(open) => { if (!open) { setResolveDialogOpen(false); setResolveAlertId(null); setResolveMessage(""); setResolveImageFile(null); setResolveSilent(false); setActiveDraft(null); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader><DialogTitle>Resolve Alert</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Resolve Message (optional)</Label>
              <RichTextEditor value={resolveMessage} onChange={setResolveMessage} placeholder="Issue has been resolved." testIdPrefix="input-resolve-message" hideImage />
            </div>
            <div className="space-y-2">
              <Label>Attach Image (optional)</Label>
              <Input type="file" accept="image/*" onChange={(e) => setResolveImageFile(e.target.files?.[0] || null)} data-testid="input-resolve-image" />
              {resolveImageFile && <img src={URL.createObjectURL(resolveImageFile)} alt="Preview" className="max-h-20 rounded-md" />}
            </div>
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="switch-resolve-silent">Resolve silently</Label>
                <p className="text-xs text-muted-foreground">Mark resolved without sending any push, email, Discord, Telegram or in-app notifications.</p>
              </div>
              <Switch id="switch-resolve-silent" checked={resolveSilent} onCheckedChange={setResolveSilent} data-testid="switch-resolve-silent" />
            </div>
            <Button
              className="w-full"
              disabled={resolveMutation.isPending}
              onClick={() => resolveAlertId && resolveMutation.mutate({ id: resolveAlertId, message: resolveMessage, imageFile: resolveImageFile, silent: resolveSilent })}
              data-testid="button-confirm-resolve"
            >
              {resolveMutation.isPending ? "Resolving..." : resolveSilent ? "Resolve Silently" : "Resolve Alert"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editUpdateDialogOpen} onOpenChange={(open) => { if (!open) { setEditUpdateDialogOpen(false); setEditingAlertUpdate(null); setEditUpdateImageFile(null); setEditUpdateRemoveImage(false); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Update</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Message</Label>
              <RichTextEditor value={editUpdateMessage} onChange={setEditUpdateMessage} testIdPrefix="input-edit-update-message" hideImage />
            </div>
            <div className="space-y-2">
              <Label>Image</Label>
              {editingAlertUpdate?.update.imageUrl && !editUpdateRemoveImage && !editUpdateImageFile && (
                <div className="flex items-center gap-2">
                  <img src={editingAlertUpdate.update.imageUrl} alt="Current" className="max-h-20 rounded-md" />
                  <Button variant="ghost" size="sm" onClick={() => setEditUpdateRemoveImage(true)}>Remove</Button>
                </div>
              )}
              <Input type="file" accept="image/*" onChange={(e) => { setEditUpdateImageFile(e.target.files?.[0] || null); setEditUpdateRemoveImage(false); }} data-testid="input-edit-update-image" />
              {editUpdateImageFile && <img src={URL.createObjectURL(editUpdateImageFile)} alt="Preview" className="max-h-20 rounded-md" />}
            </div>
            <Button
              className="w-full"
              disabled={editUpdateMutation.isPending || !stripHtml(editUpdateMessage)}
              onClick={() => editingAlertUpdate && editUpdateMutation.mutate({ alertId: editingAlertUpdate.alertId, updateId: editingAlertUpdate.update.id, message: editUpdateMessage, imageFile: editUpdateImageFile, removeImage: editUpdateRemoveImage })}
              data-testid="button-save-edit-update"
            >
              {editUpdateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="divide-y divide-border border-t border-border">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="px-5 py-3.5"><Skeleton className="h-16 w-full" /></div>)}
        </div>
      ) : (
        <div className="divide-y divide-border border-t border-border">
          {alerts?.map((alert) => (
            <div key={alert.id} className="hover-elevate px-5 py-3.5 group" data-testid={`card-admin-alert-${alert.id}`}>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 cursor-pointer" onClick={() => setExpandedAlertCardId(expandedAlertCardId === alert.id ? null : alert.id)} data-testid={`button-expand-alert-${alert.id}`}>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {expandedAlertCardId === alert.id ? <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground group-hover:text-foreground" /> : <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground group-hover:text-foreground" />}
                    <h4 className="font-semibold text-sm min-w-0 truncate text-foreground">{alert.title}</h4>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant={alert.severity === "critical" ? "destructive" : "secondary"} className="text-[10px] font-normal">{alertSeverityLabel(alert.severity)}</Badge>
                    <Badge variant="outline" className={`text-[10px] font-semibold bg-background ${ALERT_STATUS_COLORS[alert.status] || ""}`} data-testid={`badge-alert-status-${alert.id}`}>{alertStatusLabel(alert.status)}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap pl-6">
                  {alert.serviceIds?.map((sid) => serviceMap.get(sid) && <Badge key={sid} variant="secondary" className="text-[10px] font-normal" data-testid={`badge-alert-service-${sid}`}>{serviceMap.get(sid)}</Badge>)}
                  <span className="text-[10px] text-muted-foreground">{format(new Date(alert.createdAt), "MMM d, yyyy h:mm a")}</span>
                </div>
                {canManage && alert.status !== "resolved" && (
                  <div className="flex items-center gap-2 flex-wrap pl-6 mt-2" onClick={(e) => e.stopPropagation()} data-testid={`inline-status-controls-${alert.id}`}>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Set status</span>
                    <div className="inline-flex rounded-md border overflow-hidden">
                      {ALERT_ACTIVE_STATUSES.map((st) => {
                        const active = alert.status === st;
                        return (
                          <button
                            key={st}
                            type="button"
                            onClick={() => openUpdateWithStatus(alert.id, st)}
                            className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                            data-testid={`button-set-status-${st}-${alert.id}`}
                            aria-pressed={active}
                          >
                            {ALERT_STATUS_LABELS[st]}
                          </button>
                        );
                      })}
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" onClick={() => { setResolveAlertId(alert.id); setResolveDialogOpen(true); }} data-testid={`button-resolve-inline-${alert.id}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Resolve
                    </Button>
                  </div>
                )}
                {expandedAlertCardId === alert.id && (
                  <div className="space-y-3 pt-2 pl-6 pb-1 border-t mt-3 border-border">
                    <RichTextContent content={alert.description} className="text-xs text-muted-foreground" testId={`text-admin-alert-desc-${alert.id}`} />
                    {alert.imageUrl && <ClickableImage src={alert.imageUrl} alt="Alert image" className="max-h-24 rounded-md border border-border" />}
                    <div className="flex items-center gap-2 flex-wrap">
                      {canManage && (
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openEditAlert(alert); }} data-testid={`button-edit-alert-${alert.id}`}>
                          <Edit className="w-3.5 h-3.5 mr-1.5" /> Edit
                        </Button>
                      )}
                      {canManage && <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" data-testid={`button-delete-alert-${alert.id}`}>
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Alert</AlertDialogTitle>
                            <AlertDialogDescription>Are you sure you want to delete this alert? This will also delete all associated updates. This action cannot be undone.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteMutation.mutate(alert.id)} data-testid={`button-confirm-delete-alert-${alert.id}`}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>}
                    </div>
                    <div className="pt-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Update timeline</p>
                      <AlertUpdatesList alertId={alert.id} canManage={canManage} onEditUpdate={(update) => { setEditingAlertUpdate({ alertId: alert.id, update }); setEditUpdateMessage(update.message); setEditUpdateImageFile(null); setEditUpdateRemoveImage(false); setEditUpdateDialogOpen(true); }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AlertUpdatesList({ alertId, canManage, onEditUpdate }: { alertId: string; canManage: boolean; onEditUpdate: (update: AlertUpdate) => void }) {
  const { data: updates, isLoading } = useQuery<AlertUpdate[]>({
    queryKey: ["/api/alerts", alertId, "updates"],
  });

  if (isLoading) return <Skeleton className="h-16 mt-2" />;
  if (!updates || updates.length === 0) return <p className="text-xs text-muted-foreground text-center py-4">No updates yet</p>;

  return (
    <div className="border-t pt-3 mt-2">
      {updates.map((update, idx) => {
        const isLast = idx === updates.length - 1;
        const dotColor = update.status === "resolved"
          ? "bg-emerald-500"
          : update.status === "monitoring"
            ? "bg-blue-500"
            : update.status === "identified"
              ? "bg-amber-500"
              : "bg-red-500";
        return (
          <div key={update.id} className="relative flex gap-4 pb-4 last:pb-0 group" data-testid={`alert-update-entry-${update.id}`}>
            <div className="flex flex-col items-center flex-shrink-0">
              <span className={`w-2.5 h-2.5 rounded-full mt-1 ring-2 ring-background ${dotColor}`} aria-hidden="true" />
              {!isLast && <span className="w-px flex-1 bg-border mt-1.5" aria-hidden="true" />}
            </div>
            <div className="min-w-0 flex-1 -mt-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={`text-[10px] font-semibold capitalize ${ALERT_STATUS_COLORS[update.status] || ""}`} data-testid={`badge-alert-update-status-${update.id}`}>{alertStatusLabel(update.status)}</Badge>
                <span className="text-xs text-muted-foreground">{format(new Date(update.createdAt), "MMM d, h:mm a")}</span>
                {canManage && (
                  <Button size="icon" variant="ghost" className="h-6 w-6 ml-auto flex-shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" onClick={() => onEditUpdate(update)} data-testid={`button-edit-update-${update.id}`}>
                    <Edit className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
              <RichTextContent content={update.message} className="text-xs mt-1.5" testId={`text-alert-update-message-${update.id}`} />
              {update.imageUrl && <ClickableImage src={update.imageUrl} alt="Update image" className="max-h-24 rounded-md mt-2" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NewsTab({ canManage = true }: { canManage?: boolean }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingStory, setEditingStory] = useState<NewsStory | null>(null);
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [attachPoll, setAttachPoll] = useState(false);
  const [pollDraft, setPollDraft] = useState(emptyPollDraft());
  const [deleteTargetStory, setDeleteTargetStory] = useState<{ id: string; title: string } | null>(null);

  const { data: news, isLoading } = useQuery<NewsStory[]>({
    queryKey: ["/api/news"],
  });

  const { data: reactionsByStory } = useQuery<Record<string, { emoji: string; count: number; mine: boolean }[]>>({
    queryKey: ["/api/news/reactions/all"],
  });

  const form = useForm({
    resolver: zodResolver(createNewsSchema),
    defaultValues: { title: "", content: "" },
  });

  const editForm = useForm({
    resolver: zodResolver(createNewsSchema),
    defaultValues: { title: "", content: "" },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof createNewsSchema>) => {
      const formData = new FormData();
      formData.append("title", data.title);
      formData.append("content", data.content);
      if (imageFile) formData.append("image", imageFile);

      const res = await uploadRequest("POST", "/api/admin/news", formData);
      if (!res.ok) throw new Error(await res.text());
      const story = await res.json();
      if (attachPoll && isPollDraftValid(pollDraft)) {
        try {
          await submitPollDraft(pollDraft, "news", story.id);
        } catch (err: any) {
          toast({ title: "Story saved, but poll failed", description: err.message, variant: "destructive" });
        }
      }
      return story;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/news"] });
      clearTiptapDraft("news:new");
      setDialogOpen(false);
      form.reset();
      setImageFile(null);
      setAttachPoll(false);
      setPollDraft(emptyPollDraft());
      toast({ title: "News story published" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async (data: z.infer<typeof createNewsSchema>) => {
      if (!editingStory) return;
      const formData = new FormData();
      formData.append("title", data.title);
      formData.append("content", data.content);
      if (editImageFile) formData.append("image", editImageFile);
      if (removeImage && !editImageFile) formData.append("removeImage", "true");

      const res = await uploadRequest("PATCH", `/api/admin/news/${editingStory.id}`, formData);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/news"] });
      if (editingStory) clearTiptapDraft(`news:${editingStory.id}`);
      setEditDialogOpen(false);
      setEditingStory(null);
      setEditImageFile(null);
      setRemoveImage(false);
      toast({ title: "News story updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/news/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/news"] });
      toast({ title: "News story deleted" });
    },
  });

  const openEditDialog = (story: NewsStory) => {
    setEditingStory(story);
    editForm.reset({ title: story.title, content: story.content });
    setEditImageFile(null);
    setRemoveImage(false);
    setEditDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-wrap gap-4">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Newspaper className="h-[18px] w-[18px]" />
            </span>
            News Stories ({news?.length || 0})
          </h2>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            {canManage && <DialogTrigger asChild>
              <Button size="sm" data-testid="button-create-news"><Plus className="w-4 h-4 mr-1" /> Publish Story</Button>
            </DialogTrigger>}
            <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Publish News Story</DialogTitle></DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="space-y-3">
                  <FormField control={form.control} name="title" render={({ field }) => (
                    <FormItem><FormLabel>Title</FormLabel><FormControl><Input data-testid="input-news-title" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="content" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Content</FormLabel>
                      <FormControl>
                        <RichTextEditor value={field.value} onChange={field.onChange} testIdPrefix="create-news" draftKey={dialogOpen ? "news:new" : undefined} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div>
                    <label className="text-sm font-medium">Cover Image (optional)</label>
                    <Input type="file" accept="image/*" className="mt-1" onChange={(e) => setImageFile(e.target.files?.[0] || null)} data-testid="input-news-image" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="attach-poll" checked={attachPoll} onCheckedChange={(v) => setAttachPoll(!!v)} data-testid="checkbox-attach-poll" />
                    <label htmlFor="attach-poll" className="text-sm cursor-pointer">Attach a poll</label>
                  </div>
                  {attachPoll && <PollEditor value={pollDraft} onChange={setPollDraft} />}
                  <Button type="submit" className="w-full" disabled={createMutation.isPending || (attachPoll && !isPollDraftValid(pollDraft))} data-testid="button-submit-news">
                    {createMutation.isPending ? "Publishing..." : "Publish Story"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <ul className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="px-5 py-3.5 flex items-start gap-4">
                <Skeleton className="w-16 h-12 rounded-md shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
                <div className="flex gap-1 py-1">
                  <Skeleton className="h-8 w-8 rounded-md" />
                  <Skeleton className="h-8 w-8 rounded-md" />
                </div>
              </li>
            ))}
          </ul>
        ) : news?.length === 0 ? (
          <div className="px-5 py-8 text-center flex flex-col items-center justify-center">
            <Newspaper className="w-8 h-8 mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No news stories published yet</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {news?.map((story) => (
              <li key={story.id} className="px-5 py-4 flex items-start justify-between gap-4 hover-elevate transition-colors group" data-testid={`card-admin-news-${story.id}`}>
                <div className="flex items-start gap-4 min-w-0">
                  {story.imageUrl ? (
                    <img src={story.imageUrl} alt="" loading="lazy" decoding="async" width={64} height={48} className="w-16 h-12 rounded-md object-cover border shrink-0" />
                  ) : (
                    <div className="w-16 h-12 rounded-md bg-muted/50 border flex items-center justify-center shrink-0">
                      <Newspaper className="w-6 h-6 text-muted-foreground/30" />
                    </div>
                  )}
                  <div className="space-y-1.5 min-w-0">
                    <h4 className="font-semibold text-sm truncate">{story.title}</h4>
                    <p className="text-xs text-muted-foreground line-clamp-1">{stripHtml(story.content)}</p>
                    {(() => {
                      const groups = reactionsByStory?.[story.id] ?? [];
                      const total = groups.reduce((sum, g) => sum + g.count, 0);
                      if (total === 0) {
                        return (
                          <p className="text-xs text-muted-foreground" data-testid={`text-admin-news-reactions-${story.id}`}>
                            No reactions yet
                          </p>
                        );
                      }
                      return (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5" data-testid={`text-admin-news-reactions-${story.id}`}>
                          {groups.map((g) => (
                            <span
                              key={g.emoji}
                              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                              data-testid={`text-admin-news-reaction-${story.id}-${g.emoji}`}
                            >
                              <span aria-hidden>{g.emoji}</span>
                              <span className="tabular-nums">{g.count}</span>
                            </span>
                          ))}
                          <span className="text-[10px] text-muted-foreground">· {total} total</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
                {canManage && (
                  <div className="flex gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEditDialog(story)} data-testid={`button-edit-news-${story.id}`}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTargetStory({ id: story.id, title: story.title })} data-testid={`button-delete-news-${story.id}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog open={!!deleteTargetStory} onOpenChange={(open) => { if (!open) setDeleteTargetStory(null); }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete news story?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deleteTargetStory?.title ?? "this story"}" for all customers. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-news">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteTargetStory) deleteMutation.mutate(deleteTargetStory.id); setDeleteTargetStory(null); }}
              data-testid="button-confirm-delete-news"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editDialogOpen} onOpenChange={(open) => { if (!open) { setEditDialogOpen(false); setEditingStory(null); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit News Story</DialogTitle></DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((d) => editMutation.mutate(d))} className="space-y-3">
              <FormField control={editForm.control} name="title" render={({ field }) => (
                <FormItem><FormLabel>Title</FormLabel><FormControl><Input data-testid="input-edit-news-title" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={editForm.control} name="content" render={({ field }) => (
                <FormItem>
                  <FormLabel>Content</FormLabel>
                  <FormControl>
                    <RichTextEditor value={field.value} onChange={field.onChange} testIdPrefix="edit-news" draftKey={editingStory ? `news:${editingStory.id}` : undefined} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="space-y-2">
                <label className="text-sm font-medium">Image</label>
                {editingStory?.imageUrl && !removeImage && (
                  <div className="flex items-center gap-3">
                    <img src={editingStory.imageUrl} alt="" className="w-20 h-14 rounded-md object-cover" />
                    <Button type="button" variant="outline" size="sm" onClick={() => setRemoveImage(true)} data-testid="button-remove-news-image">
                      Remove Image
                    </Button>
                  </div>
                )}
                {removeImage && !editImageFile && (
                  <p className="text-xs text-muted-foreground">Image will be removed on save.</p>
                )}
                <Input type="file" accept="image/*" onChange={(e) => { setEditImageFile(e.target.files?.[0] || null); if (e.target.files?.[0]) setRemoveImage(false); }} data-testid="input-edit-news-image" />
              </div>
              <Button type="submit" className="w-full" disabled={editMutation.isPending} data-testid="button-save-edit-news">
                {editMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const quickResponseSchema = z.object({
  title: z.string().min(1, "Title is required"),
  message: z.string().min(1, "Message is required"),
  categoryId: z.string().nullable().optional(),
});

const UNCATEGORIZED = "__uncategorized__";
const ALL_CATEGORIES = "__all__";
const NEEDS_REVIEW = "__needs_review__";

function QuickResponsesTab({ canManage = true }: { canManage?: boolean }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingQr, setEditingQr] = useState<QuickResponse | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_CATEGORIES);
  const [searchQuery, setSearchQuery] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState<
    | { data: z.infer<typeof quickResponseSchema>; mode: "create" | "update"; unknown: string[] }
    | null
  >(null);

  const { data: quickResponses, isLoading } = useQuery<QuickResponse[]>({
    queryKey: ["/api/admin/quick-responses"],
  });
  const { data: categories } = useQuery<QuickResponseCategory[]>({
    queryKey: ["/api/quick-response-categories"],
  });

  const form = useForm({
    resolver: zodResolver(quickResponseSchema),
    defaultValues: { title: "", message: "", categoryId: null as string | null },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof quickResponseSchema>) => {
      const res = await apiRequest("POST", "/api/admin/quick-responses", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quick-responses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quick-responses"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Quick response created" });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to create quick response", description: e.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: z.infer<typeof quickResponseSchema>) => {
      const res = await apiRequest("PATCH", `/api/admin/quick-responses/${editingQr!.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quick-responses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quick-responses"] });
      setEditingQr(null);
      setDialogOpen(false);
      form.reset();
      toast({ title: "Quick response updated" });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to update quick response", description: e.message, variant: "destructive" });
    },
  });

  const applySuggestionMutation = useMutation({
    mutationFn: async ({ id, message }: { id: string; message: string }) => {
      await apiRequest("PATCH", `/api/admin/quick-responses/${id}`, { message });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quick-responses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quick-responses"] });
      toast({ title: "Suggestion applied" });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to apply suggestion", description: e.message, variant: "destructive" });
    },
  });

  const bulkApplySuggestionsMutation = useMutation({
    mutationFn: async (items: { id: string; message: string }[]) => {
      const results = await Promise.allSettled(
        items.map((it) =>
          apiRequest("PATCH", `/api/admin/quick-responses/${it.id}`, { message: it.message }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { total: items.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quick-responses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quick-responses"] });
      if (failed === 0) {
        toast({ title: `Applied suggestions to ${total} template${total === 1 ? "" : "s"}` });
      } else {
        toast({
          title: `Applied ${total - failed} of ${total} suggestions`,
          description: `${failed} update${failed === 1 ? "" : "s"} failed.`,
          variant: "destructive",
        });
      }
    },
    onError: (e: Error) => {
      toast({ title: "Failed to apply suggestions", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/quick-responses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quick-responses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quick-responses"] });
      toast({ title: "Quick response deleted" });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to delete quick response", description: e.message, variant: "destructive" });
    },
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/admin/quick-response-categories", { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quick-response-categories"] });
      setNewCategoryName("");
    },
    onError: (e: Error) => toast({ title: "Failed to add category", description: e.message, variant: "destructive" }),
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      await apiRequest("PATCH", `/api/admin/quick-response-categories/${id}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quick-response-categories"] });
      setEditingCatId(null);
      setEditingCatName("");
    },
    onError: (e: Error) => toast({ title: "Failed to rename category", description: e.message, variant: "destructive" }),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/quick-response-categories/${id}`);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quick-response-categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quick-responses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quick-responses"] });
      if (selectedCategory === id) setSelectedCategory(ALL_CATEGORIES);
      toast({ title: "Category deleted" });
    },
    onError: (e: Error) => toast({ title: "Failed to delete", description: e.message, variant: "destructive" }),
  });

  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await apiRequest("POST", "/api/admin/quick-response-categories/reorder", { orderedIds });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/quick-response-categories"] }),
  });

  const openEdit = (qr: QuickResponse) => {
    setEditingQr(qr);
    form.reset({ title: qr.title, message: qr.message, categoryId: qr.categoryId ?? null });
    setDialogOpen(true);
  };

  const openCreate = () => {
    setEditingQr(null);
    form.reset({
      title: "",
      message: "",
      categoryId: selectedCategory === ALL_CATEGORIES || selectedCategory === UNCATEGORIZED ? null : selectedCategory,
    });
    setDialogOpen(true);
  };

  const unknownTokensById = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const qr of quickResponses ?? []) {
      const tokens = findUnknownPlaceholders(qr.message ?? "");
      if (tokens.length > 0) map.set(qr.id, tokens);
    }
    return map;
  }, [quickResponses]);

  const suggestionsById = useMemo(() => {
    const map = new Map<string, { nextMessage: string; replaced: number; pairs: { token: string; suggestion: string }[] }>();
    for (const qr of quickResponses ?? []) {
      const msg = qr.message ?? "";
      const { next, replaced } = applySuggestionsToTemplate(msg);
      if (replaced === 0 || next === msg) continue;
      const seen = new Set<string>();
      const pairs: { token: string; suggestion: string }[] = [];
      for (const token of findUnknownPlaceholders(msg)) {
        if (seen.has(token)) continue;
        const sug = suggestKnownVariable(token);
        if (!sug) continue;
        seen.add(token);
        pairs.push({ token, suggestion: sug });
      }
      map.set(qr.id, { nextMessage: next, replaced, pairs });
    }
    return map;
  }, [quickResponses]);

  const pendingSaveSuggestion = useMemo(() => {
    if (!pendingSave) return null;
    const msg = pendingSave.data.message ?? "";
    const { next, replaced } = applySuggestionsToTemplate(msg);
    if (replaced === 0 || next === msg) return null;
    return { nextMessage: next, replaced };
  }, [pendingSave]);

  const filteredResponses = useMemo(() => {
    const all = quickResponses ?? [];
    let scoped = all;
    if (selectedCategory === UNCATEGORIZED) scoped = all.filter((qr) => !qr.categoryId);
    else if (selectedCategory === NEEDS_REVIEW) scoped = all.filter((qr) => unknownTokensById.has(qr.id));
    else if (selectedCategory !== ALL_CATEGORIES) scoped = all.filter((qr) => qr.categoryId === selectedCategory);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((qr) => qr.title.toLowerCase().includes(q) || qr.message.toLowerCase().includes(q));
  }, [quickResponses, selectedCategory, searchQuery, unknownTokensById]);

  const counts = useMemo(() => {
    const all = quickResponses ?? [];
    const map = new Map<string, number>();
    let uncat = 0;
    for (const qr of all) {
      if (!qr.categoryId) uncat++;
      else map.set(qr.categoryId, (map.get(qr.categoryId) ?? 0) + 1);
    }
    return { total: all.length, uncategorized: uncat, byCategory: map, needsReview: unknownTokensById.size };
  }, [quickResponses, unknownTokensById]);

  const handleDrop = (targetId: string) => {
    if (!dragId || !categories || dragId === targetId) return;
    const ids = categories.map((c) => c.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);
    reorderMutation.mutate(ids);
    setDragId(null);
  };

  const renderCategoryRow = (label: string, value: string, count: number, key: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setSelectedCategory(value)}
      className={`w-full text-left px-3 py-2 text-sm rounded-md flex items-center justify-between gap-2 hover-elevate ${selectedCategory === value ? "bg-accent" : ""}`}
      data-testid={`button-cat-${key}`}
    >
      <span className="truncate">{label}</span>
      <span className="text-xs text-muted-foreground flex-shrink-0">{count}</span>
    </button>
  );

  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-wrap gap-2">
        <h2 className="text-sm font-semibold flex items-center gap-3" data-testid="text-quick-responses-title">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-500">
            <Zap className="h-[18px] w-[18px]" />
          </span>
          Quick Responses
        </h2>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setEditingQr(null); form.reset(); } }}>
          {canManage && <DialogTrigger asChild>
            <Button size="sm" onClick={openCreate} data-testid="button-add-quick-response">
              <Plus className="w-4 h-4 mr-1" /> Add Response
            </Button>
          </DialogTrigger>}
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingQr ? "Edit Quick Response" : "Add Quick Response"}</DialogTitle>
              <DialogDescription>
                Use <code>{"{{customer_name}}"}</code>, <code>{"{{ticket_subject}}"}</code>, or <code>{"{{admin_name}}"}</code> to insert dynamic values.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => {
                const unknown = findUnknownPlaceholders(data.message ?? "");
                if (unknown.length > 0) {
                  setPendingSave({ data, mode: editingQr ? "update" : "create", unknown });
                  return;
                }
                if (editingQr) updateMutation.mutate(data); else createMutation.mutate(data);
              })} className="space-y-4">
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g. Billing Question" data-testid="input-qr-title" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="categoryId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select
                      value={field.value ?? "__none__"}
                      onValueChange={(v) => field.onChange(v === "__none__" ? null : v)}
                    >
                      <FormControl><SelectTrigger data-testid="select-qr-category"><SelectValue placeholder="Uncategorized" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">Uncategorized</SelectItem>
                        {(categories ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="message" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Message</FormLabel>
                    <FormControl>
                      <TemplateMessageEditor
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        rows={4}
                        placeholder="The response text to send..."
                        testId="input-qr-message"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-save-quick-response">
                  {editingQr ? "Update" : "Create"} Quick Response
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <AlertDialog
        open={pendingSave !== null}
        onOpenChange={(open) => { if (!open) setPendingSave(null); }}
      >
        <AlertDialogContent data-testid="dialog-qr-unknown-placeholder-warning">
          <AlertDialogHeader>
            <AlertDialogTitle>Unknown placeholders in this template</AlertDialogTitle>
            <AlertDialogDescription>
              This message contains{" "}
              {pendingSave?.unknown.map((token, i) => (
                <span key={`${token}-${i}`}>
                  {i > 0 ? ", " : ""}
                  <code
                    className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100"
                    data-testid={`text-qr-unknown-token-${i}`}
                  >
                    {token}
                  </code>
                </span>
              ))}
              , which {pendingSave && pendingSave.unknown.length === 1 ? "does" : "do"} not match any known variable and will be sent literally. Save anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingSaveSuggestion && (
            <p
              className="text-sm text-muted-foreground"
              data-testid="text-qr-unknown-suggestion-summary"
            >
              We can replace {pendingSaveSuggestion.replaced} placeholder
              {pendingSaveSuggestion.replaced === 1 ? "" : "s"} with the closest
              recognized variable.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-qr-unknown-fix">Fix</AlertDialogCancel>
            {pendingSaveSuggestion && (
              <AlertDialogAction
                onClick={() => {
                  if (!pendingSave || !pendingSaveSuggestion) return;
                  const { data, mode } = pendingSave;
                  const fixed = { ...data, message: pendingSaveSuggestion.nextMessage };
                  setPendingSave(null);
                  form.setValue("message", pendingSaveSuggestion.nextMessage);
                  if (mode === "update") updateMutation.mutate(fixed);
                  else createMutation.mutate(fixed);
                }}
                data-testid="button-qr-unknown-apply-suggestion"
              >
                Apply suggestion & save
              </AlertDialogAction>
            )}
            <AlertDialogAction
              onClick={() => {
                if (!pendingSave) return;
                const { data, mode } = pendingSave;
                setPendingSave(null);
                if (mode === "update") updateMutation.mutate(data);
                else createMutation.mutate(data);
              }}
              data-testid="button-qr-unknown-save-anyway"
            >
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] border-t border-border">
        <div className="p-3 space-y-1 border-b md:border-b-0 md:border-r border-border bg-muted/20">
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Categories</div>
            {renderCategoryRow("All", ALL_CATEGORIES, counts.total, "all")}
            {renderCategoryRow("Uncategorized", UNCATEGORIZED, counts.uncategorized, "uncategorized")}
            {counts.needsReview > 0 && (
              <button
                type="button"
                onClick={() => setSelectedCategory(NEEDS_REVIEW)}
                className={`w-full text-left px-3 py-2 text-sm rounded-md flex items-center justify-between gap-2 hover-elevate ${selectedCategory === NEEDS_REVIEW ? "bg-accent" : ""}`}
                data-testid="button-cat-needs-review"
              >
                <span className="truncate flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Needs review
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0" data-testid="text-needs-review-count">{counts.needsReview}</span>
              </button>
            )}
            <div className="border-t my-1" />
            {(categories ?? []).map((c) => (
              <div
                key={c.id}
                draggable={canManage}
                onDragStart={() => setDragId(c.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(c.id)}
                className={`group flex items-center gap-1 ${dragId === c.id ? "opacity-50" : ""}`}
                data-testid={`row-cat-${c.id}`}
              >
                {editingCatId === c.id ? (
                  <div className="flex-1 flex items-center gap-1 px-2 py-1">
                    <Input
                      value={editingCatName}
                      onChange={(e) => setEditingCatName(e.target.value)}
                      className="h-7 text-sm"
                      data-testid={`input-edit-cat-${c.id}`}
                      autoFocus
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => updateCategoryMutation.mutate({ id: c.id, name: editingCatName })} data-testid={`button-save-cat-${c.id}`}>
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingCatId(null); setEditingCatName(""); }}>
                      <XIcon className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelectedCategory(c.id)}
                      className={`flex-1 text-left px-3 py-2 text-sm rounded-md flex items-center justify-between gap-2 hover-elevate ${selectedCategory === c.id ? "bg-accent" : ""}`}
                      data-testid={`button-cat-${c.id}`}
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{counts.byCategory.get(c.id) ?? 0}</span>
                    </button>
                    {canManage && (
                      <div className="opacity-0 group-hover:opacity-100 flex items-center">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingCatId(c.id); setEditingCatName(c.name); }} data-testid={`button-rename-cat-${c.id}`}>
                          <Edit className="w-3 h-3" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" data-testid={`button-delete-cat-${c.id}`}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete category "{c.name}"?</AlertDialogTitle>
                              <AlertDialogDescription>Responses in this category will become Uncategorized.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteCategoryMutation.mutate(c.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {canManage && (
              <div className="flex items-center gap-1 pt-2 border-t">
                <Input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="New category"
                  className="h-7 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newCategoryName.trim()) {
                      createCategoryMutation.mutate(newCategoryName.trim());
                    }
                  }}
                  data-testid="input-new-cat"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={!newCategoryName.trim() || createCategoryMutation.isPending}
                  onClick={() => createCategoryMutation.mutate(newCategoryName.trim())}
                  data-testid="button-add-cat"
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
        </div>

        <div className="flex flex-col">
          <div className="p-3 border-b border-border bg-muted/10 relative">
            <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search responses..."
              className="pl-8 bg-background"
              data-testid="input-qr-search"
            />
          </div>

          {canManage && selectedCategory === NEEDS_REVIEW && (() => {
            const items = filteredResponses
              .map((qr) => {
                const sug = suggestionsById.get(qr.id);
                return sug ? { id: qr.id, message: sug.nextMessage, replaced: sug.replaced } : null;
              })
              .filter((x): x is { id: string; message: string; replaced: number } => x !== null);
            const totalReplacements = items.reduce((acc, it) => acc + it.replaced, 0);
            if (items.length === 0) return null;
            return (
              <div
                className="flex items-center justify-between gap-3 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-2"
                data-testid="banner-qr-bulk-suggestions"
              >
                <div className="text-xs text-amber-900 dark:text-amber-100">
                  We found{" "}
                  <span data-testid="text-qr-bulk-suggestion-count">{totalReplacements}</span>
                  {" "}placeholder{totalReplacements === 1 ? "" : "s"} across{" "}
                  {items.length} template{items.length === 1 ? "" : "s"} that look like typos of known variables.
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkApplySuggestionsMutation.isPending}
                  onClick={() =>
                    bulkApplySuggestionsMutation.mutate(
                      items.map(({ id, message }) => ({ id, message })),
                    )
                  }
                  data-testid="button-qr-bulk-apply-suggestions"
                >
                  {bulkApplySuggestionsMutation.isPending ? "Applying…" : "Apply all suggestions"}
                </Button>
              </div>
            );
          })()}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : filteredResponses.length === 0 ? (
            <div className="rounded-xl border border-card-border bg-card py-8 text-center">
              <Zap className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
              <p className="text-sm text-muted-foreground">
                {(quickResponses ?? []).length === 0
                  ? "No quick responses yet. Add one to get started."
                  : "No responses match this filter."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredResponses.map((qr) => (
                <div key={qr.id} className="rounded-xl border border-card-border bg-card p-4" data-testid={`card-quick-response-${qr.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm" data-testid={`text-qr-title-${qr.id}`}>{qr.title}</p>
                          {qr.categoryId && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                              <Hash className="w-2.5 h-2.5" />
                              {(categories ?? []).find((c) => c.id === qr.categoryId)?.name ?? "Unknown"}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0" data-testid={`text-qr-usage-${qr.id}`}>
                            Used {qr.usageCount}
                          </Badge>
                          {unknownTokensById.has(qr.id) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => canManage && openEdit(qr)}
                                  className="inline-flex items-center gap-1 rounded border border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100 text-[10px] px-1.5 py-0 hover-elevate"
                                  data-testid={`badge-qr-unknown-${qr.id}`}
                                >
                                  <AlertTriangle className="w-2.5 h-2.5" />
                                  Unknown placeholder
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="text-xs">
                                  <div className="font-medium mb-1">Unknown placeholder{(unknownTokensById.get(qr.id)?.length ?? 0) > 1 ? "s" : ""}:</div>
                                  <div className="font-mono">
                                    {(unknownTokensById.get(qr.id) ?? []).join(", ")}
                                  </div>
                                  {suggestionsById.get(qr.id) && (
                                    <div className="mt-2 pt-2 border-t border-border/50">
                                      <div className="font-medium mb-1">Suggested fix{(suggestionsById.get(qr.id)?.pairs.length ?? 0) > 1 ? "es" : ""}:</div>
                                      <div className="font-mono space-y-0.5">
                                        {(suggestionsById.get(qr.id)?.pairs ?? []).map((p) => (
                                          <div key={p.token}>
                                            {p.token} → {`{{${p.suggestion}}}`}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {canManage && suggestionsById.has(qr.id) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-5 text-[10px] px-1.5 py-0 gap-1 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100"
                              disabled={applySuggestionMutation.isPending}
                              onClick={() => {
                                const sug = suggestionsById.get(qr.id);
                                if (!sug) return;
                                applySuggestionMutation.mutate({ id: qr.id, message: sug.nextMessage });
                              }}
                              data-testid={`button-qr-apply-suggestion-${qr.id}`}
                            >
                              <Check className="w-2.5 h-2.5" />
                              Apply suggestion
                            </Button>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap" data-testid={`text-qr-message-${qr.id}`}>{qr.message}</p>
                      </div>
                      {canManage && <div className="flex items-center gap-1 flex-shrink-0">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(qr)} data-testid={`button-edit-qr-${qr.id}`}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" data-testid={`button-delete-qr-${qr.id}`}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Quick Response</AlertDialogTitle>
                              <AlertDialogDescription>Are you sure you want to delete "{qr.title}"?</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMutation.mutate(qr.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>}
                    </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

type EnrichedReportRequest = ReportRequest & { customerName?: string; customerEmail?: string; serviceName?: string };

function ReportsRequestsTab({ canManage = true }: { canManage?: boolean }) {
  const { toast } = useToast();
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updatingReport, setUpdatingReport] = useState<EnrichedReportRequest | null>(null);
  const [updateStatus, setUpdateStatus] = useState("");
  const [updateNotes, setUpdateNotes] = useState("");

  useEffect(() => {
    apiRequest("POST", "/api/content-notifications/mark-read", { category: "admin-reports" })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/content-notifications/counts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      })
      .catch(() => {});
  }, []);

  const { data: reports, isLoading } = useQuery<EnrichedReportRequest[]>({
    queryKey: ["/api/report-requests"],
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, adminNotes }: { id: string; status: string; adminNotes: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/report-requests/${id}`, { status, adminNotes: adminNotes || undefined });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/report-requests"] });
      setUpdateDialogOpen(false);
      setUpdatingReport(null);
      toast({ title: "Status updated and customer notified" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/report-requests/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/report-requests"] });
      toast({ title: "Report/request deleted" });
    },
  });

  const openUpdateDialog = (rr: EnrichedReportRequest) => {
    setUpdatingReport(rr);
    setUpdateStatus(rr.status);
    setUpdateNotes(rr.adminNotes || "");
    setUpdateDialogOpen(true);
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pending: "secondary",
      reviewed: "default",
      completed: "default",
      dismissed: "outline",
    };
    return <Badge variant={variants[status] || "secondary"} className="text-xs capitalize">{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-wrap gap-4">
          <h2 className="text-sm font-semibold flex items-center gap-3" data-testid="text-reports-requests-title">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
              <FileText className="h-[18px] w-[18px]" />
            </span>
            Reports & Requests
          </h2>
        </div>
        {isLoading ? (
          <ul className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="px-5 py-3.5 flex items-start gap-4">
                <div className="flex-1 space-y-2 py-1">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </li>
            ))}
          </ul>
        ) : !reports || reports.length === 0 ? (
          <div className="px-5 py-8 text-center flex flex-col items-center justify-center">
            <FileText className="w-8 h-8 mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No reports or requests yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {reports.map((rr) => (
              <li key={rr.id} className="px-5 py-4 flex items-start justify-between gap-4 hover-elevate transition-colors group" data-testid={`card-report-${rr.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={rr.type === "content_issue" ? "destructive" : rr.type === "app_issue" ? "outline" : "default"} className="text-xs">
                      {rr.type === "content_issue" ? "Content Issue" : rr.type === "app_issue" ? "App Issue / Feature Request" : "Movie/Series Request"}
                    </Badge>
                    {statusBadge(rr.status)}
                  </div>
                  <p className="font-medium text-sm mt-2" data-testid={`text-report-title-${rr.id}`}>{rr.title}</p>
                  {rr.description && <p className="text-xs text-muted-foreground mt-1">{rr.description}</p>}
                  {rr.imageUrl && (
                    <div className="mt-2">
                      {rr.imageUrl.match(/\.(mp4|webm|mov|avi)$/i) ? (
                        <div>
                          <ClickableVideo src={rr.imageUrl} className="max-h-32 rounded-md border" />
                          <a href={rr.imageUrl} download target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid={`link-download-video-${rr.id}`}>
                            <Download className="w-3 h-3" />
                            <span>Download</span>
                          </a>
                        </div>
                      ) : (
                        <div>
                          <ClickableImage src={rr.imageUrl} alt="Attachment" className="max-h-32 rounded-md border" />
                          <a href={rr.imageUrl} download target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid={`link-download-image-${rr.id}`}>
                            <Download className="w-3 h-3" />
                            <span>Download</span>
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                  {rr.adminNotes && (
                    <div className="mt-2 p-2 rounded-md bg-accent/50 border">
                      <p className="text-xs font-medium text-muted-foreground">Admin Notes:</p>
                      <p className="text-xs mt-0.5">{rr.adminNotes}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground flex-wrap">
                    <span>{rr.customerName}</span>
                    {rr.customerEmail && <span>({rr.customerEmail})</span>}
                    <span>·</span>
                    <span>{rr.serviceName}</span>
                    <span>·</span>
                    <Clock className="w-3 h-3" />
                    <span>{format(new Date(rr.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
                  </div>
                </div>
                {canManage && <div className="flex gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openUpdateDialog(rr)} data-testid={`button-update-report-${rr.id}`}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" data-testid={`button-delete-report-${rr.id}`}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Report/Request</AlertDialogTitle>
                        <AlertDialogDescription>Are you sure you want to delete this submission?</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteMutation.mutate(rr.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={updateDialogOpen} onOpenChange={(open) => { if (!open) { setUpdateDialogOpen(false); setUpdatingReport(null); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update Report/Request</DialogTitle>
          </DialogHeader>
          {updatingReport && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">{updatingReport.title}</p>
                <p className="text-xs text-muted-foreground mt-1">From: {updatingReport.customerName}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <Select value={updateStatus} onValueChange={setUpdateStatus}>
                  <SelectTrigger data-testid="select-update-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="reviewed">Reviewed</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="dismissed">Dismissed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Admin Notes</label>
                <Textarea
                  value={updateNotes}
                  onChange={(e) => setUpdateNotes(e.target.value)}
                  rows={3}
                  placeholder="Add notes for the customer..."
                  data-testid="input-admin-notes"
                />
              </div>
              <Button
                className="w-full"
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate({ id: updatingReport.id, status: updateStatus, adminNotes: updateNotes })}
                data-testid="button-save-update"
              >
                {updateMutation.isPending ? "Updating..." : "Update & Notify Customer"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ServiceUpdatesTab({ canManage = true }: { canManage?: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editingUpdate, setEditingUpdate] = useState<ServiceUpdate | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editMatureContent, setEditMatureContent] = useState(false);
  const [expandedUpdateId, setExpandedUpdateId] = useState<string | null>(null);

  const { data: updates, isLoading } = useQuery<ServiceUpdate[]>({
    queryKey: ["/api/service-updates"],
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const createSchema = z.object({
    title: z.string().min(1, "Title is required"),
    description: z.string().refine(v => stripHtml(v).trim().length > 0, "Description is required"),
    serviceId: z.string().min(1, "Service is required"),
    matureContent: z.boolean().default(false),
  });

  const form = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: { title: "", description: "", serviceId: "", matureContent: false },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof createSchema>) => {
      await apiRequest("POST", "/api/admin/service-updates", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-updates"] });
      toast({ title: "Service update created and notifications sent" });
      form.reset();
      setOpen(false);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { title: string; description: string; matureContent: boolean } }) => {
      await apiRequest("PATCH", `/api/admin/service-updates/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-updates"] });
      toast({ title: "Service update updated" });
      setEditingUpdate(null);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/service-updates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-updates"] });
      toast({ title: "Service update deleted" });
    },
  });

  const openEditDialog = (update: ServiceUpdate) => {
    setEditTitle(update.title);
    setEditDescription(update.description);
    setEditMatureContent(update.matureContent);
    setEditingUpdate(update);
  };

  const getServiceName = (serviceId: string) => {
    return services?.find(s => s.id === serviceId)?.name || "Unknown";
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex justify-between items-center px-5 py-4 border-b border-border flex-wrap gap-4">
          <h2 className="text-sm font-semibold flex items-center gap-3" data-testid="text-admin-service-updates-title">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400">
              <RefreshCw className="h-[18px] w-[18px]" />
            </span>
            Service Updates ({updates?.length || 0})
          </h2>
          <Dialog open={open} onOpenChange={setOpen}>
            {canManage && <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-service-update"><Plus className="w-4 h-4 mr-1" />Add Update</Button>
            </DialogTrigger>}
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Service Update</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
                <FormField control={form.control} name="serviceId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-service-update-service">
                          <SelectValue placeholder="Select a service" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {services?.map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Update title" data-testid="input-service-update-title" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <RichTextEditor value={field.value} onChange={field.onChange} placeholder="Describe the update..." testIdPrefix="input-service-update-description" hideImage />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="matureContent" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between border rounded-md px-3 py-2">
                      <div>
                        <FormLabel className="text-sm font-medium">Mature Content</FormLabel>
                        <p className="text-xs text-muted-foreground">Warn customers before viewing this update</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={field.value}
                        onClick={() => field.onChange(!field.value)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${field.value ? 'bg-destructive' : 'bg-input'}`}
                        data-testid="switch-mature-content"
                      >
                        <span className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${field.value ? 'translate-x-5' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  </FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-submit-service-update">
                  {createMutation.isPending ? "Creating..." : "Create & Notify Subscribers"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {!updates || updates.length === 0 ? (
        <div className="py-12 text-center">
          <Bell className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground" data-testid="text-no-admin-updates">
            No service updates yet
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {updates.map((update) => (
            <div key={update.id} className="px-5 py-3.5" data-testid={`card-admin-update-${update.id}`}>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 cursor-pointer group" onClick={() => setExpandedUpdateId(expandedUpdateId === update.id ? null : update.id)} data-testid={`button-expand-update-${update.id}`}>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {expandedUpdateId === update.id ? <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground group-hover:text-foreground" /> : <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground group-hover:text-foreground" />}
                    <h4 className="font-semibold text-sm min-w-0 truncate text-foreground">{update.title}</h4>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="outline" className="text-[10px] font-normal bg-background">{getServiceName(update.serviceId)}</Badge>
                    {update.matureContent && <Badge variant="destructive" className="text-[10px] font-normal" data-testid={`badge-mature-${update.id}`}>Mature</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap pl-6">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {format(new Date(update.createdAt), "MMM d, yyyy h:mm a")}
                  </span>
                </div>
                {expandedUpdateId === update.id && (
                  <div className="space-y-3 pt-2 pl-6 pb-1">
                    <RichTextContent content={update.description} className="text-sm text-muted-foreground" testId={`text-admin-update-desc-${update.id}`} />
                    <div className="flex items-center gap-2 flex-wrap">
                      {canManage && (
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openEditDialog(update); }} data-testid={`button-admin-edit-update-${update.id}`}>
                          <Edit className="w-3.5 h-3.5 mr-1.5" /> Edit
                        </Button>
                      )}
                      {canManage && <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" data-testid={`button-admin-delete-update-${update.id}`}>
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Service Update?</AlertDialogTitle>
                            <AlertDialogDescription>This will permanently remove this service update.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteMutation.mutate(update.id)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </section>

      <Dialog open={!!editingUpdate} onOpenChange={(open) => { if (!open) setEditingUpdate(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Service Update</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Service</Label>
              <p className="text-sm text-muted-foreground mt-1">{editingUpdate ? getServiceName(editingUpdate.serviceId) : ""}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-update-title">Title</Label>
              <Input id="edit-update-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} data-testid="input-edit-update-title" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <RichTextEditor value={editDescription} onChange={setEditDescription} testIdPrefix="input-edit-update-description" hideImage />
            </div>
            <div className="flex items-center justify-between border rounded-md px-3 py-2">
              <div>
                <Label className="text-sm font-medium">Mature Content</Label>
                <p className="text-xs text-muted-foreground">Warn customers before viewing this update</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={editMatureContent}
                onClick={() => setEditMatureContent(!editMatureContent)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${editMatureContent ? 'bg-destructive' : 'bg-input'}`}
                data-testid="switch-edit-mature-content"
              >
                <span className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${editMatureContent ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            <Button
              className="w-full"
              disabled={editMutation.isPending || !editTitle.trim() || !stripHtml(editDescription).trim()}
              onClick={() => {
                if (editingUpdate) {
                  editMutation.mutate({ id: editingUpdate.id, data: { title: editTitle, description: editDescription, matureContent: editMatureContent } });
                }
              }}
              data-testid="button-save-edit-update"
            >
              {editMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmailTemplatesTab({ canManage = true }: { canManage?: boolean }) {
  const { toast } = useToast();
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const { data: templates, isLoading } = useQuery<EmailTemplate[]>({
    queryKey: ["/api/admin/email-templates"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, subject, body }: { id: string; subject: string; body: string }) => {
      await apiRequest("PATCH", `/api/admin/email-templates/${id}`, { subject, body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-templates"] });
      setEditingTemplate(null);
      toast({ title: "Template updated" });
    },
    onError: () => {
      toast({ title: "Failed to update template", variant: "destructive" });
    },
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      await apiRequest("PATCH", `/api/admin/email-templates/${id}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-templates"] });
      toast({ title: "Template updated" });
    },
    onError: () => {
      toast({ title: "Failed to update template", variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/admin/email-templates/${id}/reset`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-templates"] });
      setEditingTemplate(null);
      toast({ title: "Template reset to default" });
    },
    onError: () => {
      toast({ title: "Failed to reset template", variant: "destructive" });
    },
  });

  const openEdit = (template: EmailTemplate) => {
    setEditingTemplate(template);
    setEditSubject(template.subject);
    setEditBody(template.body);
    setShowPreview(false);
  };

  const insertVariable = (varName: string) => {
    const textarea = document.getElementById("template-body-editor") as HTMLTextAreaElement | null;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newBody = editBody.substring(0, start) + `{${varName}}` + editBody.substring(end);
      setEditBody(newBody);
      setTimeout(() => {
        textarea.focus();
        const newPos = start + varName.length + 2;
        textarea.setSelectionRange(newPos, newPos);
      }, 0);
    } else {
      setEditBody(editBody + `{${varName}}`);
    }
  };

  if (isLoading) return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-wrap gap-4">
        <h2 className="text-sm font-semibold flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <Mail className="h-[18px] w-[18px]" />
          </span>
          Email Templates
        </h2>
      </div>
      <ul className="divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="px-5 py-3.5 flex items-start gap-4">
            <div className="flex-1 space-y-2 py-1">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-muted-foreground">Customize the subject and body of outgoing system emails. Use variable placeholders like <code className="bg-muted px-1 py-0.5 rounded text-xs">{"{variable_name}"}</code> which get replaced automatically when emails are sent.</p>
      </div>
      
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-wrap gap-4">
          <h2 className="text-sm font-semibold flex items-center gap-3" data-testid="text-email-templates-title">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Mail className="h-[18px] w-[18px]" />
            </span>
            Email Templates ({templates?.length || 0})
          </h2>
        </div>
        
        {!templates || templates.length === 0 ? (
          <div className="px-5 py-8 text-center flex flex-col items-center justify-center">
            <Mail className="w-8 h-8 mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No templates available</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {templates.map((template) => (
              <li key={template.id} className="px-5 py-4 flex items-start justify-between gap-4 hover-elevate transition-colors group" data-testid={`card-template-${template.templateKey}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm" data-testid={`text-template-name-${template.templateKey}`}>{template.name}</h3>
                    <Badge variant={template.enabled !== false ? "default" : "secondary"} className={template.enabled !== false ? "bg-status-online/10 text-status-online hover:bg-status-online/20" : ""}>
                      {template.enabled !== false ? "On" : "Off"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{template.description}</p>
                  <p className="text-xs text-muted-foreground mt-1.5 font-mono truncate">Subject: {template.subject}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Switch
                    checked={template.enabled !== false}
                    onCheckedChange={(checked) => toggleEnabledMutation.mutate({ id: template.id, enabled: checked })}
                    disabled={!canManage}
                    data-testid={`switch-template-enabled-${template.templateKey}`}
                  />
                  {canManage && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      onClick={() => openEdit(template)}
                      data-testid={`button-edit-template-${template.templateKey}`}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={!!editingTemplate} onOpenChange={(open) => { if (!open) setEditingTemplate(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-edit-template">
          <DialogHeader>
            <DialogTitle data-testid="text-edit-template-title">Edit Template: {editingTemplate?.name}</DialogTitle>
          </DialogHeader>
          {editingTemplate && (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">{editingTemplate.description}</p>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Available Variables</label>
                <div className="flex flex-wrap gap-1.5">
                  {editingTemplate.availableVariables?.map((v) => (
                    <Badge
                      key={v}
                      variant="secondary"
                      className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors text-xs gap-1"
                      onClick={() => insertVariable(v)}
                      data-testid={`badge-var-${v}`}
                    >
                      <Copy className="w-3 h-3" />
                      {`{${v}}`}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Click a variable to insert it at the cursor position in the body field</p>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Subject</label>
                <Input
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  className="font-mono text-sm"
                  data-testid="input-template-subject"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">Body (HTML)</label>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 h-7 text-xs"
                    onClick={() => setShowPreview(!showPreview)}
                    data-testid="button-toggle-preview"
                  >
                    {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {showPreview ? "Edit" : "Preview"}
                  </Button>
                </div>
                {showPreview ? (
                  <div
                    className="border rounded-md p-4 min-h-[200px] prose prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: editBody }}
                    data-testid="div-template-preview"
                  />
                ) : (
                  <Textarea
                    id="template-body-editor"
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    className="font-mono text-xs min-h-[200px] resize-y"
                    data-testid="textarea-template-body"
                  />
                )}
              </div>

              <div className="flex gap-2 justify-between">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-muted-foreground"
                      data-testid="button-reset-template"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      Reset to Default
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset Template?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will restore the template to the original system default. Any customizations will be lost.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => resetMutation.mutate(editingTemplate.id)}
                        data-testid="button-confirm-reset"
                      >
                        Reset
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditingTemplate(null)} data-testid="button-cancel-edit">
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1"
                    disabled={updateMutation.isPending}
                    onClick={() => updateMutation.mutate({ id: editingTemplate.id, subject: editSubject, body: editBody })}
                    data-testid="button-save-template"
                  >
                    {updateMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface NotificationTemplateRow {
  id: string | null;
  templateKey: string;
  group: "Service" | "Invoice" | "Ticket";
  label: string;
  description: string;
  variables: { name: string; description: string }[];
  defaultTitle: string;
  defaultBody: string;
  title: string;
  body: string;
  enabled: boolean;
  customized: boolean;
}

const NOTIFICATION_TEMPLATE_GROUPS: NotificationTemplateRow["group"][] = ["Service", "Invoice", "Ticket"];

function NotificationTemplatesTab({ canManage = true }: { canManage?: boolean }) {
  const { toast } = useToast();
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplateRow | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const { data: templates, isLoading } = useQuery<NotificationTemplateRow[]>({
    queryKey: ["/api/admin/notification-templates"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, title, body }: { id: string; title: string; body: string }) => {
      await apiRequest("PATCH", `/api/admin/notification-templates/${id}`, { title, body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/notification-templates"] });
      setEditingTemplate(null);
      toast({ title: "Notification updated" });
    },
    onError: () => {
      toast({ title: "Failed to update notification", variant: "destructive" });
    },
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      await apiRequest("PATCH", `/api/admin/notification-templates/${id}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/notification-templates"] });
      toast({ title: "Notification updated" });
    },
    onError: () => {
      toast({ title: "Failed to update notification", variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/admin/notification-templates/${id}/reset`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/notification-templates"] });
      setEditingTemplate(null);
      toast({ title: "Notification reset to default" });
    },
    onError: () => {
      toast({ title: "Failed to reset notification", variant: "destructive" });
    },
  });

  const openEdit = (template: NotificationTemplateRow) => {
    setEditingTemplate(template);
    setEditTitle(template.title);
    setEditBody(template.body);
  };

  const insertVariable = (varName: string) => {
    const textarea = document.getElementById("notif-template-body-editor") as HTMLTextAreaElement | null;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newBody = editBody.substring(0, start) + `{${varName}}` + editBody.substring(end);
      setEditBody(newBody);
      setTimeout(() => {
        textarea.focus();
        const newPos = start + varName.length + 2;
        textarea.setSelectionRange(newPos, newPos);
      }, 0);
    } else {
      setEditBody(editBody + `{${varName}}`);
    }
  };

  if (isLoading) return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-wrap gap-4">
        <h2 className="text-sm font-semibold flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <Bell className="h-[18px] w-[18px]" />
          </span>
          Notification Wording
        </h2>
      </div>
      <ul className="divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="px-5 py-3.5 flex items-start gap-4">
            <div className="flex-1 space-y-2 py-1">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-muted-foreground">Customize the title and body of the WHMCS push &amp; in-app notifications customers receive. Use placeholders like <code className="bg-muted px-1 py-0.5 rounded text-xs">{"{service}"}</code> which are filled in automatically. Turning a notification <strong>Off</strong> reverts it to the built-in default wording — the notification still sends.</p>
      </div>

      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-wrap gap-4">
          <h2 className="text-sm font-semibold flex items-center gap-3" data-testid="text-notification-templates-title">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <Bell className="h-[18px] w-[18px]" />
            </span>
            Notification Wording
          </h2>
        </div>
        
        {NOTIFICATION_TEMPLATE_GROUPS.map((group) => {
          const groupTemplates = templates?.filter((t) => t.group === group) ?? [];
          if (groupTemplates.length === 0) return null;
          return (
            <div key={group} className="border-b border-border last:border-0">
              <div className="px-5 py-3 bg-muted/20 border-b border-border">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide" data-testid={`text-notif-group-${group.toLowerCase()}`}>{group} Notifications</h3>
              </div>
              <ul className="divide-y divide-border">
                {groupTemplates.map((template) => (
                  <li key={template.templateKey} className="px-5 py-4 flex items-start justify-between gap-4 hover-elevate transition-colors group" data-testid={`card-notif-template-${template.templateKey}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-sm" data-testid={`text-notif-template-name-${template.templateKey}`}>{template.label}</h4>
                        {template.customized && template.enabled && (
                          <Badge variant="secondary" className="text-[10px]">Custom</Badge>
                        )}
                        <Badge variant={template.enabled ? "default" : "secondary"} className={template.enabled ? "bg-status-online/10 text-status-online hover:bg-status-online/20" : ""}>
                          {template.enabled ? "On" : "Off"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{template.description}</p>
                      <p className="text-xs text-muted-foreground mt-2 font-mono truncate">{template.enabled ? template.title : template.defaultTitle}</p>
                      <p className="text-xs text-muted-foreground mt-1 font-mono truncate">{template.enabled ? template.body : template.defaultBody}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Switch
                        checked={template.enabled}
                        onCheckedChange={(checked) => template.id && toggleEnabledMutation.mutate({ id: template.id, enabled: checked })}
                        disabled={!canManage || !template.id}
                        data-testid={`switch-notif-template-enabled-${template.templateKey}`}
                      />
                      {canManage && template.id && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                          onClick={() => openEdit(template)}
                          data-testid={`button-edit-notif-template-${template.templateKey}`}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <Dialog open={!!editingTemplate} onOpenChange={(open) => { if (!open) setEditingTemplate(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-edit-notif-template">
          <DialogHeader>
            <DialogTitle data-testid="text-edit-notif-template-title">Edit Notification: {editingTemplate?.label}</DialogTitle>
          </DialogHeader>
          {editingTemplate && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">{editingTemplate.description}</p>

              <div>
                <label className="text-sm font-medium mb-1 block">Available Variables</label>
                <div className="flex flex-wrap gap-1.5">
                  {editingTemplate.variables.map((v) => (
                    <Badge
                      key={v.name}
                      variant="secondary"
                      className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors text-xs gap-1"
                      onClick={() => insertVariable(v.name)}
                      title={v.description}
                      data-testid={`badge-notif-var-${v.name}`}
                    >
                      <Copy className="w-3 h-3" />
                      {`{${v.name}}`}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Click a variable to insert it at the cursor position in the body field</p>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Title</label>
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="font-mono text-sm"
                  data-testid="input-notif-template-title"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Body</label>
                <Textarea
                  id="notif-template-body-editor"
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  className="font-mono text-xs min-h-[120px] resize-y"
                  data-testid="textarea-notif-template-body"
                />
              </div>

              <div className="flex gap-2 justify-between">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-muted-foreground"
                      data-testid="button-reset-notif-template"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      Reset to Default
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset Notification?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will restore the notification to the original system default. Any customizations will be lost.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => editingTemplate.id && resetMutation.mutate(editingTemplate.id)}
                        data-testid="button-confirm-notif-reset"
                      >
                        Reset
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditingTemplate(null)} data-testid="button-cancel-notif-edit">
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1"
                    disabled={updateMutation.isPending}
                    onClick={() => editingTemplate.id && updateMutation.mutate({ id: editingTemplate.id, title: editTitle, body: editBody })}
                    data-testid="button-save-notif-template"
                  >
                    {updateMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ActivityLog {
  id: string;
  category: string;
  action: string;
  actorId: string | null;
  targetId: string | null;
  targetType: string | null;
  recipientId: string | null;
  summary: string;
  details: string | null;
  createdAt: string;
  actorName?: string | null;
  recipientName?: string | null;
}

const LOG_CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: typeof Mail }> = {
  email: { label: "Email", color: "bg-indigo-500/10 text-indigo-500", icon: Mail },
  push: { label: "Push", color: "bg-green-500/10 text-green-500", icon: Bell },
  ticket: { label: "Ticket", color: "bg-sky-500/10 text-sky-500", icon: LifeBuoy },
  alert: { label: "Alert", color: "bg-amber-500/10 text-amber-500", icon: AlertTriangle },
  user: { label: "User", color: "bg-blue-500/10 text-blue-500", icon: Users },
  news: { label: "News", color: "bg-purple-500/10 text-purple-500", icon: Newspaper },
  service_update: { label: "Service Update", color: "bg-teal-500/10 text-teal-500", icon: RefreshCw },
  report: { label: "Report", color: "bg-cyan-500/10 text-cyan-500", icon: FileText },
  error_log: { label: "Error Log", color: "bg-red-500/10 text-red-500", icon: AlertTriangle },
};

function DownloadsTab({ canManage = true }: { canManage?: boolean }) {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<DownloadItem | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [downloaderCode, setDownloaderCode] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);

  const { data: downloads, isLoading } = useQuery<DownloadItem[]>({
    queryKey: ["/api/downloads"],
  });

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setDownloaderCode("");
    setDownloadUrl("");
    setImageFile(null);
    setImagePreview(null);
    setRemoveImage(false);
    setEditItem(null);
  };

  const openAddDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (item: DownloadItem) => {
    setEditItem(item);
    setTitle(item.title);
    setDescription(item.description);
    setDownloaderCode(item.downloaderCode);
    setDownloadUrl(item.downloadUrl);
    setImageFile(null);
    setImagePreview(item.imageUrl || null);
    setRemoveImage(false);
    setDialogOpen(true);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setRemoveImage(false);
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setRemoveImage(true);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("description", description);
      formData.append("downloaderCode", downloaderCode);
      formData.append("downloadUrl", downloadUrl);
      if (imageFile) formData.append("image", imageFile);
      const res = await uploadRequest("POST", "/api/admin/downloads", formData);
      if (!res.ok) { const err = await res.json().catch(() => ({ message: "Request failed" })); throw new Error(err.message); }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Download created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editItem) return;
      const formData = new FormData();
      formData.append("title", title);
      formData.append("description", description);
      formData.append("downloaderCode", downloaderCode);
      formData.append("downloadUrl", downloadUrl);
      if (imageFile) formData.append("image", imageFile);
      if (removeImage) formData.append("removeImage", "true");
      const res = await uploadRequest("PATCH", `/api/admin/downloads/${editItem.id}`, formData);
      if (!res.ok) { const err = await res.json().catch(() => ({ message: "Request failed" })); throw new Error(err.message); }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Download updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/downloads/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
      toast({ title: "Download deleted" });
    },
  });

  const handleSubmit = () => {
    if (!title.trim() || !description.trim() || !downloaderCode.trim() || !downloadUrl.trim()) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    if (editItem) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-wrap gap-4">
          <h2 className="text-sm font-semibold flex items-center gap-3" data-testid="text-admin-downloads-title">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Download className="h-[18px] w-[18px]" />
            </span>
            Downloads ({downloads?.length || 0})
          </h2>
          {canManage && (
            <Button size="sm" onClick={openAddDialog} data-testid="button-add-download">
              <Plus className="w-4 h-4 mr-1" /> Add Download
            </Button>
          )}
        </div>
        
        {isLoading ? (
          <ul className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="px-5 py-3.5 flex items-start gap-4">
                <Skeleton className="w-16 h-12 rounded-md shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </li>
            ))}
          </ul>
        ) : !downloads || downloads.length === 0 ? (
          <div className="px-5 py-8 text-center flex flex-col items-center justify-center">
            <Download className="w-8 h-8 mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No downloads available</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {downloads.map((item) => (
              <li key={item.id} className="px-5 py-4 flex items-start justify-between gap-4 hover-elevate transition-colors group" data-testid={`card-download-${item.id}`}>
                <div className="flex items-start gap-4 min-w-0">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" loading="lazy" decoding="async" width={64} height={48} className="w-16 h-12 rounded-md object-cover border shrink-0" />
                  ) : (
                    <div className="w-16 h-12 rounded-md bg-muted/50 border flex items-center justify-center shrink-0">
                      <Download className="w-6 h-6 text-muted-foreground/30" />
                    </div>
                  )}
                  <div className="space-y-1.5 min-w-0">
                    <h4 className="font-semibold text-sm truncate" data-testid={`text-download-title-${item.id}`}>{item.title}</h4>
                    <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                    <div className="flex items-center gap-3 pt-1 flex-wrap">
                      <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">{item.downloaderCode}</code>
                      <a href={item.downloadUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline inline-flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" />
                        URL
                      </a>
                    </div>
                  </div>
                </div>
                {canManage && (
                  <div className="flex gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEditDialog(item)} data-testid={`button-edit-download-${item.id}`}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" data-testid={`button-delete-download-${item.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Download</AlertDialogTitle>
                          <AlertDialogDescription>Are you sure you want to delete this download item?</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMutation.mutate(item.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); resetForm(); } else setDialogOpen(true); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[85vh] overflow-y-auto" data-testid="dialog-download-form">
          <DialogHeader>
            <DialogTitle>{editItem ? "Edit Download" : "Add Download"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Title</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Download title" data-testid="input-download-title" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Description</label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this download?" rows={3} data-testid="input-download-description" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Downloader Code</label>
              <Input value={downloaderCode} onChange={(e) => setDownloaderCode(e.target.value)} placeholder="e.g. ABC-123" data-testid="input-download-code" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Download URL</label>
              <Input value={downloadUrl} onChange={(e) => setDownloadUrl(e.target.value)} placeholder="https://..." data-testid="input-download-url" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Thumbnail Image</label>
              {imagePreview ? (
                <div className="relative">
                  <img src={imagePreview} alt="Preview" className="w-full h-32 object-cover rounded-md" />
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1"
                    data-testid="button-remove-thumbnail"
                  >
                    <XIcon className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent/50 transition-colors" data-testid="label-upload-thumbnail">
                  <ImagePlus className="w-6 h-6 text-muted-foreground mb-1" />
                  <span className="text-xs text-muted-foreground">Click to upload</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                </label>
              )}
            </div>
            <Button className="w-full" disabled={isPending} onClick={handleSubmit} data-testid="button-submit-download">
              {isPending ? "Saving..." : editItem ? "Save Changes" : "Create Download"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="divide-y divide-border border-t border-border">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="px-5 py-3.5"><Skeleton className="h-14 w-full" /></div>)}
        </div>
      ) : !downloads || downloads.length === 0 ? (
        <div className="text-center py-12 border-t border-border">
          <Download className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No downloads yet</p>
        </div>
      ) : (
        <div className="divide-y divide-border border-t border-border">
          {downloads.map((dl) => (
            <div key={dl.id} className="px-5 py-3.5 hover-elevate group" data-testid={`card-admin-download-${dl.id}`}>
              <div className="flex items-start gap-4">
                {dl.imageUrl ? (
                  <img src={dl.imageUrl} alt={dl.title} loading="lazy" decoding="async" width={56} height={56} className="w-14 h-14 rounded-md object-cover flex-shrink-0 border border-border" />
                ) : (
                  <div className="w-14 h-14 rounded-md bg-muted/30 border border-border flex items-center justify-center flex-shrink-0">
                    <Download className="w-6 h-6 text-muted-foreground/50" />
                  </div>
                )}
                <div className="flex-1 min-w-0 py-0.5">
                  <p className="font-medium text-sm text-foreground truncate">{dl.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{dl.description}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 font-mono">{dl.downloaderCode}</p>
                </div>
                {canManage && (
                  <div className="flex gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEditDialog(dl)} data-testid={`button-edit-download-${dl.id}`}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" data-testid={`button-delete-download-${dl.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Download?</AlertDialogTitle>
                          <AlertDialogDescription>This will permanently remove "{dl.title}". This cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMutation.mutate(dl.id)} data-testid={`button-confirm-delete-download-${dl.id}`}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LogsTab() {
  const [category, setCategory] = useState<string>("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [previewLog, setPreviewLog] = useState<ActivityLog | null>(null);
  const limit = 30;

  const { data, isLoading } = useQuery<{ logs: ActivityLog[]; total: number }>({
    queryKey: ["/api/admin/activity-logs", category, search, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(`/api/admin/activity-logs?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load logs");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const getLogParsedDetails = (log: ActivityLog) => {
    if (!log.details) return null;
    try { return JSON.parse(log.details); } catch { return null; }
  };

  const hasPreview = (log: ActivityLog) => {
    return log.category === "email" || log.category === "push";
  };

  const renderDetails = (log: ActivityLog) => {
    if (!log.details) return null;
    try {
      const parsed = JSON.parse(log.details);
      const hideKeys = log.category === "email" ? ["body"] : [];
      return (
        <div className="space-y-1.5" data-testid={`log-details-${log.id}`}>
          {Object.entries(parsed).filter(([key]) => !hideKeys.includes(key)).map(([key, value]) => (
            <div key={key} className="flex gap-2 text-xs">
              <span className="font-medium text-muted-foreground min-w-[80px] capitalize">{key.replace(/_/g, " ")}:</span>
              <span className="text-foreground break-all whitespace-pre-wrap">{typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}</span>
            </div>
          ))}
        </div>
      );
    } catch {
      return <p className="text-xs text-muted-foreground whitespace-pre-wrap">{log.details}</p>;
    }
  };

  const renderEmailPreview = (parsed: Record<string, string>) => {
    const styledBody = (parsed.body || "")
      .replace(/<h2>(.*?)<\/h2>/g, '<h2 style="margin:0 0 16px;color:#1a1a2e;font-size:22px;font-weight:600;line-height:1.3;">$1</h2>')
      .replace(/<p>(.*?)<\/p>/g, '<p style="margin:0 0 12px;color:#374151;font-size:15px;line-height:1.6;">$1</p>');
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><style>body{margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;}</style></head><body style="margin:0;padding:0;background-color:#f4f4f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;"><tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);padding:32px 40px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:0.5px;">CowboyMedia</h1>
<p style="margin:6px 0 0;color:#94a3b8;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Service Hub</p>
</td></tr>
<tr><td style="padding:32px 40px 24px;">${styledBody}</td></tr>
<tr><td style="padding:0 40px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #e5e7eb;padding-top:24px;">
<p style="margin:0 0 8px;color:#6b7280;font-size:12px;text-align:center;">This is an automated notification from CowboyMedia Service Hub.</p>
<p style="margin:0 0 8px;color:#6b7280;font-size:12px;text-align:center;">Please do not reply to this email.</p>
<p style="margin:0;color:#9ca3af;font-size:11px;text-align:center;">&copy; CowboyMedia. All rights reserved.</p>
</td></tr></table></td></tr>
</table></td></tr></table></body></html>`;
    return fullHtml;
  };

  const renderPushPreview = (parsed: Record<string, string>) => {
    return (
      <div className="flex flex-col items-center py-6 px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-800 shadow-xl border border-border overflow-hidden">
          <div className="flex items-start gap-3 p-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1a1a2e] to-[#0f3460] flex items-center justify-center flex-shrink-0">
              <Bell className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold text-foreground">CowboyMedia</span>
                <span className="text-[10px] text-muted-foreground">now</span>
              </div>
              <p className="text-sm font-semibold text-foreground mb-0.5 truncate">{parsed.title || "Notification"}</p>
              <p className="text-xs text-muted-foreground line-clamp-3" style={{ overflowWrap: "anywhere" }}>{parsed.body || ""}</p>
              {parsed.url && (
                <p className="text-[10px] text-blue-500 mt-1 truncate">{parsed.url}</p>
              )}
            </div>
          </div>
        </div>
        <div className="mt-4 space-y-2 w-full max-w-sm">
          {parsed.recipientName && (
            <div className="flex gap-2 text-xs">
              <span className="font-medium text-muted-foreground min-w-[70px]">To:</span>
              <span className="text-foreground">{parsed.recipientName}</span>
            </div>
          )}
          {parsed.tag && (
            <div className="flex gap-2 text-xs">
              <span className="font-medium text-muted-foreground min-w-[70px]">Tag:</span>
              <span className="text-foreground font-mono">{parsed.tag}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex flex-col sm:flex-row gap-4 px-5 py-4 border-b border-border justify-between sm:items-center">
          <div className="flex items-center gap-3">
             <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-zinc-500/10 text-zinc-600 dark:text-zinc-400">
                <ScrollText className="h-[18px] w-[18px]" />
              </span>
              <div>
                <h2 className="text-sm font-semibold" data-testid="text-admin-logs-title">Activity Logs</h2>
                <div className="text-xs text-muted-foreground" data-testid="text-log-total">{total} log entries</div>
              </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={category} onValueChange={(v) => { setCategory(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-[180px] h-8 text-xs" data-testid="select-log-category">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {Object.entries(LOG_CATEGORY_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2 flex-1">
              <Input
                placeholder="Search logs..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1 h-8 text-xs"
                data-testid="input-log-search"
              />
              <Button size="icon" variant="outline" className="h-8 w-8" onClick={handleSearch} data-testid="button-log-search">
                <Search className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <ul className="divide-y divide-border">
            {[1, 2, 3, 4, 5].map(i => (
              <li key={i} className="px-5 py-3.5 flex items-center">
                <Skeleton className="h-10 w-full rounded-md" />
              </li>
            ))}
          </ul>
        ) : logs.length === 0 ? (
          <div className="px-5 py-8 text-center text-muted-foreground flex flex-col items-center justify-center">
            <ScrollText className="w-8 h-8 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No log entries found</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {logs.map((log) => {
              const config = LOG_CATEGORY_CONFIG[log.category] || { label: log.category, color: "bg-gray-500/10 text-gray-500", icon: ScrollText };
              const Icon = config.icon;
              const isExpanded = expandedLogId === log.id;
              return (
                <li key={log.id} className="group" data-testid={`card-log-${log.id}`}>
                  <div
                    className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover-elevate tap-interactive"
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                    data-testid={`button-expand-log-${log.id}`}
                  >
                    <div className="flex items-center gap-2 shrink-0">
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-md shrink-0 ${config.color}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{log.summary}</span>
                        <Badge variant="outline" className={`h-5 px-1.5 text-[10px] uppercase font-medium ${config.color.replace('text-', 'border-').replace('/10', '/20')} bg-transparent`}>{config.label}</Badge>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap mt-1">
                        {log.actorName && (
                          <span className="text-xs text-muted-foreground">by {log.actorName}</span>
                        )}
                        {log.recipientName && (
                          <span className="text-xs text-muted-foreground">→ {log.recipientName}</span>
                        )}
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(new Date(log.createdAt), "MMM d, yyyy h:mm a")}
                        </span>
                      </div>
                    </div>
                    
                    {hasPreview(log) && (
                      <div className="shrink-0 flex items-center">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                          onClick={(e) => { e.stopPropagation(); setPreviewLog(log); }}
                          data-testid={`button-preview-log-${log.id}`}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  
                  {isExpanded && log.details && (
                    <div className="px-5 pb-4 pl-[4.5rem]">
                      <div className="border-l-2 border-border pl-4 space-y-1.5">
                        {renderDetails(log)}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-border flex items-center justify-between bg-muted/20">
            <Button size="sm" variant="outline" className="h-8 text-xs bg-card" disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="button-log-prev">
              Previous
            </Button>
            <span className="text-xs text-muted-foreground font-medium">Page {page} of {totalPages}</span>
            <Button size="sm" variant="outline" className="h-8 text-xs bg-card" disabled={page >= totalPages} onClick={() => setPage(page + 1)} data-testid="button-log-next">
              Next
            </Button>
          </div>
        )}
      </section>

      <Dialog open={!!previewLog} onOpenChange={(open) => { if (!open) setPreviewLog(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" data-testid="dialog-log-preview">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewLog?.category === "email" ? <Mail className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
              {previewLog?.category === "email" ? "Email Preview" : "Push Notification Preview"}
            </DialogTitle>
          </DialogHeader>
          {previewLog && (() => {
            const parsed = getLogParsedDetails(previewLog);
            if (!parsed) return <p className="text-sm text-muted-foreground">No preview data available</p>;
            if (previewLog.category === "email") {
              const emailBody = parsed.body;
              if (!emailBody) {
                return (
                  <div className="p-4 text-center text-muted-foreground space-y-2">
                    <MailOpen className="w-8 h-8 mx-auto opacity-50" />
                    <p className="text-sm">Email body not available for this log entry.</p>
                    <p className="text-xs">Older logs may not include the full email content.</p>
                    <div className="text-left mt-4 space-y-1.5">
                      <div className="flex gap-2 text-xs"><span className="font-medium text-muted-foreground min-w-[60px]">To:</span><span>{parsed.to}</span></div>
                      <div className="flex gap-2 text-xs"><span className="font-medium text-muted-foreground min-w-[60px]">Subject:</span><span>{parsed.subject}</span></div>
                      <div className="flex gap-2 text-xs"><span className="font-medium text-muted-foreground min-w-[60px]">Template:</span><span className="font-mono">{parsed.templateKey}</span></div>
                    </div>
                  </div>
                );
              }
              const htmlContent = renderEmailPreview(parsed);
              return (
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2 flex-wrap">
                    <span><strong>To:</strong> {parsed.recipientName ? `${parsed.recipientName} (${parsed.to})` : parsed.to}</span>
                    <span><strong>Subject:</strong> {parsed.subject}</span>
                  </div>
                  <div className="flex-1 min-h-0 border rounded-lg overflow-hidden bg-[#f4f4f7]">
                    <iframe
                      srcDoc={htmlContent}
                      className="w-full h-full border-0"
                      style={{ minHeight: "400px" }}
                      sandbox=""
                      title="Email Preview"
                      data-testid="iframe-email-preview"
                    />
                  </div>
                </div>
              );
            }
            return renderPushPreview(parsed);
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type ErrorLogRow = {
  id: string;
  severity: string;
  source: string;
  summary: string;
  details: string | null;
  userId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  userName?: string | null;
  resolvedByName?: string | null;
};

const ERROR_SEVERITY_OPTIONS = ["warn", "error", "fatal"] as const;
const ERROR_SOURCE_OPTIONS = ["push", "email", "discord", "telegram", "webhook", "route", "job"] as const;

function severityBadgeClass(sev: string): string {
  if (sev === "fatal") return "bg-red-600/20 text-red-700 dark:text-red-400";
  if (sev === "error") return "bg-red-500/15 text-red-600 dark:text-red-400";
  return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
}

function ErrorLogsTab() {
  const { toast } = useToast();
  const { isMasterAdmin } = useAuth();
  const [severity, setSeverity] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [resolved, setResolved] = useState<string>("false");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const limit = 30;

  const { data, isLoading } = useQuery<{ logs: ErrorLogRow[]; total: number }>({
    queryKey: ["/api/admin/error-logs", severity, source, resolved, search, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (severity) params.set("severity", severity);
      if (source) params.set("source", source);
      if (resolved !== "all") params.set("resolved", resolved);
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(`/api/admin/error-logs?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load error logs");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/error-logs/${id}/resolve`, { resolved: value });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-logs/unresolved-count"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message || "Could not update", variant: "destructive" }),
  });

  const resolveAllMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams();
      if (severity) params.set("severity", severity);
      if (source) params.set("source", source);
      if (search) params.set("search", search);
      const qs = params.toString();
      const res = await apiRequest("POST", `/api/admin/error-logs/resolve-all${qs ? `?${qs}` : ""}`);
      return res.json() as Promise<{ resolved: number }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-logs/unresolved-count"] });
      toast({ title: "Errors resolved", description: `${result.resolved} ${result.resolved === 1 ? "entry" : "entries"} marked resolved.` });
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message || "Could not resolve errors", variant: "destructive" }),
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams();
      if (severity) params.set("severity", severity);
      if (source) params.set("source", source);
      if (resolved !== "all") params.set("resolved", resolved);
      if (search) params.set("search", search);
      const qs = params.toString();
      const res = await apiRequest("DELETE", `/api/admin/error-logs${qs ? `?${qs}` : ""}`);
      return res.json() as Promise<{ deleted: number }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-logs/unresolved-count"] });
      setPage(1);
      setExpandedId(null);
      toast({ title: "Error log cleared", description: `${result.deleted} ${result.deleted === 1 ? "entry" : "entries"} removed.` });
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message || "Could not clear error log", variant: "destructive" }),
  });

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);
  const hasFilter = !!severity || !!source || resolved !== "all" || !!search;

  const handleSearch = () => { setSearch(searchInput); setPage(1); };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex flex-col sm:flex-row gap-4 px-5 py-4 border-b border-border justify-between sm:items-center">
          <div className="flex items-center gap-3">
             <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-red-500/10 text-red-600 dark:text-red-400">
                <AlertTriangle className="h-[18px] w-[18px]" />
              </span>
              <div>
                <h2 className="text-sm font-semibold">Error Logs</h2>
                <div className="text-xs text-muted-foreground" data-testid="text-error-total">{total} error log entries</div>
              </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={severity || "all"} onValueChange={(v) => { setSeverity(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-[160px] h-8 text-xs" data-testid="select-error-severity">
                <SelectValue placeholder="All Severities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                {ERROR_SEVERITY_OPTIONS.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={source || "all"} onValueChange={(v) => { setSource(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-[160px] h-8 text-xs" data-testid="select-error-source">
                <SelectValue placeholder="All Sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {ERROR_SOURCE_OPTIONS.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={resolved} onValueChange={(v) => { setResolved(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-[160px] h-8 text-xs" data-testid="select-error-resolved">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="false">Unresolved</SelectItem>
                <SelectItem value="true">Resolved</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2 flex-1 min-w-[200px]">
              <Input
                placeholder="Search errors..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1 h-8 text-xs"
                data-testid="input-error-search"
              />
              <Button size="icon" variant="outline" className="h-8 w-8" onClick={handleSearch} data-testid="button-error-search">
                <Search className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-border bg-muted/20 flex justify-end gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs bg-card"
                disabled={total === 0 || resolved === "true" || resolveAllMutation.isPending}
                data-testid="button-resolve-all-errors"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-green-500" /> Resolve all
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
              <AlertDialogHeader>
                <AlertDialogTitle>Resolve all unresolved errors?</AlertDialogTitle>
                <AlertDialogDescription>
                  {hasFilter
                    ? "This marks every unresolved error matching the current filters as resolved. The entries stay in the log for reference."
                    : "This marks every unresolved error as resolved. The entries stay in the log for reference."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-resolve-all-errors-cancel">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => resolveAllMutation.mutate()}
                  data-testid="button-resolve-all-errors-confirm"
                >
                  Resolve all
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {isMasterAdmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive bg-card"
                  disabled={total === 0 || clearAllMutation.isPending}
                  data-testid="button-clear-all-errors"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Clear all
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all error logs?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {hasFilter
                      ? `This will permanently delete the ${total} error log ${total === 1 ? "entry" : "entries"} matching the current filters. This cannot be undone.`
                      : `This will permanently delete all ${total} error log ${total === 1 ? "entry" : "entries"}. This cannot be undone.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-clear-all-errors-cancel">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => clearAllMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid="button-clear-all-errors-confirm"
                  >
                    Clear all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {isLoading ? (
          <ul className="divide-y divide-border">
            {[1, 2, 3, 4, 5].map(i => (
              <li key={i} className="px-5 py-3.5 flex items-center">
                <Skeleton className="h-10 w-full rounded-md" />
              </li>
            ))}
          </ul>
        ) : logs.length === 0 ? (
          <div className="px-5 py-8 text-center text-muted-foreground flex flex-col items-center justify-center">
            <Bug className="w-8 h-8 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No errors logged 🎉</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {logs.map((log) => {
              const isExpanded = expandedId === log.id;
              const isResolved = !!log.resolvedAt;
              return (
                <li key={log.id} className={`group ${isResolved ? "opacity-70" : ""}`} data-testid={`card-error-${log.id}`}>
                  <div
                    className="flex items-start gap-3 px-5 py-3.5 cursor-pointer hover-elevate tap-interactive"
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    data-testid={`button-expand-error-${log.id}`}
                  >
                    <div className="flex items-center gap-2 mt-0.5 shrink-0">
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md shrink-0 ${isResolved ? "bg-muted text-muted-foreground" : severityBadgeClass(log.severity).replace('text-', 'bg-transparent border-').replace('/15', '/30')} border`}>
                        <AlertTriangle className="h-3.5 w-3.5" />
                      </span>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate" data-testid={`text-error-summary-${log.id}`}>{log.summary}</span>
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase font-medium">{log.source}</Badge>
                        <Badge variant="outline" className={`h-5 px-1.5 text-[10px] uppercase font-medium ${severityBadgeClass(log.severity)}`}>{log.severity}</Badge>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap mt-1">
                        {log.userName && (<span className="text-xs text-muted-foreground">user: {log.userName}</span>)}
                        {log.referenceType && log.referenceId && (<span className="text-xs text-muted-foreground">ref: {log.referenceType}/{log.referenceId.slice(0,8)}</span>)}
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(new Date(log.createdAt), "MMM d, yyyy h:mm a")}
                        </span>
                        {isResolved && log.resolvedAt && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Check className="w-3 h-3 text-green-500" />
                            resolved {format(new Date(log.resolvedAt), "MMM d, h:mm a")}{log.resolvedByName ? ` by ${log.resolvedByName}` : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="shrink-0 flex items-center">
                      {isResolved ? (
                        <Badge variant="outline" className="h-6 text-[10px] bg-green-500/10 text-green-600 dark:text-green-400">resolved</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs px-3 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                          disabled={resolveMutation.isPending}
                          onClick={(e) => { e.stopPropagation(); resolveMutation.mutate({ id: log.id, value: true }); }}
                          data-testid={`button-resolve-error-${log.id}`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-green-500" /> Resolve
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  {isExpanded && (
                    <div className="px-5 pb-4 pl-[4.5rem]">
                      <div className="border-l-2 border-border pl-4 space-y-3">
                        {log.details ? (
                          <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-muted/40 rounded-md p-3 max-h-[400px] overflow-y-auto border border-border/50" data-testid={`text-error-details-${log.id}`}>{log.details}</pre>
                        ) : (
                          <p className="text-xs text-muted-foreground">No additional details available.</p>
                        )}
                        {isResolved && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            disabled={resolveMutation.isPending}
                            onClick={() => resolveMutation.mutate({ id: log.id, value: false })}
                            data-testid={`button-reopen-error-${log.id}`}
                          >
                            <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reopen error
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-border flex items-center justify-between bg-muted/20">
            <Button size="sm" variant="outline" className="h-8 text-xs bg-card" disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="button-error-prev">
              Previous
            </Button>
            <span className="text-xs text-muted-foreground font-medium">Page {page} of {totalPages}</span>
            <Button size="sm" variant="outline" className="h-8 text-xs bg-card" disabled={page >= totalPages} onClick={() => setPage(page + 1)} data-testid="button-error-next">
              Next
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function MonitoringTab({ canManage, initialMonitorId }: { canManage: boolean; initialMonitorId?: string | null }) {
  const { toast } = useToast();
  const { data: monitors = [], isLoading } = useQuery<UrlMonitor[]>({ queryKey: ["/api/admin/monitors"], refetchInterval: 15000 });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UrlMonitor | null>(null);
  const [selectedMonitor, setSelectedMonitor] = useState<UrlMonitor | null>(null);
  const initialMonitorAppliedRef = useRef(false);
  useEffect(() => {
    if (initialMonitorAppliedRef.current) return;
    if (!initialMonitorId) return;
    const found = monitors.find(m => m.id === initialMonitorId);
    if (found) {
      setSelectedMonitor(found);
      initialMonitorAppliedRef.current = true;
    }
  }, [initialMonitorId, monitors]);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [monitorType, setMonitorType] = useState("url_availability");
  const [checkInterval, setCheckInterval] = useState("60");
  const [expectedStatus, setExpectedStatus] = useState("200");
  const [timeout, setTimeout_] = useState("10");
  const [failureThreshold, setFailureThreshold] = useState("3");
  const [emailNotif, setEmailNotif] = useState(true);
  const [linkedServiceId, setLinkedServiceId] = useState<string>("none");

  const { data: servicesForMonitor = [] } = useQuery<Service[]>({ queryKey: ["/api/services"] });

  const resetForm = () => {
    setName("");
    setUrl("");
    setMonitorType("url_availability");
    setCheckInterval("60");
    setExpectedStatus("200");
    setTimeout_("10");
    setFailureThreshold("3");
    setEmailNotif(true);
    setLinkedServiceId("none");
    setEditing(null);
  };

  const openEdit = (m: UrlMonitor) => {
    setEditing(m);
    setName(m.name);
    setUrl(m.url);
    setMonitorType(m.monitorType || "url_availability");
    setCheckInterval(String(m.checkIntervalSeconds));
    setExpectedStatus(String(m.expectedStatusCode));
    setTimeout_(String(m.timeoutSeconds));
    setFailureThreshold(String(m.consecutiveFailuresThreshold));
    setEmailNotif(m.emailNotifications);
    setLinkedServiceId(m.serviceId || "none");
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        url,
        monitorType,
        checkIntervalSeconds: parseInt(checkInterval),
        expectedStatusCode: parseInt(expectedStatus),
        timeoutSeconds: parseInt(timeout),
        consecutiveFailuresThreshold: parseInt(failureThreshold),
        emailNotifications: emailNotif,
        serviceId: linkedServiceId === "none" ? null : linkedServiceId,
      };
      if (editing) {
        const res = await fetch(`/api/admin/monitors/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "include" });
        if (!res.ok) throw new Error((await res.json()).message || "Failed");
        return res.json();
      } else {
        const res = await fetch("/api/admin/monitors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "include" });
        if (!res.ok) throw new Error((await res.json()).message || "Failed");
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/monitors"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: editing ? "Monitor updated" : "Monitor created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/monitors/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/monitors"] });
      toast({ title: "Monitor deleted" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await fetch(`/api/admin/monitors/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }), credentials: "include" });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/monitors"] }),
  });

  const getStatusColor = (status: string, enabled: boolean) => {
    if (!enabled) return "text-muted-foreground";
    switch (status) {
      case "up": return "text-green-500";
      case "down": return "text-red-500";
      default: return "text-muted-foreground";
    }
  };

  const getStatusBg = (status: string, enabled: boolean) => {
    if (!enabled) return "bg-muted";
    switch (status) {
      case "up": return "bg-green-500/10";
      case "down": return "bg-red-500/10";
      default: return "bg-muted";
    }
  };

  if (selectedMonitor) {
    return <MonitorDetailView monitor={selectedMonitor} onBack={() => { setSelectedMonitor(null); queryClient.invalidateQueries({ queryKey: ["/api/admin/monitors"] }); }} />;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Globe className="h-[18px] w-[18px]" />
            </span>
            <div>
              <h3 className="text-sm font-semibold" data-testid="text-monitoring-title">URL Monitors</h3>
              <p className="text-xs text-muted-foreground hidden sm:block">Track availability of external services</p>
            </div>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => { resetForm(); setDialogOpen(true); }} data-testid="button-add-monitor">
              <Plus className="w-4 h-4 mr-1" /> Add Monitor
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3].map(i => (
              <div key={i} className="px-5 py-3.5 flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : monitors.length === 0 ? (
          <div className="px-5 py-8 text-center text-muted-foreground">
            <Globe className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm font-medium">No URL monitors configured</p>
            {canManage && <p className="text-xs mt-1">Add a monitor to start tracking URL health.</p>}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {monitors.map(m => (
              <li key={m.id} className="cursor-pointer hover-elevate tap-interactive" onClick={() => setSelectedMonitor(m)} data-testid={`card-monitor-${m.id}`}>
                <div className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className={`rounded-full p-2 ${getStatusBg(m.status, m.enabled)} shrink-0`}>
                      <Circle className={`w-4 h-4 ${getStatusColor(m.status, m.enabled)} ${m.enabled && m.status === "up" ? "animate-status-glow fill-current" : m.enabled && m.status === "down" ? "animate-status-down fill-current" : ""}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-sm truncate max-w-[50vw] sm:max-w-none" data-testid={`text-monitor-name-${m.id}`}>{m.name}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">{m.monitorType === "http_status" ? "HTTP Status" : "Availability"}</Badge>
                        {!m.enabled && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 flex-shrink-0">Paused</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{m.url}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground hidden sm:block">
                      {m.lastCheckedAt && <p>Checked {format(new Date(m.lastCheckedAt), "MMM d, h:mm a")}</p>}
                      {m.lastResponseTimeMs != null && m.status === "up" && <p>{m.lastResponseTimeMs}ms</p>}
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => toggleMutation.mutate({ id: m.id, enabled: !m.enabled })} data-testid={`button-toggle-monitor-${m.id}`}>
                          {m.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEdit(m)} data-testid={`button-edit-monitor-${m.id}`}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" data-testid={`button-delete-monitor-${m.id}`}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Monitor</AlertDialogTitle>
                              <AlertDialogDescription>This will permanently delete "{m.name}" and all its incident history.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMutation.mutate(m.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={v => { if (!v) resetForm(); setDialogOpen(v); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Monitor" : "Add Monitor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="My Website" data-testid="input-monitor-name" />
            </div>
            <div>
              <Label>URL</Label>
              <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" data-testid="input-monitor-url" />
            </div>
            <div>
              <Label>Monitor Type</Label>
              <Select value={monitorType} onValueChange={setMonitorType}>
                <SelectTrigger data-testid="select-monitor-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="url_availability">URL Becomes Unavailable</SelectItem>
                  <SelectItem value="http_status">HTTP Status Check</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {monitorType === "url_availability"
                  ? "Checks if the URL is reachable. Marks as down only on connection failure, timeout, or server errors (5xx)."
                  : "Sends a HEAD request and checks for a specific HTTP status code."}
              </p>
            </div>
            <div className={`grid gap-3 ${monitorType === "http_status" ? "grid-cols-2" : ""}`}>
              <div>
                <Label>Check Interval</Label>
                <Select value={checkInterval} onValueChange={setCheckInterval}>
                  <SelectTrigger data-testid="select-monitor-interval"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 seconds</SelectItem>
                    <SelectItem value="60">1 minute</SelectItem>
                    <SelectItem value="120">2 minutes</SelectItem>
                    <SelectItem value="300">5 minutes</SelectItem>
                    <SelectItem value="600">10 minutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {monitorType === "http_status" && (
                <div>
                  <Label>Expected Status</Label>
                  <Input type="number" value={expectedStatus} onChange={e => setExpectedStatus(e.target.value)} data-testid="input-monitor-status-code" />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Timeout</Label>
                <Select value={timeout} onValueChange={setTimeout_}>
                  <SelectTrigger data-testid="select-monitor-timeout"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 seconds</SelectItem>
                    <SelectItem value="10">10 seconds</SelectItem>
                    <SelectItem value="30">30 seconds</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Failure Threshold</Label>
                <Select value={failureThreshold} onValueChange={setFailureThreshold}>
                  <SelectTrigger data-testid="select-monitor-threshold"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 failure</SelectItem>
                    <SelectItem value="2">2 failures</SelectItem>
                    <SelectItem value="3">3 failures</SelectItem>
                    <SelectItem value="4">4 failures</SelectItem>
                    <SelectItem value="5">5 failures</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={emailNotif} onCheckedChange={setEmailNotif} data-testid="switch-monitor-email" />
              <Label>Email notifications</Label>
            </div>
            <div>
              <Label>Linked service (for status page uptime)</Label>
              <Select value={linkedServiceId} onValueChange={setLinkedServiceId}>
                <SelectTrigger data-testid="select-monitor-service"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Not linked —</SelectItem>
                  {servicesForMonitor.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">When linked, this monitor's incidents drive the public status page uptime % and sparkline for the chosen service.</p>
            </div>
            <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={!name || !url || saveMutation.isPending} data-testid="button-save-monitor">
              {saveMutation.isPending ? "Saving..." : editing ? "Update Monitor" : "Create Monitor"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MonitorDetailView({ monitor, onBack }: { monitor: UrlMonitor; onBack: () => void }) {
  const { data: liveMonitor } = useQuery<UrlMonitor>({ queryKey: ["/api/admin/monitors", monitor.id], refetchInterval: 15000 });
  const { data: incidents = [], isLoading } = useQuery<MonitorIncident[]>({ queryKey: ["/api/admin/monitors", monitor.id, "incidents"], refetchInterval: 30000 });
  const m = liveMonitor || monitor;

  const getStatusColor = (status: string, enabled: boolean) => {
    if (!enabled) return "text-muted-foreground";
    switch (status) {
      case "up": return "text-green-500";
      case "down": return "text-red-500";
      default: return "text-muted-foreground";
    }
  };

  const getStatusLabel = (status: string, enabled: boolean) => {
    if (!enabled) return "Paused";
    switch (status) {
      case "up": return "Operational";
      case "down": return "Down";
      default: return "Unknown";
    }
  };

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const min = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts: string[] = [];
    if (h > 0) parts.push(`${h}h`);
    if (min > 0) parts.push(`${min}m`);
    parts.push(`${s}s`);
    return parts.join(" ");
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 -ml-2 text-muted-foreground hover:text-foreground" data-testid="button-monitor-back">
        <ArrowLeft className="w-4 h-4" /> Back to Monitors
      </Button>

      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="p-5 space-y-3">
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <Circle className={`w-5 h-5 flex-shrink-0 mt-1 ${getStatusColor(m.status, m.enabled)} ${m.enabled && m.status === "up" ? "animate-status-glow fill-current" : m.enabled && m.status === "down" ? "animate-status-down fill-current" : ""}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className="text-lg font-semibold text-foreground" data-testid="text-monitor-detail-name">{m.name}</h3>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0 font-normal bg-background">{m.monitorType === "http_status" ? "HTTP Status" : "Availability"}</Badge>
                  <Badge className={`flex-shrink-0 font-normal ${!m.enabled ? "bg-muted text-muted-foreground border-muted" : m.status === "up" ? "bg-green-500/10 text-green-600 border-green-500/20" : m.status === "down" ? "bg-red-500/10 text-red-600 border-red-500/20" : ""}`} variant="outline">
                    {getStatusLabel(m.status, m.enabled)}
                  </Badge>
                </div>
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground hover:underline inline-flex items-center gap-1 break-all transition-colors" data-testid="link-monitor-url">
                  {m.url} <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="bg-muted/30 rounded-lg p-3 border border-border">
              <p className="text-muted-foreground text-xs mb-1">Check Interval</p>
              <p className="font-medium text-foreground">{m.checkIntervalSeconds}s</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 border border-border">
              <p className="text-muted-foreground text-xs mb-1">Response Time</p>
              <p className="font-medium text-foreground">{m.lastResponseTimeMs != null ? `${m.lastResponseTimeMs}ms` : "—"}</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 border border-border">
              <p className="text-muted-foreground text-xs mb-1">Last Checked</p>
              <p className="font-medium text-foreground">{m.lastCheckedAt ? format(new Date(m.lastCheckedAt), "h:mm:ss a") : "Never"}</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 border border-border">
              <p className="text-muted-foreground text-xs mb-1">Status Since</p>
              <p className="font-medium text-foreground">{m.lastStatusChange ? format(new Date(m.lastStatusChange), "MMM d, h:mm a") : "—"}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-card-border bg-card overflow-hidden mt-6">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold flex items-center gap-2" data-testid="text-incidents-title">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-rose-500/10 text-rose-500">
              <Activity className="h-4 w-4" />
            </span>
            Incident History
          </h3>
        </div>
        {isLoading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3].map(i => <div key={i} className="px-5 py-3.5"><Skeleton className="h-16 w-full" /></div>)}
          </div>
        ) : incidents.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <Activity className="w-8 h-8 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No incidents recorded yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {incidents.map(inc => (
              <div key={inc.id} className="px-5 py-3.5 hover-elevate" data-testid={`card-incident-${inc.id}`}>
                <div className="flex items-start gap-4">
                  <div className={`mt-0.5 rounded-full p-2 flex-shrink-0 ${inc.resolvedAt ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>
                    {inc.resolvedAt ? <Activity className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge variant={inc.resolvedAt ? "secondary" : "destructive"} className="text-[10px] font-normal">
                        {inc.resolvedAt ? "Resolved" : "Ongoing"}
                      </Badge>
                      {inc.durationSeconds != null && (
                        <span className="text-xs text-muted-foreground">Duration: {formatDuration(inc.durationSeconds)}</span>
                      )}
                    </div>
                    {inc.failureReason && <p className="text-sm text-foreground mt-1 mb-1.5">{inc.failureReason}</p>}
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Started: {format(new Date(inc.startedAt), "MMM d, yyyy h:mm:ss a")}</span>
                      {inc.resolvedAt && <span className="flex items-center gap-1">· Resolved: {format(new Date(inc.resolvedAt), "MMM d, yyyy h:mm:ss a")}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const ALL_PERMISSIONS = [
  { category: "Users", perms: ["users.view", "users.manage"] },
  { category: "Services", perms: ["services.view", "services.manage"] },
  { category: "Alerts", perms: ["alerts.view", "alerts.manage"] },
  { category: "News", perms: ["news.view", "news.manage"] },
  { category: "Messages", perms: ["messages.view", "messages.manage"] },
  { category: "Quick Responses", perms: ["quick_responses.view", "quick_responses.manage"] },
  { category: "Service Updates", perms: ["service_updates.view", "service_updates.manage"] },
  { category: "Reports/Requests", perms: ["reports.view", "reports.manage"] },
  { category: "Email Templates", perms: ["email_templates.view", "email_templates.manage"] },
  { category: "Notification Wording", perms: ["notification_templates.view", "notification_templates.manage"] },
  { category: "Downloads", perms: ["downloads.view", "downloads.manage"] },
  { category: "Support Tickets", perms: ["support_tickets"] },
  { category: "Admin Chat", perms: ["admin_chat"] },
  { category: "Logs", perms: ["logs.view"] },
  { category: "Error Log", perms: ["error_log.view"] },
  { category: "URL Monitoring", perms: ["monitoring.view", "monitoring.manage"] },
  { category: "Announcements", perms: ["announcements"] },
  { category: "Knowledge Base", perms: ["knowledge_base"] },
];

function AdminManagementTab({ initialInnerTab }: { initialInnerTab?: string | null } = {}) {
  const { toast } = useToast();
  const { data: roles = [] } = useQuery<AdminRole[]>({ queryKey: ["/api/admin/roles"] });
  const { data: categories = [] } = useQuery<TicketCategory[]>({ queryKey: ["/api/ticket-categories"] });
  const { data: allUsers = [] } = useQuery<(User & { adminRoleId?: string })[]>({ queryKey: ["/api/admin/users"] });
  const adminUsers = allUsers.filter(u => u.role === "admin" || u.role === "master_admin");

  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<AdminRole | null>(null);
  const [roleName, setRoleName] = useState("");
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);

  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<TicketCategory | null>(null);
  const [catName, setCatName] = useState("");
  const [catDescription, setCatDescription] = useState("");
  const [catRoleIds, setCatRoleIds] = useState<string[]>([]);

  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastUserIds, setBroadcastUserIds] = useState<string[]>([]);

  const createRoleMutation = useMutation({
    mutationFn: async (data: { name: string; permissions: string[] }) => {
      await apiRequest("POST", "/api/admin/roles", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      setRoleDialogOpen(false);
      setEditingRole(null);
      toast({ title: "Role created" });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name: string; permissions: string[] }) => {
      await apiRequest("PATCH", `/api/admin/roles/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      setRoleDialogOpen(false);
      setEditingRole(null);
      toast({ title: "Role updated" });
    },
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/roles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      toast({ title: "Role deleted" });
    },
  });

  const createCatMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; assignedRoleIds: string[] }) => {
      await apiRequest("POST", "/api/admin/ticket-categories", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ticket-categories"] });
      setCatDialogOpen(false);
      setEditingCat(null);
      toast({ title: "Category created" });
    },
  });

  const updateCatMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name: string; description: string; assignedRoleIds: string[] }) => {
      await apiRequest("PATCH", `/api/admin/ticket-categories/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ticket-categories"] });
      setCatDialogOpen(false);
      setEditingCat(null);
      toast({ title: "Category updated" });
    },
  });

  const deleteCatMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/ticket-categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ticket-categories"] });
      toast({ title: "Category deleted" });
    },
  });

  const broadcastMutation = useMutation({
    mutationFn: async (data: { title: string; message: string; userIds: string[] }) => {
      await apiRequest("POST", "/api/admin/broadcast-push", data);
    },
    onSuccess: () => {
      setBroadcastTitle("");
      setBroadcastMessage("");
      setBroadcastUserIds([]);
      toast({ title: "Broadcast sent" });
    },
  });

  const updateUserRoleMutation = useMutation({
    mutationFn: async ({ id, role, adminRoleId }: { id: string; role?: string; adminRoleId?: string | null }) => {
      await apiRequest("PATCH", `/api/admin/users/${id}/role`, { role, adminRoleId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User updated" });
    },
  });

  const openRoleDialog = (role?: AdminRole) => {
    if (role) {
      setEditingRole(role);
      setRoleName(role.name);
      setRolePermissions(role.permissions || []);
    } else {
      setEditingRole(null);
      setRoleName("");
      setRolePermissions([]);
    }
    setRoleDialogOpen(true);
  };

  const openCatDialog = (cat?: TicketCategory) => {
    if (cat) {
      setEditingCat(cat);
      setCatName(cat.name);
      setCatDescription(cat.description || "");
      setCatRoleIds(cat.assignedRoleIds || []);
    } else {
      setEditingCat(null);
      setCatName("");
      setCatDescription("");
      setCatRoleIds([]);
    }
    setCatDialogOpen(true);
  };

  const togglePermission = (perm: string) => {
    setRolePermissions(prev => prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]);
  };

  const toggleCatRole = (roleId: string) => {
    setCatRoleIds(prev => prev.includes(roleId) ? prev.filter(r => r !== roleId) : [...prev, roleId]);
  };

  const toggleBroadcastUser = (userId: string) => {
    setBroadcastUserIds(prev => prev.includes(userId) ? prev.filter(u => u !== userId) : [...prev, userId]);
  };

  return (
    <Tabs defaultValue={initialInnerTab || "roles"} className="space-y-6">
      <TabsList data-testid="tabs-admin-management" className="mb-2">
        <TabsTrigger value="roles" data-testid="tab-roles">Roles</TabsTrigger>
        <TabsTrigger value="categories" data-testid="tab-categories">Ticket Categories</TabsTrigger>
        <TabsTrigger value="user-roles" data-testid="tab-user-roles">User Roles</TabsTrigger>
        <TabsTrigger value="broadcast" data-testid="tab-broadcast">Broadcast Push</TabsTrigger>
      </TabsList>

      <TabsContent value="roles" className="m-0">
        <section className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
            <div className="flex items-center gap-3">
               <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <Shield className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">Admin Roles</h3>
                  <div className="text-xs text-muted-foreground">Manage permission groups</div>
                </div>
            </div>
            <Button size="sm" className="h-8 gap-1.5" onClick={() => openRoleDialog()} data-testid="button-create-role">
              <Plus className="w-3.5 h-3.5" /> Create Role
            </Button>
          </div>
          
          {roles.length === 0 ? (
            <div className="px-5 py-8 text-center text-muted-foreground flex flex-col items-center justify-center">
              <Shield className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No roles created yet</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {roles.map(role => (
                <li key={role.id} className="px-5 py-3.5 flex items-center justify-between group hover-elevate" data-testid={`card-role-${role.id}`}>
                  <div>
                    <p className="font-medium text-sm text-foreground">{role.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{(role.permissions || []).length} permissions</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openRoleDialog(role)} data-testid={`button-edit-role-${role.id}`}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" data-testid={`button-delete-role-${role.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Role</AlertDialogTitle>
                          <AlertDialogDescription>This will remove the role from all assigned admins. Continue?</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteRoleMutation.mutate(role.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingRole ? "Edit Role" : "Create Role"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Role Name</Label>
                <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="e.g. Tier 1 Support" data-testid="input-role-name" />
              </div>
              <div className="space-y-2">
                <Label className="mb-2 block">Permissions</Label>
                <div className="space-y-3 bg-muted/20 p-4 rounded-lg border border-border">
                  {ALL_PERMISSIONS.map(({ category, perms }) => (
                    <div key={category} className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{category}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 ml-1">
                        {perms.map(p => (
                          <label key={p} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-2 py-1 rounded-md transition-colors">
                            <Checkbox checked={rolePermissions.includes(p)} onCheckedChange={() => togglePermission(p)} data-testid={`checkbox-perm-${p}`} />
                            <span>{p.split(".").pop()}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <Button
                className="w-full mt-2"
                disabled={!roleName || createRoleMutation.isPending || updateRoleMutation.isPending}
                onClick={() => {
                  const data = { name: roleName, permissions: rolePermissions };
                  if (editingRole) {
                    updateRoleMutation.mutate({ id: editingRole.id, ...data });
                  } else {
                    createRoleMutation.mutate(data);
                  }
                }}
                data-testid="button-save-role"
              >
                {editingRole ? "Update Role" : "Create Role"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </TabsContent>

      <TabsContent value="categories" className="m-0">
        <section className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
            <div className="flex items-center gap-3">
               <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400">
                  <Tags className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">Ticket Categories</h3>
                  <div className="text-xs text-muted-foreground">Organize support requests</div>
                </div>
            </div>
            <Button size="sm" className="h-8 gap-1.5" onClick={() => openCatDialog()} data-testid="button-create-category">
              <Plus className="w-3.5 h-3.5" /> Create Category
            </Button>
          </div>
          
          {categories.length === 0 ? (
            <div className="px-5 py-8 text-center text-muted-foreground flex flex-col items-center justify-center">
              <Tags className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No categories created yet</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {categories.map(cat => (
                <li key={cat.id} className="px-5 py-3.5 flex items-center justify-between group hover-elevate" data-testid={`card-category-${cat.id}`}>
                  <div>
                    <p className="font-medium text-sm text-foreground">{cat.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 max-w-md truncate">{cat.description || "No description"}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 font-medium bg-muted w-max px-2 py-0.5 rounded">
                      {(cat.assignedRoleIds || []).length} role(s) assigned
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openCatDialog(cat)} data-testid={`button-edit-category-${cat.id}`}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" data-testid={`button-delete-category-${cat.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Category</AlertDialogTitle>
                          <AlertDialogDescription>Tickets in this category will become uncategorized. Continue?</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteCatMutation.mutate(cat.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingCat ? "Edit Category" : "Create Category"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Category Name</Label>
                <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="e.g. Billing" data-testid="input-category-name" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={catDescription} onChange={(e) => setCatDescription(e.target.value)} placeholder="Optional description" data-testid="input-category-description" />
              </div>
              <div className="space-y-2">
                <Label className="mb-2 block">Assigned Admin Roles</Label>
                <div className="space-y-2 bg-muted/20 p-3 rounded-lg border border-border max-h-48 overflow-y-auto">
                  {roles.map(role => (
                    <label key={role.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-2 py-1.5 rounded-md transition-colors">
                      <Checkbox checked={catRoleIds.includes(role.id)} onCheckedChange={() => toggleCatRole(role.id)} data-testid={`checkbox-cat-role-${role.id}`} />
                      <span className="font-medium">{role.name}</span>
                    </label>
                  ))}
                  {roles.length === 0 && <p className="text-xs text-muted-foreground p-2">Create admin roles first</p>}
                </div>
              </div>
              <Button
                className="w-full mt-2"
                disabled={!catName || createCatMutation.isPending || updateCatMutation.isPending}
                onClick={() => {
                  const data = {
                    name: catName,
                    description: catDescription,
                    assignedRoleIds: catRoleIds,
                  };
                  if (editingCat) {
                    updateCatMutation.mutate({ id: editingCat.id, ...data });
                  } else {
                    createCatMutation.mutate(data);
                  }
                }}
                data-testid="button-save-category"
              >
                {editingCat ? "Update Category" : "Create Category"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </TabsContent>

      <TabsContent value="user-roles" className="m-0">
        <section className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-muted/20">
             <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Users className="h-[18px] w-[18px]" />
              </span>
              <div>
                <h3 className="text-sm font-semibold">Admin User Roles</h3>
                <div className="text-xs text-muted-foreground">Assign roles to staff members</div>
              </div>
          </div>
          
          <ul className="divide-y divide-border">
            {adminUsers.filter(u => u.username !== "cowboymedia-support").map(u => (
              <li key={u.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 group hover-elevate" data-testid={`card-admin-user-${u.id}`}>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-medium text-sm text-foreground">{u.fullName}</p>
                    {u.role === "master_admin" && (
                      <Badge variant="default" className="h-5 px-1.5 text-[10px] uppercase font-semibold tracking-wider">
                        <Crown className="w-3 h-3 mr-1" />Master
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">@{u.username}</p>
                </div>
                {u.role !== "master_admin" && (
                  <div className="shrink-0">
                    <Select
                      value={u.adminRoleId || "_none"}
                      onValueChange={(val) => updateUserRoleMutation.mutate({ id: u.id, adminRoleId: val === "_none" ? null : val })}
                    >
                      <SelectTrigger className="w-full sm:w-[180px] h-8 text-xs bg-card" data-testid={`select-role-${u.id}`}>
                        <SelectValue placeholder="No role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">No Role</SelectItem>
                        {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </TabsContent>

      <TabsContent value="broadcast" className="m-0">
        <section className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-muted/20">
             <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400">
                <Bell className="h-[18px] w-[18px]" />
              </span>
              <div>
                <h3 className="text-sm font-semibold">Broadcast Push Notification</h3>
                <div className="text-xs text-muted-foreground">Send direct alerts to admins</div>
              </div>
          </div>
          
          <div className="p-5 space-y-5">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={broadcastTitle} onChange={(e) => setBroadcastTitle(e.target.value)} placeholder="Notification title" data-testid="input-broadcast-title" className="max-w-md" />
            </div>
            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea value={broadcastMessage} onChange={(e) => setBroadcastMessage(e.target.value)} placeholder="Notification message" data-testid="input-broadcast-message" className="max-w-xl resize-none h-24" />
            </div>
            <div className="space-y-2">
              <Label className="mb-2 block">Select Admins to Notify</Label>
              <div className="space-y-2 bg-muted/20 p-3 rounded-lg border border-border max-h-48 overflow-y-auto max-w-xl">
                {adminUsers.filter(u => u.username !== "cowboymedia-support").map(u => (
                  <label key={u.id} className="flex items-center gap-3 text-sm cursor-pointer hover:bg-muted/50 px-2 py-1.5 rounded-md transition-colors">
                    <Checkbox checked={broadcastUserIds.includes(u.id)} onCheckedChange={() => toggleBroadcastUser(u.id)} data-testid={`checkbox-broadcast-${u.id}`} />
                    <span className="font-medium text-foreground">{u.fullName}</span>
                    <span className="text-xs text-muted-foreground font-mono">(@{u.username})</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="pt-2">
              <Button
                className="w-full sm:w-auto"
                disabled={!broadcastTitle || !broadcastMessage || broadcastUserIds.length === 0 || broadcastMutation.isPending}
                onClick={() => broadcastMutation.mutate({ title: broadcastTitle, message: broadcastMessage, userIds: broadcastUserIds })}
                data-testid="button-send-broadcast"
              >
                <Send className="w-4 h-4 mr-2" />
                {broadcastMutation.isPending ? "Sending..." : `Send to ${broadcastUserIds.length} admin(s)`}
              </Button>
            </div>
          </div>
        </section>
      </TabsContent>
    </Tabs>
  );
}

interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  message: string;
  fileUrl: string | null;
  fileType: string | null;
  fileName: string | null;
  createdAt: string;
}

interface ChatThread {
  id: string;
  name: string | null;
  createdBy: string;
  createdAt: string;
  participants: { id: string; fullName: string; username: string }[];
  lastMessage: ChatMessage | null;
}

function AdminChatTab({ initialThreadId }: { initialThreadId?: string | null }) {
  const { user, isMasterAdmin } = useAuth();
  const { toast } = useToast();
  const { sendMessage, subscribe } = useGlobalSocket();
  const isMobile = useIsMobile();
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialThreadId ?? null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [chatParticipantIds, setChatParticipantIds] = useState<string[]>([]);
  const [chatThreadName, setChatThreadName] = useState("");
  const [messageText, setMessageText] = useState("");
  const [chatFile, setChatFile] = useState<File | null>(null);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef<number>(0);

  const { data: threads = [] } = useQuery<ChatThread[]>({
    queryKey: ["/api/admin/chat/threads"],
    refetchInterval: 10000,
  });

  const [deleteThreadConfirmOpen, setDeleteThreadConfirmOpen] = useState(false);
  const { data: adminUsers = [] } = useQuery<User[]>({ queryKey: ["/api/admin/chat/users"] });

  const { data: unreadThreadIds = [] } = useQuery<string[]>({
    queryKey: ["/api/admin/chat/unread-threads"],
    refetchInterval: 10000,
  });

  const { data: messages = [] } = useQuery<ChatMessage[]>({
    queryKey: ["/api/admin/chat/threads", activeThreadId, "messages"],
    enabled: !!activeThreadId,
    refetchInterval: 5000,
  });

  const createThreadMutation = useMutation({
    mutationFn: async (data: { name: string | null; participantIds: string[] }) => {
      const res = await apiRequest("POST", "/api/admin/chat/threads", data);
      return res.json();
    },
    onSuccess: (thread: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
      setNewChatOpen(false);
      setChatParticipantIds([]);
      setChatThreadName("");
      setActiveThreadId(thread.id);
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({ threadId, message, file }: { threadId: string; message: string; file: File | null }) => {
      const formData = new FormData();
      formData.append("message", message);
      if (file) formData.append("file", file);
      const res = await uploadRequest("POST", `/api/admin/chat/threads/${threadId}/messages`, formData);
      if (!res.ok) throw new Error("Failed to send");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads", activeThreadId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
      setMessageText("");
      setChatFile(null);
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      await apiRequest("POST", `/api/admin/chat/threads/${threadId}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/unread-threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/unread-count"] });
    },
  });

  const selectThread = (threadId: string) => {
    setActiveThreadId(threadId);
    markReadMutation.mutate(threadId);
  };

  const deleteThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      await apiRequest("DELETE", `/api/admin/chat/threads/${threadId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
      setActiveThreadId(null);
      toast({ title: "Thread deleted" });
    },
  });

  useEffect(() => {
    if (!activeThreadId) return;
    sendMessage({ type: "viewing_admin_chat", threadId: activeThreadId, userId: user?.id });
    const handleWs = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "admin_chat_message" && data.threadId === activeThreadId) {
          queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads", activeThreadId, "messages"] });
          markReadMutation.mutate(activeThreadId);
          setTypingUser(null);
        }
        if (data.type === "admin_chat_message") {
          queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
          queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/unread-threads"] });
          queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/unread-count"] });
        }
        if (data.type === "admin_chat_typing" && data.threadId === activeThreadId && data.userId !== user?.id) {
          setTypingUser(data.userName);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 3000);
        }
      } catch {}
    };
    const unsubscribe = subscribe(handleWs);
    return () => {
      unsubscribe();
      sendMessage({ type: "left_admin_chat", threadId: activeThreadId, userId: user?.id });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      setTypingUser(null);
    };
  // Keep: mutation object identity is unstable, but `.mutate` is stable, so
  // omitting `markReadMutation` avoids re-subscribing the websocket handler on
  // every render. The effect should only re-run when the thread/connection changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId, user?.id, sendMessage, subscribe]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Shrink the chat container while the on-screen keyboard is open so the
  // composer stays visible above the keyboard on mobile (iOS especially).
  const keyboardInset = useKeyboardInset();

  const sendTypingEvent = () => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    if (user && activeThreadId) {
      sendMessage({ type: "admin_chat_typing", threadId: activeThreadId, userId: user.id, userName: user.fullName });
    }
  };

  const activeThread = threads.find(t => t.id === activeThreadId);

  const getThreadDisplayName = (thread: ChatThread) => {
    if (thread.name) return thread.name;
    const others = thread.participants.filter(p => p.id !== user?.id);
    return others.map(p => p.fullName).join(", ") || "Chat";
  };

  const showThreadList = !isMobile || !activeThreadId;
  const showMessages = !isMobile || !!activeThreadId;

  return (
    <div
      className={`flex ${isMobile ? "" : "h-[600px]"} rounded-xl border border-card-border bg-card overflow-hidden`}
      style={
        isMobile
          ? {
              height: `calc(100dvh - 12rem - ${keyboardInset}px)`,
              transition: "height 150ms ease-out",
            }
          : undefined
      }
      data-testid="admin-chat-container"
    >
      {showThreadList && (
      <div className={`${isMobile ? "w-full" : "w-1/3"} border-r border-border flex flex-col`}>
        <div className="px-5 py-4 border-b border-border flex justify-between items-center">
          <h4 className="text-sm font-semibold flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <MessageSquare className="h-[18px] w-[18px]" />
            </span>
            Threads
          </h4>
          <Button size="icon" variant="ghost" onClick={() => setNewChatOpen(true)} data-testid="button-new-chat">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-border">
          {threads.map(thread => {
            const hasUnread = unreadThreadIds.includes(thread.id);
            return (
            <button
              key={thread.id}
              className={`w-full text-left px-5 py-3.5 hover-elevate tap-interactive transition-colors ${activeThreadId === thread.id ? "bg-accent/50" : ""}`}
              onClick={() => selectThread(thread.id)}
              data-testid={`thread-${thread.id}`}
            >
              <div className="flex items-center gap-2">
                {hasUnread && <span className="w-2 h-2 rounded-full bg-destructive flex-shrink-0" data-testid={`unread-dot-${thread.id}`} />}
                <p className={`text-sm truncate font-medium text-foreground`}>{getThreadDisplayName(thread)}</p>
              </div>
              {thread.lastMessage && (
                <p className={`text-xs text-muted-foreground truncate mt-0.5 ${hasUnread ? "ml-4 font-medium text-foreground" : ""}`}>{thread.lastMessage.message || "📎 File"}</p>
              )}
            </button>
          );
          })}
          {threads.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No chats yet</p>}
        </div>
      </div>
      )}

      {showMessages && (
      <div className="flex-1 flex flex-col">
        {activeThread ? (
          <>
            <div className="px-5 py-4 border-b border-border flex justify-between items-start">
              <div className="flex items-center gap-2">
                {isMobile && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 flex-shrink-0"
                    onClick={() => setActiveThreadId(null)}
                    data-testid="button-chat-back"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{getThreadDisplayName(activeThread)}</p>
                  <p className="text-xs text-muted-foreground truncate">{activeThread.participants.map(p => p.fullName).join(", ")}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => {
                    queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads", activeThreadId, "messages"] });
                    queryClient.invalidateQueries({ queryKey: ["/api/admin/chat/threads"] });
                  }}
                  data-testid="button-refresh-chat"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
                {isMasterAdmin && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                    onClick={() => setDeleteThreadConfirmOpen(true)}
                    disabled={deleteThreadMutation.isPending}
                    data-testid="button-delete-thread"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex-1 p-5 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
              <div className="space-y-4">
                {messages.map(msg => {
                  const isMe = msg.senderId === user?.id;
                  return (
                    <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`} data-testid={`chat-msg-${msg.id}`}>
                      <div className={`max-w-[85%] sm:max-w-[75%] min-w-0 overflow-hidden rounded-xl p-3 ${isMe ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                        {!isMe && <p className="text-xs font-semibold mb-1 opacity-80">{msg.senderName}</p>}
                        {msg.message && <p className="text-sm whitespace-pre-wrap overflow-hidden leading-relaxed" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{msg.message}</p>}
                        {msg.fileUrl && msg.fileType?.startsWith("image/") && (
                          <div className="mt-2">
                            <ClickableImage src={msg.fileUrl} alt="attachment" className="max-w-full max-h-48 rounded-md" />
                            <a href={msg.fileUrl} download target="_blank" rel="noopener noreferrer" className="mt-1.5 flex items-center gap-1.5 text-xs opacity-70 hover:opacity-100 transition-opacity" data-testid="link-download-image">
                              <Download className="w-3.5 h-3.5" />
                              <span>Download</span>
                            </a>
                          </div>
                        )}
                        {msg.fileUrl && msg.fileType?.startsWith("video/") && (
                          <div className="mt-2">
                            <ClickableVideo src={msg.fileUrl} className="max-w-full max-h-48 rounded-md" />
                            <a href={msg.fileUrl} download target="_blank" rel="noopener noreferrer" className="mt-1.5 flex items-center gap-1.5 text-xs opacity-70 hover:opacity-100 transition-opacity" data-testid="link-download-video">
                              <Download className="w-3.5 h-3.5" />
                              <span>Download</span>
                            </a>
                          </div>
                        )}
                        {msg.fileUrl && !msg.fileType?.startsWith("image/") && !msg.fileType?.startsWith("video/") && (
                          <a href={msg.fileUrl} download target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center gap-2 p-2 rounded bg-background/10 hover:bg-background/20 transition-colors border border-border/10" data-testid="file-attachment">
                            <FileText className="w-4 h-4 flex-shrink-0" />
                            <span className="text-xs font-medium truncate">{msg.fileName || "Download file"}</span>
                            <Download className="w-3.5 h-3.5 flex-shrink-0 ml-auto" />
                          </a>
                        )}
                        <p className="text-[10px] font-medium opacity-60 mt-1.5">{format(new Date(msg.createdAt), "h:mm a")}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </div>
            {typingUser && (
              <div className="px-5 py-2 bg-gradient-to-t from-background/50 to-transparent">
                <p className="text-xs font-medium text-muted-foreground animate-pulse" data-testid="text-chat-typing">{typingUser} is typing...</p>
              </div>
            )}
            <div className="p-3 sm:p-5 border-t border-border bg-card">
              <div className="space-y-2">
                {chatFile && (
                  <div className="flex items-center gap-2 text-xs font-medium bg-muted/50 w-fit px-2.5 py-1.5 rounded-md text-foreground">
                    <Paperclip className="w-3.5 h-3.5 text-muted-foreground" /> 
                    <span className="truncate max-w-[200px]">{chatFile.name}</span>
                    <Button variant="ghost" size="icon" className="w-5 h-5 ml-1 hover:bg-muted" onClick={() => setChatFile(null)}>
                      <XIcon className="w-3 h-3" />
                    </Button>
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    value={messageText}
                    onChange={(e) => {
                      setMessageText(e.target.value);
                      if (e.target.value.trim()) sendTypingEvent();
                    }}
                    placeholder="Type a message..."
                    className="rounded-full px-4 bg-background"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if ((messageText.trim() || chatFile) && !sendMessageMutation.isPending) {
                          sendMessageMutation.mutate({ threadId: activeThreadId!, message: messageText, file: chatFile });
                        }
                      }
                    }}
                    data-testid="input-chat-message"
                  />
                  <input
                    type="file"
                    id="chat-file-input"
                    className="hidden"
                    onChange={(e) => setChatFile(e.target.files?.[0] || null)}
                  />
                  <Button variant="outline" size="icon" className="rounded-full shrink-0" onClick={() => document.getElementById("chat-file-input")?.click()} data-testid="button-chat-attach">
                    <Paperclip className="w-4 h-4 text-muted-foreground" />
                  </Button>
                  <Button
                    size="icon"
                    className="rounded-full shrink-0"
                    disabled={(!messageText.trim() && !chatFile) || sendMessageMutation.isPending}
                    onClick={() => sendMessageMutation.mutate({ threadId: activeThreadId!, message: messageText, file: chatFile })}
                    data-testid="button-chat-send"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium">Select a thread or start a new chat</p>
          </div>
        )}
      </div>
      )}

      <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Chat</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Thread Name (optional for groups)</Label>
              <Input value={chatThreadName} onChange={(e) => setChatThreadName(e.target.value)} placeholder="e.g. Project Discussion" data-testid="input-thread-name" />
            </div>
            <div>
              <Label className="mb-2 block">Select Participants</Label>
              <div className="space-y-1 max-h-48 overflow-y-auto border border-border rounded-md p-1 divide-y divide-border">
                {adminUsers.map(u => (
                  <label key={u.id} className="flex items-center gap-3 text-sm cursor-pointer hover:bg-muted/50 px-2 py-2 rounded-sm transition-colors">
                    <Checkbox
                      checked={chatParticipantIds.includes(u.id)}
                      onCheckedChange={() => setChatParticipantIds(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id])}
                      data-testid={`checkbox-participant-${u.id}`}
                    />
                    <span className="font-medium">{u.fullName}</span>
                    <span className="text-xs text-muted-foreground ml-auto">@{u.username}</span>
                  </label>
                ))}
              </div>
            </div>
            <Button
              className="w-full"
              disabled={chatParticipantIds.length === 0 || createThreadMutation.isPending}
              onClick={() => createThreadMutation.mutate({ name: chatThreadName || null, participantIds: chatParticipantIds })}
              data-testid="button-create-thread"
            >
              Start Chat
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteThreadConfirmOpen} onOpenChange={setDeleteThreadConfirmOpen}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete thread?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this thread and all its messages. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-thread">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (activeThread) deleteThreadMutation.mutate(activeThread.id); setDeleteThreadConfirmOpen(false); }}
              data-testid="button-confirm-delete-thread"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type BannedUser = { id: string; fullName: string; username: string; chatUsername: string | null; email: string };
type WordFilter = { id: string; word: string; createdAt: string };

function ChatAdminTab() {
  const { toast } = useToast();
  const [newWord, setNewWord] = useState("");
  const [deleteTargetFilter, setDeleteTargetFilter] = useState<{ id: string; word: string } | null>(null);

  const { data: wordFilters, isLoading: filtersLoading } = useQuery<WordFilter[]>({
    queryKey: ["/api/community-chat/word-filters"],
  });

  const { data: bannedUsers, isLoading: bannedLoading } = useQuery<BannedUser[]>({
    queryKey: ["/api/community-chat/banned-users"],
  });

  const addFilterMutation = useMutation({
    mutationFn: async (word: string) => {
      const res = await apiRequest("POST", "/api/community-chat/word-filters", { word });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add word");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/community-chat/word-filters"] });
      setNewWord("");
      toast({ title: "Word filter added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteFilterMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/community-chat/word-filters/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/community-chat/word-filters"] });
      toast({ title: "Word filter removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const unbanMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("POST", "/api/community-chat/unban-user", { userId });
      if (!res.ok) throw new Error("Failed to unban user");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/community-chat/banned-users"] });
      toast({ title: "User unbanned from chat" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleAddWord = () => {
    const cleaned = newWord.trim().toLowerCase();
    if (cleaned.length < 2) return;
    addFilterMutation.mutate(cleaned);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-orange-500/10 text-orange-500">
              <Shield className="h-[18px] w-[18px]" />
            </span>
            Word Filters
          </h2>
          <p className="text-xs text-muted-foreground mt-2 ml-12">
            Add words to automatically censor in community chat messages. Filtered words will have their middle characters replaced with asterisks.
          </p>
        </div>
        <div className="p-5 border-b border-border bg-muted/20">
          <div className="flex gap-2 max-w-sm">
            <Input
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              placeholder="Enter a word to filter..."
              className="flex-1 bg-background"
              onKeyDown={(e) => { if (e.key === "Enter") handleAddWord(); }}
              data-testid="input-add-word-filter"
            />
            <Button
              onClick={handleAddWord}
              disabled={newWord.trim().length < 2 || addFilterMutation.isPending}
              data-testid="button-add-word-filter"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
        </div>

        <div className="divide-y divide-border">
          {filtersLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-5 py-3.5">
                <Skeleton className="h-5 w-32" />
              </div>
            ))
          ) : wordFilters && wordFilters.length > 0 ? (
            wordFilters.map((f) => (
              <div key={f.id} className="flex items-center justify-between px-5 py-3.5 hover-elevate transition-colors" data-testid={`word-filter-${f.id}`}>
                <span className="text-sm font-mono">{f.word}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteTargetFilter({ id: f.id, word: f.word })}
                  disabled={deleteFilterMutation.isPending}
                  data-testid={`button-delete-filter-${f.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))
          ) : (
            <div className="px-5 py-8 flex flex-col items-center justify-center text-center">
              <Shield className="w-8 h-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-word-filters">
                No word filters configured. Add words above to keep the chat family-friendly.
              </p>
            </div>
          )}
        </div>
      </section>

      <AlertDialog open={!!deleteTargetFilter} onOpenChange={(open) => { if (!open) setDeleteTargetFilter(null); }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove word filter?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTargetFilter?.word ?? "This word"}" will no longer be blocked in community chat.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-filter">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteTargetFilter) deleteFilterMutation.mutate(deleteTargetFilter.id); setDeleteTargetFilter(null); }}
              data-testid="button-confirm-delete-filter"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-red-500/10 text-red-500">
              <Users className="h-[18px] w-[18px]" />
            </span>
            Banned Users
          </h2>
          <p className="text-xs text-muted-foreground mt-2 ml-12">
            Users banned from community chat. You can unban them to restore their access.
          </p>
        </div>
        <div className="divide-y divide-border">
          {bannedLoading ? (
            Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="px-5 py-3.5">
                <Skeleton className="h-10 w-full" />
              </div>
            ))
          ) : bannedUsers && bannedUsers.length > 0 ? (
            bannedUsers.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-5 py-3.5 hover-elevate transition-colors gap-3" data-testid={`banned-user-${u.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{u.fullName}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    @{u.username}{u.chatUsername ? ` · Chat: ${u.chatUsername}` : ""}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => unbanMutation.mutate(u.id)}
                  disabled={unbanMutation.isPending}
                  data-testid={`button-unban-${u.id}`}
                >
                  Unban
                </Button>
              </div>
            ))
          ) : (
            <div className="px-5 py-8 flex flex-col items-center justify-center text-center">
              <Users className="w-8 h-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-banned-users">
                No users are currently banned from chat.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const TILE_PERM_MAP: Record<string, string> = {
  "users": "users.view",
  "services": "services.view",
  "alerts": "alerts.view",
  "news": "news.view",
  "messages": "messages.view",
  "quick-responses": "quick_responses.view",
  "service-updates": "service_updates.view",
  "reports-requests": "reports.view",
  "email-templates": "email_templates.view",
  "notification-templates": "notification_templates.view",
  "downloads": "downloads.view",
  "support-tickets": "support_tickets",
  "admin-chat": "admin_chat",
  "logs": "logs.view",
  "error-log": "error_log.view",
  "monitoring": "monitoring.view",
  "chat-admin": "admin_chat",
  "announcements": "announcements",
  "knowledge-base": "knowledge_base",
  "overview": "dashboard.view",
  "billing-dashboard": "users.view",
};

const TILE_MANAGE_MAP: Record<string, string> = {
  "users": "users.manage",
  "services": "services.manage",
  "alerts": "alerts.manage",
  "news": "news.manage",
  "messages": "messages.manage",
  "quick-responses": "quick_responses.manage",
  "service-updates": "service_updates.manage",
  "reports-requests": "reports.manage",
  "email-templates": "email_templates.manage",
  "notification-templates": "notification_templates.manage",
  "downloads": "downloads.manage",
  "monitoring": "monitoring.manage",
  "announcements": "announcements",
  "knowledge-base": "knowledge_base",
};

const NO_LINK_VALUE = "__none__";

export function KnowledgeBaseTab() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"articles" | "categories">("articles");

  // Categories state
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<KbCategory | null>(null);
  const [catName, setCatName] = useState("");
  const [catSlug, setCatSlug] = useState("");
  const [catDescription, setCatDescription] = useState("");
  const [catSortOrder, setCatSortOrder] = useState(0);

  // Articles state
  const [artDialogOpen, setArtDialogOpen] = useState(false);
  const [editingArt, setEditingArt] = useState<KbArticle | null>(null);
  const [artTitle, setArtTitle] = useState("");
  const [artSlug, setArtSlug] = useState("");
  const [artSlugTouched, setArtSlugTouched] = useState(false);
  const [artCategoryId, setArtCategoryId] = useState("");
  const [artSummary, setArtSummary] = useState("");
  const [artBodyHtml, setArtBodyHtml] = useState("");
  const [artTags, setArtTags] = useState("");
  const [artPublished, setArtPublished] = useState(true);
  const [artSortOrder, setArtSortOrder] = useState(0);
  const [artFilter, setArtFilter] = useState<"all" | "published" | "draft">("all");

  const { data: categories = [], isLoading: catsLoading } = useQuery<KbCategory[]>({ queryKey: ["/api/admin/kb/categories"] });
  const { data: articles = [], isLoading: artsLoading } = useQuery<KbArticle[]>({ queryKey: ["/api/admin/kb/articles"] });

  const resetCat = () => {
    setEditingCat(null);
    setCatName("");
    setCatSlug("");
    setCatDescription("");
    setCatSortOrder(0);
  };
  const resetArt = () => {
    setEditingArt(null);
    setArtTitle("");
    setArtSlug("");
    setArtSlugTouched(false);
    setArtCategoryId("");
    setArtSummary("");
    setArtBodyHtml("");
    setArtTags("");
    setArtPublished(false);
    setArtSortOrder(0);
  };

  const openCreateCat = () => { resetCat(); setCatDialogOpen(true); };
  const openEditCat = (c: KbCategory) => {
    setEditingCat(c);
    setCatName(c.name);
    setCatSlug(c.slug);
    setCatDescription(c.description ?? "");
    setCatSortOrder(c.sortOrder);
    setCatDialogOpen(true);
  };
  const openCreateArt = () => {
    resetArt();
    if (categories.length > 0) setArtCategoryId(categories[0].id);
    setArtDialogOpen(true);
  };
  const openEditArt = (a: KbArticle) => {
    setEditingArt(a);
    setArtTitle(a.title);
    setArtSlug(a.slug);
    setArtSlugTouched(true);
    setArtCategoryId(a.categoryId);
    setArtSummary(a.summary ?? "");
    setArtBodyHtml(a.bodyHtml);
    setArtTags(a.tags.join(", "));
    setArtPublished(a.published);
    setArtSortOrder(a.sortOrder);
    setArtDialogOpen(true);
  };

  const catPayload = () => ({
    name: catName.trim(),
    slug: (catSlug.trim() || slugify(catName)).toLowerCase(),
    description: catDescription.trim() || null,
    sortOrder: Number(catSortOrder) || 0,
  });
  const artPayload = (publishedOverride?: boolean) => ({
    title: artTitle.trim(),
    slug: (artSlug.trim() || slugify(artTitle)).toLowerCase(),
    categoryId: artCategoryId,
    summary: artSummary.trim() || null,
    bodyHtml: artBodyHtml,
    tags: artTags.split(",").map(t => t.trim()).filter(Boolean),
    published: publishedOverride ?? artPublished,
    sortOrder: Number(artSortOrder) || 0,
  });

  const createCatMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/kb/categories", catPayload())).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kb/categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kb/categories"] });
      setCatDialogOpen(false); resetCat();
      toast({ title: "Category created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updateCatMutation = useMutation({
    mutationFn: async () => {
      if (!editingCat) return;
      return (await apiRequest("PATCH", `/api/admin/kb/categories/${editingCat.id}`, catPayload())).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kb/categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kb/categories"] });
      setCatDialogOpen(false); resetCat();
      toast({ title: "Category updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteCatMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/kb/categories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kb/categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kb/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kb/categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kb/articles"] });
      toast({ title: "Category deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createArtMutation = useMutation({
    mutationFn: async (published: boolean) => (await apiRequest("POST", "/api/admin/kb/articles", artPayload(published))).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kb/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kb/articles"] });
      clearTiptapDraft("kb-article:new");
      setArtDialogOpen(false); resetArt();
      toast({ title: "Article created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updateArtMutation = useMutation({
    mutationFn: async (published: boolean) => {
      if (!editingArt) return;
      return (await apiRequest("PATCH", `/api/admin/kb/articles/${editingArt.id}`, artPayload(published))).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kb/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kb/articles"] });
      if (editingArt) clearTiptapDraft(`kb-article:${editingArt.id}`);
      setArtDialogOpen(false); resetArt();
      toast({ title: "Article updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteArtMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/kb/articles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kb/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kb/articles"] });
      toast({ title: "Article deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const publishedCount = articles.filter((a) => a.published).length;
  const draftCount = articles.length - publishedCount;
  const filteredArticles =
    artFilter === "all"
      ? articles
      : articles.filter((a) => (artFilter === "published" ? a.published : !a.published));
  const artSaveDisabled =
    !artTitle.trim() || !artCategoryId || !artBodyHtml.trim() || createArtMutation.isPending || updateArtMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Knowledge Base</h2>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as "articles" | "categories")}>
        <TabsList>
          <TabsTrigger value="articles" data-testid="tab-kb-articles">Articles</TabsTrigger>
          <TabsTrigger value="categories" data-testid="tab-kb-categories">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="articles" className="space-y-3 mt-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {articles.length > 0 ? (
              <div className="flex items-center gap-1" data-testid="kb-article-filter">
                {([
                  ["all", "All", articles.length],
                  ["published", "Published", publishedCount],
                  ["draft", "Drafts", draftCount],
                ] as const).map(([key, label, count]) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={artFilter === key ? "default" : "outline"}
                    onClick={() => setArtFilter(key)}
                    data-testid={`filter-kb-articles-${key}`}
                  >
                    {label} ({count})
                  </Button>
                ))}
              </div>
            ) : <div />}
            <Button onClick={openCreateArt} disabled={categories.length === 0} data-testid="button-create-kb-article">
              <Plus className="w-4 h-4 mr-1" /> New Article
            </Button>
          </div>
          {categories.length === 0 && (
            <p className="text-xs text-muted-foreground">Create a category first.</p>
          )}
          {artsLoading ? (
            <Skeleton className="h-24" />
          ) : articles.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground border-t border-border">
              <FileText className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No articles yet.</p>
            </div>
          ) : filteredArticles.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground border-t border-border">
              <FileText className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm" data-testid="text-kb-articles-empty-filter">
                No {artFilter === "draft" ? "draft" : "published"} articles.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border border-t border-border">
              {filteredArticles.map((a) => {
                const cat = categories.find((c) => c.id === a.categoryId);
                return (
                  <div key={a.id} className="px-5 py-3.5 hover-elevate group" data-testid={`card-admin-kb-article-${a.id}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1 py-0.5">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="font-medium text-sm text-foreground">{a.title}</p>
                          {a.published ? (
                            <Badge variant="outline" className="text-[10px] border-green-500/40 text-green-600 dark:text-green-400 font-normal bg-green-500/5" data-testid={`badge-kb-status-${a.id}`}>Published</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400 font-normal bg-amber-500/5" data-testid={`badge-kb-status-${a.id}`}>Draft</Badge>
                          )}
                          {cat && <Badge variant="secondary" className="text-[10px] font-normal">{cat.name}</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">/{a.slug} · {a.viewCount} views · 👍 {a.helpfulCount} 👎 {a.unhelpfulCount}</p>
                      </div>
                      <div className="flex gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <a href={`/knowledge/${a.slug}`} target="_blank" rel="noopener noreferrer" data-testid={`link-preview-kb-article-${a.id}`}>
                          <Button size="icon" variant="ghost" title="Preview" className="h-8 w-8 text-muted-foreground hover:text-foreground" data-testid={`button-preview-kb-article-${a.id}`}>
                            <Eye className="w-4 h-4" />
                          </Button>
                        </a>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEditArt(a)} data-testid={`button-edit-kb-article-${a.id}`}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" data-testid={`button-delete-kb-article-${a.id}`}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete article?</AlertDialogTitle>
                              <AlertDialogDescription>This will permanently delete "{a.title}".</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteArtMutation.mutate(a.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="categories" className="mt-0 border-t border-border">
          <div className="flex justify-between items-center px-5 py-4 border-b border-border bg-muted/20">
            <div>
              <h3 className="text-sm font-semibold">Categories</h3>
              <div className="text-xs text-muted-foreground mt-0.5">Manage article grouping</div>
            </div>
            <Button size="sm" onClick={openCreateCat} data-testid="button-create-kb-category" className="h-8 gap-1.5 shrink-0">
              <Plus className="w-3.5 h-3.5" /> New Category
            </Button>
          </div>
          {catsLoading ? (
            <div className="px-5 py-4"><Skeleton className="h-16 w-full" /></div>
          ) : categories.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Hash className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No categories yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {categories.map((c) => (
                <div key={c.id} className="px-5 py-3.5 hover-elevate group" data-testid={`card-admin-kb-category-${c.id}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 py-0.5">
                      <p className="font-medium text-sm text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">/{c.slug}{c.description ? ` · ${c.description}` : ""}</p>
                    </div>
                    <div className="flex gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEditCat(c)} data-testid={`button-edit-kb-category-${c.id}`}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" data-testid={`button-delete-kb-category-${c.id}`}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete category?</AlertDialogTitle>
                            <AlertDialogDescription>This will permanently delete "{c.name}" and all of its articles.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteCatMutation.mutate(c.id)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Category dialog */}
      <Dialog open={catDialogOpen} onOpenChange={(open) => { setCatDialogOpen(open); if (!open) resetCat(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCat ? "Edit Category" : "New Category"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={catName} onChange={(e) => { setCatName(e.target.value); if (!editingCat) setCatSlug(slugify(e.target.value)); }} data-testid="input-kb-category-name" />
            </div>
            <div>
              <Label>Slug</Label>
              <Input value={catSlug} onChange={(e) => setCatSlug(e.target.value)} data-testid="input-kb-category-slug" />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea value={catDescription} onChange={(e) => setCatDescription(e.target.value)} data-testid="input-kb-category-description" />
            </div>
            <div>
              <Label>Sort order</Label>
              <Input type="number" value={catSortOrder} onChange={(e) => setCatSortOrder(parseInt(e.target.value, 10) || 0)} data-testid="input-kb-category-sort" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCatDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={() => editingCat ? updateCatMutation.mutate() : createCatMutation.mutate()}
                disabled={!catName.trim() || createCatMutation.isPending || updateCatMutation.isPending}
                data-testid="button-save-kb-category"
              >
                {editingCat ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Article dialog */}
      <Dialog open={artDialogOpen} onOpenChange={(open) => { setArtDialogOpen(open); if (!open) resetArt(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingArt ? "Edit Article" : "New Article"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title</Label>
              <Input
                value={artTitle}
                onChange={(e) => { setArtTitle(e.target.value); if (!artSlugTouched) setArtSlug(slugify(e.target.value)); }}
                data-testid="input-kb-article-title"
              />
            </div>
            <div>
              <Label>Slug</Label>
              <Input value={artSlug} onChange={(e) => { setArtSlug(e.target.value); setArtSlugTouched(true); }} data-testid="input-kb-article-slug" />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={artCategoryId} onValueChange={setArtCategoryId}>
                <SelectTrigger data-testid="select-kb-article-category"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Summary (optional)</Label>
              <Textarea value={artSummary} onChange={(e) => setArtSummary(e.target.value)} data-testid="input-kb-article-summary" />
            </div>
            <div>
              <Label>Body</Label>
              <RichTextEditor value={artBodyHtml} onChange={setArtBodyHtml} testIdPrefix="kb-article" draftKey={artDialogOpen ? `kb-article:${editingArt?.id ?? "new"}` : undefined} />
            </div>
            <div>
              <Label>Tags (comma-separated)</Label>
              <Input value={artTags} onChange={(e) => setArtTags(e.target.value)} data-testid="input-kb-article-tags" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Status:</span>
                {editingArt ? (
                  editingArt.published ? (
                    <Badge variant="outline" className="text-[10px] border-green-500/40 text-green-600 dark:text-green-400" data-testid="badge-kb-dialog-status">Published</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400" data-testid="badge-kb-dialog-status">Draft</Badge>
                  )
                ) : (
                  <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400" data-testid="badge-kb-dialog-status">New draft</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Sort order</Label>
                <Input type="number" className="w-20" value={artSortOrder} onChange={(e) => setArtSortOrder(parseInt(e.target.value, 10) || 0)} data-testid="input-kb-article-sort" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setArtDialogOpen(false)}>Cancel</Button>
              <Button
                variant="outline"
                onClick={() => editingArt ? updateArtMutation.mutate(false) : createArtMutation.mutate(false)}
                disabled={artSaveDisabled}
                data-testid="button-save-kb-article-draft"
              >
                Save as Draft
              </Button>
              <Button
                onClick={() => editingArt ? updateArtMutation.mutate(true) : createArtMutation.mutate(true)}
                disabled={artSaveDisabled}
                data-testid="button-publish-kb-article"
              >
                Publish
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AnnouncementsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [linkPath, setLinkPath] = useState<string>(NO_LINK_VALUE);
  const [linkLabel, setLinkLabel] = useState("");
  const [frequency, setFrequency] = useState<"once" | "always">("once");
  const [active, setActive] = useState(true);

  const { data: list = [], isLoading } = useQuery<Announcement[]>({
    queryKey: ["/api/admin/announcements"],
  });

  const resetForm = () => {
    setEditing(null);
    setTitle("");
    setBodyHtml("");
    setLinkPath(NO_LINK_VALUE);
    setLinkLabel("");
    setFrequency("once");
    setActive(true);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (a: Announcement) => {
    setEditing(a);
    setTitle(a.title);
    setBodyHtml(a.bodyHtml);
    setLinkPath(a.linkPath ?? NO_LINK_VALUE);
    setLinkLabel(a.linkLabel ?? "");
    setFrequency((a.frequency as "once" | "always") ?? "once");
    setActive(a.active);
    setDialogOpen(true);
  };

  const buildPayload = () => ({
    title: title.trim(),
    bodyHtml: bodyHtml,
    linkPath: linkPath === NO_LINK_VALUE ? null : linkPath,
    linkLabel: linkPath === NO_LINK_VALUE || !linkLabel.trim() ? null : linkLabel.trim(),
    frequency,
    active,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/announcements", buildPayload());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/announcements"] });
      clearTiptapDraft("announcement:new");
      setDialogOpen(false);
      resetForm();
      toast({ title: "Announcement created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const res = await apiRequest("PATCH", `/api/admin/announcements/${editing.id}`, buildPayload());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/announcements"] });
      if (editing) clearTiptapDraft(`announcement:${editing.id}`);
      setDialogOpen(false);
      resetForm();
      toast({ title: "Announcement updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      await apiRequest("PATCH", `/api/admin/announcements/${id}`, { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/announcements"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/announcements/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/announcements"] });
      toast({ title: "Announcement deleted" });
    },
  });

  const activeShown = list.find(a => a.active);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-500">
                <Megaphone className="h-[18px] w-[18px]" />
              </span>
              Announcements ({list.length})
            </h2>
            <p className="text-xs text-muted-foreground mt-2 sm:ml-12">
              Only the newest Active announcement is shown to customers.
            </p>
          </div>
          <Button size="sm" onClick={openCreate} data-testid="button-create-announcement" className="shrink-0">
            <Plus className="w-4 h-4 mr-1" /> New Announcement
          </Button>
        </div>

        {activeShown && (
          <div className="bg-primary/5 px-5 py-3 border-b border-border flex items-center gap-3" data-testid="banner-active-announcement">
            <Megaphone className="w-4 h-4 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-primary">Currently shown to customers</p>
              <p className="text-sm truncate">{activeShown.title}</p>
            </div>
          </div>
        )}

        <div className="divide-y divide-border">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-5 py-4">
                <Skeleton className="h-16 w-full" />
              </div>
            ))
          ) : list.length === 0 ? (
            <div className="px-5 py-12 flex flex-col items-center justify-center text-center">
              <Megaphone className="w-10 h-10 text-muted-foreground/30 mb-4" />
              <p className="text-sm text-muted-foreground">No announcements yet.</p>
              <Button size="sm" variant="outline" onClick={openCreate} className="mt-4">
                Create one now
              </Button>
            </div>
          ) : (
            list.map(a => (
              <div key={a.id} className="p-5" data-testid={`card-announcement-${a.id}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <p className="font-semibold text-sm truncate">{a.title}</p>
                      {a.active ? (
                        <Badge variant="outline" className="text-[10px] border-green-500/40 text-green-600 dark:text-green-400" data-testid={`badge-announcement-status-${a.id}`}>
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground" data-testid={`badge-announcement-status-${a.id}`}>
                          Inactive
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-[10px]">
                        {a.frequency === "always" ? "Every open" : "Once per user"}
                      </Badge>
                      {a.linkPath && (
                        <Badge variant="secondary" className="text-[10px] gap-1">
                          <ExternalLink className="w-3 h-3" />
                          {getAnnouncementRouteLabel(a.linkPath) ?? a.linkPath}
                        </Badge>
                      )}
                    </div>
                    <div
                      className="prose prose-sm dark:prose-invert max-w-none text-sm text-muted-foreground line-clamp-2 mt-2"
                      dangerouslySetInnerHTML={{ __html: a.bodyHtml }}
                    />
                    <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      Created {format(new Date(a.createdAt), "MMM d, yyyy h:mm a")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Switch
                      checked={a.active}
                      onCheckedChange={(v) => toggleActiveMutation.mutate({ id: a.id, active: v })}
                      data-testid={`switch-announcement-active-${a.id}`}
                    />
                    <div className="h-4 w-px bg-border mx-1" />
                    <Button size="icon" variant="ghost" onClick={() => openEdit(a)} data-testid={`button-edit-announcement-${a.id}`} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                      <Edit className="w-4 h-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" data-testid={`button-delete-announcement-${a.id}`} className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Announcement</AlertDialogTitle>
                          <AlertDialogDescription>This permanently deletes the announcement and clears any seen-state for users. Continue?</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMutation.mutate(a.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); resetForm(); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Announcement" : "New Announcement"}</DialogTitle>
            <DialogDescription>
              Customers see the newest Active announcement when they open the app.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title (admin-only)</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Holiday hours notice"
                data-testid="input-announcement-title"
              />
            </div>
            <div>
              <Label>Body</Label>
              <RichTextEditor value={bodyHtml} onChange={setBodyHtml} testIdPrefix="announcement" draftKey={dialogOpen ? `announcement:${editing?.id ?? "new"}` : undefined} />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>Frequency</Label>
                <Select value={frequency} onValueChange={(v) => setFrequency(v as "once" | "always")}>
                  <SelectTrigger data-testid="select-announcement-frequency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">Once per user</SelectItem>
                    <SelectItem value="always">Every app open</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3 gap-2">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground">Only the newest active is shown.</p>
                </div>
                <Switch checked={active} onCheckedChange={setActive} data-testid="switch-announcement-active" />
              </div>
            </div>
            <div>
              <Label>In-app link (optional)</Label>
              <Select value={linkPath} onValueChange={setLinkPath}>
                <SelectTrigger data-testid="select-announcement-link"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LINK_VALUE}>No link</SelectItem>
                  {ANNOUNCEMENT_ROUTES.map(r => (
                    <SelectItem key={r.path} value={r.path}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {linkPath !== NO_LINK_VALUE && (
              <div>
                <Label>Button label (optional)</Label>
                <Input
                  value={linkLabel}
                  onChange={(e) => setLinkLabel(e.target.value)}
                  placeholder={`Defaults to "View"`}
                  data-testid="input-announcement-link-label"
                />
              </div>
            )}
            <Button
              className="w-full"
              disabled={!title.trim() || createMutation.isPending || updateMutation.isPending}
              onClick={() => editing ? updateMutation.mutate() : createMutation.mutate()}
              data-testid="button-save-announcement"
            >
              {editing ? "Save Changes" : "Publish Announcement"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Auto-deploy kill-switch. master_admin only. The toggle writes to
// app_settings.auto_deploy_enabled, which the VPS webhook listener reads
// over HTTP before invoking update.sh. Pausing here drops incoming pushes
// at the listener with a Discord notice; the next push after re-enabling
// will pick up whatever HEAD is on main at that point.
function DeployTab() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useQuery<{ autoDeployEnabled: boolean; autoDeployPausedReason: string | null; autoDeployPausedBy: string | null; updatedAt: string }>({
    queryKey: ["/api/admin/app-settings"],
  });
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (settings?.autoDeployPausedReason) setReason(settings.autoDeployPausedReason);
  }, [settings?.autoDeployPausedReason]);

  const toggleMutation = useMutation({
    mutationFn: async (vars: { autoDeployEnabled: boolean; autoDeployPausedReason?: string | null }) => {
      return apiRequest("PATCH", "/api/admin/app-settings", vars);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/app-settings"] });
      toast({ title: "Saved", description: "Deploy settings updated." });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e?.message ?? "Failed to update.", variant: "destructive" });
    },
  });

  if (isLoading || !settings) {
    return <div className="text-sm text-muted-foreground" data-testid="text-deploy-loading">Loading…</div>;
  }

  const paused = !settings.autoDeployEnabled;
  return (
    <div className="space-y-6 max-w-2xl">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-500">
              <Rocket className="h-[18px] w-[18px]" />
            </span>
            Deploy controls
          </h2>
          <p className="text-xs text-muted-foreground mt-2 ml-12">
            Pause or resume the GitHub → VPS auto-deploy pipeline. When paused, pushes to <code>main</code> are still
            received by the webhook listener but are NOT deployed; they're acknowledged and dropped. The next push after
            re-enabling will deploy whatever HEAD is on main at that point.
          </p>
        </div>

        <div className="p-5 border-b border-border bg-muted/10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {paused ? <Pause className="w-4 h-4 text-amber-500" /> : <Play className="w-4 h-4 text-green-500" />}
              <span className="text-sm font-medium">Auto-deploy from GitHub</span>
            </div>
            <Badge variant={paused ? "destructive" : "default"} data-testid="badge-deploy-status">
              {paused ? "PAUSED" : "ENABLED"}
            </Badge>
          </div>
          
          <div className="space-y-4">
            {paused && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm" data-testid="text-deploy-paused-banner">
                <div className="font-medium text-amber-700 dark:text-amber-300">Pipeline paused</div>
                {settings.autoDeployPausedReason && <div className="text-xs mt-1">Reason: {settings.autoDeployPausedReason}</div>}
                <div className="text-xs mt-1 text-muted-foreground">Last changed {formatDistanceToNow(new Date(settings.updatedAt), { addSuffix: true })}</div>
              </div>
            )}

            {!paused && (
              <div className="space-y-2">
                <Label htmlFor="pause-reason" className="text-xs">Pause reason (optional)</Label>
                <div className="flex gap-2 max-w-md">
                  <Input
                    id="pause-reason"
                    placeholder="e.g. database migration in progress"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="flex-1 bg-background"
                    data-testid="input-deploy-pause-reason"
                  />
                  <Button
                    variant="destructive"
                    onClick={() => toggleMutation.mutate({ autoDeployEnabled: false, autoDeployPausedReason: reason.trim() || null })}
                    disabled={toggleMutation.isPending}
                    data-testid="button-deploy-pause"
                  >
                    <Pause className="w-4 h-4 mr-1.5" /> Pause
                  </Button>
                </div>
              </div>
            )}

            {paused && (
              <Button
                onClick={() => toggleMutation.mutate({ autoDeployEnabled: true })}
                disabled={toggleMutation.isPending}
                data-testid="button-deploy-resume"
              >
                <Play className="w-4 h-4 mr-1.5" /> Resume auto-deploy
              </Button>
            )}
          </div>
        </div>
        <div className="px-5 py-3 text-xs text-muted-foreground space-y-1 bg-muted/5">
          <div><span className="font-mono text-foreground">POST /_deploy</span> on the VPS — GitHub webhook target</div>
          <div>Listener service: <span className="font-mono text-foreground">systemctl status servicehub-deploy</span></div>
          <div>Per-deploy logs: <span className="font-mono text-foreground">/var/log/servicehub-deploy/&lt;deliveryId&gt;.log</span></div>
          <div>Manual sync from Replit: <span className="font-mono text-foreground">git push origin main</span></div>
        </div>
      </section>

      <DeployNotifyHealthCard />

      <DeployHistoryCard />
    </div>
  );
}

// Recent deploy outcomes from the VPS listener's in-memory ring buffer.
// Lets master_admins see "did the last 5 deploys succeed?" without scrolling
// Discord or SSHing. Per-row log tail is fetched on expand via the same
// proxy pattern as notify-status — DEPLOY_GATE_TOKEN never reaches the browser.
type DeployHistoryEntry = {
  deliveryId: string;
  sha: string;
  author: string;
  message: string;
  startedAt: string;
  durationMs: number;
  exitCode: number;
  verificationLine: string | null;
};
type DeployHistoryResponse = {
  available: boolean;
  reason?: string;
  deploys: DeployHistoryEntry[];
};

function formatDeployDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

function DeployHistoryRow({ entry }: { entry: DeployHistoryEntry }) {
  const [open, setOpen] = useState(false);
  const [logText, setLogText] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const succeeded = entry.exitCode === 0;
  const Icon = succeeded ? CheckCircle2 : XIcon;
  const pillClass = succeeded
    ? "border-green-500/40 text-green-600 dark:text-green-400 bg-green-500/10"
    : "border-red-500/40 text-red-600 dark:text-red-400 bg-red-500/10";

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && logText === null && !logLoading) {
      setLogLoading(true);
      setLogError(null);
      try {
        const res = await fetch(`/api/admin/deploy/log/${encodeURIComponent(entry.deliveryId)}`, {
          credentials: "include",
        });
        const text = await res.text();
        if (!res.ok) {
          setLogError(text || `HTTP ${res.status}`);
        } else {
          // Show only the tail — full log can be hundreds of lines.
          const lines = text.split("\n");
          setLogText(lines.slice(-80).join("\n"));
        }
      } catch (e: any) {
        setLogError(e?.message || "Failed to fetch log");
      } finally {
        setLogLoading(false);
      }
    }
  };

  return (
    <div className="flex flex-col" data-testid={`row-deploy-${entry.deliveryId}`}>
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover-elevate active-elevate-2 transition-colors focus-visible:outline-none focus-visible:bg-accent/50"
        data-testid={`button-deploy-row-${entry.deliveryId}`}
      >
        <Badge variant="outline" className={`shrink-0 ${pillClass}`} data-testid={`badge-deploy-status-${entry.deliveryId}`}>
          <Icon className="w-3 h-3 mr-1" />
          {succeeded ? "Success" : `Failed (${entry.exitCode})`}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold" data-testid={`text-deploy-sha-${entry.deliveryId}`}>
              {entry.sha.slice(0, 7)}
            </span>
            <span className="text-sm truncate font-medium" title={entry.message} data-testid={`text-deploy-message-${entry.deliveryId}`}>
              {entry.message || "(no commit message)"}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="truncate" data-testid={`text-deploy-author-${entry.deliveryId}`}>
              {entry.author}
            </span>
            <span data-testid={`text-deploy-duration-${entry.deliveryId}`}>
              {formatDeployDuration(entry.durationMs)}
            </span>
            <span data-testid={`text-deploy-when-${entry.deliveryId}`}>
              {formatDistanceToNow(new Date(entry.startedAt), { addSuffix: true })}
            </span>
          </div>
        </div>
        <div className="shrink-0 text-muted-foreground">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>
      {open && (
        <div className="px-5 pb-4 pt-1 space-y-2 bg-muted/5">
          {entry.verificationLine && (
            <div className="text-xs bg-card border rounded-md p-2">
              <span className="text-muted-foreground font-medium">Verification: </span>
              <span className="font-mono text-foreground" data-testid={`text-deploy-verification-${entry.deliveryId}`}>
                {entry.verificationLine}
              </span>
            </div>
          )}
          {logLoading && (
            <div className="text-xs text-muted-foreground flex items-center gap-2 p-2" data-testid={`text-deploy-log-loading-${entry.deliveryId}`}>
              <RefreshCw className="w-3 h-3 animate-spin" /> Loading log…
            </div>
          )}
          {logError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs font-mono break-all text-destructive" data-testid={`text-deploy-log-error-${entry.deliveryId}`}>
              {logError}
            </div>
          )}
          {logText !== null && (
            <pre
              className="rounded-md border border-border bg-card p-3 text-[11px] font-mono whitespace-pre-wrap break-all max-h-80 overflow-auto text-foreground"
              data-testid={`text-deploy-log-${entry.deliveryId}`}
            >
              {logText || "(log is empty)"}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function DeployHistoryCard() {
  const { data, isLoading, isFetching, refetch } = useQuery<DeployHistoryResponse>({
    queryKey: ["/api/admin/deploy/history"],
    refetchOnWindowFocus: false,
  });

  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-500">
            <ScrollText className="h-[18px] w-[18px]" />
          </span>
          Recent deploys
        </h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-8 w-8 p-0"
          data-testid="button-deploy-history-refresh"
        >
          <RefreshCw className={`w-4 h-4 text-muted-foreground hover:text-foreground transition-colors ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <div className="px-5 py-3 border-b border-border bg-muted/10">
        <p className="text-xs text-muted-foreground">
          Last few deploy outcomes from the VPS listener's in-memory ring buffer. Resets on listener restart —
          durable per-deploy logs live under <code className="text-foreground">/var/log/servicehub-deploy/</code>. Click a row to fetch the
          last 80 lines of its log.
        </p>
      </div>

      <div className="divide-y divide-border">
        {isLoading && (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="px-5 py-4 flex gap-3" data-testid={i === 0 ? "text-deploy-history-loading" : undefined}>
              <Skeleton className="h-6 w-20 shrink-0" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))
        )}

        {!isLoading && !data?.available && (
          <div className="p-5">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm" data-testid="text-deploy-history-unavailable">
              <div className="font-medium text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Deploy history unavailable
              </div>
              <div className="mt-2 text-muted-foreground">{data?.reason || "Unknown reason."}</div>
              <div className="mt-1 text-muted-foreground text-xs">
                This is normal in the Replit dev environment — the deploy listener only runs on the VPS.
              </div>
            </div>
          </div>
        )}

        {data?.available && data.deploys.length === 0 && (
          <div className="px-5 py-8 flex flex-col items-center justify-center text-center">
            <ScrollText className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground" data-testid="text-deploy-history-empty">
              No deploys recorded yet. The buffer resets when the listener restarts; push to <code>main</code> to populate it.
            </p>
          </div>
        )}

        {data?.available && data.deploys.length > 0 && (
          <div className="flex flex-col" data-testid="list-deploy-history">
            {data.deploys.map((entry) => (
              <DeployHistoryRow key={entry.deliveryId} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// Surfaces the VPS deploy listener's last-known Discord notification health
// inside the Admin Portal so a misconfigured webhook URL is visible without
// SSHing to read journalctl. Refreshes on demand only — no polling, since
// the listener's own boot-time validator + per-call recording mean the
// status only changes when there's an actual deploy or restart.
type DeployNotifyStatus = {
  available: boolean;
  reason?: string;
  at?: string | null;
  ok?: boolean | null;
  status?: number | null;
  error?: string | null;
  kind?: "boot" | "notify" | null;
  configured?: boolean;
};

function DeployNotifyHealthCard() {
  const { toast } = useToast();
  const { data, isLoading, isFetching, refetch } = useQuery<DeployNotifyStatus>({
    queryKey: ["/api/admin/deploy/notify-status"],
    refetchOnWindowFocus: false,
  });

  const sendTest = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/deploy/notify-test");
      return (await res.json()) as DeployNotifyStatus;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deploy/notify-status"] });
      if (!result.available) {
        toast({
          title: "Test notification not sent",
          description: result.reason || "Listener unavailable.",
          variant: "destructive",
        });
        return;
      }
      if (result.configured === false) {
        toast({
          title: "Discord webhook not configured",
          description: "DEPLOY_DISCORD_WEBHOOK is unset on the listener.",
          variant: "destructive",
        });
        return;
      }
      if (result.ok) {
        toast({
          title: "Test notification sent",
          description: `Discord accepted the post (HTTP ${result.status ?? "—"}). Check the deploy channel.`,
        });
      } else {
        toast({
          title: "Discord rejected the test",
          description: result.error || `HTTP ${result.status ?? "?"}`,
          variant: "destructive",
        });
      }
    },
    onError: (e: any) => {
      toast({
        title: "Test notification failed",
        description: e?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const renderPill = () => {
    if (isLoading) {
      return <Badge variant="secondary" data-testid="badge-notify-status">Loading…</Badge>;
    }
    if (!data?.available) {
      return <Badge variant="secondary" data-testid="badge-notify-status">Unavailable</Badge>;
    }
    if (data.configured === false) {
      return <Badge variant="destructive" data-testid="badge-notify-status">Not configured</Badge>;
    }
    if (data.ok === true) {
      return <Badge variant="outline" className="border-green-500/40 text-green-600 dark:text-green-400 bg-green-500/10" data-testid="badge-notify-status">Healthy</Badge>;
    }
    if (data.ok === false) {
      return <Badge variant="destructive" data-testid="badge-notify-status">Failing</Badge>;
    }
    return <Badge variant="secondary" data-testid="badge-notify-status">Unknown</Badge>;
  };

  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-500">
            <Bell className="h-[18px] w-[18px]" />
          </span>
          Deploy Discord notifications
        </h2>
        <div className="flex items-center gap-3">
          {renderPill()}
          <Button
            size="sm"
            variant="outline"
            onClick={() => sendTest.mutate()}
            disabled={sendTest.isPending}
            data-testid="button-notify-test"
            className="h-8 text-xs"
          >
            <Send className={`w-3.5 h-3.5 mr-1.5 ${sendTest.isPending ? "animate-pulse" : ""}`} />
            {sendTest.isPending ? "Sending…" : "Test"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 w-8 p-0"
            data-testid="button-notify-status-refresh"
          >
            <RefreshCw className={`w-4 h-4 text-muted-foreground hover:text-foreground transition-colors ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      <div className="p-5">
        <p className="text-xs text-muted-foreground mb-4">
          Last-known result of the VPS webhook listener posting to its Discord channel. Updated on listener boot
          (URL validation) and on every deploy. If this shows red, the in-channel <code>:rocket:</code> /
          <code>:white_check_mark:</code> deploy posts won't arrive — usually a revoked or malformed{" "}
          <code className="text-foreground">DEPLOY_DISCORD_WEBHOOK</code> in <code className="text-foreground">/etc/servicehub-deploy.env</code>.
        </p>

        {!data?.available ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm" data-testid="text-notify-status-unavailable">
            <div className="font-medium text-amber-700 dark:text-amber-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Listener status unavailable
            </div>
            <div className="mt-2 text-muted-foreground">{data?.reason || "Unknown reason."}</div>
            <div className="mt-1 text-muted-foreground text-xs">
              This is normal in the Replit dev environment — the deploy listener only runs on the VPS.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
              <div className="text-muted-foreground font-medium">Last attempt</div>
              <div className="font-medium text-foreground" data-testid="text-notify-status-at">
                {data.at ? `${formatDistanceToNow(new Date(data.at), { addSuffix: true })} (${new Date(data.at).toLocaleString()})` : "never"}
              </div>
              
              <div className="text-muted-foreground font-medium">Trigger</div>
              <div className="text-foreground" data-testid="text-notify-status-kind">
                {data.kind === "boot" ? "Listener boot validation" : data.kind === "notify" ? "Deploy notification" : "—"}
              </div>
              
              <div className="text-muted-foreground font-medium">HTTP status</div>
              <div className="font-mono text-xs text-foreground" data-testid="text-notify-status-code">{data.status ?? "—"}</div>
              
              <div className="text-muted-foreground font-medium">Configured</div>
              <div className="text-foreground" data-testid="text-notify-status-configured">{data.configured ? "Yes" : "No (DEPLOY_DISCORD_WEBHOOK unset)"}</div>
            </div>
            
            {data.error && (
              <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 font-mono text-[11px] break-all text-destructive" data-testid="text-notify-status-error">
                <span className="font-bold mr-2">Error:</span> {data.error}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function DiscordTab() {
  const { toast } = useToast();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookDirty, setWebhookDirty] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [sendAlerts, setSendAlerts] = useState(true);
  const [sendServiceUpdates, setSendServiceUpdates] = useState(true);
  const [sendNews, setSendNews] = useState(true);
  const [testing, setTesting] = useState(false);

  const { data: settings, isLoading } = useQuery<{ webhookUrlMasked: string; hasWebhook: boolean; enabled: boolean; sendAlerts: boolean; sendServiceUpdates: boolean; sendNews: boolean }>({
    queryKey: ["/api/admin/discord-settings"],
  });

  useEffect(() => {
    if (settings) {
      setWebhookUrl(settings.webhookUrlMasked || "");
      setWebhookDirty(false);
      setEnabled(!!settings.enabled);
      setSendAlerts(settings.sendAlerts !== false);
      setSendServiceUpdates(settings.sendServiceUpdates !== false);
      setSendNews(settings.sendNews !== false);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (data: { webhookUrl?: string; enabled: boolean; sendAlerts: boolean; sendServiceUpdates: boolean; sendNews: boolean }) => {
      const res = await apiRequest("PATCH", "/api/admin/discord-settings", data);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to save settings");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/discord-settings"] });
      toast({ title: "Discord settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSave = () => {
    const payload: { webhookUrl?: string; enabled: boolean; sendAlerts: boolean; sendServiceUpdates: boolean; sendNews: boolean } = {
      enabled,
      sendAlerts,
      sendServiceUpdates,
      sendNews,
    };
    if (webhookDirty) payload.webhookUrl = webhookUrl.trim();
    saveMutation.mutate(payload);
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/admin/discord-settings/test", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast({ title: "Test message sent", description: "Check your Discord channel." });
      } else {
        toast({ title: "Test failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Test failed", description: e.message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-40 w-full" /></div>;

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-500">
            <Hash className="h-[18px] w-[18px]" />
          </span>
          <h2 className="text-sm font-semibold">Discord Notifications</h2>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <Label htmlFor="discord-webhook-url">Webhook URL</Label>
            <Input
              id="discord-webhook-url"
              type="text"
              placeholder="https://discord.com/api/webhooks/..."
              value={webhookUrl}
              onChange={(e) => { setWebhookUrl(e.target.value); setWebhookDirty(true); }}
              data-testid="input-discord-webhook-url"
            />
            <p className="text-xs text-muted-foreground mt-1">
              In Discord, go to <strong>Server Settings → Integrations → Webhooks → New Webhook</strong>, choose a channel, then copy the webhook URL. Leave blank to remove. The saved URL is masked for security.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Enable Discord notifications</p>
              <p className="text-xs text-muted-foreground">
                When enabled, alerts, service updates, and news are posted to the configured channel.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              data-testid="switch-discord-enabled"
            />
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <p className="text-sm font-medium">Send these event types</p>
            <div className="flex items-center gap-2">
              <Checkbox
                id="discord-send-alerts"
                checked={sendAlerts}
                onCheckedChange={(v) => setSendAlerts(!!v)}
                data-testid="checkbox-discord-send-alerts"
              />
              <Label htmlFor="discord-send-alerts" className="text-sm font-normal cursor-pointer">
                Service alerts (created, updated, resolved)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="discord-send-service-updates"
                checked={sendServiceUpdates}
                onCheckedChange={(v) => setSendServiceUpdates(!!v)}
                data-testid="checkbox-discord-send-service-updates"
              />
              <Label htmlFor="discord-send-service-updates" className="text-sm font-normal cursor-pointer">
                Service updates
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="discord-send-news"
                checked={sendNews}
                onCheckedChange={(v) => setSendNews(!!v)}
                data-testid="checkbox-discord-send-news"
              />
              <Label htmlFor="discord-send-news" className="text-sm font-normal cursor-pointer">
                News stories
              </Label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              data-testid="button-save-discord"
            >
              {saveMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing || !settings?.hasWebhook}
              data-testid="button-test-discord"
            >
              {testing ? "Sending..." : "Send Test Message"}
            </Button>
          </div>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">What gets sent:</p>
            <p>🚨 Service alerts (created / updated / resolved) — with service name and impact</p>
            <p>📢 Service updates — with service name</p>
            <p>📰 News stories — title and preview, split across messages if longer than 2000 characters</p>
            <p className="mt-2">If Discord fails or is disabled, your app notifications still send normally.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

interface WhmcsClientSummary {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  companyName: string;
  email: string;
  status: string;
}

interface WhmcsPanelData {
  configured: boolean;
  enabled: boolean;
  link: { whmcsClientId: number; whmcsLinkedAt: string | null } | null;
  linkedClient: WhmcsClientSummary | null;
  suggestion: WhmcsClientSummary | null;
}

interface WhmcsProductSummary {
  id: number;
  name: string;
  groupName: string;
}

interface WhmcsProductMappingRow {
  whmcsProductId: number;
  serviceIds: string[];
  // Name captured from WHMCS when the mapping was saved. Survives the product
  // later becoming Hidden/Retired (GetProducts then omits it). Null for rows
  // created before this was stored — those fall back to the live lookup.
  whmcsProductName: string | null;
}

interface StoreProductRow {
  id: string;
  whmcsProductId: number;
  name: string | null;
  description: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  category: string | null;
  sortOrder: number;
  enabled: boolean;
}

// Admin UI to curate the customer-facing WHMCS storefront (Task #518). Admin
// picks a live WHMCS product and enriches it (display name, blurb, image,
// category, sort order, enabled). Enabled rows that still exist in WHMCS become
// the customer "Order new product" catalogue. The WHMCS product picker is live;
// the curated rows are a pure DB read so they render even when WHMCS is down.
function StoreProductsSection() {
  const { toast } = useToast();
  const emptyForm = { whmcsProductId: "", name: "", description: "", category: "", sortOrder: "0", enabled: true };
  const [form, setForm] = useState<typeof emptyForm>({ ...emptyForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  // Additional gallery images: new files to upload + existing URLs to remove.
  // `galleryOrder` is the admin's drag-reordered list of the existing URLs.
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [removeGalleryUrls, setRemoveGalleryUrls] = useState<string[]>([]);
  const [galleryOrder, setGalleryOrder] = useState<string[]>([]);
  const [galleryDragIdx, setGalleryDragIdx] = useState<number | null>(null);
  // An existing gallery image the admin wants to promote to be the primary image
  // (the old primary moves into the gallery). null = no promotion requested.
  const [promotePrimaryUrl, setPromotePrimaryUrl] = useState<string | null>(null);
  // Drag-to-reorder of the curated product rows themselves. `rowOrder` mirrors
  // the server's product list locally so the drag preview updates instantly;
  // dropping persists the new order via the reorder mutation.
  const [rowOrder, setRowOrder] = useState<StoreProductRow[]>([]);
  const [rowDragId, setRowDragId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  // Crop step: when an admin picks file(s), they're queued here and cropped one
  // at a time before landing in imageFile / galleryFiles. Cropping every photo
  // to the same aspect keeps the catalogue card + customer gallery uniform.
  const [cropAspect, setCropAspect] = useState<CropAspectKey>("16:9");
  const [cropQueue, setCropQueue] = useState<File[]>([]);
  const [cropTarget, setCropTarget] = useState<"primary" | "gallery" | null>(null);
  const cropResultsRef = useRef<File[]>([]);

  const startCrop = (files: File[], target: "primary" | "gallery") => {
    if (files.length === 0) return;
    cropResultsRef.current = [];
    setCropTarget(target);
    setCropQueue(files);
  };

  const cancelCrop = () => {
    setCropQueue([]);
    setCropTarget(null);
    cropResultsRef.current = [];
    if (cropTarget === "primary" && fileInputRef.current) fileInputRef.current.value = "";
    if (cropTarget === "gallery" && galleryInputRef.current) galleryInputRef.current.value = "";
  };

  const handleCropConfirm = (cropped: File) => {
    cropResultsRef.current = [...cropResultsRef.current, cropped];
    const remaining = cropQueue.slice(1);
    if (remaining.length > 0) {
      setCropQueue(remaining);
      return;
    }
    // Batch finished — commit the cropped files to the right slot.
    const results = cropResultsRef.current;
    if (cropTarget === "primary") {
      setImageFile(results[0] ?? null);
      setRemoveImage(false);
      setPromotePrimaryUrl(null);
    } else if (cropTarget === "gallery") {
      setGalleryFiles((prev) => [...prev, ...results]);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
    setCropQueue([]);
    setCropTarget(null);
    cropResultsRef.current = [];
  };

  // Object URLs for previewing freshly cropped (not-yet-saved) files. Memoised
  // + revoked on change so we don't leak a blob URL on every render.
  const primaryPreviewUrl = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : null), [imageFile]);
  useEffect(() => () => { if (primaryPreviewUrl) URL.revokeObjectURL(primaryPreviewUrl); }, [primaryPreviewUrl]);
  const galleryPreviewUrls = useMemo(() => galleryFiles.map((f) => URL.createObjectURL(f)), [galleryFiles]);
  useEffect(() => () => { galleryPreviewUrls.forEach((u) => URL.revokeObjectURL(u)); }, [galleryPreviewUrls]);

  // Object URLs for the not-yet-uploaded files so the live preview can show the
  // admin's pending primary/gallery choices. Revoked when the selection changes
  // or the section unmounts to avoid leaking blob URLs.
  const [primaryFileUrl, setPrimaryFileUrl] = useState<string | null>(null);
  const [galleryFileUrls, setGalleryFileUrls] = useState<string[]>([]);
  useEffect(() => {
    if (!imageFile) {
      setPrimaryFileUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPrimaryFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);
  useEffect(() => {
    const urls = galleryFiles.map((f) => URL.createObjectURL(f));
    setGalleryFileUrls(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [galleryFiles]);

  const handleGalleryDrop = (targetIdx: number) => {
    setGalleryOrder((prev) => {
      if (galleryDragIdx === null || galleryDragIdx === targetIdx) return prev;
      const next = [...prev];
      const [moved] = next.splice(galleryDragIdx, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
    setGalleryDragIdx(null);
  };

  const { data: productsData, isLoading: productsLoading } = useQuery<{
    ok: boolean;
    products?: WhmcsProductSummary[];
    error?: string;
    reason?: string;
  }>({ queryKey: ["/api/admin/whmcs/products"] });

  const { data: storeData } = useQuery<{ products: StoreProductRow[] }>({
    queryKey: ["/api/admin/store-products"],
  });

  const whmcsProducts = useMemo(
    () => (productsData?.ok ? productsData.products ?? [] : []),
    [productsData],
  );
  const storeProducts = storeData?.products ?? [];
  const currentPrimaryUrl = editingId ? storeProducts.find((p) => p.id === editingId)?.imageUrl ?? null : null;
  const curatedPids = new Set(storeProducts.map((p) => p.whmcsProductId));
  // When adding, hide products already in the store. When editing, keep the
  // current product visible so its <SelectItem> can stay selected.
  const availableProducts = whmcsProducts.filter(
    (p) => !curatedPids.has(p.id) || String(p.id) === form.whmcsProductId,
  );

  const whmcsName = (pid: number) => {
    const p = whmcsProducts.find((p) => p.id === pid);
    if (!p) return `Product #${pid}`;
    return p.groupName ? `${p.name} · ${p.groupName}` : p.name;
  };

  // Live customer-facing preview of the catalogue card + order gallery. Mirrors
  // the server's save logic (server/whmcs-store-route.ts) for how pending edits
  // resolve the primary image + gallery order, then the primary-first dedupe in
  // assembleStoreCatalogue (server/whmcs-billing.ts). Recomputes as the admin
  // edits text, uploads, removes, reorders, or promotes images.
  const preview = useMemo(() => {
    // Resolve the primary slot. A fresh upload always wins, then an explicit
    // removal, otherwise keep the existing primary. (undefined = keep existing.)
    let primaryCandidate: string | null | undefined;
    if (primaryFileUrl) primaryCandidate = primaryFileUrl;
    else if (editingId && removeImage) primaryCandidate = null;
    else primaryCandidate = undefined;

    // Build the gallery: drop removed URLs (admin order already applied to
    // galleryOrder), append new uploads.
    let kept = galleryOrder.filter((u) => !removeGalleryUrls.includes(u));
    kept = [...kept, ...galleryFileUrls];

    // Promotion (only when no fresh upload): pull the promoted image into the
    // primary slot and demote whatever primary would otherwise stay to the head
    // of the gallery.
    const promoteUrl =
      !primaryFileUrl && promotePrimaryUrl && kept.includes(promotePrimaryUrl)
        ? promotePrimaryUrl
        : null;
    let finalPrimary: string | null;
    if (promoteUrl) {
      kept = kept.filter((u) => u !== promoteUrl);
      const demote = primaryCandidate !== undefined ? primaryCandidate : currentPrimaryUrl;
      finalPrimary = promoteUrl;
      if (demote && demote !== promoteUrl && !kept.includes(demote)) {
        kept = [demote, ...kept];
      }
    } else {
      finalPrimary = primaryCandidate !== undefined ? primaryCandidate : currentPrimaryUrl;
    }

    // Primary-first, deduped, empties dropped — same as assembleStoreCatalogue.
    const images: string[] = [];
    for (const candidate of [finalPrimary, ...kept]) {
      const url = (candidate ?? "").trim();
      if (url && !images.includes(url)) images.push(url);
    }

    const fallbackName = form.whmcsProductId
      ? whmcsProducts.find((p) => p.id === Number(form.whmcsProductId))?.name ?? ""
      : "";
    const name = form.name.trim() || fallbackName;
    const description = form.description.trim();
    const category = form.category.trim();

    return { primaryUrl: finalPrimary, images, name, description, category };
  }, [
    primaryFileUrl,
    galleryFileUrls,
    galleryOrder,
    removeGalleryUrls,
    promotePrimaryUrl,
    removeImage,
    currentPrimaryUrl,
    editingId,
    form.name,
    form.description,
    form.category,
    form.whmcsProductId,
    whmcsProducts,
  ]);

  // Keep the gallery preview's active thumbnail valid as images change.
  const [previewGalleryIdx, setPreviewGalleryIdx] = useState(0);
  useEffect(() => {
    if (previewGalleryIdx > preview.images.length - 1) setPreviewGalleryIdx(0);
  }, [preview.images.length, previewGalleryIdx]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/store-products"] });

  // Mirror the server's product list into local drag state. Skip while a drag is
  // in flight so an incoming refetch can't yank rows out from under the cursor.
  useEffect(() => {
    if (rowDragId !== null) return;
    setRowOrder(storeProducts);
  }, [storeData, rowDragId]); // eslint-disable-line react-hooks/exhaustive-deps

  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const res = await apiRequest("POST", "/api/admin/store-products/reorder", { orderedIds });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Product order saved" });
    },
    onError: (e: Error) => {
      invalidate();
      toast({ title: "Reorder failed", description: e.message, variant: "destructive" });
    },
  });

  const handleRowDrop = (targetId: string) => {
    if (rowDragId === null || rowDragId === targetId) {
      setRowDragId(null);
      return;
    }
    const from = rowOrder.findIndex((p) => p.id === rowDragId);
    const to = rowOrder.findIndex((p) => p.id === targetId);
    setRowDragId(null);
    if (from === -1 || to === -1) return;
    const next = [...rowOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setRowOrder(next);
    reorderMutation.mutate(next.map((p) => p.id));
  };

  const resetForm = () => {
    setForm({ ...emptyForm });
    setEditingId(null);
    setImageFile(null);
    setRemoveImage(false);
    setGalleryFiles([]);
    setRemoveGalleryUrls([]);
    setGalleryOrder([]);
    setGalleryDragIdx(null);
    setPromotePrimaryUrl(null);
    setCropQueue([]);
    setCropTarget(null);
    cropResultsRef.current = [];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (galleryInputRef.current) galleryInputRef.current.value = "";
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      if (!editingId) fd.append("whmcsProductId", form.whmcsProductId);
      fd.append("name", form.name);
      fd.append("description", form.description);
      fd.append("category", form.category);
      fd.append("sortOrder", form.sortOrder);
      fd.append("enabled", String(form.enabled));
      if (imageFile) fd.append("image", imageFile);
      if (editingId && removeImage && !imageFile) fd.append("removeImage", "true");
      for (const file of galleryFiles) fd.append("images", file);
      if (editingId && removeGalleryUrls.length > 0) fd.append("removeImageUrls", JSON.stringify(removeGalleryUrls));
      if (editingId && galleryOrder.length > 0) fd.append("imageUrlsOrder", JSON.stringify(galleryOrder));
      if (editingId && promotePrimaryUrl && !imageFile) fd.append("promotePrimaryImageUrl", promotePrimaryUrl);
      const url = editingId ? `/api/admin/store-products/${editingId}` : "/api/admin/store-products";
      const res = await uploadRequest(editingId ? "PATCH" : "POST", url, fd);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.message || "Failed to save product");
      }
      return res.json();
    },
    onSuccess: () => {
      const wasEditing = Boolean(editingId);
      invalidate();
      resetForm();
      toast({ title: wasEditing ? "Product updated" : "Product added to store" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/store-products/${id}`);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Product removed from store" });
    },
    onError: (e: Error) => toast({ title: "Remove failed", description: e.message, variant: "destructive" }),
  });

  const startEdit = (p: StoreProductRow) => {
    setEditingId(p.id);
    setForm({
      whmcsProductId: String(p.whmcsProductId),
      name: p.name ?? "",
      description: p.description ?? "",
      category: p.category ?? "",
      sortOrder: String(p.sortOrder),
      enabled: p.enabled,
    });
    setImageFile(null);
    setRemoveImage(false);
    setGalleryFiles([]);
    setRemoveGalleryUrls([]);
    setGalleryOrder(p.imageUrls ?? []);
    setGalleryDragIdx(null);
    setPromotePrimaryUrl(null);
    setCropQueue([]);
    setCropTarget(null);
    cropResultsRef.current = [];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (galleryInputRef.current) galleryInputRef.current.value = "";
  };

  const handleSave = () => {
    if (!editingId) {
      const pid = Number(form.whmcsProductId);
      if (!Number.isInteger(pid) || pid <= 0) {
        toast({ title: "Pick a WHMCS product first", variant: "destructive" });
        return;
      }
    }
    saveMutation.mutate();
  };

  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden" data-testid="card-store-products">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Tag className="h-[18px] w-[18px]" />
          </span>
          Customer storefront
        </h2>
      </div>
      <div className="p-5 space-y-4">
        <p className="text-sm text-muted-foreground">
          Curate the products customers can self-order from the "Order new product" button on their My Services page. Pick a WHMCS product, give it a customer-friendly name, blurb, image and category, then enable it. Only enabled products that still exist in WHMCS appear to customers.
        </p>

        {/* Curated products */}
        {rowOrder.length === 0 ? (
          <div className="px-5 py-8 text-center" data-testid="text-no-store-products">
            <Tag className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">No products in the store yet.</p>
          </div>
        ) : (
          <div className="border-t border-b border-border -mx-5" data-testid="list-store-products">
            {rowOrder.length > 1 && (
              <div className="bg-muted/30 px-5 py-2 border-b border-border">
                <p className="text-xs text-muted-foreground">Drag the handle to reorder how products appear in the customer catalogue.</p>
              </div>
            )}
            <div className="divide-y divide-border">
              {rowOrder.map((p) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={() => setRowDragId(p.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleRowDrop(p.id)}
                  onDragEnd={() => setRowDragId(null)}
                  className={`flex items-start justify-between gap-3 px-5 py-3.5 hover:bg-muted/50 ${rowDragId === p.id ? "opacity-50" : ""}`}
                  data-testid={`row-store-product-${p.id}`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {rowOrder.length > 1 && (
                      <span className="cursor-grab hover:text-foreground text-muted-foreground mt-3 shrink-0" aria-label="Drag to reorder" data-testid={`drag-store-product-${p.id}`}>
                        <GripVertical className="w-4 h-4" />
                      </span>
                    )}
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" className="w-12 h-12 rounded object-cover border shrink-0 bg-muted" data-testid={`img-store-product-${p.id}`} />
                    ) : (
                      <div className="w-12 h-12 rounded border bg-muted flex items-center justify-center shrink-0">
                        <ImagePlus className="w-5 h-5 text-muted-foreground opacity-50" />
                      </div>
                    )}
                    <div className="min-w-0 mt-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium truncate" data-testid={`text-store-product-name-${p.id}`}>{p.name || whmcsName(p.whmcsProductId)}</p>
                        {p.enabled ? (
                          <Badge className="h-5 px-1.5 text-xs shrink-0 border-green-300 bg-green-100 text-green-800 dark:border-green-700/60 dark:bg-green-950/50 dark:text-green-200" data-testid={`badge-store-enabled-${p.id}`}>Enabled</Badge>
                        ) : (
                          <Badge variant="secondary" className="h-5 px-1.5 text-xs shrink-0" data-testid={`badge-store-disabled-${p.id}`}>Disabled</Badge>
                        )}
                        {p.category && <Badge variant="outline" className="h-5 px-1.5 text-xs shrink-0" data-testid={`badge-store-category-${p.id}`}>{p.category}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{whmcsName(p.whmcsProductId)} <span className="opacity-70">(#{p.whmcsProductId})</span></p>
                      {p.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.description}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 mt-1">
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => startEdit(p)} data-testid={`button-edit-store-product-${p.id}`}>
                      <Edit className="w-3 h-3" /> Edit
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20" onClick={() => removeMutation.mutate(p.id)} disabled={removeMutation.isPending} data-testid={`button-remove-store-product-${p.id}`}>
                      <Trash2 className="w-3 h-3" /> Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add / edit form */}
        <div className="rounded-md border p-3 space-y-3">
          <p className="text-sm font-medium">{editingId ? "Edit product" : "Add a product"}</p>
          {!editingId && productsLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : !editingId && !productsData?.ok ? (
            <p className="text-sm text-amber-600" data-testid="text-store-products-unavailable">
              {productsData?.reason === "not_configured"
                ? "Configure and enable WHMCS above to load the product list."
                : `Couldn't load WHMCS products${productsData?.error ? `: ${productsData.error}` : "."}`}
            </p>
          ) : (
            <>
              <div>
                <Label>WHMCS product</Label>
                {editingId ? (
                  <p className="text-sm mt-1" data-testid="text-editing-store-product">{whmcsName(Number(form.whmcsProductId))} (#{form.whmcsProductId})</p>
                ) : (
                  <Select value={form.whmcsProductId} onValueChange={(v) => setForm((f) => ({ ...f, whmcsProductId: v }))}>
                    <SelectTrigger data-testid="select-store-whmcs-product"><SelectValue placeholder="Choose a product…" /></SelectTrigger>
                    <SelectContent>
                      {availableProducts.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">All products are already in the store.</div>
                      ) : availableProducts.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)} data-testid={`option-store-product-${p.id}`}>
                          {p.groupName ? `${p.name} · ${p.groupName}` : p.name} (#{p.id})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div>
                <Label>Display name</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Customer-friendly name (defaults to WHMCS name)" data-testid="input-store-name" />
              </div>

              <div>
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Short blurb shown to customers" rows={3} data-testid="input-store-description" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Category</Label>
                  <Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Hosting" data-testid="input-store-category" />
                </div>
                <div>
                  <Label>Sort order</Label>
                  <Input type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} data-testid="input-store-sort" />
                </div>
              </div>

              <div>
                <Label>Primary image</Label>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) startCrop([f], "primary"); }} className="block w-full text-sm mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm" data-testid="input-store-image" />
                <p className="text-xs text-muted-foreground mt-1">Shown on the catalogue card and as the first gallery image. You'll crop it to a consistent shape before saving.</p>
                {/* Preview of the freshly cropped primary image (before save). */}
                {imageFile && primaryPreviewUrl && (
                  <div className="flex items-center gap-2 mt-2" data-testid="preview-store-primary-new">
                    <img src={primaryPreviewUrl} alt="" className="w-14 h-14 rounded border object-cover" data-testid="img-store-primary-new" />
                    <p className="text-xs text-muted-foreground">
                      Cropped image ready.{" "}
                      <button type="button" className="underline hover:text-foreground" onClick={() => startCrop([imageFile], "primary")} data-testid="button-store-recrop-primary">Re-crop</button>
                      {" · "}
                      <button type="button" className="underline hover:text-foreground" onClick={() => { setImageFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} data-testid="button-store-clear-primary">Remove</button>
                    </p>
                  </div>
                )}
                {/* Current primary preview (edit mode). When a gallery image is
                    pending promotion, show THAT image here instead so the admin
                    sees the result, and flag where the old primary will land. */}
                {editingId && !imageFile && (currentPrimaryUrl || promotePrimaryUrl) && (
                  <div className="flex items-center gap-2 mt-2" data-testid="preview-store-primary">
                    <img
                      src={promotePrimaryUrl ?? currentPrimaryUrl ?? ""}
                      alt=""
                      className="w-14 h-14 rounded border object-cover"
                      data-testid="img-store-primary-current"
                    />
                    {promotePrimaryUrl && (
                      <p className="text-xs text-muted-foreground" data-testid="text-store-promote-note">
                        This photo will become the main image{currentPrimaryUrl ? "; the current main image moves into the gallery" : ""}.{" "}
                        <button
                          type="button"
                          className="underline hover:text-foreground"
                          onClick={() => setPromotePrimaryUrl(null)}
                          data-testid="button-store-promote-undo"
                        >
                          Undo
                        </button>
                      </p>
                    )}
                  </div>
                )}
                {editingId && currentPrimaryUrl && !imageFile && !promotePrimaryUrl && (
                  <label className="flex items-center gap-2 mt-2 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox checked={removeImage} onCheckedChange={(c) => setRemoveImage(Boolean(c))} data-testid="checkbox-store-remove-image" />
                    Remove current image
                  </label>
                )}
              </div>

              <div>
                <Label>Additional images</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-1">Extra photos shown in a gallery on the order screen (up to 8).</p>
                {/* Existing additional images (edit mode) — drag to reorder,
                    toggle removal each. Order is persisted as the imageUrls array. */}
                {editingId && galleryOrder.length > 0 && (
                  <>
                    {galleryOrder.length > 1 && (
                      <p className="text-xs text-muted-foreground mb-1">Drag to reorder how photos appear in the customer gallery.</p>
                    )}
                    <div className="flex flex-wrap gap-2 mb-2" data-testid="list-store-gallery-existing">
                      {galleryOrder.map((url, idx) => {
                        const marked = removeGalleryUrls.includes(url);
                        const isPromoted = promotePrimaryUrl === url;
                        return (
                          <div
                            key={url}
                            draggable={!marked}
                            onDragStart={() => setGalleryDragIdx(idx)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => handleGalleryDrop(idx)}
                            onDragEnd={() => setGalleryDragIdx(null)}
                            className={`relative ${marked ? "" : "cursor-move"} ${galleryDragIdx === idx ? "opacity-50" : ""}`}
                            data-testid={`gallery-existing-${url}`}
                          >
                            <img src={url} alt="" className={`w-14 h-14 rounded border object-cover ${marked ? "opacity-30" : ""} ${isPromoted ? "ring-2 ring-primary ring-offset-1" : ""}`} />
                            {!marked && galleryOrder.length > 1 && (
                              <span className="absolute bottom-0.5 left-0.5 rounded bg-background/80 border p-0.5 pointer-events-none" aria-hidden="true">
                                <GripVertical className="w-3 h-3 text-muted-foreground" />
                              </span>
                            )}
                            {!marked && (
                              <button
                                type="button"
                                onClick={() => { setPromotePrimaryUrl(isPromoted ? null : url); setImageFile(null); setRemoveImage(false); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                                className={`absolute -top-1.5 -left-1.5 rounded-full border shadow-sm p-0.5 hover-elevate ${isPromoted ? "bg-primary text-primary-foreground" : "bg-background"}`}
                                aria-label={isPromoted ? "Cancel make primary" : "Make this the main image"}
                                title={isPromoted ? "This will become the main image" : "Make this the main image"}
                                data-testid="button-gallery-make-primary"
                              >
                                <Star className={`w-3 h-3 ${isPromoted ? "fill-current" : ""}`} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => { setRemoveGalleryUrls((prev) => marked ? prev.filter((u) => u !== url) : [...prev, url]); if (!marked && isPromoted) setPromotePrimaryUrl(null); }}
                              className="absolute -top-1.5 -right-1.5 rounded-full bg-background border shadow-sm p-0.5 hover-elevate"
                              aria-label={marked ? "Keep image" : "Remove image"}
                              data-testid={`button-gallery-toggle-remove`}
                            >
                              {marked ? <Plus className="w-3 h-3" /> : <XIcon className="w-3 h-3" />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length > 0) startCrop(files, "gallery"); }}
                  className="block w-full text-sm mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
                  data-testid="input-store-gallery"
                />
                {galleryFiles.length > 0 && (
                  <div className="mt-2" data-testid="text-store-gallery-count">
                    <p className="text-xs text-muted-foreground mb-1">
                      {galleryFiles.length} new cropped image{galleryFiles.length === 1 ? "" : "s"} ready
                    </p>
                    <div className="flex flex-wrap gap-2" data-testid="list-store-gallery-new">
                      {galleryPreviewUrls.map((url, i) => (
                        <div key={url} className="relative" data-testid={`gallery-new-${i}`}>
                          <img src={url} alt="" className="w-14 h-14 rounded border object-cover" />
                          <button
                            type="button"
                            onClick={() => setGalleryFiles((prev) => prev.filter((_, idx) => idx !== i))}
                            className="absolute -top-1.5 -right-1.5 rounded-full bg-background border shadow-sm p-0.5 hover-elevate"
                            aria-label="Remove image"
                            data-testid={`button-gallery-new-remove-${i}`}
                          >
                            <XIcon className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Live customer preview — catalogue card + order-screen gallery,
                  reflecting the current name, blurb, primary image and gallery
                  order (primary first) exactly as a customer would see them. */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-3" data-testid="preview-customer-store">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" /> Customer preview
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {/* Catalogue card (step 1) */}
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Catalogue card</p>
                    <div className="text-left rounded-lg border bg-card overflow-hidden flex flex-col max-w-[220px]" data-testid="preview-store-card">
                      <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
                        {preview.primaryUrl ? (
                          <img src={preview.primaryUrl} alt={preview.name} className="w-full h-full object-contain" data-testid="img-preview-card" />
                        ) : (
                          <Package className="w-8 h-8 text-muted-foreground" />
                        )}
                      </div>
                      <div className="p-3 flex flex-col gap-1 flex-1">
                        {preview.category && (
                          <Badge variant="secondary" className="self-start text-[10px] font-normal" data-testid="text-preview-card-category">{preview.category}</Badge>
                        )}
                        <p className="font-medium text-sm leading-snug" data-testid="text-preview-card-name">
                          {preview.name || <span className="text-muted-foreground italic">Product name</span>}
                        </p>
                        {preview.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2" data-testid="text-preview-card-description">{preview.description}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Order-screen gallery (step 2) */}
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Order screen</p>
                    {preview.name && (
                      <p className="font-medium text-sm mb-2" data-testid="text-preview-gallery-name">{preview.name}</p>
                    )}
                    {preview.images.length > 0 ? (
                      <div className="space-y-2" data-testid="preview-store-gallery">
                        {(() => {
                          const idx = Math.min(previewGalleryIdx, preview.images.length - 1);
                          return (
                            <>
                              <img src={preview.images[idx]} alt={preview.name} className="w-full max-h-40 rounded-lg border bg-muted object-contain" data-testid="img-preview-gallery" />
                              {preview.images.length > 1 && (
                                <div className="flex flex-wrap gap-2" data-testid="preview-store-thumbnails">
                                  {preview.images.map((src, i) => (
                                    <button
                                      key={src}
                                      type="button"
                                      onClick={() => setPreviewGalleryIdx(i)}
                                      className={`h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-muted hover-elevate ${i === idx ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
                                      aria-label={`View image ${i + 1} of ${preview.images.length}`}
                                      data-testid={`button-preview-thumbnail-${i}`}
                                    >
                                      <img src={src} alt="" className="h-full w-full object-cover" />
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          );
                        })()}
                        {preview.description && (
                          <p className="text-xs text-muted-foreground" data-testid="text-preview-gallery-description">{preview.description}</p>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed bg-muted/40 px-3 py-6 text-center text-xs text-muted-foreground" data-testid="preview-store-gallery-empty">
                        No images yet — customers will see a placeholder icon.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer" data-testid="label-store-enabled">
                <Switch checked={form.enabled} onCheckedChange={(c) => setForm((f) => ({ ...f, enabled: c }))} data-testid="switch-store-enabled" />
                <span className="text-sm">Enabled (visible to customers)</span>
              </label>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-store-product">
                  {saveMutation.isPending ? "Saving..." : editingId ? "Save changes" : "Add to store"}
                </Button>
                {(editingId || form.whmcsProductId || form.name) && (
                  <Button type="button" variant="ghost" onClick={resetForm} data-testid="button-cancel-store-product">
                    Cancel
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <ImageCropDialog
        open={cropQueue.length > 0}
        file={cropQueue[0] ?? null}
        aspect={cropAspect}
        onAspectChange={setCropAspect}
        position={cropTarget === "gallery" ? { index: cropResultsRef.current.length, total: cropResultsRef.current.length + cropQueue.length } : undefined}
        onConfirm={handleCropConfirm}
        onCancel={cancelCrop}
      />
    </section>
  );
}

// Admin UI to map WHMCS products → ServiceHub monitored services (Task #335).
// Lives under the WHMCS Billing tab below the connection settings. The product
// picker comes from WHMCS (live), the service picker from ServiceHub, and the
// saved mappings are a pure DB read so they render even when WHMCS is down.
function WhmcsProductMappingSection() {
  const { toast } = useToast();
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  // Drag-to-reorder of the mapping rows. `rowOrder` mirrors the server list
  // locally so the drag preview updates instantly; dropping persists the order.
  const [rowOrder, setRowOrder] = useState<WhmcsProductMappingRow[]>([]);
  const [rowDragId, setRowDragId] = useState<number | null>(null);

  const { data: productsData, isLoading: productsLoading } = useQuery<{
    ok: boolean;
    products?: WhmcsProductSummary[];
    error?: string;
    reason?: string;
  }>({
    queryKey: ["/api/admin/whmcs/products"],
  });

  const { data: mappingsData } = useQuery<{ mappings: WhmcsProductMappingRow[] }>({
    queryKey: ["/api/admin/whmcs/product-mappings"],
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const products = productsData?.ok ? productsData.products ?? [] : [];
  const mappings = mappingsData?.mappings ?? [];
  const mappedProductIds = new Set(mappings.map((m) => m.whmcsProductId));
  const unmappedProducts = products.filter((p) => !mappedProductIds.has(p.id));

  const serviceName = (id: string) => services?.find((s) => s.id === id)?.name ?? id;
  // Live name from the WHMCS picker. Null when GetProducts can't resolve the
  // product (it's Hidden/Retired, or WHMCS is unreachable).
  const liveProductName = (pid: number): string | null => {
    const p = products.find((p) => p.id === pid);
    if (!p) return null;
    return p.groupName ? `${p.name} (${p.groupName})` : p.name;
  };
  const productName = (pid: number) => liveProductName(pid) ?? `Product #${pid}`;
  // Name to show on a mapped row: prefer the snapshot captured at save time
  // (survives the product being hidden), then the live lookup, then the id.
  const mappingName = (m: WhmcsProductMappingRow) =>
    m.whmcsProductName?.trim() || liveProductName(m.whmcsProductId) || `Product #${m.whmcsProductId}`;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/whmcs/product-mappings"] });

  const saveMutation = useMutation({
    mutationFn: async (vars: { whmcsProductId: number; serviceIds: string[] }) => {
      // Snapshot the live name so the row stays identifiable after the product
      // is hidden. Null when unresolvable — the server then keeps the prior name.
      const res = await apiRequest("PUT", "/api/admin/whmcs/product-mappings", {
        ...vars,
        productName: liveProductName(vars.whmcsProductId),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.message || "Failed to save mapping");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setSelectedProductId("");
      setSelectedServiceIds([]);
      toast({ title: "Mapping saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (pid: number) => {
      const res = await apiRequest("DELETE", `/api/admin/whmcs/product-mappings/${pid}`);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.message || "Failed to remove mapping");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Mapping removed" });
    },
    onError: (e: Error) => toast({ title: "Remove failed", description: e.message, variant: "destructive" }),
  });

  // Mirror the server's mapping list into local drag state. Skip while a drag is
  // in flight so an incoming refetch can't yank rows out from under the cursor.
  useEffect(() => {
    if (rowDragId !== null) return;
    setRowOrder(mappings);
  }, [mappingsData, rowDragId]); // eslint-disable-line react-hooks/exhaustive-deps

  const reorderMutation = useMutation({
    mutationFn: async (orderedProductIds: number[]) => {
      const res = await apiRequest("POST", "/api/admin/whmcs/product-mappings/reorder", { orderedProductIds });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.message || "Failed to save order");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Mapping order saved" });
    },
    onError: (e: Error) => {
      invalidate();
      toast({ title: "Reorder failed", description: e.message, variant: "destructive" });
    },
  });

  const handleRowDrop = (targetId: number) => {
    if (rowDragId === null || rowDragId === targetId) {
      setRowDragId(null);
      return;
    }
    const from = rowOrder.findIndex((m) => m.whmcsProductId === rowDragId);
    const to = rowOrder.findIndex((m) => m.whmcsProductId === targetId);
    setRowDragId(null);
    if (from === -1 || to === -1) return;
    const next = [...rowOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setRowOrder(next);
    reorderMutation.mutate(next.map((m) => m.whmcsProductId));
  };

  const startEdit = (m: WhmcsProductMappingRow) => {
    setSelectedProductId(String(m.whmcsProductId));
    setSelectedServiceIds([...m.serviceIds]);
  };

  const toggleService = (id: string) => {
    setSelectedServiceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const handleSave = () => {
    const pid = Number(selectedProductId);
    if (!Number.isInteger(pid) || pid <= 0) {
      toast({ title: "Pick a WHMCS product first", variant: "destructive" });
      return;
    }
    saveMutation.mutate({ whmcsProductId: pid, serviceIds: selectedServiceIds });
  };

  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden" data-testid="card-whmcs-mappings">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Server className="h-[18px] w-[18px]" />
          </span>
          Product → Service mapping
        </h2>
      </div>
      <div className="p-5 space-y-4">
        <p className="text-sm text-muted-foreground">
          Link a WHMCS product to the monitored services it includes. Customers linked to a WHMCS client will automatically see the matching services for their active products.
        </p>
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200" data-testid="notice-orderable-gate">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="text-xs">
            <span className="font-medium">Only mapped products can be ordered by customers.</span> A product without a mapping is hidden from the "order a new service" picker. This is the only reliable way to hide a product from ordering, because WHMCS doesn't tell us which products are Hidden or Retired. Map every product you want customers to be able to order — and leave a product unmapped to keep it un-orderable.
          </p>
        </div>

        {/* Existing mappings */}
        {rowOrder.length === 0 ? (
          <div className="px-5 py-8 text-center" data-testid="text-no-mappings">
            <Server className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">No product mappings yet.</p>
          </div>
        ) : (
          <div className="border-t border-b border-border -mx-5" data-testid="list-whmcs-mappings">
            {rowOrder.length > 1 && (
              <div className="bg-muted/30 px-5 py-2 border-b border-border">
                <p className="text-xs text-muted-foreground" data-testid="text-mapping-reorder-hint">Drag the handle to reorder this list (for example to group a product's monthly, quarterly and annual variants together).</p>
              </div>
            )}
            <div className="divide-y divide-border">
              {rowOrder.map((m) => (
                <div
                  key={m.whmcsProductId}
                  draggable
                  onDragStart={() => setRowDragId(m.whmcsProductId)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleRowDrop(m.whmcsProductId)}
                  onDragEnd={() => setRowDragId(null)}
                  className={`flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 px-5 py-3.5 hover:bg-muted/50 ${rowDragId === m.whmcsProductId ? "opacity-50" : ""}`}
                  data-testid={`row-mapping-${m.whmcsProductId}`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {rowOrder.length > 1 && (
                      <span className="mt-1 shrink-0 cursor-grab hover:text-foreground text-muted-foreground" data-testid={`drag-mapping-${m.whmcsProductId}`} aria-label="Drag to reorder">
                        <GripVertical className="w-4 h-4" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-sm font-medium break-words" data-testid={`text-mapping-product-${m.whmcsProductId}`}>{mappingName(m)}</p>
                        <span className="text-xs text-muted-foreground opacity-70 shrink-0" data-testid={`text-mapping-pid-${m.whmcsProductId}`}>#{m.whmcsProductId}</span>
                        <Badge className="h-5 px-1.5 text-xs shrink-0 border-green-300 bg-green-100 text-green-800 dark:border-green-700/60 dark:bg-green-950/50 dark:text-green-200" data-testid={`badge-orderable-${m.whmcsProductId}`}>Orderable</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {m.serviceIds.map((sid) => (
                          <Badge key={sid} variant="secondary" className="h-5 px-1.5 text-[11px] font-medium" data-testid={`badge-mapping-service-${m.whmcsProductId}-${sid}`}>
                            {serviceName(sid)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-start mt-1">
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => startEdit(m)} data-testid={`button-edit-mapping-${m.whmcsProductId}`}>
                      <Edit className="w-3 h-3" /> Edit
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20" onClick={() => removeMutation.mutate(m.whmcsProductId)} disabled={removeMutation.isPending} data-testid={`button-remove-mapping-${m.whmcsProductId}`}>
                      <Trash2 className="w-3 h-3" /> Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Unmapped products — not orderable */}
        {productsData?.ok && unmappedProducts.length > 0 && (
          <div className="rounded-md border border-dashed p-3 space-y-2" data-testid="list-unmapped-products">
            <p className="text-sm font-medium flex items-center gap-2">
              Unmapped products
              <Badge variant="outline" className="h-5 px-1.5 text-xs text-muted-foreground" data-testid="badge-unmapped-count">Not orderable · {unmappedProducts.length}</Badge>
            </p>
            <p className="text-xs text-muted-foreground">These WHMCS products have no service mapping, so customers can't order them. Map one below to make it orderable.</p>
            <div className="flex flex-wrap gap-1">
              {unmappedProducts.map((p) => (
                <Badge key={p.id} variant="secondary" className="h-5 px-1.5 text-xs font-normal" data-testid={`badge-unmapped-${p.id}`}>
                  {p.groupName ? `${p.name} · ${p.groupName}` : p.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Add / edit form */}
        <div className="rounded-md border p-3 space-y-3">
          <p className="text-sm font-medium">Add or edit a mapping</p>
          {productsLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : !productsData?.ok ? (
            <p className="text-sm text-amber-600" data-testid="text-products-unavailable">
              {productsData?.reason === "not_configured"
                ? "Configure and enable WHMCS above to load the product list."
                : `Couldn't load WHMCS products${productsData?.error ? `: ${productsData.error}` : "."}`}
            </p>
          ) : products.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-products">No products found in WHMCS.</p>
          ) : (
            <>
              <div>
                <Label>WHMCS product</Label>
                <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                  <SelectTrigger data-testid="select-whmcs-product"><SelectValue placeholder="Choose a product…" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)} data-testid={`option-product-${p.id}`}>
                        {p.groupName ? `${p.name} · ${p.groupName}` : p.name} (#{p.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Monitored services</Label>
                {!services || services.length === 0 ? (
                  <p className="text-xs text-muted-foreground mt-1">No services exist yet. Create services first.</p>
                ) : (
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-md border divide-y" data-testid="list-service-picker">
                    {services.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 px-2.5 py-2 cursor-pointer" data-testid={`label-service-${s.id}`}>
                        <Checkbox
                          checked={selectedServiceIds.includes(s.id)}
                          onCheckedChange={() => toggleService(s.id)}
                          data-testid={`checkbox-service-${s.id}`}
                        />
                        <span className="text-sm truncate">{s.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={handleSave} disabled={saveMutation.isPending || !selectedProductId} data-testid="button-save-mapping">
                  {saveMutation.isPending ? "Saving..." : "Save mapping"}
                </Button>
                {(selectedProductId || selectedServiceIds.length > 0) && (
                  <Button type="button" variant="ghost" onClick={() => { setSelectedProductId(""); setSelectedServiceIds([]); }} data-testid="button-cancel-mapping">
                    Clear
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Saving with no services selected clears the product's mapping.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

interface WhmcsProductDnsRow {
  whmcsProductId: number;
  dns: string;
}

// Admin UI to assign a DNS (connection address) to each WHMCS product (Task
// #473). The DNS is a property of the product TYPE, so it's keyed by WHMCS pid
// and shown to every customer holding that product alongside their login. The
// product picker is live from WHMCS; the saved DNS values are a pure DB read so
// they render even when WHMCS is down.
function WhmcsProductDnsSection() {
  const { toast } = useToast();
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [dnsValue, setDnsValue] = useState<string>("");

  const { data: productsData, isLoading: productsLoading } = useQuery<{
    ok: boolean;
    products?: WhmcsProductSummary[];
    error?: string;
    reason?: string;
  }>({
    queryKey: ["/api/admin/whmcs/products"],
  });

  const { data: dnsData } = useQuery<{ entries: WhmcsProductDnsRow[] }>({
    queryKey: ["/api/admin/whmcs/product-dns"],
  });

  const products = productsData?.ok ? productsData.products ?? [] : [];
  const entries = dnsData?.entries ?? [];

  const productName = (pid: number) => {
    const p = products.find((p) => p.id === pid);
    if (!p) return `Product #${pid}`;
    return p.groupName ? `${p.name} (${p.groupName})` : p.name;
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/whmcs/product-dns"] });

  const saveMutation = useMutation({
    mutationFn: async (vars: { whmcsProductId: number; dns: string }) => {
      const res = await apiRequest("PUT", "/api/admin/whmcs/product-dns", vars);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.message || "Failed to save DNS");
      }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      invalidate();
      setSelectedProductId("");
      setDnsValue("");
      toast({ title: vars.dns.trim() ? "DNS saved" : "DNS cleared" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const startEdit = (row: WhmcsProductDnsRow) => {
    setSelectedProductId(String(row.whmcsProductId));
    setDnsValue(row.dns);
  };

  const handleSave = () => {
    const pid = Number(selectedProductId);
    if (!Number.isInteger(pid) || pid <= 0) {
      toast({ title: "Pick a WHMCS product first", variant: "destructive" });
      return;
    }
    saveMutation.mutate({ whmcsProductId: pid, dns: dnsValue });
  };

  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden" data-testid="card-whmcs-dns">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Server className="h-[18px] w-[18px]" />
          </span>
          Product DNS (connection address)
        </h2>
      </div>
      <div className="p-5 space-y-4">
        <p className="text-sm text-muted-foreground">
          Assign a connection address (DNS) to each WHMCS product. Customers see it next to their login under "My Services" — including brand-new signups, since the DNS belongs to the product, not the individual account.
        </p>

        {/* Existing DNS values */}
        {entries.length === 0 ? (
          <div className="px-5 py-8 text-center" data-testid="text-no-dns">
            <Server className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">No product DNS set yet.</p>
          </div>
        ) : (
          <div className="border-t border-b border-border -mx-5" data-testid="list-whmcs-dns">
            <div className="divide-y divide-border">
              {entries.map((row) => (
                <div key={row.whmcsProductId} className="flex items-start justify-between gap-3 px-5 py-3.5 hover:bg-muted/50" data-testid={`row-dns-${row.whmcsProductId}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" data-testid={`text-dns-product-${row.whmcsProductId}`}>{productName(row.whmcsProductId)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground break-all font-mono" data-testid={`text-dns-value-${row.whmcsProductId}`}>{row.dns}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => startEdit(row)} data-testid={`button-edit-dns-${row.whmcsProductId}`}>
                      <Edit className="w-3 h-3" /> Edit
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20" onClick={() => saveMutation.mutate({ whmcsProductId: row.whmcsProductId, dns: "" })} disabled={saveMutation.isPending} data-testid={`button-remove-dns-${row.whmcsProductId}`}>
                      <Trash2 className="w-3 h-3" /> Clear
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add / edit form */}
        <div className="rounded-md border p-3 space-y-3">
          <p className="text-sm font-medium">Set or edit a product's DNS</p>
          {productsLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : !productsData?.ok ? (
            <p className="text-sm text-amber-600" data-testid="text-dns-products-unavailable">
              {productsData?.reason === "not_configured"
                ? "Configure and enable WHMCS above to load the product list."
                : `Couldn't load WHMCS products${productsData?.error ? `: ${productsData.error}` : "."}`}
            </p>
          ) : products.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-dns-no-products">No products found in WHMCS.</p>
          ) : (
            <>
              <div>
                <Label>WHMCS product</Label>
                <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                  <SelectTrigger data-testid="select-whmcs-dns-product"><SelectValue placeholder="Choose a product…" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)} data-testid={`option-dns-product-${p.id}`}>
                        {p.groupName ? `${p.name} · ${p.groupName}` : p.name} (#{p.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="input-dns-value">DNS / connection address</Label>
                <Input
                  id="input-dns-value"
                  value={dnsValue}
                  onChange={(e) => setDnsValue(e.target.value)}
                  placeholder="e.g. host.example.com"
                  data-testid="input-dns-value"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={handleSave} disabled={saveMutation.isPending || !selectedProductId} data-testid="button-save-dns">
                  {saveMutation.isPending ? "Saving..." : "Save DNS"}
                </Button>
                {(selectedProductId || dnsValue) && (
                  <Button type="button" variant="ghost" onClick={() => { setSelectedProductId(""); setDnsValue(""); }} data-testid="button-cancel-dns">
                    Clear
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Saving with an empty DNS removes it for that product.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

type BillingDashboardCustomer = {
  userId: string;
  clientId: number;
  name: string;
  status: string;
  outstanding: number;
  overdue: number;
  unpaidCount: number;
  overdueCount: number;
  currencyCode: string | null;
};

type BillingDashboardPayload = {
  configured: boolean;
  enabled: boolean;
  unreachable: boolean;
  partial: boolean;
  generatedAt: string;
  summary: {
    linkedCustomers: number;
    customersLoaded: number;
    customersFailed: number;
    totalOutstanding: number;
    overdueAmount: number;
    overdueInvoiceCount: number;
    unpaidInvoiceCount: number;
    activeServices: number;
    suspendedServices: number;
    estimatedMrr: number;
    currencyCode: string | null;
  };
  customers: BillingDashboardCustomer[];
};

function formatDashboardMoney(amount: number, currencyCode: string | null): string {
  const value = (amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currencyCode ? `${value} ${currencyCode}` : value;
}

function BillingSummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
  testid,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger" | "success";
  testid: string;
}) {
  const toneClass =
    tone === "danger"
      ? "bg-destructive/10 text-destructive"
      : tone === "success"
        ? "bg-green-500/10 text-green-600 dark:text-green-400"
        : "bg-primary/10 text-primary";
  return (
    <div className="rounded-xl border border-card-border bg-card p-4 hover-elevate tap-interactive" data-testid={testid}>
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${toneClass}`}>
          <Icon className="w-4 h-4" />
        </div>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="text-2xl font-bold mt-2 truncate" data-testid={`${testid}-value`}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

// Admin billing dashboard (Task #370): a fleet-wide, read-only billing health
// view across every linked customer. Snapshot only — totals + the customers who
// owe money, each drilling through to that customer's existing billing detail.
function BillingDashboardTab() {
  const [, navigate] = useLocation();
  const { data, isLoading, isFetching, refetch } = useQuery<BillingDashboardPayload>({
    queryKey: ["/api/admin/whmcs/billing/dashboard"],
  });

  const goToCustomer = (userId: string) => {
    navigate(`/admin?tab=users&user=${encodeURIComponent(userId)}`);
  };

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="billing-dashboard-loading">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!data || !data.configured || !data.enabled) {
    return (
      <div className="text-center py-12 rounded-xl border border-card-border bg-card" data-testid="billing-dashboard-unconfigured">
        <CreditCard className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-base font-semibold">Billing dashboard unavailable</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          WHMCS billing isn't configured or is currently disabled. Enable it under the WHMCS Billing section to see fleet-wide billing health.
        </p>
      </div>
    );
  }

  if (data.unreachable) {
    return (
      <div className="text-center py-12 rounded-xl border border-card-border bg-card" data-testid="billing-dashboard-unreachable">
        <ServerCog className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-base font-semibold">Billing temporarily unavailable</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          We couldn't reach the billing system for any customer right now. Please try again in a few minutes.
        </p>
        <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => refetch()} data-testid="button-billing-dashboard-retry">
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </Button>
      </div>
    );
  }

  const s = data.summary;
  const code = s.currencyCode;

  return (
    <div className="space-y-4" data-testid="billing-dashboard">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div>
          <h3 className="font-semibold text-lg">Billing health</h3>
          <p className="text-sm text-muted-foreground">
            Across {s.linkedCustomers} linked customer{s.linkedCustomers === 1 ? "" : "s"}
            {data.generatedAt ? ` · updated ${formatDistanceToNow(new Date(data.generatedAt), { addSuffix: true })}` : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()} disabled={isFetching} data-testid="button-billing-dashboard-refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {data.partial && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm" data-testid="billing-dashboard-partial">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <span>
            Showing partial data — {s.customersFailed} of {s.linkedCustomers} customer{s.customersFailed === 1 ? "" : "s"} couldn't be loaded from WHMCS and were skipped. Totals below cover the {s.customersLoaded} that loaded.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <BillingSummaryCard icon={Users} label="Linked customers" value={String(s.linkedCustomers)} hint={`${s.customersLoaded} loaded`} testid="card-billing-linked" />
        <BillingSummaryCard icon={Wallet} label="Total outstanding" value={formatDashboardMoney(s.totalOutstanding, code)} hint={`${s.unpaidInvoiceCount} unpaid invoice${s.unpaidInvoiceCount === 1 ? "" : "s"}`} tone={s.totalOutstanding > 0 ? "danger" : "default"} testid="card-billing-outstanding" />
        <BillingSummaryCard icon={AlertTriangle} label="Overdue" value={formatDashboardMoney(s.overdueAmount, code)} hint={`${s.overdueInvoiceCount} overdue invoice${s.overdueInvoiceCount === 1 ? "" : "s"}`} tone={s.overdueAmount > 0 ? "danger" : "default"} testid="card-billing-overdue" />
        <BillingSummaryCard icon={Server} label="Active services" value={String(s.activeServices)} hint="across linked customers" tone="success" testid="card-billing-active-services" />
        <BillingSummaryCard icon={ServerCog} label="Suspended services" value={String(s.suspendedServices)} hint="across linked customers" tone={s.suspendedServices > 0 ? "danger" : "default"} testid="card-billing-suspended-services" />
        <BillingSummaryCard icon={TrendingUp} label="Est. monthly revenue" value={formatDashboardMoney(s.estimatedMrr, code)} hint="from active services" tone="success" testid="card-billing-mrr" />
      </div>

      <section className="rounded-xl border border-card-border bg-card overflow-hidden mt-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-3" data-testid="heading-billing-owing">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <Wallet className="h-[18px] w-[18px]" />
            </span>
            Customers with balances
          </h2>
        </div>
        {data.customers.length === 0 ? (
          <div className="px-5 py-8 text-center" data-testid="billing-dashboard-no-owing">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500 opacity-50" />
            <p className="text-sm text-muted-foreground">No outstanding balances. Every linked customer is paid up.</p>
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-border -mt-[1px]">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="px-5">Customer</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Overdue</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead className="w-10 pr-5" />
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border">
                {data.customers.map((c) => (
                  <TableRow
                    key={c.userId}
                    className="cursor-pointer hover-elevate tap-interactive border-0"
                    onClick={() => goToCustomer(c.userId)}
                    data-testid={`row-billing-customer-${c.userId}`}
                  >
                    <TableCell className="px-5 py-3.5">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate" data-testid={`text-billing-customer-name-${c.userId}`}>{c.name}</p>
                        {c.status && <p className="text-xs text-muted-foreground truncate">WHMCS: {c.status}</p>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold py-3.5" data-testid={`text-billing-customer-outstanding-${c.userId}`}>
                      {formatDashboardMoney(c.outstanding, c.currencyCode ?? code)}
                    </TableCell>
                    <TableCell className="text-right hidden sm:table-cell py-3.5">
                      {c.overdue > 0 ? (
                        <span className="text-destructive font-medium" data-testid={`text-billing-customer-overdue-${c.userId}`}>
                          {formatDashboardMoney(c.overdue, c.currencyCode ?? code)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right py-3.5">
                      <Badge variant="outline" className={c.overdueCount > 0 ? "bg-destructive/15 text-destructive border-destructive/30" : "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"}>
                        {c.unpaidCount}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-5 py-3.5">
                      <ChevronRight className="w-4 h-4 text-muted-foreground inline" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

function WhmcsTab() {
  const { toast } = useToast();
  const [baseUrl, setBaseUrl] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [autoMatchByEmail, setAutoMatchByEmail] = useState(true);
  const [adminUsername, setAdminUsername] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; hint?: string } | null>(null);

  const { data: settings, isLoading } = useQuery<{ baseUrl: string; enabled: boolean; autoMatchByEmail: boolean; adminUsername: string; hasCredentials: boolean; configured: boolean }>({
    queryKey: ["/api/admin/whmcs-settings"],
  });

  useEffect(() => {
    if (settings) {
      setBaseUrl(settings.baseUrl || "");
      setEnabled(!!settings.enabled);
      setAutoMatchByEmail(settings.autoMatchByEmail !== false);
      setAdminUsername(settings.adminUsername || "");
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (data: { baseUrl: string; enabled: boolean; autoMatchByEmail: boolean; adminUsername: string }) => {
      const res = await apiRequest("PATCH", "/api/admin/whmcs-settings", data);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to save settings");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/whmcs-settings"] });
      toast({ title: "WHMCS settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSave = () => {
    saveMutation.mutate({ baseUrl: baseUrl.trim(), enabled, autoMatchByEmail, adminUsername: adminUsername.trim() });
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/whmcs-settings/test", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (res.ok && data.ok) {
        const msg = typeof data.totalClients === "number"
          ? `Connected. WHMCS reports ${data.totalClients} client${data.totalClients === 1 ? "" : "s"}.`
          : "Connected successfully.";
        setTestResult({ ok: true, message: msg });
        toast({ title: "WHMCS connection OK" });
      } else {
        setTestResult({ ok: false, message: data.error || "Connection failed", hint: data.hint });
        toast({ title: "Connection failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message });
      toast({ title: "Connection failed", description: e.message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-40 w-full rounded-xl" /></div>;

  const hasCredentials = !!settings?.hasCredentials;

  return (
    <div className="space-y-4 max-w-3xl">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-500/10 text-slate-600 dark:text-slate-400">
              <CreditCard className="h-[18px] w-[18px]" />
            </span>
            WHMCS Billing
          </h2>
        </div>
        <div className="p-5 space-y-5">
          <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${hasCredentials ? "border-green-500/40 bg-green-500/5 text-green-700 dark:text-green-300" : "border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-200"}`} data-testid="status-whmcs-credentials">
            {hasCredentials ? (
              <><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> <span>API credentials detected.</span></>
            ) : (
              <><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>API credentials are not set. Add <code>WHMCS_API_IDENTIFIER</code> and <code>WHMCS_API_SECRET</code> in Secrets to enable the connection.</span></>
            )}
          </div>

          <div>
            <Label htmlFor="whmcs-base-url">WHMCS base URL</Label>
            <Input
              id="whmcs-base-url"
              type="text"
              placeholder="https://billing.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              data-testid="input-whmcs-base-url"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The root URL of your WHMCS install (without the trailing <code>/includes/api.php</code>). The API identifier and secret are stored as server secrets, not here.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Enable WHMCS integration</p>
              <p className="text-xs text-muted-foreground">
                When off, no WHMCS lookups run and the billing panel on customer profiles stays hidden.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-whmcs-enabled" />
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Auto-match customers by email</p>
              <p className="text-xs text-muted-foreground">
                Suggest and link a WHMCS client automatically when its email exactly matches a ServiceHub user.
              </p>
            </div>
            <Switch checked={autoMatchByEmail} onCheckedChange={setAutoMatchByEmail} data-testid="switch-whmcs-auto-match" />
          </div>

          <div>
            <Label htmlFor="whmcs-admin-username">WHMCS admin username (for ticket replies)</Label>
            <Input
              id="whmcs-admin-username"
              type="text"
              placeholder="support"
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
              data-testid="input-whmcs-admin-username"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The WHMCS staff username replies are posted under when an admin answers a customer's billing ticket from here. Leave blank to disable replying to WHMCS tickets from the admin portal.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-whmcs">
              {saveMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing || !hasCredentials || !baseUrl.trim()}
              data-testid="button-test-whmcs"
            >
              {testing ? "Testing..." : "Test Connection"}
            </Button>
          </div>

          {testResult && (
            <div className={`rounded-md border p-3 text-sm ${testResult.ok ? "border-green-500/40 bg-green-500/5" : "border-red-500/40 bg-red-500/5"}`} data-testid="text-whmcs-test-result">
              <p className={testResult.ok ? "text-green-600" : "text-red-600"}>{testResult.message}</p>
              {testResult.hint && <p className="text-xs text-muted-foreground mt-1">{testResult.hint}</p>}
            </div>
          )}

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">How linking works:</p>
            <p>Open a customer under <strong>Users</strong> to link them to a WHMCS client — automatically by matching email, or manually by searching.</p>
            <p className="mt-2">This is the foundation for upcoming billing features.</p>
          </div>
        </div>
      </section>

      <StoreProductsSection />
      <WhmcsProductMappingSection />
      <WhmcsProductDnsSection />
    </div>
  );
}

function WhmcsCustomerPanel({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<WhmcsClientSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [autoMatchError, setAutoMatchError] = useState<string | null>(null);
  const autoFiredRef = useRef(false);

  const { data, isLoading } = useQuery<WhmcsPanelData>({
    queryKey: ["/api/admin/users", userId, "whmcs"],
    ...liveQueryOptions,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "whmcs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
  };

  const linkMutation = useMutation({
    mutationFn: async (clientId: number) => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/whmcs/link`, { clientId });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to link");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setSearchResults(null);
      setSearchQ("");
      toast({ title: "Linked to WHMCS client" });
    },
    onError: (e: Error) => toast({ title: "Link failed", description: e.message, variant: "destructive" }),
  });

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/admin/users/${userId}/whmcs/link`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to unlink");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Unlinked from WHMCS" });
    },
    onError: (e: Error) => toast({ title: "Unlink failed", description: e.message, variant: "destructive" }),
  });

  const autoMatchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/whmcs/auto-match`, {});
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Auto-match failed");
      }
      return res.json();
    },
    onSuccess: (result: { matched?: boolean }) => {
      invalidate();
      if (result?.matched) toast({ title: "Auto-linked by email" });
    },
    onError: (e: Error) => setAutoMatchError(e.message),
  });

  // The panel GET is pure — it never persists. When the server returns a
  // suggestion (unambiguous email match, nothing linked yet) the frontend
  // fires the auto-match POST exactly once to perform the link.
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (data && !data.link && data.suggestion) {
      autoFiredRef.current = true;
      autoMatchMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleSearch = async () => {
    const q = searchQ.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/whmcs/clients/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
      const body = await res.json();
      if (res.ok && body.ok) setSearchResults(body.clients || []);
      else toast({ title: "Search failed", description: body.error || "Unknown error", variant: "destructive" });
    } catch (e: any) {
      toast({ title: "Search failed", description: e.message, variant: "destructive" });
    } finally {
      setSearching(false);
    }
  };

  if (isLoading) return null;
  if (!data || !data.configured || !data.enabled) return null;

  const link = data.link;
  const linkedClient = data.linkedClient;

  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden" data-testid="panel-whmcs">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-500/10 text-slate-600 dark:text-slate-400">
            <CreditCard className="h-[18px] w-[18px]" />
          </span>
          Billing (WHMCS)
        </h2>
      </div>
      <div className="p-5 space-y-4">
        {link ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-4 border rounded-md">
            <div className="min-w-0 text-sm" data-testid="text-whmcs-linked-client">
              {linkedClient ? (
                <>
                  <p className="font-medium truncate flex items-center gap-2">
                    {linkedClient.fullName}
                    {linkedClient.status && (
                      <Badge variant="outline" className="h-5 px-1.5 text-xs">{linkedClient.status}</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {linkedClient.email || "no email"} <span className="opacity-70">· WHMCS client #{link.whmcsClientId}</span>
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">WHMCS client #{link.whmcsClientId}</p>
                  <p className="text-xs text-muted-foreground mt-1">Details unavailable — WHMCS could not be reached.</p>
                </>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1 shrink-0 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20"
              onClick={() => unlinkMutation.mutate()}
              disabled={unlinkMutation.isPending}
              data-testid="button-whmcs-unlink"
            >
              <Unlink className="w-3 h-3" />
              {unlinkMutation.isPending ? "Unlinking..." : "Unlink"}
            </Button>
          </div>
        ) : null}

        {link && <WhmcsBillingSection userId={userId} />}
        {link && <WhmcsDerivedServicesSection userId={userId} />}
        {link && <WhmcsServiceAlertsSection userId={userId} />}
        {link && <WhmcsTicketsSection userId={userId} />}

        {!link && (
          <div className="p-4 border rounded-md space-y-4">
            {autoMatchMutation.isPending ? (
              <p className="text-sm text-muted-foreground" data-testid="text-whmcs-matching">Matching by email…</p>
            ) : autoMatchError ? (
              <p className="text-sm text-amber-600" data-testid="text-whmcs-automatch-error">{autoMatchError}</p>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="text-whmcs-not-linked">Not linked to a WHMCS client. Link an account to sync services and billing.</p>
            )}

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-8 h-9"
                  placeholder="Search WHMCS clients by name or email…"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSearch(); } }}
                  data-testid="input-whmcs-search"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 text-xs"
                onClick={handleSearch}
                disabled={searching || !searchQ.trim()}
                data-testid="button-whmcs-search"
              >
                {searching ? "Searching..." : "Search"}
              </Button>
            </div>

            {searchResults && (
              searchResults.length === 0 ? (
                <p className="text-xs text-muted-foreground" data-testid="text-whmcs-no-results">No matching WHMCS clients.</p>
              ) : (
                <div className="border rounded-md divide-y divide-border max-h-56 overflow-y-auto">
                  {searchResults.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/50" data-testid={`row-whmcs-client-${c.id}`}>
                      <div className="min-w-0 text-sm">
                        <p className="font-medium truncate">{c.fullName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.email || "no email"} <span className="opacity-70">· #{c.id}</span></p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs gap-1 shrink-0"
                        onClick={() => linkMutation.mutate(c.id)}
                        disabled={linkMutation.isPending}
                        data-testid={`button-whmcs-link-${c.id}`}
                      >
                        <Link2 className="w-3 h-3" /> Link
                      </Button>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function WhmcsBillingSection({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery<BillingSummary>({
    queryKey: ["/api/admin/users", userId, "whmcs", "billing"],
    ...liveQueryOptions,
  });

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden" data-testid="panel-whmcs-billing">
      <BillingSummaryView data={data} isLoading={isLoading} context="admin" userId={userId} />
    </div>
  );
}

interface DerivedServicesPayload {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  unreachable: boolean;
  services: Service[];
}

function serviceStatusBadgeClass(status: string): string {
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

// Admin view: the monitored services derived from a linked customer's active
// WHMCS products. Degrades quietly when WHMCS is unreachable or nothing maps.
function WhmcsDerivedServicesSection({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery<DerivedServicesPayload>({
    queryKey: ["/api/admin/users", userId, "whmcs", "derived-services"],
    ...liveQueryOptions,
  });

  if (isLoading) {
    return <div className="rounded-xl border border-card-border bg-card p-5"><Skeleton className="h-16 w-full" /></div>;
  }
  if (!data || !data.linked) return null;

  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden" data-testid="panel-whmcs-derived-services">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Server className="h-[18px] w-[18px]" />
          </span>
          Monitored services (from products)
        </h2>
      </div>
      <div className="p-5">
        {data.unreachable ? (
          <p className="text-sm text-muted-foreground" data-testid="text-derived-unreachable">Couldn't reach WHMCS to derive services.</p>
        ) : data.services.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-derived-empty">No services map to this customer's active products.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5" data-testid="list-derived-services">
            {data.services.map((s) => (
              <Badge key={s.id} variant="outline" className={`h-6 px-2 text-xs gap-1.5 ${serviceStatusBadgeClass(s.status)}`} data-testid={`badge-derived-service-${s.id}`}>
                {s.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

interface WhmcsServiceAlert {
  id: string;
  type: "whmcs_service_ready" | "whmcs_service_added" | string;
  title: string;
  body: string;
  serviceId: string | null;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
}

// Admin read-only audit: the new-service alerts this customer was sent — both
// the store "ready" path and the direct-WHMCS "added" path — so support can
// answer "did this customer get notified, and when?" without digging in the DB.
// Includes read/dismissed rows; live-refetches with the rest of the panel.
function WhmcsServiceAlertsSection({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery<{ alerts: WhmcsServiceAlert[] }>({
    queryKey: ["/api/admin/users", userId, "whmcs", "service-alerts"],
    ...liveQueryOptions,
  });

  if (isLoading) {
    return <div className="rounded-xl border border-card-border bg-card p-5"><Skeleton className="h-16 w-full" /></div>;
  }

  const alerts = data?.alerts ?? [];

  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden" data-testid="panel-whmcs-service-alerts">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Bell className="h-[18px] w-[18px]" />
          </span>
          New-service alerts sent
        </h2>
      </div>
      {alerts.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <Bell className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground" data-testid="text-service-alerts-empty">
            No new-service alerts have been sent to this customer.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border" data-testid="list-whmcs-service-alerts">
          {alerts.map((a) => {
            const added = a.type === "whmcs_service_added";
            const when = new Date(a.createdAt);
            return (
              <div
                key={a.id}
                className="flex items-start gap-3 px-5 py-3.5 text-sm hover:bg-muted/30 transition-colors"
                data-testid={`row-service-alert-${a.id}`}
              >
                <div className="mt-0.5 shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium truncate">{a.title}</span>
                    <Badge variant="outline" className="h-5 px-1.5 text-xs">
                      {added ? "Added" : "Ready"}
                    </Badge>
                    {a.dismissedAt ? (
                      <Badge variant="outline" className="h-5 px-1.5 text-xs text-muted-foreground">Dismissed</Badge>
                    ) : a.readAt ? (
                      <Badge variant="outline" className="h-5 px-1.5 text-xs text-muted-foreground">Read</Badge>
                    ) : (
                      <Badge variant="outline" className="h-5 px-1.5 text-xs">Unread</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{a.body}</p>
                  <p
                    className="text-xs text-muted-foreground mt-1"
                    title={when.toLocaleString()}
                    data-testid={`text-service-alert-when-${a.id}`}
                  >
                    {formatDistanceToNow(when, { addSuffix: true })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// Admin view of a linked customer's WHMCS support tickets. Read-on-demand
// mirror (never stored). Selecting a ticket opens its thread inline; staff
// replies post back to WHMCS under the configured admin username.
function WhmcsTicketsSection({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<WhmcsTicketsListData>({
    queryKey: ["/api/admin/users", userId, "whmcs", "tickets"],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const { data: detail, isLoading: detailLoading, isError: detailError } = useQuery<{ ticket: WhmcsTicketDetail }>({
    queryKey: ["/api/admin/users", userId, "whmcs", "tickets", selectedId],
    enabled: selectedId !== null,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const replyMutation = useMutation({
    mutationFn: async ({ message, files }: { message: string; files: File[] }) => {
      const form = new FormData();
      form.append("message", message);
      for (const f of files) form.append("attachments", f);
      const res = await uploadRequest("POST", `/api/admin/users/${userId}/whmcs/tickets/${selectedId}/reply`, form);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Failed to send reply (${res.status})`);
      }
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "whmcs", "tickets", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "whmcs", "tickets"] });
      toast({ title: "Reply sent to WHMCS" });
    },
    onError: (e: Error) => toast({ title: "Couldn't send reply", description: e.message, variant: "destructive" }),
  });

  const buildAttachmentUrl = (a: WhmcsAttachment) =>
    `/api/admin/users/${userId}/whmcs/tickets/${selectedId}/attachments?type=${encodeURIComponent(
      a.type,
    )}&relatedid=${encodeURIComponent(String(a.relatedId))}&index=${encodeURIComponent(String(a.index))}`;

  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden" data-testid="panel-whmcs-tickets">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <LifeBuoy className="h-[18px] w-[18px]" />
          </span>
          Billing &amp; account support tickets
        </h2>
      </div>
      <div className="p-0">
        {selectedId === null ? (
          <div className="p-5">
             <WhmcsTicketList data={data} isLoading={isLoading} context="admin" onOpen={setSelectedId} />
          </div>
        ) : (
          <div className="p-5">
            <WhmcsTicketThread
              ticket={detail?.ticket}
              isLoading={detailLoading}
              isError={detailError}
              context="admin"
              onReply={(message, files) => replyMutation.mutate({ message, files })}
              replyPending={replyMutation.isPending}
              onBack={() => setSelectedId(null)}
              replyHint="Your reply posts to WHMCS as the configured support staff member."
              buildAttachmentUrl={buildAttachmentUrl}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function TelegramTab() {
  const { toast } = useToast();
  const [chatId, setChatId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [sendAlerts, setSendAlerts] = useState(true);
  const [sendServiceUpdates, setSendServiceUpdates] = useState(true);
  const [sendNews, setSendNews] = useState(true);
  const [testing, setTesting] = useState(false);

  const { data: settings, isLoading } = useQuery<{ chatId: string; enabled: boolean; sendAlerts: boolean; sendServiceUpdates: boolean; sendNews: boolean; hasToken: boolean }>({
    queryKey: ["/api/admin/telegram-settings"],
  });

  useEffect(() => {
    if (settings) {
      setChatId(settings.chatId || "");
      setEnabled(!!settings.enabled);
      setSendAlerts(settings.sendAlerts !== false);
      setSendServiceUpdates(settings.sendServiceUpdates !== false);
      setSendNews(settings.sendNews !== false);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (data: { chatId: string; enabled: boolean; sendAlerts: boolean; sendServiceUpdates: boolean; sendNews: boolean }) => {
      const res = await apiRequest("PATCH", "/api/admin/telegram-settings", data);
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/telegram-settings"] });
      toast({ title: "Telegram settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/admin/telegram-settings/test", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast({ title: "Test message sent", description: "Check your Telegram group." });
      } else {
        toast({ title: "Test failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Test failed", description: e.message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-40 w-full rounded-xl" /></div>;

  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden max-w-2xl">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Send className="h-[18px] w-[18px]" />
          </span>
          Telegram Notifications
        </h2>
      </div>
      <div className="p-5 space-y-6">
        <div className="rounded-md border p-3 text-sm space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Bot token:</span>
            {settings?.hasToken ? (
              <span className="text-green-600 font-medium">Configured</span>
            ) : (
              <span className="text-destructive font-medium">Missing</span>
            )}
          </div>
          {!settings?.hasToken && (
            <p className="text-xs text-muted-foreground">
              Ask the administrator to set the <code className="font-mono">TELEGRAM_BOT_TOKEN</code> secret.
              Create a bot via <strong>@BotFather</strong> on Telegram to get a token.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="telegram-chat-id">Telegram Chat ID</Label>
          <Input
            id="telegram-chat-id"
            placeholder="e.g. -1001234567890"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            data-testid="input-telegram-chat-id"
          />
          <p className="text-xs text-muted-foreground">
            Add your bot to the group, then use @RawDataBot or a similar helper bot to obtain the group's chat ID (usually a negative number for groups).
          </p>
        </div>

        <div className="flex items-center justify-between rounded-md border p-4">
          <div>
            <p className="text-sm font-medium">Enable Telegram notifications</p>
            <p className="text-xs text-muted-foreground mt-1">
              When enabled, alerts, service updates, and news are posted to the configured chat.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            data-testid="switch-telegram-enabled"
          />
        </div>

        <div className="rounded-md border p-4 space-y-3">
          <p className="text-sm font-medium">Send these event types</p>
          <div className="flex items-center gap-2">
            <Checkbox
              id="telegram-send-alerts"
              checked={sendAlerts}
              onCheckedChange={(v) => setSendAlerts(!!v)}
              data-testid="checkbox-telegram-send-alerts"
            />
            <Label htmlFor="telegram-send-alerts" className="text-sm font-normal cursor-pointer">
              Service alerts (created, updated, resolved)
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="telegram-send-service-updates"
              checked={sendServiceUpdates}
              onCheckedChange={(v) => setSendServiceUpdates(!!v)}
              data-testid="checkbox-telegram-send-service-updates"
            />
            <Label htmlFor="telegram-send-service-updates" className="text-sm font-normal cursor-pointer">
              Service updates
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="telegram-send-news"
              checked={sendNews}
              onCheckedChange={(v) => setSendNews(!!v)}
              data-testid="checkbox-telegram-send-news"
            />
            <Label htmlFor="telegram-send-news" className="text-sm font-normal cursor-pointer">
              News stories
            </Label>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => saveMutation.mutate({ chatId: chatId.trim(), enabled, sendAlerts, sendServiceUpdates, sendNews })}
            disabled={saveMutation.isPending}
            data-testid="button-save-telegram"
          >
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testing || !settings?.hasToken || !chatId.trim()}
            data-testid="button-test-telegram"
          >
            {testing ? "Sending..." : "Send Test Message"}
          </Button>
        </div>

        <div className="rounded-md bg-muted/50 p-4 text-xs text-muted-foreground space-y-1.5">
          <p className="font-medium text-foreground">What gets sent:</p>
          <p>🚨 Service alerts (created / updated / resolved) — with service name and impact</p>
          <p>📢 Service updates — with service name</p>
          <p>📰 News stories — title and preview</p>
          <p className="mt-2 text-[11px]">If Telegram fails or is disabled, your app notifications still send normally.</p>
        </div>
      </div>
    </section>
  );
}

type SupportAwayAdminPayload = {
  enabled: boolean;
  startAt: string | null;
  endAt: string | null;
  message: string;
  isActive: boolean;
  updatedAt: string;
};

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function SupportAwayTab() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [message, setMessage] = useState("");

  const { data: settings, isLoading } = useQuery<SupportAwayAdminPayload>({
    queryKey: ["/api/admin/support-away"],
  });

  const hydratedRef = useRef(false);
  useEffect(() => {
    if (settings && !hydratedRef.current) {
      setEnabled(!!settings.enabled);
      setStartAt(toLocalInput(settings.startAt));
      setEndAt(toLocalInput(settings.endAt));
      setMessage(settings.message);
      hydratedRef.current = true;
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (payload: { enabled: boolean; startAt: string | null; endAt: string | null; message: string }) => {
      const res = await apiRequest("PATCH", "/api/admin/support-away", payload);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/support-away"] });
      queryClient.invalidateQueries({ queryKey: ["/api/support-away/status"] });
      toast({ title: "Away message saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const turnOffMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/admin/support-away", { enabled: false });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/support-away"] });
      queryClient.invalidateQueries({ queryKey: ["/api/support-away/status"] });
      toast({ title: "Away message turned off" });
    },
    onError: (e: Error) => toast({ title: "Couldn't turn off", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-64 w-full rounded-xl" /></div>;

  const startDate = startAt ? new Date(startAt) : null;
  const endDate = endAt ? new Date(endAt) : null;
  const windowInvalid = enabled && (!startDate || !endDate || startDate.getTime() >= endDate.getTime());
  const messageInvalid = !message.trim();

  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden max-w-2xl">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400">
            <Clock className="h-[18px] w-[18px]" />
          </span>
          Support Away Message
          {settings?.isActive && (
            <Badge variant="default" className="ml-2 text-[10px] uppercase tracking-wider bg-orange-500 hover:bg-orange-500" data-testid="badge-away-status">
              Active now
            </Badge>
          )}
        </h2>
      </div>
      <div className="p-5 space-y-6">
        <div className="flex items-center justify-between rounded-md border p-4">
          <div className="pr-4">
            <p className="text-sm font-medium">Enable away message</p>
            <p className="text-xs text-muted-foreground mt-1">
              When enabled and inside the window, customers see a banner before opening a ticket, and new tickets get the away message as an auto-reply instead of the standard one.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-away-enabled" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="away-start">Start</Label>
            <Input
              id="away-start"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              data-testid="input-away-start"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="away-end">End</Label>
            <Input
              id="away-end"
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              data-testid="input-away-end"
            />
          </div>
        </div>
        {enabled && windowInvalid && (
          <p className="text-xs text-destructive" data-testid="text-away-window-error">
            Set a start and an end time, with the end after the start.
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="away-msg">Away message</Label>
          <Textarea
            id="away-msg"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={2000}
            rows={4}
            data-testid="textarea-away-message"
          />
          <p className="text-xs text-muted-foreground">
            Shown to customers as a banner before they open a ticket and posted as the auto-reply on any new ticket while active.
          </p>
          {messageInvalid && (
            <p className="text-xs text-destructive">Away message can't be empty.</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            onClick={() => saveMutation.mutate({
              enabled,
              startAt: fromLocalInput(startAt),
              endAt: fromLocalInput(endAt),
              message: message.trim(),
            })}
            disabled={saveMutation.isPending || windowInvalid || messageInvalid}
            data-testid="button-save-away"
          >
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
          {settings?.isActive && (
            <Button
              variant="outline"
              onClick={() => turnOffMutation.mutate()}
              disabled={turnOffMutation.isPending}
              data-testid="button-away-turn-off"
            >
              {turnOffMutation.isPending ? "Turning off..." : "Turn off now"}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

type BusinessHoursAdminPayload = {
  enabled: boolean;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  timezone: string;
  afterHoursMessage: string;
  isOpen: boolean;
  nextOpenAt: string | null;
};

const DAY_LABELS: { value: number; label: string; short: string }[] = [
  { value: 0, label: "Sunday", short: "Sun" },
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
];

function getSupportedTimezones(): string[] {
  try {
    const anyIntl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    if (typeof anyIntl.supportedValuesOf === "function") {
      return anyIntl.supportedValuesOf("timeZone");
    }
  } catch {}
  return [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Phoenix",
    "America/Anchorage",
    "Pacific/Honolulu",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Australia/Sydney",
  ];
}

function BusinessHoursTab() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]));
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [timezone, setTimezone] = useState("America/New_York");
  const [afterHoursMessage, setAfterHoursMessage] = useState("");

  const { data: settings, isLoading } = useQuery<BusinessHoursAdminPayload>({
    queryKey: ["/api/admin/business-hours"],
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (settings) {
      setEnabled(!!settings.enabled);
      setDays(new Set(settings.daysOfWeek));
      setStartTime(settings.startTime);
      setEndTime(settings.endTime);
      setTimezone(settings.timezone);
      setAfterHoursMessage(settings.afterHoursMessage);
    }
  }, [settings]);

  const timezones = useMemo(() => getSupportedTimezones(), []);

  const saveMutation = useMutation({
    mutationFn: async (payload: {
      enabled: boolean;
      daysOfWeek: number[];
      startTime: string;
      endTime: string;
      timezone: string;
      afterHoursMessage: string;
    }) => {
      const res = await apiRequest("PATCH", "/api/admin/business-hours", payload);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-hours"] });
      queryClient.invalidateQueries({ queryKey: ["/api/business-hours/status"] });
      toast({ title: "Business hours saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-64 w-full rounded-xl" /></div>;

  const toggleDay = (d: number) => {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  const startMin = (() => { const [h, m] = startTime.split(":").map(Number); return h * 60 + m; })();
  const endMin = (() => { const [h, m] = endTime.split(":").map(Number); return h * 60 + m; })();
  const hoursInvalid = startMin >= endMin;

  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden max-w-2xl">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Clock className="h-[18px] w-[18px]" />
          </span>
          Business Hours
          {settings?.enabled && (
            <Badge variant={settings.isOpen ? "default" : "secondary"} className="ml-2 text-[10px] uppercase tracking-wider" data-testid="badge-bh-status">
              {settings.isOpen ? "Currently open" : "Currently closed"}
            </Badge>
          )}
        </h2>
      </div>
      <div className="p-5 space-y-6">
        <div className="flex items-center justify-between rounded-md border p-4">
          <div className="pr-4">
            <p className="text-sm font-medium">Enable business hours</p>
            <p className="text-xs text-muted-foreground mt-1">
              When enabled, customers see an after-hours warning when opening or replying to tickets outside the configured hours.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            data-testid="switch-bh-enabled"
          />
        </div>

        <div className="rounded-md border p-4 space-y-3">
          <p className="text-sm font-medium">Business days</p>
          <div className="flex flex-wrap gap-4">
            {DAY_LABELS.map((d) => (
              <div key={d.value} className="flex items-center gap-2">
                <Checkbox
                  id={`bh-day-${d.value}`}
                  checked={days.has(d.value)}
                  onCheckedChange={() => toggleDay(d.value)}
                  data-testid={`checkbox-bh-day-${d.value}`}
                />
                <Label htmlFor={`bh-day-${d.value}`} className="text-sm font-normal cursor-pointer">
                  {d.short}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="bh-start">Open time</Label>
            <Input
              id="bh-start"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              data-testid="input-bh-start-time"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bh-end">Close time</Label>
            <Input
              id="bh-end"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              data-testid="input-bh-end-time"
            />
          </div>
        </div>
        {hoursInvalid && (
          <p className="text-xs text-destructive" data-testid="text-bh-hours-error">
            Open time must be earlier than close time. Hours that wrap past midnight aren't supported.
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="bh-tz">Timezone</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="bh-tz" data-testid="select-bh-timezone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {timezones.map((tz) => (
                <SelectItem key={tz} value={tz}>{tz}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bh-msg">After-hours message</Label>
          <Textarea
            id="bh-msg"
            value={afterHoursMessage}
            onChange={(e) => setAfterHoursMessage(e.target.value)}
            maxLength={2000}
            rows={4}
            data-testid="textarea-bh-message"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Customers see this in the warning popup and the in-ticket banner. The "we reopen ..." line is added automatically based on the next business day.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            onClick={() =>
              saveMutation.mutate({
                enabled,
                daysOfWeek: Array.from(days).sort((a, b) => a - b),
                startTime,
                endTime,
                timezone,
                afterHoursMessage: afterHoursMessage.trim(),
              })
            }
            disabled={saveMutation.isPending || hoursInvalid}
            data-testid="button-save-business-hours"
          >
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </section>
  );
}

interface OnlineUserRow {
  userId: string;
  fullName: string;
  username: string;
  role: string;
  tabs: number;
  connectedAt: string;
  lastActivityAt: string;
  idleSeconds: number;
  page: string | null;
}

function OnlineUsersTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { subscribe } = useGlobalSocket();
  const [, navigate] = useLocation();
  const [tick, setTick] = useState(0);
  const [composeFor, setComposeFor] = useState<OnlineUserRow | null>(null);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");

  const { data, isLoading, refetch } = useQuery<OnlineUserRow[]>({
    queryKey: ["/api/admin/online-users"],
    refetchInterval: 15000,
  });

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (!msg || msg.type !== "presence_changed") return;
        if (msg.status === "page" && typeof msg.userId === "string") {
          const nowIso = new Date().toISOString();
          const newPage: string | null = typeof msg.page === "string" ? msg.page : null;
          const prev = queryClient.getQueryData<OnlineUserRow[]>(["/api/admin/online-users"]);
          if (prev && prev.some((r) => r.userId === msg.userId)) {
            queryClient.setQueryData<OnlineUserRow[]>(
              ["/api/admin/online-users"],
              prev.map((r) =>
                r.userId === msg.userId
                  ? { ...r, page: newPage, lastActivityAt: nowIso, idleSeconds: 0 }
                  : r,
              ),
            );
          } else {
            refetch();
          }
          return;
        }
        refetch();
      } catch {}
    };
    return subscribe(listener);
  }, [refetch, subscribe]);

  const startMessage = useMutation({
    mutationFn: async ({ customerId, subject, body }: { customerId: string; subject: string; body: string }) => {
      const res = await apiRequest("POST", "/api/message-threads", { customerId, subject, body });
      return res.json() as Promise<{ thread: { id: string } }>;
    },
    onSuccess: (result) => {
      setComposeFor(null);
      setComposeSubject("");
      setComposeBody("");
      navigate(`/messages/${result.thread.id}`);
    },
    onError: (e: Error) => toast({ title: "Failed to send", description: e.message, variant: "destructive" }),
  });

  const formatIdle = (row: OnlineUserRow): string => {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(row.lastActivityAt).getTime()) / 1000));
    if (seconds < 30) return "active now";
    if (seconds < 60) return `idle ${seconds}s`;
    if (seconds < 3600) return `idle ${Math.floor(seconds / 60)}m`;
    return `idle ${Math.floor(seconds / 3600)}h`;
  };

  const roleBadge = (role: string) => {
    const map: Record<string, string> = {
      master_admin: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30",
      admin: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
      employee: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
      customer: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
    };
    return map[role] || "bg-muted text-muted-foreground border-border";
  };

  const rows = (data || []).filter(r => r.userId !== user?.id);
  void tick;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden max-w-4xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-3" data-testid="text-online-title">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Activity className="h-[18px] w-[18px]" />
              </span>
              Online Now
            </h2>
            <p className="text-xs text-muted-foreground mt-1 ml-[3.25rem]">
              {isLoading ? "Loading..." : `${rows.length} user${rows.length === 1 ? "" : "s"} currently connected`}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-online">
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
               <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                  <Skeleton className="w-9 h-9 rounded-full shrink-0" />
                  <div className="space-y-1.5 flex-1 max-w-48">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
               </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No other users are currently online.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.userId} className="flex items-center gap-3 px-5 py-3.5" data-testid={`row-online-${r.userId}`}>
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                    {r.fullName.charAt(0).toUpperCase()}
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-background" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate" data-testid={`text-online-name-${r.userId}`}>{r.fullName}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${roleBadge(r.role)}`} data-testid={`badge-online-role-${r.userId}`}>
                      {r.role.replace("_", " ")}
                    </span>
                    {r.tabs > 1 && (
                      <span className="text-[10px] text-muted-foreground" data-testid={`text-online-tabs-${r.userId}`}>{r.tabs} tabs</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    <span data-testid={`text-online-idle-${r.userId}`}>{formatIdle(r)}</span>
                    {r.page && (
                      <>
                        <span className="mx-1.5">•</span>
                        <span data-testid={`text-online-page-${r.userId}`}>{r.page}</span>
                      </>
                    )}
                  </div>
                </div>
                {r.role === "customer" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => { setComposeFor(r); setComposeSubject(""); setComposeBody(""); }}
                    data-testid={`button-message-${r.userId}`}
                  >
                    <Mail className="w-3.5 h-3.5 sm:mr-1" />
                    <span className="hidden sm:inline">Message</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={!!composeFor} onOpenChange={(open) => { if (!open) setComposeFor(null); }}>
        <DialogContent data-testid="dialog-online-message">
          <DialogHeader>
            <DialogTitle>Message {composeFor?.fullName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Subject"
              value={composeSubject}
              onChange={(e) => setComposeSubject(e.target.value)}
              data-testid="input-online-subject"
            />
            <Textarea
              placeholder="Type your message..."
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              rows={5}
              data-testid="textarea-online-body"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComposeFor(null)} data-testid="button-cancel-online-message">Cancel</Button>
            <Button
              onClick={() => composeFor && startMessage.mutate({ customerId: composeFor.userId, subject: composeSubject.trim(), body: composeBody.trim() })}
              disabled={startMessage.isPending || !composeSubject.trim() || !composeBody.trim()}
              data-testid="button-send-online-message"
            >
              {startMessage.isPending ? "Sending..." : "Send & Open"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminPortal() {
  const { user, isAdmin, isMasterAdmin, hasPermission } = useAuth();
  const [, navigate] = useLocation();
  // Subscribe to the live URL search string so the deep-link params
  // are recomputed on every URL change. This keeps /admin?tab=...&user=...
  // working across remounts (Fast Refresh, error-boundary resets, route
  // swaps that briefly unmount the portal) and makes browser back/forward
  // restore the right tab and dialog.
  const search = useSearch();
  const initialParams = useMemo(
    () => parseAdminPortalQuery(search ? `?${search}` : ""),
    [search],
  );

  // Ticket deep-link: redirect once whenever the URL carries ?ticket=.
  useEffect(() => {
    if (initialParams.ticket) {
      navigate(`/tickets/${initialParams.ticket}`);
    }
  }, [initialParams.ticket, navigate]);

  // Whether the current URL resolves to the tile menu (no section open).
  const isMenuView = computeInitialActiveSection({
    tabParam: initialParams.tab,
    hasDashboardView: hasPermission("dashboard.view"),
  }) === null;

  // Snapshot the shared scroll container before leaving the menu for a section.
  const captureMenuScroll = useCallback(() => {
    const el = document.getElementById(ADMIN_SCROLL_CONTAINER_ID);
    if (el) savedAdminMenuScroll = el.scrollTop;
  }, []);

  // Restore the captured offset once the menu view is shown again. A fresh
  // entry has no captured offset (null), so it stays at the top as before.
  useEffect(() => {
    if (isMenuView && savedAdminMenuScroll !== null) {
      const target = savedAdminMenuScroll;
      savedAdminMenuScroll = null;
      requestAnimationFrame(() => {
        const el = document.getElementById(ADMIN_SCROLL_CONTAINER_ID);
        if (el) el.scrollTop = target;
      });
    }
  }, [isMenuView]);

  // Drop any pending offset when the portal unmounts so navigating away and
  // back to /admin is treated as a fresh entry (top), not a back-navigation.
  useEffect(() => {
    return () => {
      savedAdminMenuScroll = null;
    };
  }, []);

  const { data: contentCounts } = useQuery<Record<string, number>>({
    queryKey: ["/api/content-notifications/counts"],
    refetchInterval: 15000,
    enabled: isAdmin,
  });

  const { data: chatUnreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/admin/chat/unread-count"],
    refetchInterval: 10000,
    enabled: isAdmin && hasPermission("admin_chat"),
  });

  const tileBadgeMap: Record<string, string> = {
    "users": "admin-users",
    "reports-requests": "admin-reports",
  };

  const goToSection = useCallback((section: string | null) => {
    if (!section) {
      navigate("/admin");
      return;
    }
    const sp = new URLSearchParams();
    sp.set("tab", section);
    navigate(`/admin?${sp.toString()}`);
  }, [navigate]);

  // Admins with dashboard.view auto-land on Overview. Without an
  // explicit sentinel, navigating to /admin would just bounce back to
  // Overview, leaving them no way to reach the tile menu. Always go
  // through the sentinel so this works for both permission states.
  const goToMenu = useCallback(() => {
    goToSection(ADMIN_MENU_SENTINEL);
  }, [goToSection]);

  // Every hook above must run unconditionally on every render. Only after
  // all hooks have been called do we gate on the resolved role — otherwise a
  // first render with the user still unknown (null) followed by a re-render
  // as admin would change the hook count and crash React with "Rendered more
  // hooks than during the previous render".
  if (!isAdmin) {
    return (
      <div className="text-center py-12" data-testid="text-admin-access-denied">
        <Shield className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-lg font-semibold">Access Denied</p>
        <p className="text-sm text-muted-foreground mt-1">You must be an admin to access this page</p>
      </div>
    );
  }

  // The active tab is derived directly from the URL so it survives
  // remounts and stays in lock-step with browser back/forward.
  // computeInitialActiveSection still falls back to "overview" once
  // dashboard.view permission resolves (no tab param + permission).
  const activeSection = computeInitialActiveSection({
    tabParam: initialParams.tab,
    hasDashboardView: hasPermission("dashboard.view"),
  });

  const allSections = [
    { key: "overview", label: "Overview", icon: LayoutDashboard, color: "text-primary", bg: "bg-primary/10", group: "operations" },
    { key: "users", label: "Users", icon: Users, color: "text-blue-500", bg: "bg-blue-500/10", group: "people" },
    { key: "services", label: "Services", icon: Server, color: "text-green-500", bg: "bg-green-500/10", group: "status" },
    { key: "alerts", label: "Alerts", icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10", group: "status" },
    { key: "news", label: "News", icon: Newspaper, color: "text-purple-500", bg: "bg-purple-500/10", group: "content" },
    { key: "messages", label: "Messages", icon: Mail, color: "text-rose-500", bg: "bg-rose-500/10", navigateTo: "/messages", group: "support" },
    { key: "quick-responses", label: "Quick Responses", icon: Zap, color: "text-orange-500", bg: "bg-orange-500/10", group: "support" },
    { key: "service-updates", label: "Service Updates", icon: RefreshCw, color: "text-teal-500", bg: "bg-teal-500/10", group: "status" },
    { key: "reports-requests", label: "Reports/Requests", icon: FileText, color: "text-cyan-500", bg: "bg-cyan-500/10", group: "support" },
    { key: "email-templates", label: "Email Templates", icon: MailOpen, color: "text-indigo-500", bg: "bg-indigo-500/10", group: "support" },
    { key: "notification-templates", label: "Notification Wording", icon: Bell, color: "text-amber-500", bg: "bg-amber-500/10", group: "support" },
    { key: "downloads", label: "Downloads", icon: Download, color: "text-emerald-500", bg: "bg-emerald-500/10", group: "content" },
    { key: "support-tickets", label: "Support Tickets", icon: LifeBuoy, color: "text-sky-500", bg: "bg-sky-500/10", navigateTo: "/tickets", group: "support" },
    { key: "admin-chat", label: "Admin Chat", icon: MessageSquare, color: "text-pink-500", bg: "bg-pink-500/10", group: "support" },
    { key: "chat-admin", label: "Chat Admin", icon: ShieldCheck, color: "text-violet-500", bg: "bg-violet-500/10", group: "community" },
    { key: "monitoring", label: "URL Monitoring", icon: Globe, color: "text-lime-500", bg: "bg-lime-500/10", group: "status" },
    { key: "logs", label: "Logs", icon: ScrollText, color: "text-slate-500", bg: "bg-slate-500/10", group: "system" },
    { key: "error-log", label: "Error Log", icon: Bug, color: "text-red-500", bg: "bg-red-500/10", group: "system" },
    { key: "telegram", label: "Telegram", icon: Send, color: "text-blue-400", bg: "bg-blue-400/10", group: "integrations" },
    { key: "discord", label: "Discord", icon: Hash, color: "text-indigo-400", bg: "bg-indigo-400/10", group: "integrations" },
    { key: "whmcs", label: "WHMCS Billing", icon: CreditCard, color: "text-emerald-400", bg: "bg-emerald-400/10", group: "integrations" },
    { key: "billing-dashboard", label: "Billing", icon: Wallet, color: "text-emerald-500", bg: "bg-emerald-500/10", group: "integrations" },
    { key: "business-hours", label: "Business Hours", icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10", group: "system" },
    { key: "support-away", label: "Support Away", icon: Clock, color: "text-orange-500", bg: "bg-orange-500/10", group: "support" },
    { key: "announcements", label: "Announcements", icon: Megaphone, color: "text-fuchsia-500", bg: "bg-fuchsia-500/10", group: "content" },
    { key: "knowledge-base", label: "Knowledge Base", icon: BookOpen, color: "text-indigo-500", bg: "bg-indigo-500/10", group: "content" },
    { key: "online-users", label: "Online Now", icon: Activity, color: "text-emerald-500", bg: "bg-emerald-500/10", adminOnly: true, group: "community" },
    { key: "admin-management", label: "Admin Management", icon: Crown, color: "text-yellow-500", bg: "bg-yellow-500/10", masterOnly: true, group: "people" },
    { key: "deploy", label: "Deploy", icon: Rocket, color: "text-cyan-500", bg: "bg-cyan-500/10", masterOnly: true, group: "system" },
    { key: "changelog", label: "Changelog", icon: FileText, color: "text-cyan-500", bg: "bg-cyan-500/10", masterOnly: true, group: "content" },
  ];

  const sections = allSections.filter(s => {
    if (s.masterOnly) return isMasterAdmin;
    if (s.adminOnly) return user?.role === "admin" || user?.role === "master_admin";
    const perm = TILE_PERM_MAP[s.key];
    return perm ? hasPermission(perm) : true;
  });

  const sectionGroups: { key: string; label: string }[] = [
    { key: "operations", label: "Dashboard" },
    { key: "support", label: "Customer Support" },
    { key: "status", label: "Status & Monitoring" },
    { key: "content", label: "Content" },
    { key: "community", label: "Community" },
    { key: "people", label: "People & Access" },
    { key: "integrations", label: "Integrations" },
    { key: "system", label: "System" },
  ];

  const canManageSection = (key: string) => {
    if (isMasterAdmin) return true;
    const perm = TILE_MANAGE_MAP[key];
    return perm ? hasPermission(perm) : false;
  };

  const renderContent = () => {
    switch (activeSection) {
      case "overview": return <AdminDashboard onNavigateSection={(k) => goToSection(k)} />;
      case "users": return <UsersTab canManage={canManageSection("users")} initialUserId={initialParams.user} />;
      case "services": return <ServicesTab canManage={canManageSection("services")} />;
      case "alerts": return <AlertsTab canManage={canManageSection("alerts")} />;
      case "news": return <NewsTab canManage={canManageSection("news")} />;
      case "quick-responses": return <QuickResponsesTab canManage={canManageSection("quick-responses")} />;
      case "service-updates": return <ServiceUpdatesTab canManage={canManageSection("service-updates")} />;
      case "reports-requests": return <ReportsRequestsTab canManage={canManageSection("reports-requests")} />;
      case "email-templates": return <EmailTemplatesTab canManage={canManageSection("email-templates")} />;
      case "notification-templates": return <NotificationTemplatesTab canManage={canManageSection("notification-templates")} />;
      case "downloads": return <DownloadsTab canManage={canManageSection("downloads")} />;
      case "admin-chat": return <AdminChatTab initialThreadId={initialParams.chat} />;
      case "chat-admin": return <ChatAdminTab />;
      case "monitoring": return <MonitoringTab canManage={canManageSection("monitoring")} initialMonitorId={initialParams.monitor} />;
      case "logs": return <LogsTab />;
      case "error-log": return <ErrorLogsTab />;
      case "telegram": return <TelegramTab />;
      case "discord": return <DiscordTab />;
      case "whmcs": return <WhmcsTab />;
      case "billing-dashboard": return <BillingDashboardTab />;
      case "business-hours": return <BusinessHoursTab />;
      case "support-away": return <SupportAwayTab />;
      case "announcements": return <AnnouncementsTab />;
      case "knowledge-base": return <KnowledgeBaseTab />;
      case "admin-management": return isMasterAdmin ? <AdminManagementTab initialInnerTab={initialParams.section} /> : null;
      case "deploy": return isMasterAdmin ? <DeployTab /> : null;
      case "changelog": return isMasterAdmin ? <ChangelogTab /> : null;
      case "online-users": return (user?.role === "admin" || user?.role === "master_admin") ? <OnlineUsersTab /> : null;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-admin-title">Admin Portal</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage users, services, alerts, news, and messages</p>
      </div>

      {!activeSection ? (
        <div className="grid gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-3" data-testid="admin-menu-grouped">
          {sectionGroups.map((g) => {
            const items = sections.filter((s) => s.group === g.key);
            if (items.length === 0) return null;
            return (
              <section key={g.key} data-testid={`menu-group-${g.key}`} className="rounded-xl border border-card-border bg-card overflow-hidden">
                <div className="px-5 py-4 border-b border-border bg-muted/20">
                  <h2 className="text-sm font-semibold tracking-tight">
                    {g.label}
                  </h2>
                </div>
                <ul className="divide-y divide-border">
                  {items.map((s) => {
                    const Icon = s.icon;
                    const badgeCategory = tileBadgeMap[s.key];
                    let badgeCount = badgeCategory && contentCounts ? (contentCounts[badgeCategory] ?? 0) : 0;
                    if (s.key === "admin-chat" && chatUnreadData) badgeCount = chatUnreadData.count;
                    return (
                      <li key={s.key}>
                        <button
                          onClick={() => {
                            captureMenuScroll();
                            if (s.navigateTo) navigate(s.navigateTo);
                            else goToSection(s.key);
                          }}
                          className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/50 active:bg-muted focus:outline-none tap-interactive"
                          data-testid={`tile-admin-${s.key}`}
                        >
                          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${s.bg} ${s.color} ring-1 ring-inset ring-current/10`}>
                            <Icon className="w-[18px] h-[18px]" />
                          </span>
                          <span className="flex-1 min-w-0 text-sm font-medium truncate">{s.label}</span>
                          {badgeCount > 0 && (
                            <Badge variant="destructive" className="shrink-0 text-[10px] h-5 min-w-5 flex items-center justify-center px-1" data-testid={`badge-tile-${s.key}`}>
                              {badgeCount}
                            </Badge>
                          )}
                          <ChevronRight aria-hidden="true" className="w-4 h-4 shrink-0 text-muted-foreground/50" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={goToMenu}
              className="gap-1 -ml-2 text-muted-foreground hover:text-foreground"
              data-testid="button-admin-back"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Admin Menu
            </Button>
            {activeSection === "overview" && (
              <Button
                variant="outline"
                size="sm"
                onClick={goToMenu}
                className="gap-1 ml-auto"
                data-testid="button-admin-open-menu"
              >
                <LayoutDashboard className="w-4 h-4" />
                All sections
              </Button>
            )}
          </div>
          {renderContent()}
        </div>
      )}
    </div>
  );
}

// Admin-editable release notes. master_admin only. See
// shared/changelog-rollover.ts for the model: a single always-open "rolling
// draft" (status "collecting") collects every note; when the version number
// changes and the app reboots, those notes are stamped with the new version
// (status "awaiting_publish"). Publishing — the gate that fires the
// "Welcome to version X" popup — is only available on an awaiting-publish
// entry, so it can only happen as part of a version change, never mid-version.
type ChangelogStatus = "collecting" | "awaiting_publish" | "published" | "draft";
type ChangelogRow = {
  version: string;
  title: string;
  bodyHtml: string;
  status: ChangelogStatus;
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

// The rolling draft renders without a real version number — show a friendly
// label instead of the sentinel string.
function changelogVersionLabel(row: { version: string; status: ChangelogStatus }): string {
  if (row.version === ROLLING_DRAFT_VERSION || row.status === "collecting") return "Next release";
  return `v${row.version}`;
}

function ChangelogTab() {
  const { toast } = useToast();
  const { data: rows, isLoading, isFetching, refetch } = useQuery<ChangelogRow[]>({
    queryKey: ["/api/admin/changelog"],
    // The bullet counter and editor body need to reflect any out-of-band
    // appends (e.g. agent calls to /append). The app-wide staleTime: Infinity
    // would otherwise serve a stale row indefinitely until a mutation
    // invalidated it.
    staleTime: 0,
    refetchOnMount: "always",
  });
  const [editing, setEditing] = useState<ChangelogRow | null>(null);
  const [previewing, setPreviewing] = useState<ChangelogRow | null>(null);
  const [confirmPublish, setConfirmPublish] = useState<ChangelogRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ChangelogRow | null>(null);
  const [filter, setFilter] = useState("");

  // The single open rolling draft — every append (agent or admin) lands here.
  const rollingDraft = useMemo(
    () => rows?.find((r) => r.status === "collecting") ?? null,
    [rows],
  );
  const rollingBulletCount = useMemo(
    () => (rollingDraft ? countBulletsInBody(rollingDraft.bodyHtml) : 0),
    [rollingDraft],
  );
  // Whether the current live version is staged and waiting on a Publish click.
  const pendingPublish = useMemo(
    () => rows?.find((r) => r.version === APP_VERSION && r.status === "awaiting_publish") ?? null,
    [rows],
  );

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        changelogVersionLabel(r).toLowerCase().includes(q) ||
        r.version.toLowerCase().includes(q) ||
        (r.title ?? "").toLowerCase().includes(q),
    );
  }, [rows, filter]);

  // The rolling draft and awaiting-publish entries are editable. Published
  // history is read-only — those entries are owned by the user.
  const isEditableRow = (r: ChangelogRow) =>
    r.status === "collecting" || r.status === "awaiting_publish" || r.status === "draft";
  // Publishing is only ever possible on a version-stamped awaiting-publish
  // entry (created when the version number changes). The rolling draft is
  // never directly publishable.
  const isPublishableRow = (r: ChangelogRow) =>
    r.status === "awaiting_publish" || r.status === "draft";
  // The rolling draft is recreated on boot, so it can't be deleted; published
  // history is permanent. Everything else (awaiting-publish) is deletable.
  const isDeletableRow = (r: ChangelogRow) =>
    r.status === "awaiting_publish" || r.status === "draft";

  const publishMutation = useMutation({
    mutationFn: async (version: string) => apiRequest("POST", `/api/admin/changelog/${version}/publish`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/changelog"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/changelog/pending-publish"] });
      setConfirmPublish(null);
      toast({ title: "Published", description: "Customers will see the popup the next time they open the app." });
    },
    onError: (e: any) => toast({ title: "Publish failed", description: e?.message ?? "", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (version: string) => apiRequest("DELETE", `/api/admin/changelog/${version}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/changelog"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/changelog/pending-publish"] });
      setConfirmDelete(null);
      toast({ title: "Entry deleted" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e?.message ?? "", variant: "destructive" }),
  });

  if (isLoading || !rows) {
    return <div className="space-y-4 max-w-3xl" data-testid="text-changelog-loading"><Skeleton className="h-64 w-full rounded-xl" /></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
              <FileText className="h-[18px] w-[18px]" />
            </span>
            Changelog
          </h2>
          <p className="text-xs text-muted-foreground mt-2 max-w-2xl">
            Notes collect in the <strong className="font-medium text-foreground">Next release</strong> draft as changes ship. When the version number changes, those
            notes get stamped with the new version and wait for you to click <strong className="font-medium text-foreground">Publish</strong> — the gate that fires the
            "Welcome to version X" popup for customers.
          </p>
        </div>
        <div className="p-5 space-y-5">
          {(pendingPublish || rollingDraft) && (
            <div className="space-y-3">
              {pendingPublish && (
                <div
                  className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                  data-testid="banner-changelog-pending-publish"
                >
                  <div>
                    <div className="font-medium text-sm text-amber-700 dark:text-amber-300">
                      v{APP_VERSION} is staged and ready to publish
                    </div>
                    <div className="text-xs mt-1 text-amber-700/80 dark:text-amber-300/80">
                      Proofread, then publish to fire the welcome popup for everyone.
                    </div>
                  </div>
                  <div className="flex gap-2 self-end sm:self-auto shrink-0">
                    <Button variant="outline" size="sm" onClick={() => setEditing(pendingPublish)} data-testid="button-changelog-edit-pending" className="bg-background">
                      <Edit className="w-4 h-4 mr-1.5" /> Edit
                    </Button>
                    <Button size="sm" onClick={() => setConfirmPublish(pendingPublish)} data-testid="button-changelog-publish-pending" className="bg-amber-600 hover:bg-amber-700 text-white">
                      Publish v{APP_VERSION}
                    </Button>
                  </div>
                </div>
              )}

              {rollingDraft && (
                <div
                  className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                  data-testid="banner-changelog-rolling-draft"
                >
                  <div>
                    <div className="font-medium text-sm text-cyan-700 dark:text-cyan-300">
                      Collecting notes for the next release
                    </div>
                    <div className="text-xs mt-1 text-cyan-700/80 dark:text-cyan-300/80">
                      {rollingBulletCount} bullet{rollingBulletCount === 1 ? "" : "s"} so far · Updated {formatDistanceToNow(new Date(rollingDraft.updatedAt), { addSuffix: true })}.
                    </div>
                  </div>
                  <div className="flex gap-2 self-end sm:self-auto shrink-0">
                    <Button variant="outline" size="sm" onClick={() => setEditing(rollingDraft)} data-testid="button-changelog-edit-rolling" className="bg-background">
                      <Edit className="w-4 h-4 mr-1.5" /> Edit draft
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Filter by version or headline…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="pl-9 h-9"
                data-testid="input-changelog-filter"
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="text-xs text-muted-foreground" data-testid="text-changelog-count">
                {filteredRows.length} of {rows.length} entr{rows.length === 1 ? "y" : "ies"}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={async () => {
                  try {
                    if ("caches" in window) {
                      const keys = await caches.keys();
                      await Promise.all(
                        keys
                          .filter((k) => k.startsWith("servicehub-api-"))
                          .map(async (k) => {
                            const cache = await caches.open(k);
                            await cache.delete("/api/admin/changelog");
                          }),
                      );
                    }
                  } catch {}
                  await queryClient.invalidateQueries({ queryKey: ["/api/admin/changelog"] });
                  await refetch();
                  toast({ title: "Refreshed" });
                }}
                disabled={isFetching}
                data-testid="button-changelog-refresh"
                title="Re-fetch from server (bypasses PWA cache)"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-border overflow-hidden">
            <ul className="divide-y divide-border">
              {rows.length === 0 && (
                <li className="p-8 text-center">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
                  <p className="text-sm text-muted-foreground" data-testid="text-changelog-empty">No entries yet.</p>
                </li>
              )}
              {rows.length > 0 && filteredRows.length === 0 && (
                <li className="p-8 text-center text-sm text-muted-foreground" data-testid="text-changelog-no-match">
                  No entries match "{filter}".
                </li>
              )}
              {filteredRows.map((r) => {
                const editable = isEditableRow(r);
                const publishable = isPublishableRow(r);
                const deletable = isDeletableRow(r);
                const statusLabel =
                  r.status === "published" ? "Published"
                  : r.status === "collecting" ? "Collecting"
                  : r.status === "awaiting_publish" ? "Awaiting publish"
                  : "Draft";
                return (
                  <li key={r.version} className="p-4 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-muted/30 transition-colors" data-testid={`row-changelog-${r.version}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <span className="font-mono text-sm font-semibold" data-testid={`text-changelog-version-${r.version}`}>{changelogVersionLabel(r)}</span>
                        <Badge variant={r.status === "published" ? "default" : "secondary"} className={r.status !== "published" ? "font-normal" : ""} data-testid={`badge-changelog-status-${r.version}`}>
                          {statusLabel}
                        </Badge>
                        {r.status === "awaiting_publish" && r.version === APP_VERSION && (
                          <Badge variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-400 font-normal" data-testid={`badge-changelog-current-${r.version}`}>
                            Current version
                          </Badge>
                        )}
                        {!editable && (
                          <Badge variant="outline" className="text-muted-foreground font-normal border-border/50" data-testid={`badge-changelog-readonly-${r.version}`}>
                            Read-only
                          </Badge>
                        )}
                        {r.status === "published" && r.publishedAt && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(r.publishedAt), "MMM d, yyyy")}
                          </span>
                        )}
                      </div>
                      {r.title && <div className="text-sm font-medium truncate" data-testid={`text-changelog-title-${r.version}`}>{r.title}</div>}
                      <div className="text-xs text-muted-foreground mt-1">
                        Updated {formatDistanceToNow(new Date(r.updatedAt), { addSuffix: true })}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 self-start sm:self-auto shrink-0 mt-2 sm:mt-0">
                      {editable ? (
                        <>
                          <Button variant="outline" size="sm" className="h-8" onClick={() => setEditing(r)} data-testid={`button-changelog-edit-${r.version}`}>
                            <Edit className="w-3.5 h-3.5 mr-1.5" /> Edit
                          </Button>
                          <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setPreviewing(r)} title="Preview" data-testid={`button-changelog-preview-${r.version}`}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          {publishable && (
                            <Button variant="default" size="sm" className="h-8" onClick={() => setConfirmPublish(r)} data-testid={`button-changelog-publish-${r.version}`}>
                              Publish
                            </Button>
                          )}
                          {deletable && (
                            <Button variant="outline" size="sm" className="h-8 px-2 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20" onClick={() => setConfirmDelete(r)} title="Delete" data-testid={`button-changelog-delete-${r.version}`}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </>
                      ) : (
                        <Button variant="outline" size="sm" className="h-8" onClick={() => setPreviewing(r)} data-testid={`button-changelog-view-${r.version}`}>
                          <Eye className="w-3.5 h-3.5 mr-1.5" /> View
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>

      {editing && (
        <ChangelogEditor
          row={editing}
          onClose={() => setEditing(null)}
          onPreview={(draft) => setPreviewing(draft)}
        />
      )}

      {previewing && (
        <ChangelogPreviewDialog row={previewing} onClose={() => setPreviewing(null)} />
      )}

      <Dialog open={!!confirmPublish} onOpenChange={(o) => { if (!o) setConfirmPublish(null); }}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-confirm-publish">
          <DialogHeader>
            <DialogTitle>Publish v{confirmPublish?.version}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Publishing will start showing the welcome popup to every customer the next time they open the app. Continue?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPublish(null)}>Cancel</Button>
            <Button
              onClick={() => confirmPublish && publishMutation.mutate(confirmPublish.version)}
              disabled={publishMutation.isPending}
              data-testid="button-confirm-publish"
            >
              Publish now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-confirm-delete-changelog">
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete ? changelogVersionLabel(confirmDelete) : ""}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This cannot be undone. Published entries can't be deleted.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.version)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-changelog"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChangelogEditor({ row, onClose, onPreview }: { row: ChangelogRow; onClose: () => void; onPreview: (draft: ChangelogRow) => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(row.title);
  const [bodyHtml, setBodyHtml] = useState(row.bodyHtml);
  const [rawMode, setRawMode] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/admin/changelog/${row.version}`, { title, bodyHtml }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/changelog"] });
      queryClient.invalidateQueries({ queryKey: ["/api/changelog"] });
      toast({ title: "Saved" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message ?? "", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto p-0 gap-0" data-testid="dialog-changelog-editor">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            Edit {changelogVersionLabel(row)}
            <Badge variant={row.status === "published" ? "default" : "secondary"} className="font-normal text-[10px] uppercase tracking-wider">
              {row.status === "published" ? "Published"
                : row.status === "collecting" ? "Collecting"
                : row.status === "awaiting_publish" ? "Awaiting publish"
                : "Draft"}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="p-5 space-y-6">
          <div className="space-y-2">
            <Label htmlFor="cl-title">Headline (shown in the popup)</Label>
            <Input
              id="cl-title"
              placeholder="e.g. Smarter notifications & faster ticket replies"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-changelog-title"
            />
            <p className="text-xs text-muted-foreground">Optional. Falls back to "Welcome to version {row.version}" if empty.</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Body (appears on /whats-new)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setRawMode((v) => !v)}
                data-testid="button-changelog-raw-toggle"
              >
                {rawMode ? "Switch to Rich text" : "Switch to Raw HTML"}
              </Button>
            </div>
            {rawMode ? (
              <>
                <Textarea
                  value={bodyHtml}
                  onChange={(e) => setBodyHtml(e.target.value)}
                  rows={14}
                  className="font-mono text-xs"
                  placeholder="<h3>New</h3><ul><li>…</li></ul>"
                  data-testid="textarea-changelog-raw"
                />
                <p className="text-xs text-muted-foreground">
                  Paste raw HTML here (e.g. an exported body). Saved as-is after sanitization. {bodyHtml.length} chars.
                </p>
              </>
            ) : (
              <div className="rounded-md border bg-card">
                <RichTextEditor
                  value={bodyHtml}
                  onChange={setBodyHtml}
                  testIdPrefix="changelog-editor"
                  draftKey={`changelog:${row.version}`}
                />
              </div>
            )}
          </div>
          {row.status === "published" && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
              This entry is already published. Editing it here updates the What's New page immediately, but does NOT re-fire the popup for customers who already dismissed it.
            </div>
          )}
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2 px-5 py-4 border-t border-border bg-muted/20">
          <Button variant="outline" onClick={() => onPreview({ ...row, title, bodyHtml })} data-testid="button-changelog-preview-current" className="bg-background">
            <Eye className="w-4 h-4 mr-1.5" /> Preview
          </Button>
          <div className="flex-1 hidden sm:block" />
          <Button variant="outline" onClick={onClose} className="bg-background">Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-changelog-save">
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangelogPreviewDialog({ row, onClose }: { row: ChangelogRow; onClose: () => void }) {
  // Render exactly what the customer popup + /whats-new entry will look like.
  // Reads from the in-memory row so unsaved edits in the editor preview correctly.
  const sanitized = useMemo(
    () => DOMPurify.sanitize(row.bodyHtml, { ADD_ATTR: ["id"] }),
    [row.bodyHtml],
  );
  const isRolling = row.version === ROLLING_DRAFT_VERSION || row.status === "collecting";
  // The rolling draft has no real version number yet — preview it generically.
  const popupVersion = isRolling ? "the next release" : row.version;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto p-0 gap-0" data-testid="dialog-changelog-preview">
        <DialogHeader className="px-5 py-4 border-b border-border bg-muted/20">
          <DialogTitle>Preview {changelogVersionLabel(row)}</DialogTitle>
        </DialogHeader>

        <div className="p-6 space-y-10">
          <section>
            <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-4 text-center">Welcome popup preview</div>
            <div className="rounded-xl border border-card-border bg-card shadow-sm p-6 sm:p-8 max-w-sm mx-auto text-center" data-testid="preview-changelog-popup">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 ring-8 ring-primary/5">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <div className="text-xl font-bold tracking-tight">Welcome to version {popupVersion}</div>
              <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
                {row.title?.trim() || `What\u2019s new in ${popupVersion}`}
              </p>
            </div>
          </section>

          <section>
            <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-4 text-center">What's New entry preview</div>
            <article className="rounded-xl border border-card-border bg-card shadow-sm p-6 sm:p-8 max-w-2xl mx-auto" data-testid="preview-changelog-entry">
              <h2 className="text-2xl font-bold tracking-tight">{isRolling ? "Next release" : `Version ${row.version}`}</h2>
              {row.title && <p className="text-base text-muted-foreground mt-2">{row.title}</p>}
              <div className="mt-6 border-t border-border pt-6">
                <div
                  className="prose prose-sm max-w-none dark:prose-invert"
                  dangerouslySetInnerHTML={{ __html: sanitized }}
                />
              </div>
            </article>
          </section>
        </div>

        <DialogFooter className="px-5 py-4 border-t border-border">
          <Button onClick={onClose} variant="outline">Close preview</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
