import { useRef, useState } from "react";
import { trackOutcome } from "@/lib/analytics";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, useParams } from "wouter";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { uploadPrivateMessage } from "@/lib/private-message-upload";
import { PRIVATE_UPLOAD_LIMIT_LABEL, privateUploadError } from "@shared/private-message-uploads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { serverActionErrorMessage } from "@/lib/server-error";
import { useToast } from "@/hooks/use-toast";
import { Mail, Paperclip, X, BookOpen, ChevronRight, MessageSquare, Trash2, Users, Inbox, Clock } from "lucide-react";
import type { MessageThread, ThreadMessage, PrivateMessage, User } from "@shared/schema";
import { KbArticlePickerDialog, type KbArticleRef } from "@/components/kb-article-picker-dialog";
import { ThreadChatView } from "@/components/private-messages/thread-chat-view";
import { ThreadListSync } from "@/components/private-messages/thread-list-sync";

type EnrichedThread = MessageThread & {
  adminName: string;
  customerName: string;
  lastMessage: { body: string; senderId: string; createdAt: string } | null;
  unreadCount: number;
};

export type EnrichedThreadMessage = ThreadMessage & { senderName?: string; kbArticle?: KbArticleRef | null };

export function messageReceiptLabel(msg: Pick<ThreadMessage, "deliveredAt" | "readAt">): "Sent" | "Delivered" | "Read" {
  if (msg.readAt) return "Read";
  if (msg.deliveredAt) return "Delivered";
  return "Sent";
}

const newThreadSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().optional().default(""),
});
type NewThreadData = z.infer<typeof newThreadSchema>;

function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 3 | 8)).toString(16);
  });
}

async function uploadError(response: Response, fallback: string): Promise<string> {
  if (response.status === 413) return PRIVATE_UPLOAD_LIMIT_LABEL;
  const body = await response.text().catch(() => "");
  if (body) {
    try {
      const parsed = JSON.parse(body);
      if (parsed.message) return String(parsed.message);
      if (parsed.error) return String(parsed.error);
    } catch {
      return /<[^>]+>/.test(body)
        ? `The upload server rejected the request (${response.status}). Your draft has not been cleared; please try again.`
        : body.slice(0, 400);
    }
  }
  return `${fallback} (${response.status})`;
}

function NewConversationDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [kbArticle, setKbArticle] = useState<KbArticleRef | null>(null);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clientThreadIdRef = useRef(newClientId());
  const clientMessageIdRef = useRef(newClientId());
  const failedPayloadRef = useRef<{ customerId: string; subject: string; body: string; file: File | null; kbSlug: string | null } | null>(null);
  const { data: users } = useQuery<User[]>({ queryKey: ["/api/admin/users"], enabled: open });
  const customers = users?.filter(user => user.role === "customer") || [];
  const form = useForm<NewThreadData>({
    resolver: zodResolver(newThreadSchema),
    defaultValues: { customerId: "", subject: "", body: "" },
  });

  const createMutation = useMutation({
    mutationFn: async (data: NewThreadData) => {
      const fd = new FormData();
      fd.append("customerId", data.customerId);
      fd.append("subject", data.subject);
      fd.append("body", data.body ?? "");
      fd.append("clientThreadId", clientThreadIdRef.current);
      fd.append("clientMessageId", clientMessageIdRef.current);
      if (imageFile) fd.append("image", imageFile);
      if (kbArticle) fd.append("kbArticleSlug", kbArticle.slug);
      setUploadProgress(0);
      const response = await uploadPrivateMessage("/api/message-threads", fd, setUploadProgress);
      if (!response.ok) throw new Error(await uploadError(response, "Couldn't start the conversation"));
      return response.json();
    },
    onSuccess: data => {
      trackOutcome("private_conversation_started", clientThreadIdRef.current, { has_attachment: !!imageFile });
      setOpen(false);
      form.reset();
      setImageFile(null);
      setKbArticle(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      clientThreadIdRef.current = newClientId();
      clientMessageIdRef.current = newClientId();
      failedPayloadRef.current = null;
      void queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
      toast({ title: "Conversation started" });
      if (data.thread?.id) navigate(`/messages/${data.thread.id}`);
    },
    onError: (error, data) => {
      failedPayloadRef.current = {
        customerId: data.customerId, subject: data.subject, body: data.body ?? "",
        file: imageFile, kbSlug: kbArticle?.slug ?? null,
      };
      toast({ title: "Error", description: serverActionErrorMessage(error, "Couldn't start the conversation. Please try again."), variant: "destructive" });
    },
    onSettled: () => setUploadProgress(null),
  });

  const submit = (data: NewThreadData) => {
    if (!(data.body ?? "").trim() && !imageFile && !kbArticle) {
      toast({ title: "Add a message, photo, or article", variant: "destructive" });
      return;
    }
    const rejection = imageFile ? privateUploadError(imageFile) : null;
    if (rejection) {
      toast({ title: "Attachment is too large", description: rejection, variant: "destructive" });
      return;
    }
    const failed = failedPayloadRef.current;
    if (failed && (
      failed.customerId !== data.customerId || failed.subject !== data.subject ||
      failed.body !== (data.body ?? "") || failed.file !== imageFile ||
      failed.kbSlug !== (kbArticle?.slug ?? null)
    )) {
      clientThreadIdRef.current = newClientId();
      clientMessageIdRef.current = newClientId();
      failedPayloadRef.current = null;
    }
    createMutation.mutate(data);
  };

  const onOpenChange = (next: boolean) => {
    if (!next && createMutation.isPending) return;
    setOpen(next);
    if (!next) {
      form.reset();
      setImageFile(null);
      setKbArticle(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      clientThreadIdRef.current = newClientId();
      clientMessageIdRef.current = newClientId();
      failedPayloadRef.current = null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild><Button size="sm" data-testid="button-new-conversation"><MessageSquare className="mr-1 h-4 w-4" /> New Conversation</Button></DialogTrigger>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
        <DialogHeader><DialogTitle>Start Conversation</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-3">
            <FormField control={form.control} name="customerId" render={({ field }) => (
              <FormItem><FormLabel>Customer</FormLabel><Select onValueChange={field.onChange} value={field.value} disabled={createMutation.isPending}>
                <FormControl><SelectTrigger data-testid="select-thread-customer"><SelectValue placeholder="Select a customer" /></SelectTrigger></FormControl>
                <SelectContent>{customers.map(user => <SelectItem key={user.id} value={user.id}>{user.fullName} (@{user.username})</SelectItem>)}</SelectContent>
              </Select><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="subject" render={({ field }) => (
              <FormItem><FormLabel>Subject</FormLabel><FormControl><Input data-testid="input-thread-subject" disabled={createMutation.isPending} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="body" render={({ field }) => (
              <FormItem><FormLabel>First Message</FormLabel><FormControl><Textarea className="min-h-[100px]" data-testid="input-thread-body" disabled={createMutation.isPending} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            {imageFile && <div className="flex w-fit items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs" data-testid="chip-new-thread-image">
              <Paperclip className="h-3.5 w-3.5" /><span className="max-w-[200px] truncate">{imageFile.name}</span>
              <button type="button" disabled={createMutation.isPending} onClick={() => { setImageFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} data-testid="button-new-thread-remove-image"><X className="h-3.5 w-3.5" /></button>
            </div>}
            {kbArticle && <div className="flex w-fit items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs" data-testid="chip-new-thread-kb">
              <BookOpen className="h-3.5 w-3.5" /><span className="max-w-[200px] truncate">{kbArticle.title}</span>
              <button type="button" disabled={createMutation.isPending} onClick={() => setKbArticle(null)} data-testid="button-new-thread-remove-kb"><X className="h-3.5 w-3.5" /></button>
            </div>}
            <input ref={fileInputRef} type="file" accept="*/*" className="hidden" disabled={createMutation.isPending} data-testid="input-new-thread-file"
              onChange={event => {
                const selected = event.target.files?.[0];
                const rejection = selected ? privateUploadError(selected) : null;
                if (rejection) {
                  toast({ title: "Attachment is too large", description: rejection, variant: "destructive" });
                  event.target.value = "";
                } else if (selected) setImageFile(selected);
              }} />
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={createMutation.isPending} onClick={() => fileInputRef.current?.click()} data-testid="button-new-thread-attach-image"><Paperclip className="mr-1 h-4 w-4" /> Photo</Button>
              <Button type="button" variant="outline" size="sm" disabled={createMutation.isPending} onClick={() => setKbPickerOpen(true)} data-testid="button-new-thread-attach-kb"><BookOpen className="mr-1 h-4 w-4" /> Article</Button>
            </div>
            <p className="text-xs text-muted-foreground">{PRIVATE_UPLOAD_LIMIT_LABEL}</p>
            <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-start-conversation">{createMutation.isPending ? uploadProgress === 100 ? "Saving…" : `Uploading ${uploadProgress ?? 0}%` : "Start Conversation"}</Button>
          </form>
        </Form>
        <KbArticlePickerDialog open={kbPickerOpen && !createMutation.isPending} onOpenChange={next => { if (!createMutation.isPending) setKbPickerOpen(next); }}
          onSelect={article => { if (!createMutation.isPending) setKbArticle(article); setKbPickerOpen(false); }} />
      </DialogContent>
    </Dialog>
  );
}

function SectionIcon({ icon: Icon, tone }: { icon: typeof MessageSquare; tone: string }) {
  return <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${tone}`}><Icon className="h-[18px] w-[18px]" /></span>;
}

function ThreadRow({ thread, isAdmin, currentUserId, onOpen, onDelete, canManage }: {
  thread: EnrichedThread; isAdmin: boolean; currentUserId?: string; onOpen: () => void; onDelete?: () => void; canManage: boolean;
}) {
  return <li onClick={onOpen} className="stagger-item group flex cursor-pointer items-center gap-3 px-5 py-3.5 hover-elevate tap-interactive" data-testid={`card-thread-${thread.id}`}>
    {!isAdmin && <Avatar className="h-9 w-9 shrink-0"><AvatarFallback className="text-xs">{thread.adminName?.[0] || "A"}</AvatarFallback></Avatar>}
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-2">
        <p className={`truncate text-sm font-medium ${thread.unreadCount > 0 ? "text-foreground" : "text-muted-foreground"}`} data-testid={`text-thread-subject-${thread.id}`}>{thread.subject}</p>
        {thread.unreadCount > 0 && <span className="shrink-0 rounded-full bg-status-online/15 px-2 py-0.5 text-[10px] font-medium text-status-online" data-testid={`badge-thread-unread-${thread.id}`}>{thread.unreadCount} new</span>}
      </div>
      {!isAdmin && <p className="truncate text-xs text-muted-foreground">{thread.adminName}</p>}
      {thread.lastMessage && <p className="mt-0.5 truncate text-xs text-muted-foreground">{thread.lastMessage.senderId === currentUserId ? "You: " : ""}{thread.lastMessage.body}</p>}
    </div>
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-[10px] text-muted-foreground">{format(new Date(thread.lastMessage?.createdAt ?? thread.createdAt), "MMM d")}</span>
      {isAdmin && canManage && onDelete && <div onClick={event => event.stopPropagation()}>
        <AlertDialog>
          <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100" data-testid={`button-delete-thread-${thread.id}`}><Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" /></Button></AlertDialogTrigger>
          <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm" onClick={event => event.stopPropagation()}>
            <AlertDialogHeader><AlertDialogTitle>Delete Conversation</AlertDialogTitle><AlertDialogDescription>Delete this entire conversation and all messages? This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={onDelete} data-testid="button-confirm-delete-thread">Delete</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  </li>;
}

export default function MessagesPage() {
  const { user, isAdmin, hasPermission } = useAuth();
  const { toast } = useToast();
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const canManage = isAdmin && hasPermission("messages.manage");
  const { data: threads, isLoading, isError, error, refetch, isFetching } = useQuery<EnrichedThread[]>({
    queryKey: ["/api/message-threads"], refetchInterval: 15000, enabled: !params.id,
    staleTime: 0, refetchOnMount: true, refetchOnWindowFocus: true, refetchOnReconnect: true,
  });
  const { data: legacyMessages } = useQuery<PrivateMessage[]>({ queryKey: ["/api/private-messages"], enabled: !params.id && !isAdmin });
  const { data: sentMessages } = useQuery<PrivateMessage[]>({ queryKey: ["/api/admin/private-messages/sent"], enabled: !params.id && isAdmin && hasPermission("messages.view") });
  const { data: adminUsers } = useQuery<User[]>({ queryKey: ["/api/admin/users"], enabled: !params.id && isAdmin });
  const userMap = new Map(adminUsers?.map(entry => [entry.id, entry.fullName]) || []);
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/message-threads/${id}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Failed");
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] }); toast({ title: "Conversation deleted" }); },
    onError: error => toast({ title: "Error", description: serverActionErrorMessage(error, "Couldn't delete the conversation. Please try again."), variant: "destructive" }),
  });

  if (params.id) return <div className="flex h-full min-h-0 flex-col"><ThreadChatView key={params.id} threadId={params.id} onBack={() => navigate("/messages")} /></div>;

  const renderThreadList = () => {
    if (isLoading) return <section className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="flex items-center border-b border-border px-5 py-4"><h2 className="flex items-center gap-3 text-sm font-semibold"><SectionIcon icon={MessageSquare} tone="bg-primary/10 text-primary" />Conversations</h2></div>
      <div className="divide-y divide-border">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="flex items-center gap-3 px-5 py-3.5"><Skeleton className="h-9 w-9 shrink-0 rounded-full" /><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-1/4" /></div></div>)}</div>
    </section>;
    if (isError) return <section className="overflow-hidden rounded-xl border border-card-border bg-card p-6"><QueryErrorState error={error} onRetry={() => refetch()} isRetrying={isFetching} resourceName="your messages" data-testid="error-messages" /></section>;
    if (!threads?.length) return <section className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="flex items-center border-b border-border px-5 py-4"><h2 className="flex items-center gap-3 text-sm font-semibold"><SectionIcon icon={MessageSquare} tone="bg-primary/10 text-primary" />Conversations</h2></div>
      <div className="px-5 py-8 text-center"><Mail className="mx-auto mb-2 h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground" data-testid="text-no-messages">{isAdmin ? "No conversations yet." : "No messages yet"}</p><p className="mt-1 text-xs text-muted-foreground">{isAdmin ? "Start one using the New Conversation button." : "When a team member sends you a message, it will appear here."}</p></div>
    </section>;
    if (isAdmin) {
      const grouped = new Map<string, EnrichedThread[]>();
      threads.forEach(thread => { if (!grouped.has(thread.customerId)) grouped.set(thread.customerId, []); grouped.get(thread.customerId)!.push(thread); });
      const groups = Array.from(grouped.entries()).sort((a, b) => Math.max(...b[1].map(t => new Date(t.lastMessageAt).getTime())) - Math.max(...a[1].map(t => new Date(t.lastMessageAt).getTime())));
      return <div className="space-y-6">{groups.map(([customerId, customerThreads]) => <section key={customerId} className="overflow-hidden rounded-xl border border-card-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4"><SectionIcon icon={Users} tone="bg-primary/10 text-primary" /><h4 className="text-sm font-semibold">{customerThreads[0].customerName}</h4><Badge variant="outline" className="ml-1 text-[10px]">{customerThreads.length}</Badge></div>
        <ul className="divide-y divide-border">{customerThreads.map(thread => <ThreadRow key={thread.id} thread={thread} isAdmin currentUserId={user?.id} canManage={canManage} onOpen={() => navigate(`/messages/${thread.id}`)} onDelete={() => deleteMutation.mutate(thread.id)} />)}</ul>
      </section>)}</div>;
    }
    return <section className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="flex items-center border-b border-border px-5 py-4"><h2 className="flex items-center gap-3 text-sm font-semibold"><SectionIcon icon={MessageSquare} tone="bg-primary/10 text-primary" />Conversations</h2></div>
      <ul className="divide-y divide-border">{threads.map(thread => <ThreadRow key={thread.id} thread={thread} isAdmin={false} currentUserId={user?.id} canManage={false} onOpen={() => navigate(`/messages/${thread.id}`)} />)}</ul>
    </section>;
  };

  return <div className="sh-page space-y-6">
    <ThreadListSync />
    <div className="flex items-start justify-between gap-2"><div><h1 className="text-2xl font-bold" data-testid="text-messages-title">Messages</h1><p className="mt-1 text-sm text-muted-foreground">{isAdmin ? "Conversations with customers" : "Conversations with the support team"}</p></div>{canManage && <NewConversationDialog />}</div>
    {renderThreadList()}
    {!isAdmin && !!legacyMessages?.length && <section className="mt-6 overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="flex items-center border-b border-border px-5 py-4"><h2 className="flex items-center gap-3 text-sm font-semibold"><SectionIcon icon={Inbox} tone="bg-secondary/20 text-secondary-foreground" />Previous Messages</h2></div>
      <div className="border-b border-border bg-muted/30 px-5 py-3"><p className="text-xs text-muted-foreground">One-way messages received before the conversation system.</p></div>
      <ul className="divide-y divide-border">{legacyMessages.map(message => <li key={message.id} className="px-5 py-3.5" data-testid={`card-legacy-message-${message.id}`}>
        <div className="mb-1 flex items-center justify-between gap-2"><p className={`truncate text-sm font-medium ${!message.readAt ? "text-foreground" : "text-muted-foreground"}`}>{message.subject}</p>{!message.readAt && <span className="shrink-0 rounded-full bg-status-busy/15 px-2 py-0.5 text-[10px] font-medium text-status-busy">New</span>}</div>
        <p className="mb-2 whitespace-pre-wrap text-sm text-muted-foreground">{message.body}</p><p className="flex items-center gap-1 text-[10px] text-muted-foreground"><Clock className="h-3 w-3" />{format(new Date(message.createdAt), "MMM d, yyyy 'at' h:mm a")}</p>
      </li>)}</ul>
    </section>}
    {isAdmin && !!sentMessages?.length && <section className="mt-6 overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="flex items-center border-b border-border px-5 py-4"><h2 className="flex items-center gap-3 text-sm font-semibold"><SectionIcon icon={Inbox} tone="bg-secondary/20 text-secondary-foreground" />Legacy Sent Messages</h2><Badge variant="outline" className="ml-2">{sentMessages.length}</Badge></div>
      <div className="border-b border-border bg-muted/30 px-5 py-3"><p className="text-xs text-muted-foreground">One-way messages sent before the conversation system.</p></div>
      <ul className="divide-y divide-border">{sentMessages.map(message => <li key={message.id} className="px-5 py-3.5" data-testid={`card-legacy-sent-${message.id}`}>
        <p className="mb-0.5 truncate text-sm font-medium">{message.subject}</p><p className="mb-1 text-xs text-muted-foreground">To: {userMap.get(message.recipientId) || "Unknown"}</p>
        <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">{message.body}</p><p className="flex items-center gap-1 text-[10px] text-muted-foreground"><Clock className="h-3 w-3" />{format(new Date(message.createdAt), "MMM d, yyyy 'at' h:mm a")}</p>
      </li>)}</ul>
    </section>}
  </div>;
}
