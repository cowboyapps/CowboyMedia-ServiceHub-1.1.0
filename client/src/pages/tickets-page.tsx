import { useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import { format } from "date-fns";
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
import { Plus, Ticket, Clock, ChevronRight, MessageSquare, Trash2 } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import type { Ticket as TicketType, Service } from "@shared/schema";

const createTicketSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  description: z.string().min(1, "Description is required"),
  serviceId: z.string().optional(),
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

export default function TicketsPage() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);

  const { data: tickets, isLoading } = useQuery<TicketType[]>({
    queryKey: ["/api/tickets"],
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const form = useForm({
    resolver: zodResolver(createTicketSchema),
    defaultValues: { subject: "", description: "", serviceId: "", priority: "medium" },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      setDialogOpen(false);
      form.reset();
      setImageFile(null);
      toast({ title: "Ticket created successfully" });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to create ticket", description: e.message, variant: "destructive" });
    },
  });

  const openTickets = tickets?.filter((t) => t.status === "open") || [];
  const closedTickets = tickets?.filter((t) => t.status === "closed") || [];
  const serviceMap = new Map(services?.map((s) => [s.id, s.name]) || []);

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
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-ticket">
                <Plus className="w-4 h-4 mr-1" /> New Ticket
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Open a Support Ticket</DialogTitle>
              </DialogHeader>
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
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open" data-testid="tab-open-tickets">Open ({openTickets.length})</TabsTrigger>
          <TabsTrigger value="closed" data-testid="tab-closed-tickets">Closed ({closedTickets.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="mt-4 space-y-3">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)
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
                <Card className="hover-elevate cursor-pointer" data-testid={`card-ticket-${ticket.id}`}>
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
              <Card key={ticket.id} className="hover-elevate cursor-pointer opacity-80" data-testid={`card-ticket-closed-${ticket.id}`}>
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
                        <AlertDialogContent>
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
