import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import {
  parseTicketFiltersFromSearch,
  buildTicketFilterSearch,
  applyTicketFilters,
  filtersAreActive,
  DEFAULT_TICKET_FILTERS,
  type TicketFilters,
} from "@shared/ticket-filters";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce";
import type { KbArticle } from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useIsMobile } from "@/hooks/use-mobile";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Ticket, Clock, ChevronRight, MessageSquare, Trash2, Tag, AlertTriangle, BookOpen, Filter, X, CreditCard, CheckCircle2 } from "lucide-react";
import { WhmcsTicketList, type WhmcsTicketsListData } from "@/components/whmcs-tickets";
import { useWhmcsSeenMap } from "@/lib/whmcs-unread";
import { countNewReplies, newReplyTicketIds } from "@shared/whmcs-unread";
import { queryClient, apiRequest, uploadRequest } from "@/lib/queryClient";
import { QueryErrorState } from "@/components/query-error-state";
import { serverActionErrorMessage } from "@/lib/server-error";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import type { Ticket as TicketType, Service, TicketCategory } from "@shared/schema";

type AdminTicket = TicketType & { claimedByName?: string | null };

function SectionIcon({ icon: Icon, tone }: { icon: typeof MessageSquare; tone: string }) {
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${tone}`}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

function RowSkeletons({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          <Skeleton className="h-4 w-4 rounded shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

type SupportAwayPublicStatus = {
  enabled: boolean;
  isActive: boolean;
  startAt: string | null;
  endAt: string | null;
  message: string;
};

function SupportAwayBanner() {
  const { data } = useQuery<SupportAwayPublicStatus>({
    queryKey: ["/api/support-away/status"],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  if (!data?.isActive) return null;
  return (
    <div
      className="mb-3 rounded-md border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/40 p-3 flex gap-2 items-start"
      data-testid="banner-support-away"
    >
      <AlertTriangle className="w-4 h-4 text-orange-600 dark:text-orange-400 mt-0.5 flex-shrink-0" />
      <div className="text-xs text-orange-900 dark:text-orange-100 space-y-1">
        <p className="font-medium">Our support team is away</p>
        <p data-testid="text-away-message">{data.message}</p>
        <p className="text-orange-800/80 dark:text-orange-200/80">
          You can still open the ticket — we'll respond as soon as we're back.
        </p>
      </div>
    </div>
  );
}

const createTicketSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  description: z.string().min(1, "Description is required"),
  serviceId: z.string().optional(),
  categoryId: z.string().optional(),
  priority: z.string().default("medium"),
});

function PriorityBadge({ priority }: { priority: string }) {
  const variants: Record<string, string> = {
    high: "bg-status-busy/15 text-status-busy",
    medium: "bg-primary/15 text-primary",
    low: "bg-muted text-muted-foreground",
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${variants[priority] || "bg-muted text-muted-foreground"}`}>{priority}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    open: "bg-status-online/15 text-status-online",
    closed: "bg-muted text-muted-foreground",
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${variants[status] || "bg-muted text-muted-foreground"}`}>{status}</span>;
}

type BusinessHoursStatus = {
  enabled: boolean;
  isOpen: boolean;
  message: string;
  timezone: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  nextOpenAt: string | null;
};

function formatNextOpen(iso: string | null, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const safeTz = (() => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "UTC"; }
  })();
  const dateInTz = formatInTimeZone(d, safeTz, "yyyy-MM-dd");
  const todayInTz = formatInTimeZone(new Date(), safeTz, "yyyy-MM-dd");
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowInTz = formatInTimeZone(tomorrow, safeTz, "yyyy-MM-dd");
  const time = formatInTimeZone(d, safeTz, "h:mm a");
  if (dateInTz === todayInTz) return `today at ${time}`;
  if (dateInTz === tomorrowInTz) return `tomorrow at ${time}`;
  return `${formatInTimeZone(d, safeTz, "EEEE")} at ${time}`;
}

function SubjectKbSuggestions({ subject }: { subject: string }) {
  const debounced = useDebounce(subject.trim(), 300);
  const enabled = debounced.length >= 3;
  const { data: results = [] } = useQuery<KbArticle[]>({
    queryKey: ["/api/kb/articles", { search: debounced, limit: 3 }],
    enabled,
    queryFn: async () => {
      const res = await fetch(`/api/kb/articles?search=${encodeURIComponent(debounced)}&limit=3`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  if (!enabled || results.length === 0) return null;
  return (
    <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3" data-testid="kb-subject-suggestions">
      <div className="flex items-center gap-2 text-primary font-medium text-sm">
        <BookOpen className="w-4 h-4" />
        These articles might solve your issue instantly
      </div>
      <div className="grid gap-2">
        {results.slice(0, 3).map((a) => (
          <a
            key={a.id}
            href={`/knowledge/${a.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-lg border border-primary/10 bg-background px-4 py-3 hover-elevate tap-interactive"
            data-testid={`link-kb-suggestion-${a.id}`}
          >
            <span className="text-sm font-medium truncate">{a.title}</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </a>
        ))}
      </div>
    </div>
  );
}

