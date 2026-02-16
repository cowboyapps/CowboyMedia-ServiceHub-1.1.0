import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { format } from "date-fns";
import { ArrowLeft, Send, Image, X, CheckCircle } from "lucide-react";
import { ClickableImage } from "@/components/image-lightbox";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Ticket, TicketMessage, Service, User } from "@shared/schema";

export default function TicketDetail() {
  const params = useParams<{ id: string }>();
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const { data: ticket, isLoading } = useQuery<Ticket>({
    queryKey: ["/api/tickets", params.id],
  });

  const { data: messages, isLoading: messagesLoading } = useQuery<TicketMessage[]>({
    queryKey: ["/api/tickets", params.id, "messages"],
    refetchInterval: 5000,
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "ticket_message" && data.ticketId === params.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id, "messages"] });
      }
    };

    return () => {
      ws.close();
    };
  }, [params.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("message", message);
      if (imageFile) formData.append("image", imageFile);

      const res = await fetch(`/api/tickets/${params.id}/messages`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id, "messages"] });
      setMessage("");
      setImageFile(null);
    },
    onError: (e: Error) => {
      toast({ title: "Failed to send message", description: e.message, variant: "destructive" });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/tickets/${params.id}`, { status: "closed" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      toast({ title: "Ticket closed" });
    },
  });

  const serviceName = services?.find((s) => s.id === ticket?.serviceId)?.name;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
        <Skeleton className="h-60" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Ticket not found</p>
        <Link href="/tickets">
          <Button variant="ghost" className="mt-2">Back to Tickets</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between gap-3 pb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/tickets">
            <Button variant="ghost" size="icon" data-testid="button-back-tickets">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h2 className="font-semibold text-lg" data-testid="text-ticket-subject">{ticket.subject}</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={ticket.status === "open" ? "default" : "secondary"} className="text-xs capitalize">{ticket.status}</Badge>
              <Badge variant={ticket.priority === "high" ? "destructive" : "secondary"} className="text-xs capitalize">{ticket.priority}</Badge>
              {serviceName && <Badge variant="secondary" className="text-xs">{serviceName}</Badge>}
            </div>
          </div>
        </div>
        {ticket.status === "open" && (
          <Button variant="outline" size="sm" onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending} data-testid="button-close-ticket">
            <CheckCircle className="w-4 h-4 mr-1" /> Close Ticket
          </Button>
        )}
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardContent className="flex-1 flex flex-col min-h-0 p-0">
          <div className="p-4 border-b bg-card">
            <p className="text-sm" data-testid="text-ticket-description">{ticket.description}</p>
            {ticket.imageUrl && (
              <ClickableImage src={ticket.imageUrl} alt="Ticket attachment" className="mt-2 max-w-xs h-32 object-cover rounded-md" />
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Opened {format(new Date(ticket.createdAt), "MMM d, yyyy 'at' h:mm a")}
            </p>
          </div>

          <ScrollArea className="flex-1 p-4">
            {messagesLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : !messages || messages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No messages yet. Start the conversation below.</p>
            ) : (
              <div className="space-y-4">
                {messages.map((msg) => {
                  const isMe = msg.senderId === user?.id;
                  return (
                    <div key={msg.id} className={`flex gap-2.5 ${isMe ? "flex-row-reverse" : ""}`} data-testid={`message-${msg.id}`}>
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        <AvatarFallback className="text-xs">
                          {isMe ? (user?.fullName?.[0] || "U") : "S"}
                        </AvatarFallback>
                      </Avatar>
                      <div className={`max-w-[70%] space-y-1 ${isMe ? "items-end" : ""}`}>
                        <div className={`rounded-md p-3 text-sm ${isMe ? "bg-primary text-primary-foreground" : "bg-accent"}`}>
                          {msg.message}
                          {msg.imageUrl && (
                            <ClickableImage src={msg.imageUrl} alt="Attachment" className="mt-2 max-w-full h-32 object-cover rounded-md" />
                          )}
                        </div>
                        <p className={`text-xs text-muted-foreground ${isMe ? "text-right" : ""}`}>
                          {format(new Date(msg.createdAt), "h:mm a")}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}
          </ScrollArea>

          {ticket.status === "open" && !isAdmin && messages && messages.length > 0 && messages[messages.length - 1].senderId !== user?.id && (
            <div className="p-3 border-t bg-accent/50">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-medium" data-testid="text-resolution-prompt">Has your issue been resolved?</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => closeMutation.mutate()}
                    disabled={closeMutation.isPending}
                    data-testid="button-yes-close-ticket"
                  >
                    <CheckCircle className="w-4 h-4 mr-1" /> Yes, close ticket
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => messageInputRef.current?.focus()}
                    data-testid="button-reply-back"
                  >
                    Reply back
                  </Button>
                </div>
              </div>
            </div>
          )}

          {ticket.status === "open" && (
            <div className="p-3 border-t">
              {imageFile && (
                <div className="flex items-center gap-2 mb-2 p-2 bg-accent rounded-md">
                  <span className="text-xs truncate flex-1">{imageFile.name}</span>
                  <Button size="icon" variant="ghost" onClick={() => setImageFile(null)} data-testid="button-remove-image">
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (message.trim() || imageFile) sendMutation.mutate();
                }}
                className="flex items-center gap-2"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="*/*"
                  className="hidden"
                  onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-attach-image"
                >
                  <Image className="w-4 h-4" />
                </Button>
                <Input
                  ref={messageInputRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1"
                  data-testid="input-message"
                />
                <Button type="submit" size="icon" disabled={sendMutation.isPending || (!message.trim() && !imageFile)} data-testid="button-send-message">
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
