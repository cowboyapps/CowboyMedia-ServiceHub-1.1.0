import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { format } from "date-fns";
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
import { Plus, Ticket, Clock, ChevronRight, MessageSquare, Trash2, Tag, AlertTriangle } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import type { Ticket as TicketType, Service, TicketCategory } from "@shared/schema";

const createTicketSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  description: z.string().min(1, "Description is required"),
  serviceId: z.string().optional(),
  categoryId: z.string().optional(),
  priority: z.string().default("medium"),
});

function PriorityBadge({ priority }: { priority: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive"> = {
    high: "destructive",
    medium: "default",
    low: "secondary",
  };
  return <Badge variant={variants[priority] || "secondary"} className="text-xs capitalize">{priority}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive"> = {
    open: "default",
    closed: "secondary",
  };
  return <Badge variant={variants[status] || "secondary"} className="text-xs capitalize">{status}</Badge>;
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

export default function TicketsPage() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [warnOpen, setWarnOpen] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);

  const { data: bhStatus } = useQuery<BusinessHoursStatus>({
    queryKey: ["/api/business-hours/status"],
    enabled: !isAdmin,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: tickets, isLoading } = useQuery<TicketType[]>({
    queryKey: ["/api/tickets"],
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const { data: categories } = useQuery<TicketCategory[]>({
    queryKey: ["/api/ticket-categories"],
  });

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
      toast({ title: "Failed to delete ticket", description: e.message, variant: "destructive" });
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

      const res = await fetch("/api/tickets", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
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
      toast({ title: "Failed to create ticket", description: e.message, variant: "destructive" });
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

  const openTickets = tickets?.filter((t) => t.status === "open") || [];
  const closedTickets = tickets?.filter((t) => t.status === "closed") || [];
  const serviceMap = new Map(services?.map((s) => [s.id, s.name]) || []);
  const categoryMap = new Map(categories?.map((c) => [c.id, c.name]) || []);

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
              // Always gate on a fresh status fetch so the warning is reliable
              // even on the very first click (before useQuery has resolved).
              try {
                const fresh = await queryClient.ensureQueryData<BusinessHoursStatus>({
                  queryKey: ["/api/business-hours/status"],
                  staleTime: 30_000,
                });
                if (fresh?.enabled && !fresh.isOpen) {
                  setWarnOpen(true);
                  return;
                }
              } catch {
                // If the status fetch fails, fail open and let the user submit.
              }
              setDialogOpen(true);
            }}
          >
            <Plus className="w-4 h-4 mr-1" /> New Ticket
          </Button>

          <AlertDialog open={warnOpen} onOpenChange={setWarnOpen}>
            <AlertDialogContent
              className="w-[calc(100vw-2rem)] sm:max-w-md border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40"
              data-testid="dialog-after-hours-warning"
            >
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-100">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  Outside business hours
                </AlertDialogTitle>
                <AlertDialogDescription className="text-amber-900/90 dark:text-amber-100/90 space-y-2">
                  <span className="block" data-testid="text-after-hours-message">{bhStatus?.message}</span>
                  {bhStatus?.nextOpenAt && (
                    <span className="block font-medium" data-testid="text-after-hours-next-open">
                      We reopen {formatNextOpen(bhStatus.nextOpenAt, bhStatus.timezone)}.
                    </span>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-after-hours-cancel">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setWarnOpen(false);
                    setDialogOpen(true);
                  }}
                  data-testid="button-after-hours-continue"
                >
                  Continue Anyway
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {(() => {
            const ticketForm = (
              <Form {...form}>
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
                <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-new-ticket">
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

      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open" data-testid="tab-open-tickets">Open ({openTickets.length})</TabsTrigger>
          <TabsTrigger value="closed" data-testid="tab-closed-tickets">Closed ({closedTickets.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="mt-4 space-y-3">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="border rounded-lg p-4 flex items-start gap-3">
                <Skeleton className="w-5 h-5 rounded flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-full" />
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="w-4 h-4 flex-shrink-0 self-center" />
              </div>
            ))
          ) : openTickets.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Ticket className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground">No open tickets</p>
              </CardContent>
            </Card>
          ) : (
            openTickets.map((ticket) => (
              <Link key={ticket.id} href={`/tickets/${ticket.id}`}>
                <Card className="hover-elevate tap-interactive cursor-pointer" data-testid={`card-ticket-${ticket.id}`}>
                  <CardContent className="flex items-start justify-between gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <MessageSquare className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <h3 className="font-semibold text-sm">{ticket.subject}</h3>
                        <p className="text-xs text-muted-foreground line-clamp-1">{ticket.description}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <PriorityBadge priority={ticket.priority} />
                          {ticket.serviceId && serviceMap.get(ticket.serviceId) && (
                            <Badge variant="secondary" className="text-xs">{serviceMap.get(ticket.serviceId)}</Badge>
                          )}
                          {ticket.categoryId && categoryMap.get(ticket.categoryId) && (
                            <Badge variant="outline" className="text-xs"><Tag className="w-3 h-3 mr-1" />{categoryMap.get(ticket.categoryId)}</Badge>
                          )}
                          {isAdmin && ticket.claimedBy && (
                            <Badge variant="outline" className="text-xs" data-testid={`badge-claimed-${ticket.id}`}>
                              {ticket.claimedBy === user?.id ? "Claimed by you" : `Claimed by ${(ticket as any).claimedByName || "admin"}`}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(new Date(ticket.createdAt), "MMM d, h:mm a")}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </TabsContent>

        <TabsContent value="closed" className="mt-4 space-y-3">
          {closedTickets.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-sm text-muted-foreground">No closed tickets</p>
              </CardContent>
            </Card>
          ) : (
            closedTickets.map((ticket) => (
              <Card key={ticket.id} className="hover-elevate tap-interactive cursor-pointer opacity-80" data-testid={`card-ticket-closed-${ticket.id}`}>
                <CardContent className="flex items-start justify-between gap-3 p-4">
                  <Link href={`/tickets/${ticket.id}`} className="flex-1">
                    <div className="space-y-1">
                      <h3 className="font-semibold text-sm">{ticket.subject}</h3>
                      <p className="text-xs text-muted-foreground">
                        Closed {ticket.closedAt ? format(new Date(ticket.closedAt), "MMM d, yyyy") : ""}
                      </p>
                    </div>
                  </Link>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isAdmin && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`button-delete-ticket-${ticket.id}`}
                          >
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
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(ticket.id)}
                              data-testid="button-confirm-delete"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    <Link href={`/tickets/${ticket.id}`}>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