export default function TicketsPage() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const [dialogOpen, setDialogOpen] = useState(false);
  // Fresh after-hours status captured at the moment "New Ticket" is clicked, so
  // the inline notice inside the flow can't show stale. null = within hours (or
  // status disabled / fetch failed → fail open).
  const [afterHoursNotice, setAfterHoursNotice] = useState<BusinessHoursStatus | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);

  // Warm the business-hours cache in the background so the first "New Ticket"
  // click resolves instantly; the click still refetches to gate reliably.
  useQuery<BusinessHoursStatus>({
    queryKey: ["/api/business-hours/status"],
    enabled: !isAdmin,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: tickets, isLoading, isError: ticketsError, error: ticketsErrorObj, refetch: refetchTickets, isFetching: ticketsFetching } = useQuery<AdminTicket[]>({
    queryKey: ["/api/tickets"],
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const { data: categories } = useQuery<TicketCategory[]>({
    queryKey: ["/api/ticket-categories"],
  });

  // Billing & account support tickets mirrored from WHMCS — customer self-view
  // only. Refreshes on view / window focus (no WebSocket). The component
  // hides itself entirely when WHMCS is unconfigured/disabled or the user isn't
  // linked, so native tickets stay the focus for everyone else.
  const { data: whmcsTickets, isLoading: whmcsLoading } = useQuery<WhmcsTicketsListData>({
    queryKey: ["/api/whmcs-tickets"],
    enabled: !isAdmin,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const showWhmcsSection =
    !isAdmin && !!whmcsTickets?.configured && !!whmcsTickets?.enabled && !!whmcsTickets?.linked;

  // Client-side unread tracking for mirrored WHMCS tickets: flag any ticket
  // whose latest staff reply is newer than the last time the customer opened it.
  const whmcsSeen = useWhmcsSeenMap(user?.id ?? null);
  const whmcsTicketList = useMemo(
    () => whmcsTickets?.tickets ?? [],
    [whmcsTickets?.tickets],
  );
  const whmcsNewReplyCount = useMemo(
    () => countNewReplies(whmcsTicketList, whmcsSeen),
    [whmcsTicketList, whmcsSeen],
  );
  const whmcsNewReplyIds = useMemo(
    () => new Set(newReplyTicketIds(whmcsTicketList, whmcsSeen)),
    [whmcsTicketList, whmcsSeen],
  );

  const form = useForm({
    resolver: zodResolver(createTicketSchema),
    defaultValues: { subject: "", description: "", serviceId: "", categoryId: "", priority: "medium" },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ticketId: string) => {
      await apiRequest("DELETE", `/api/admin/tickets/${ticketId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      toast({ title: "Ticket deleted" });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to delete ticket", description: serverActionErrorMessage(e, "Failed to delete the ticket. Please try again."), variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof createTicketSchema>) => {
      const formData = new FormData();
      formData.append("subject", data.subject);
      formData.append("description", data.description);
      if (data.serviceId) formData.append("serviceId", data.serviceId);
      if (data.categoryId) formData.append("categoryId", data.categoryId);
      formData.append("priority", data.priority);
      if (imageFile) formData.append("image", imageFile);

      const res = await uploadRequest("POST", "/api/tickets", formData);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (ticket: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      setDialogOpen(false);
      form.reset();
      setImageFile(null);
      toast({ title: "Ticket created successfully" });
      setLocation(`/tickets/${ticket.id}`);
    },
    onError: (e: Error) => {
      toast({ title: "Failed to create ticket", description: serverActionErrorMessage(e, "Failed to create the ticket. Please try again."), variant: "destructive" });
    },
  });

  const markTicketsRead = useCallback(() => {
    apiRequest("POST", "/api/ticket-notifications/mark-read").then(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/ticket-notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    markTicketsRead();
  }, [markTicketsRead]);

  useEffect(() => {
    const onVisChange = () => {
      if (document.visibilityState === "visible") markTicketsRead();
    };
    document.addEventListener("visibilitychange", onVisChange);
    return () => document.removeEventListener("visibilitychange", onVisChange);
  }, [markTicketsRead]);

  const search = useSearch();
  const filters = useMemo<TicketFilters>(() => parseTicketFiltersFromSearch(search), [search]);

  const updateFilters = useCallback(
    (next: TicketFilters) => {
      const qs = buildTicketFilterSearch(next);
      setLocation(`/tickets${qs}`, { replace: true });
    },
    [setLocation],
  );

  const filteredTickets = useMemo(
    () => applyTicketFilters(tickets ?? [], { ...filters, status: "all" }, user?.id ?? null),
    [tickets, filters, user?.id],
  );
  const openTickets = filteredTickets.filter((t) => t.status === "open");
  const closedTickets = filteredTickets.filter((t) => t.status === "closed");
  const serviceMap = new Map(services?.map((s) => [s.id, s.name]) || []);
  const categoryMap = new Map(categories?.map((c) => [c.id, c.name]) || []);
  const hasActiveFilters = filtersAreActive(filters);

  const activeTab = filters.status === "all" ? "open" : filters.status;
  const handleTabChange = (value: string) => {
    if (value !== "open" && value !== "closed") return;
    updateFilters({ ...filters, status: value });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-tickets-title">Support Tickets</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin ? "Manage customer support tickets" : "Get help with your services"}
          </p>
        </div>
        {!isAdmin && (
          <>
          <Button
            data-testid="button-new-ticket"
            onClick={async () => {
              // Always gate on a fresh status fetch so the after-hours notice is
              // reliable even on the very first click (before useQuery has
              // resolved). The notice now renders inline inside the flow instead
              // of as a separate blocking dialog.
              try {
                const fresh = await queryClient.ensureQueryData<BusinessHoursStatus>({
                  queryKey: ["/api/business-hours/status"],
                  staleTime: 30_000,
                });
                setAfterHoursNotice(fresh?.enabled && !fresh.isOpen ? fresh : null);
              } catch {
                // If the status fetch fails, fail open — no notice, let them submit.
                setAfterHoursNotice(null);
              }
              setDialogOpen(true);
            }}
          >
            <Plus className="w-4 h-4 mr-1" /> New Ticket
          </Button>

          {(() => {
            const ticketForm = (
              <Form {...form}>
                {afterHoursNotice && (
                  <div
                    className="mb-3 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3 flex gap-2 items-start"
                    data-testid="notice-after-hours"
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-amber-900 dark:text-amber-100 space-y-1">
                      <p className="font-medium">Outside business hours</p>
                      <p data-testid="text-after-hours-message">{afterHoursNotice.message}</p>
                      {afterHoursNotice.nextOpenAt && (
                        <p className="font-medium" data-testid="text-after-hours-next-open">
                          We reopen {formatNextOpen(afterHoursNotice.nextOpenAt, afterHoursNotice.timezone)}.
                        </p>
                      )}
                      <p className="text-amber-800/80 dark:text-amber-200/80">
                        You can still open the ticket — we'll respond once we're back.
                      </p>
                    </div>
                  </div>
                )}
                <div
                  className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  data-testid="notice-kb-hint"
                >
                  <div className="flex items-start gap-3">
                    <div className="bg-primary/10 text-primary rounded-full p-2 shrink-0">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-primary">Need a quick fix?</p>
                      <p className="text-xs text-muted-foreground">
                        Many common questions are answered in our Knowledge Base — you may find a faster fix there.
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="shrink-0 w-full sm:w-auto"
                    onClick={() => {
                      setDialogOpen(false);
                      setLocation("/knowledge");
                    }}
                    data-testid="button-kb-hint-browse"
                  >
                    <BookOpen className="w-4 h-4 mr-2" />
                    Browse Knowledge Base
                  </Button>
                </div>
                <SupportAwayBanner />
                <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="subject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject</FormLabel>
                        <FormControl>
                          <Input placeholder="Brief description of the issue" data-testid="input-ticket-subject" {...field} />
                        </FormControl>
                        <SubjectKbSuggestions subject={field.value || ""} />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="serviceId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service (optional)</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-ticket-service">
                              <SelectValue placeholder="Select a service" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {services?.map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {categories && categories.length > 0 && (
                    <FormField
                      control={form.control}
                      name="categoryId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-ticket-category">
                                <SelectValue placeholder="Select a category" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {categories.map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-ticket-priority">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Describe the issue in detail" className="min-h-[100px]" data-testid="input-ticket-description" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div>
                    <label className="text-sm font-medium">Attach Image (optional)</label>
                    <Input
                      type="file"
                      accept="image/*"
                      className="mt-1"
                      onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                      data-testid="input-ticket-image"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-submit-ticket">
                    {createMutation.isPending ? "Creating..." : "Submit Ticket"}
                  </Button>
                </form>
              </Form>
            );
            if (isMobile) {
              return (
                <Sheet open={dialogOpen} onOpenChange={setDialogOpen}>
                  <SheetContent side="bottom" className="h-[92vh] p-0 flex flex-col rounded-t-2xl" data-testid="dialog-new-ticket">
                    <div className="flex justify-center pt-2 pb-1">
                      <div className="w-10 h-1.5 rounded-full bg-muted-foreground/30" />
                    </div>
                    <SheetHeader className="px-4 pb-3 text-left">
                      <SheetTitle>Open a Support Ticket</SheetTitle>
                      <SheetDescription className="sr-only">Fill out the form to submit a support ticket</SheetDescription>
                    </SheetHeader>
                    <ScrollArea className="flex-1 px-4 pb-6">{ticketForm}</ScrollArea>
                  </SheetContent>
                </Sheet>
              );
            }
            return (
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto" data-testid="dialog-new-ticket">
                  <DialogHeader>
                    <DialogTitle>Open a Support Ticket</DialogTitle>
                    <DialogDescription className="sr-only">Fill out the form to submit a support ticket</DialogDescription>
                  </DialogHeader>
                  {ticketForm}
                </DialogContent>
              </Dialog>
            );
          })()}
          </>
        )}
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-card-border bg-card p-4" data-testid="ticket-filters">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mr-1">
            <Filter className="w-3.5 h-3.5" />
            Filters
          </div>
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Category</label>
            <Select
              value={filters.categoryId ?? "any"}
              onValueChange={(v) => updateFilters({ ...filters, categoryId: v === "any" ? null : v })}
            >
              <SelectTrigger className="h-8 text-sm" data-testid="select-filter-category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">All categories</SelectItem>
                {categories?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Claim</label>
            <Select
              value={filters.claimedBy === "me" || filters.claimedBy === "unclaimed" ? filters.claimedBy : "any"}
              onValueChange={(v) => updateFilters({ ...filters, claimedBy: v as TicketFilters["claimedBy"] })}
            >
              <SelectTrigger className="h-8 text-sm" data-testid="select-filter-claimed">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Anyone</SelectItem>
                <SelectItem value="me">Claimed by me</SelectItem>
                <SelectItem value="unclaimed">Unclaimed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[120px]">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Priority</label>
            <Select
              value={filters.priority}
              onValueChange={(v) => updateFilters({ ...filters, priority: v as TicketFilters["priority"] })}
            >
              <SelectTrigger className="h-8 text-sm" data-testid="select-filter-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any priority</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => updateFilters(DEFAULT_TICKET_FILTERS)}
              data-testid="button-clear-filters"
            >
              <X className="w-3.5 h-3.5 mr-1" /> Clear filters
            </Button>
          )}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <TabsList>
            <TabsTrigger value="open" data-testid="tab-open-tickets">Open ({openTickets.length})</TabsTrigger>
            <TabsTrigger value="closed" data-testid="tab-closed-tickets">Closed ({closedTickets.length})</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="open" className="mt-4">
          <section className="rounded-xl border border-card-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold flex items-center gap-3">
                <SectionIcon icon={MessageSquare} tone="bg-primary/10 text-primary" />
                Open tickets
              </h2>
            </div>
            {isLoading ? (
              <RowSkeletons />
            ) : ticketsError ? (
              <QueryErrorState
                error={ticketsErrorObj}
                onRetry={() => refetchTickets()}
                isRetrying={ticketsFetching}
                resourceName="your tickets"
                data-testid="error-tickets"
                className="py-6"
              />
            ) : openTickets.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <Ticket className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-20" />
                <p className="font-medium">No open tickets</p>
                <p className="text-sm text-muted-foreground mt-1 mb-4">You don't have any open support requests.</p>
                <Button onClick={() => setDialogOpen(true)} data-testid="button-open-first-ticket">
                  <Plus className="w-4 h-4 mr-2" /> Open your first ticket
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {openTickets.map((ticket) => (
                  <li key={ticket.id}>
                    <Link href={`/tickets/${ticket.id}`} className="flex items-center gap-3 px-5 py-3.5 hover-elevate tap-interactive" data-testid={`card-ticket-${ticket.id}`}>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium">{ticket.subject}</p>
                        <p className="text-xs text-muted-foreground truncate">{ticket.description}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <PriorityBadge priority={ticket.priority} />
                          {ticket.serviceId && serviceMap.get(ticket.serviceId) && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{serviceMap.get(ticket.serviceId)}</span>
                          )}
                          {ticket.categoryId && categoryMap.get(ticket.categoryId) && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground flex items-center gap-1"><Tag className="w-3 h-3" />{categoryMap.get(ticket.categoryId)}</span>
                          )}
                          {isAdmin && ticket.claimedBy && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground" data-testid={`badge-claimed-${ticket.id}`}>
                              {ticket.claimedBy === user?.id ? "Claimed by you" : `Claimed by ${(ticket as any).claimedByName || "admin"}`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 mr-2 hidden sm:block">
                         <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>

        <TabsContent value="closed" className="mt-4">
          <section className="rounded-xl border border-card-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold flex items-center gap-3">
                <SectionIcon icon={CheckCircle2} tone="bg-muted text-muted-foreground" />
                Closed tickets
              </h2>
            </div>
            {isLoading ? (
              <RowSkeletons />
            ) : ticketsError ? (
              <QueryErrorState
                error={ticketsErrorObj}
                onRetry={() => refetchTickets()}
                isRetrying={ticketsFetching}
                resourceName="your tickets"
                data-testid="error-tickets-closed"
                className="py-6"
              />
            ) : closedTickets.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-sm font-medium text-muted-foreground">No closed tickets</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {closedTickets.map((ticket) => (
                  <li key={ticket.id}>
                    <div className="flex items-center justify-between gap-3 px-5 py-3.5 hover-elevate tap-interactive opacity-80" data-testid={`card-ticket-closed-${ticket.id}`}>
                      <Link href={`/tickets/${ticket.id}`} className="flex-1 min-w-0 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm font-medium">{ticket.subject}</p>
                          <p className="text-xs text-muted-foreground">
                            Closed {ticket.closedAt ? formatDistanceToNow(new Date(ticket.closedAt), { addSuffix: true }) : ""}
                          </p>
                        </div>
                      </Link>
                      <div className="flex items-center gap-1 shrink-0">
                        {isAdmin && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" data-testid={`button-delete-ticket-${ticket.id}`}>
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Ticket</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete this ticket? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteMutation.mutate(ticket.id)} data-testid="button-confirm-delete">Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                        <Link href={`/tickets/${ticket.id}`}>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>
      </Tabs>

      {showWhmcsSection && (
        <section className="rounded-xl border border-card-border bg-card overflow-hidden" data-testid="section-whmcs-tickets">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold flex items-center gap-3">
                <SectionIcon icon={CreditCard} tone="bg-primary/10 text-primary" />
                Billing &amp; account support
                {whmcsNewReplyCount > 0 && (
                  <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-destructive-foreground" data-testid="badge-whmcs-new-replies">
                    {whmcsNewReplyCount} new
                  </span>
                )}
              </h2>
              <p className="text-xs text-muted-foreground ml-[48px]">
                Tickets from our billing system, kept separate from your support tickets above.
              </p>
            </div>
          </div>
          <div className="p-0">
            <WhmcsTicketList
              data={whmcsTickets}
              isLoading={whmcsLoading}
              context="customer"
              newReplyIds={whmcsNewReplyIds}
              onOpen={(id) => setLocation(`/whmcs-tickets/${id}`)}
            />
          </div>
        </section>
      )}
    </div>
  );
}
