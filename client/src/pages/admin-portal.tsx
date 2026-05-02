import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Edit, Users, Server, AlertTriangle, Newspaper, RotateCcw, Shield, ShieldCheck, Mail, MailX, Send, Clock, Zap, FileText, RefreshCw, Bell, BellOff, MailOpen, Copy, Eye, EyeOff, RotateCw, MessageSquare, Crown, Tag, LifeBuoy, ChevronDown, ChevronRight, ScrollText, Search, ArrowLeft, Globe, Activity, Circle, ExternalLink, Pause, Play, Megaphone, Check, Minus } from "lucide-react";
import { format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { ClickableImage, ClickableVideo } from "@/components/image-lightbox";
import { Download, ImagePlus, X as XIcon } from "lucide-react";
import type { User, Service, ServiceAlert, AlertUpdate, NewsStory, QuickResponse, ReportRequest, ServiceUpdate, EmailTemplate, AdminRole, TicketCategory, Download as DownloadItem, UrlMonitor, MonitorIncident, Announcement } from "@shared/schema";
import { RichTextEditor, stripHtml } from "@/components/rich-text-editor";
import { ANNOUNCEMENT_ROUTES, getAnnouncementRouteLabel } from "@shared/announcement-routes";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_GROUPS, countEnabledChannels, userWantsChannel, type NotificationPrefs } from "@shared/notification-categories";

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
});

const createAlertSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  severity: z.string().default("warning"),
  status: z.string().default("investigating"),
  serviceImpact: z.string().default("degraded"),
  serviceId: z.string().min(1, "Service is required"),
  sendPush: z.boolean().default(true),
  sendEmail: z.boolean().default(true),
});

const addUpdateSchema = z.object({
  message: z.string().min(1, "Message is required"),
  status: z.string().min(1, "Status is required"),
  serviceImpact: z.string().default("no_change"),
  sendPush: z.boolean().default(true),
  sendEmail: z.boolean().default(true),
});

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

function UsersTab({ canManage = true }: { canManage?: boolean }) {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [notifPrefsExpanded, setNotifPrefsExpanded] = useState(false);
  const [editFullName, setEditFullName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editEmailNotifications, setEditEmailNotifications] = useState(true);
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
      setDetailUser(null);
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

  const openDetailDialog = (u: User) => {
    setDetailUser(u);
    setEditFullName(u.fullName);
    setEditUsername(u.username);
    setEditEmail(u.email);
    setEditRole(u.role);
    setEditEmailNotifications(u.emailNotifications !== false);
    setEditSubscribedServices(u.subscribedServices || []);
  };

  const handleSaveUser = () => {
    if (!detailUser) return;
    updateUserMutation.mutate({
      id: detailUser.id,
      data: {
        fullName: editFullName,
        username: editUsername,
        email: editEmail,
        role: editRole,
        emailNotifications: editEmailNotifications,
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold">Users ({filteredUsers?.length ?? 0}{searchQuery.trim() && users ? ` of ${users.length}` : ""})</h3>
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

      <Dialog open={!!detailUser} onOpenChange={(open) => { if (!open) setDetailUser(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-user-detail">
          <DialogHeader>
            <DialogTitle data-testid="text-user-detail-title">
              {detailUser?.fullName}
            </DialogTitle>
          </DialogHeader>
          {detailUser && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Full Name</label>
                  <Input
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    data-testid="input-edit-fullname"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Username</label>
                  <Input
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    data-testid="input-edit-username"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium mb-1 block">Email</label>
                  <Input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    data-testid="input-edit-email"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Role</label>
                  <Select value={editRole} onValueChange={setEditRole}>
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

              {detailUser.role === "customer" && (() => {
                const prefs: NotificationPrefs | null | undefined = detailUser.notificationPrefs;
                const p = countEnabledChannels(prefs, "push");
                const e = countEnabledChannels(prefs, "email");
                return (
                  <div className="border rounded-md">
                    <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Notification preferences</p>
                        <p className="text-xs text-muted-foreground">
                          Read-only view of the customer's per-category choices.
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="outline" className={`h-5 px-1.5 text-[10px] gap-1 ${pillColorClass(p.enabled, p.total)}`} title={`Push: ${p.enabled} of ${p.total} categories enabled`} data-testid="badge-detail-push-prefs">
                          <Bell className="w-3 h-3" />Push {p.enabled}/{p.total}
                        </Badge>
                        <Badge variant="outline" className={`h-5 px-1.5 text-[10px] gap-1 ${pillColorClass(e.enabled, e.total)}`} title={`Email: ${e.enabled} of ${e.total} categories enabled`} data-testid="badge-detail-email-prefs">
                          <Mail className="w-3 h-3" />Email {e.enabled}/{e.total}
                        </Badge>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
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
                      className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
                      data-testid="button-toggle-notif-prefs-grid"
                    >
                      <span>{notifPrefsExpanded ? "Hide" : "Show"} per-category breakdown</span>
                      {notifPrefsExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                    {notifPrefsExpanded && (
                      <div className="px-3 py-2 border-t space-y-3" data-testid="grid-notif-prefs">
                        {NOTIFICATION_GROUPS.map((group) => {
                          const cats = NOTIFICATION_CATEGORIES.filter((c) => c.group === group);
                          return (
                            <div key={group} className="space-y-1">
                              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">{group}</p>
                              <div className="space-y-0.5">
                                {cats.map((cat) => {
                                  const supportsPush = cat.channels.includes("push");
                                  const supportsEmail = cat.channels.includes("email");
                                  const pushOn = supportsPush && userWantsChannel(prefs, cat.key, "push");
                                  const emailOn = supportsEmail && userWantsChannel(prefs, cat.key, "email");
                                  return (
                                    <div key={cat.key} className="flex items-center gap-2 text-xs" data-testid={`grid-row-${cat.key}`}>
                                      <span className="flex-1 min-w-0 truncate">{cat.label}</span>
                                      <span className="w-12 flex items-center justify-center" title={supportsPush ? (pushOn ? "Push enabled" : "Push disabled") : "Push not applicable"}>
                                        {supportsPush ? (
                                          pushOn ? <Check className="w-3.5 h-3.5 text-green-500" data-testid={`grid-push-on-${cat.key}`} /> : <Minus className="w-3.5 h-3.5 text-muted-foreground/50" data-testid={`grid-push-off-${cat.key}`} />
                                        ) : <span className="text-muted-foreground/30">—</span>}
                                      </span>
                                      <span className="w-12 flex items-center justify-center" title={supportsEmail ? (emailOn ? "Email enabled" : "Email disabled") : "Email not applicable"}>
                                        {supportsEmail ? (
                                          emailOn ? <Check className="w-3.5 h-3.5 text-green-500" data-testid={`grid-email-on-${cat.key}`} /> : <Minus className="w-3.5 h-3.5 text-muted-foreground/50" data-testid={`grid-email-off-${cat.key}`} />
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

              <div>
                <label className="text-sm font-medium mb-2 block">Subscribed Services</label>
                {services && services.length > 0 ? (
                  <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                    {services.map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
                        data-testid={`label-service-${s.id}`}
                      >
                        <input
                          type="checkbox"
                          checked={editSubscribedServices.includes(s.id)}
                          onChange={() => toggleService(s.id)}
                          className="rounded border-input h-4 w-4 accent-primary"
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
                      setDetailUser(null);
                      setSelectedUser(detailUser);
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
                          onClick={() => { deleteMutation.mutate(detailUser.id); setDetailUser(null); }}
                          data-testid="button-confirm-delete-user"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setDetailUser(null)} data-testid="button-detail-cancel">
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
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
        isMobile ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-32" />
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-4 w-14 rounded-full" />
                      </div>
                      <Skeleton className="h-3 w-40" />
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Skeleton className="h-3.5 w-3.5 rounded-full" />
                      <Skeleton className="h-3.5 w-3.5 rounded-full" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-2 pt-2 border-t">
                    <Skeleton className="h-7 w-14" />
                    <Skeleton className="h-7 w-16" />
                    <Skeleton className="h-7 w-14" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Notifications</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-4 rounded-full" />
                        <Skeleton className="h-4 w-4 rounded-full" />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Skeleton className="h-8 w-16" />
                        <Skeleton className="h-8 w-16" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )
      ) : filteredUsers?.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Search className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {searchQuery.trim() ? `No users matching "${searchQuery.trim()}"` : "No users found"}
            </p>
          </CardContent>
        </Card>
      ) : isMobile ? (
        <div className="space-y-2">
          {filteredUsers?.map((u) => (
            <Card
              key={u.id}
              className="cursor-pointer active:bg-accent/50 transition-colors"
              onClick={() => openDetailDialog(u)}
              data-testid={`row-user-${u.id}`}
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {newUserIds.includes(u.id) && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" data-testid={`dot-new-user-${u.id}`} />}
                      <span className="font-medium text-sm truncate">{u.fullName}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">@{u.username}</span>
                      <Badge variant={u.role === "admin" || u.role === "master_admin" ? "default" : "secondary"} className="text-[10px] capitalize px-1.5 py-0">
                        {u.role === "master_admin" ? "Master Admin" : u.role}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 pt-0.5 flex-wrap justify-end">
                    <span title={pushStatus?.[u.id] ? "Push device registered" : "No push device registered"} data-testid={`icon-push-${u.id}`}>
                      {pushStatus?.[u.id] ? <Bell className="w-3.5 h-3.5 text-green-500" /> : <BellOff className="w-3.5 h-3.5 text-muted-foreground/40" />}
                    </span>
                    {u.role === "customer" && (() => {
                      const prefs: NotificationPrefs | null | undefined = u.notificationPrefs;
                      const p = countEnabledChannels(prefs, "push");
                      const e = countEnabledChannels(prefs, "email");
                      return (
                        <>
                          <Badge variant="outline" className={`h-5 px-1 text-[10px] gap-0.5 ${pillColorClass(p.enabled, p.total)}`} title={`Push: ${p.enabled} of ${p.total} categories enabled`} data-testid={`badge-push-prefs-${u.id}`}>
                            <Bell className="w-2.5 h-2.5" />Push {p.enabled}/{p.total}
                          </Badge>
                          <Badge variant="outline" className={`h-5 px-1 text-[10px] gap-0.5 ${pillColorClass(e.enabled, e.total)}`} title={`Email: ${e.enabled} of ${e.total} categories enabled`} data-testid={`badge-email-prefs-${u.id}`}>
                            <Mail className="w-2.5 h-2.5" />Email {e.enabled}/{e.total}
                          </Badge>
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-2 pt-2 border-t" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => openDetailDialog(u)} data-testid={`button-view-user-${u.id}`}>
                    <Edit className="w-3 h-3" /> Edit
                  </Button>
                  {canManage && u.role !== "master_admin" && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => toggleRoleMutation.mutate({ id: u.id, role: u.role === "admin" ? "customer" : "admin" })} data-testid={`button-toggle-role-${u.id}`}>
                      {u.role === "admin" ? <Shield className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                      {u.role === "admin" ? "Demote" : "Promote"}
                    </Button>
                  )}
                  {canManage && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => { setSelectedUser(u); setResetDialogOpen(true); }} data-testid={`button-reset-password-${u.id}`}>
                      <RotateCcw className="w-3 h-3" /> Reset
                    </Button>
                  )}
                  {canManage && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-destructive" onClick={() => deleteMutation.mutate(u.id)} data-testid={`button-delete-user-${u.id}`}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Notifications</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers?.map((u) => (
                <TableRow
                  key={u.id}
                  className="cursor-pointer"
                  onClick={() => openDetailDialog(u)}
                  data-testid={`row-user-${u.id}`}
                >
                  <TableCell className="font-medium text-sm">
                    <span className="flex items-center gap-1.5">
                      {newUserIds.includes(u.id) && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" data-testid={`dot-new-user-${u.id}`} />}
                      {u.fullName}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{u.username}</TableCell>
                  <TableCell className="text-sm">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" || u.role === "master_admin" ? "default" : "secondary"} className="text-xs capitalize">
                      {u.role === "master_admin" ? "Master Admin" : u.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span title={pushStatus?.[u.id] ? "Push device registered" : "No push device registered"} data-testid={`icon-push-${u.id}`}>
                        {pushStatus?.[u.id] ? <Bell className="w-4 h-4 text-green-500" /> : <BellOff className="w-4 h-4 text-muted-foreground/40" />}
                      </span>
                      {u.role === "customer" && (() => {
                        const prefs: NotificationPrefs | null | undefined = u.notificationPrefs;
                        const p = countEnabledChannels(prefs, "push");
                        const e = countEnabledChannels(prefs, "email");
                        return (
                          <>
                            <Badge variant="outline" className={`h-5 px-1.5 text-[10px] gap-1 ${pillColorClass(p.enabled, p.total)}`} title={`Push: ${p.enabled} of ${p.total} categories enabled`} data-testid={`badge-push-prefs-${u.id}`}>
                              <Bell className="w-3 h-3" />Push {p.enabled}/{p.total}
                            </Badge>
                            <Badge variant="outline" className={`h-5 px-1.5 text-[10px] gap-1 ${pillColorClass(e.enabled, e.total)}`} title={`Email: ${e.enabled} of ${e.total} categories enabled`} data-testid={`badge-email-prefs-${u.id}`}>
                              <Mail className="w-3 h-3" />Email {e.enabled}/{e.total}
                            </Badge>
                          </>
                        );
                      })()}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openDetailDialog(u)}
                        title="View/Edit User"
                        data-testid={`button-view-user-${u.id}`}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      {canManage && u.role !== "master_admin" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => toggleRoleMutation.mutate({ id: u.id, role: u.role === "admin" ? "customer" : "admin" })}
                          data-testid={`button-toggle-role-${u.id}`}
                        >
                          {u.role === "admin" ? <Shield className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                        </Button>
                      )}
                      {canManage && <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => { setSelectedUser(u); setResetDialogOpen(true); }}
                        data-testid={`button-reset-password-${u.id}`}
                      >
                        <RotateCcw className="w-4 h-4" />
                      </Button>}
                      {canManage && <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(u.id)}
                        data-testid={`button-delete-user-${u.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ServicesTab({ canManage = true }: { canManage?: boolean }) {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data: services, isLoading } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const form = useForm({
    resolver: zodResolver(createServiceSchema),
    defaultValues: { name: "", description: "", category: "", status: "operational" },
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
    form.reset({ name: s.name, description: s.description || "", category: s.category || "", status: s.status });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold">Services ({services?.length || 0})</h3>
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
                <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-submit-service">
                  {createMutation.isPending ? "Saving..." : editId ? "Update Service" : "Add Service"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <Skeleton className="h-40" /> : isMobile ? (
        <div className="space-y-2">
          {services?.map((s) => (
            <Card key={s.id} data-testid={`row-service-${s.id}`}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-sm">{s.name}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      {s.category && <span className="text-xs text-muted-foreground">{s.category}</span>}
                      <Badge variant="secondary" className="text-[10px] capitalize px-1.5 py-0">{s.status}</Badge>
                    </div>
                    {s.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{s.description}</p>}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => openEdit(s)} data-testid={`button-edit-service-${s.id}`}>
                        <Edit className="w-3 h-3" /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-destructive" onClick={() => deleteMutation.mutate(s.id)} data-testid={`button-delete-service-${s.id}`}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services?.map((s) => (
                <TableRow key={s.id} data-testid={`row-service-${s.id}`}>
                  <TableCell className="font-medium text-sm">{s.name}</TableCell>
                  <TableCell className="text-sm">{s.category || "-"}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-xs capitalize">{s.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {canManage && <Button size="icon" variant="ghost" onClick={() => openEdit(s)} data-testid={`button-edit-service-${s.id}`}>
                        <Edit className="w-4 h-4" />
                      </Button>}
                      {canManage && <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(s.id)} data-testid={`button-delete-service-${s.id}`}>
                        <Trash2 className="w-4 h-4" />
                      </Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

function AlertsTab({ canManage = true }: { canManage?: boolean }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [alertImageFile, setAlertImageFile] = useState<File | null>(null);
  const [updateImageFile, setUpdateImageFile] = useState<File | null>(null);
  const [editAlertDialogOpen, setEditAlertDialogOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState<ServiceAlert | null>(null);
  const [editAlertTitle, setEditAlertTitle] = useState("");
  const [editAlertDesc, setEditAlertDesc] = useState("");
  const [editAlertSeverity, setEditAlertSeverity] = useState("warning");
  const [editAlertImageFile, setEditAlertImageFile] = useState<File | null>(null);
  const [editAlertRemoveImage, setEditAlertRemoveImage] = useState(false);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolveAlertId, setResolveAlertId] = useState<string | null>(null);
  const [resolveMessage, setResolveMessage] = useState("");
  const [resolveImageFile, setResolveImageFile] = useState<File | null>(null);
  const [editUpdateDialogOpen, setEditUpdateDialogOpen] = useState(false);
  const [editingAlertUpdate, setEditingAlertUpdate] = useState<{ alertId: string; update: AlertUpdate } | null>(null);
  const [editUpdateMessage, setEditUpdateMessage] = useState("");
  const [editUpdateImageFile, setEditUpdateImageFile] = useState<File | null>(null);
  const [editUpdateRemoveImage, setEditUpdateRemoveImage] = useState(false);
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);
  const [expandedAlertCardId, setExpandedAlertCardId] = useState<string | null>(null);

  const { data: alerts, isLoading } = useQuery<ServiceAlert[]>({
    queryKey: ["/api/alerts"],
  });
  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const form = useForm({
    resolver: zodResolver(createAlertSchema),
    defaultValues: { title: "", description: "", severity: "warning", status: "investigating", serviceImpact: "degraded", serviceId: "", sendPush: true, sendEmail: true },
  });

  const updateForm = useForm({
    resolver: zodResolver(addUpdateSchema),
    defaultValues: { message: "", status: "investigating", serviceImpact: "no_change", sendPush: true, sendEmail: true },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof createAlertSchema>) => {
      const formData = new FormData();
      Object.entries(data).forEach(([k, v]) => formData.append(k, String(v)));
      if (alertImageFile) formData.append("image", alertImageFile);
      const res = await fetch("/api/admin/alerts", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to create alert");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setDialogOpen(false);
      form.reset();
      setAlertImageFile(null);
      toast({ title: "Alert created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addUpdateMutation = useMutation({
    mutationFn: async (data: z.infer<typeof addUpdateSchema>) => {
      const formData = new FormData();
      Object.entries(data).forEach(([k, v]) => formData.append(k, String(v)));
      if (updateImageFile) formData.append("image", updateImageFile);
      const res = await fetch(`/api/admin/alerts/${selectedAlertId}/updates`, { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to post update");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      if (selectedAlertId) queryClient.invalidateQueries({ queryKey: ["/api/alerts", selectedAlertId, "updates"] });
      setUpdateDialogOpen(false);
      updateForm.reset();
      setUpdateImageFile(null);
      toast({ title: "Update posted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editAlertMutation = useMutation({
    mutationFn: async ({ id, data, imageFile, removeImage }: { id: string; data: { title: string; description: string; severity: string }; imageFile: File | null; removeImage: boolean }) => {
      const formData = new FormData();
      formData.append("title", data.title);
      formData.append("description", data.description);
      formData.append("severity", data.severity);
      if (imageFile) formData.append("image", imageFile);
      if (removeImage) formData.append("removeImage", "true");
      const res = await fetch(`/api/admin/alerts/${id}`, { method: "PATCH", body: formData, credentials: "include" });
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
    mutationFn: async ({ id, message, imageFile }: { id: string; message: string; imageFile: File | null }) => {
      const formData = new FormData();
      if (message) formData.append("message", message);
      if (imageFile) formData.append("image", imageFile);
      const res = await fetch(`/api/admin/alerts/${id}/resolve`, { method: "PATCH", body: formData, credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to resolve alert");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setResolveDialogOpen(false);
      setResolveAlertId(null);
      setResolveMessage("");
      setResolveImageFile(null);
      toast({ title: "Alert resolved" });
    },
  });

  const editUpdateMutation = useMutation({
    mutationFn: async ({ alertId, updateId, message, imageFile, removeImage }: { alertId: string; updateId: string; message: string; imageFile: File | null; removeImage: boolean }) => {
      const formData = new FormData();
      formData.append("message", message);
      if (imageFile) formData.append("image", imageFile);
      if (removeImage) formData.append("removeImage", "true");
      const res = await fetch(`/api/admin/alerts/${alertId}/updates/${updateId}`, { method: "PATCH", body: formData, credentials: "include" });
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

  const serviceMap = new Map(services?.map((s) => [s.id, s.name]) || []);

  const openEditAlert = (alert: ServiceAlert) => {
    setEditingAlert(alert);
    setEditAlertTitle(alert.title);
    setEditAlertDesc(alert.description);
    setEditAlertSeverity(alert.severity);
    setEditAlertImageFile(null);
    setEditAlertRemoveImage(false);
    setEditAlertDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold">Alerts ({alerts?.length || 0})</h3>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setAlertImageFile(null); }}>
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
                  <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea data-testid="input-alert-desc" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="serviceId" render={({ field }) => (
                  <FormItem><FormLabel>Service</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-alert-service"><SelectValue placeholder="Select service" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {services?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
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
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-alert-push" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="sendEmail" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <FormLabel className="text-sm font-medium">Send Email to Subscribers</FormLabel>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-alert-email" /></FormControl>
                  </FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-submit-alert">
                  {createMutation.isPending ? "Creating..." : "Create Alert"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={updateDialogOpen} onOpenChange={(open) => { setUpdateDialogOpen(open); if (!open) setUpdateImageFile(null); }}>
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
              <FormField control={updateForm.control} name="message" render={({ field }) => (
                <FormItem><FormLabel>Message</FormLabel><FormControl><Textarea data-testid="input-update-message" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="space-y-2">
                <Label>Attach Image (optional)</Label>
                <Input type="file" accept="image/*" onChange={(e) => setUpdateImageFile(e.target.files?.[0] || null)} data-testid="input-update-image" />
                {updateImageFile && <img src={URL.createObjectURL(updateImageFile)} alt="Preview" className="max-h-24 rounded-md" />}
              </div>
              <FormField control={updateForm.control} name="sendPush" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <FormLabel className="text-sm font-medium">Send Push Notification</FormLabel>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-update-push" /></FormControl>
                </FormItem>
              )} />
              <FormField control={updateForm.control} name="sendEmail" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <FormLabel className="text-sm font-medium">Send Email to Subscribers</FormLabel>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-update-email" /></FormControl>
                </FormItem>
              )} />
              <Button type="submit" className="w-full" disabled={addUpdateMutation.isPending} data-testid="button-submit-update">
                {addUpdateMutation.isPending ? "Posting..." : "Post Update"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={editAlertDialogOpen} onOpenChange={(open) => { if (!open) { setEditAlertDialogOpen(false); setEditingAlert(null); setEditAlertImageFile(null); setEditAlertRemoveImage(false); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Alert</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {editingAlert && <p className="text-sm text-muted-foreground">Service: {serviceMap.get(editingAlert.serviceId) || "Unknown"}</p>}
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={editAlertTitle} onChange={(e) => setEditAlertTitle(e.target.value)} data-testid="input-edit-alert-title" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={editAlertDesc} onChange={(e) => setEditAlertDesc(e.target.value)} rows={3} data-testid="input-edit-alert-desc" />
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
              disabled={editAlertMutation.isPending || !editAlertTitle.trim() || !editAlertDesc.trim()}
              onClick={() => editingAlert && editAlertMutation.mutate({ id: editingAlert.id, data: { title: editAlertTitle, description: editAlertDesc, severity: editAlertSeverity }, imageFile: editAlertImageFile, removeImage: editAlertRemoveImage })}
              data-testid="button-save-edit-alert"
            >
              {editAlertMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={resolveDialogOpen} onOpenChange={(open) => { if (!open) { setResolveDialogOpen(false); setResolveAlertId(null); setResolveMessage(""); setResolveImageFile(null); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader><DialogTitle>Resolve Alert</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Resolve Message (optional)</Label>
              <Textarea value={resolveMessage} onChange={(e) => setResolveMessage(e.target.value)} placeholder="Issue has been resolved." rows={3} data-testid="input-resolve-message" />
            </div>
            <div className="space-y-2">
              <Label>Attach Image (optional)</Label>
              <Input type="file" accept="image/*" onChange={(e) => setResolveImageFile(e.target.files?.[0] || null)} data-testid="input-resolve-image" />
              {resolveImageFile && <img src={URL.createObjectURL(resolveImageFile)} alt="Preview" className="max-h-20 rounded-md" />}
            </div>
            <Button
              className="w-full"
              disabled={resolveMutation.isPending}
              onClick={() => resolveAlertId && resolveMutation.mutate({ id: resolveAlertId, message: resolveMessage, imageFile: resolveImageFile })}
              data-testid="button-confirm-resolve"
            >
              {resolveMutation.isPending ? "Resolving..." : "Resolve Alert"}
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
              <Textarea value={editUpdateMessage} onChange={(e) => setEditUpdateMessage(e.target.value)} rows={3} data-testid="input-edit-update-message" />
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
              disabled={editUpdateMutation.isPending || !editUpdateMessage.trim()}
              onClick={() => editingAlertUpdate && editUpdateMutation.mutate({ alertId: editingAlertUpdate.alertId, updateId: editingAlertUpdate.update.id, message: editUpdateMessage, imageFile: editUpdateImageFile, removeImage: editUpdateRemoveImage })}
              data-testid="button-save-edit-update"
            >
              {editUpdateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? <Skeleton className="h-40" /> : (
        <div className="space-y-3">
          {alerts?.map((alert) => (
            <Card key={alert.id} data-testid={`card-admin-alert-${alert.id}`}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2 cursor-pointer" onClick={() => setExpandedAlertCardId(expandedAlertCardId === alert.id ? null : alert.id)} data-testid={`button-expand-alert-${alert.id}`}>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {expandedAlertCardId === alert.id ? <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
                    <h4 className="font-semibold text-sm min-w-0 truncate">{alert.title}</h4>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Badge variant={alert.severity === "critical" ? "destructive" : "secondary"} className="text-[10px] capitalize">{alert.severity}</Badge>
                    <Badge variant={alert.status === "resolved" ? "secondary" : "default"} className="text-[10px] capitalize">{alert.status}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap pl-6">
                  {serviceMap.get(alert.serviceId) && <Badge variant="secondary" className="text-[10px]">{serviceMap.get(alert.serviceId)}</Badge>}
                  <span className="text-[10px] text-muted-foreground">{format(new Date(alert.createdAt), "MMM d, yyyy h:mm a")}</span>
                </div>
                {expandedAlertCardId === alert.id && (
                  <div className="space-y-2 pt-1 pl-6">
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{alert.description}</p>
                    {alert.imageUrl && <ClickableImage src={alert.imageUrl} alt="Alert image" className="max-h-24 rounded-md" />}
                    <div className="flex items-center gap-1 flex-wrap">
                      {canManage && (
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openEditAlert(alert); }} data-testid={`button-edit-alert-${alert.id}`}>
                          <Edit className="w-3 h-3 mr-1" /> Edit
                        </Button>
                      )}
                      {canManage && alert.status !== "resolved" && (
                        <>
                          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setSelectedAlertId(alert.id); setUpdateDialogOpen(true); }} data-testid={`button-update-alert-${alert.id}`}>
                            Update
                          </Button>
                          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setResolveAlertId(alert.id); setResolveDialogOpen(true); }} data-testid={`button-resolve-alert-${alert.id}`}>
                            Resolve
                          </Button>
                        </>
                      )}
                      {canManage && <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="text-destructive" data-testid={`button-delete-alert-${alert.id}`}>
                            <Trash2 className="w-3 h-3 mr-1" /> Delete
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
                    <Button variant="ghost" size="sm" className="text-xs" onClick={(e) => { e.stopPropagation(); setExpandedAlertId(expandedAlertId === alert.id ? null : alert.id); }} data-testid={`button-toggle-updates-${alert.id}`}>
                      {expandedAlertId === alert.id ? "Hide Updates" : "Show Updates"}
                    </Button>
                    {expandedAlertId === alert.id && <AlertUpdatesList alertId={alert.id} canManage={canManage} onEditUpdate={(update) => { setEditingAlertUpdate({ alertId: alert.id, update }); setEditUpdateMessage(update.message); setEditUpdateImageFile(null); setEditUpdateRemoveImage(false); setEditUpdateDialogOpen(true); }} />}
                  </div>
                )}
              </CardContent>
            </Card>
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

  if (isLoading) return <Skeleton className="h-16" />;
  if (!updates || updates.length === 0) return <p className="text-xs text-muted-foreground text-center py-2">No updates yet</p>;

  return (
    <div className="space-y-2 border-t pt-2">
      {updates.map((update) => (
        <div key={update.id} className="flex items-start justify-between gap-2 p-2 rounded bg-muted/50" data-testid={`alert-update-entry-${update.id}`}>
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs capitalize">{update.status}</Badge>
              <span className="text-xs text-muted-foreground">{format(new Date(update.createdAt), "MMM d, h:mm a")}</span>
            </div>
            <p className="text-xs whitespace-pre-wrap">{update.message}</p>
            {update.imageUrl && <ClickableImage src={update.imageUrl} alt="Update image" className="max-h-20 rounded-md mt-1" />}
          </div>
          {canManage && (
            <Button size="icon" variant="ghost" className="flex-shrink-0" onClick={() => onEditUpdate(update)} data-testid={`button-edit-update-${update.id}`}>
              <Edit className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      ))}
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

  const { data: news, isLoading } = useQuery<NewsStory[]>({
    queryKey: ["/api/news"],
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

      const res = await fetch("/api/admin/news", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/news"] });
      setDialogOpen(false);
      form.reset();
      setImageFile(null);
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

      const res = await fetch(`/api/admin/news/${editingStory.id}`, {
        method: "PATCH",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/news"] });
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold">News Stories ({news?.length || 0})</h3>
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
                      <RichTextEditor value={field.value} onChange={field.onChange} testIdPrefix="create-news" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div>
                  <label className="text-sm font-medium">Cover Image (optional)</label>
                  <Input type="file" accept="image/*" className="mt-1" onChange={(e) => setImageFile(e.target.files?.[0] || null)} data-testid="input-news-image" />
                </div>
                <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-submit-news">
                  {createMutation.isPending ? "Publishing..." : "Publish Story"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <Skeleton className="h-40" /> : (
        <div className="space-y-3">
          {news?.map((story) => (
            <Card key={story.id} data-testid={`card-admin-news-${story.id}`}>
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div className="flex items-start gap-3">
                  {story.imageUrl && (
                    <img src={story.imageUrl} alt="" className="w-16 h-12 rounded-md object-cover flex-shrink-0" />
                  )}
                  <div className="space-y-0.5">
                    <h4 className="font-semibold text-sm">{story.title}</h4>
                    <p className="text-xs text-muted-foreground line-clamp-1">{stripHtml(story.content)}</p>
                  </div>
                </div>
                {canManage && <div className="flex gap-1 flex-shrink-0">
                  <Button size="icon" variant="ghost" onClick={() => openEditDialog(story)} data-testid={`button-edit-news-${story.id}`}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(story.id)} data-testid={`button-delete-news-${story.id}`}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
                    <RichTextEditor value={field.value} onChange={field.onChange} testIdPrefix="edit-news" />
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

const newThreadSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Message is required"),
});

type AdminEnrichedThread = {
  id: string;
  adminId: string;
  customerId: string;
  subject: string;
  lastMessageAt: string;
  createdAt: string;
  adminName: string;
  customerName: string;
  lastMessage: { body: string; senderId: string; createdAt: string } | null;
  unreadCount: number;
};

type AdminThreadMsg = {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  senderName?: string;
};

function AdminThreadChat({ threadId, onBack, userId }: { threadId: string; onBack: () => void; userId: string }) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef<number>(0);
  const isNearBottomRef = useRef(true);
  const prevCountRef = useRef(0);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const { user } = useAuth();

  const { data: thread } = useQuery<AdminEnrichedThread>({
    queryKey: ["/api/message-threads", threadId],
  });

  const { data: messages, isLoading } = useQuery<AdminThreadMsg[]>({
    queryKey: ["/api/message-threads", threadId, "messages"],
    refetchInterval: 5000,
  });

  const markRead = useMutation({
    mutationFn: async () => { await apiRequest("PATCH", `/api/message-threads/${threadId}/read`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/message-threads/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
    },
  });

  useEffect(() => { markRead.mutate(); }, [threadId]);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    function connect() {
      if (disposed) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => { ws!.send(JSON.stringify({ type: "viewing_thread", threadId, userId })); };
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === "thread_message" && d.threadId === threadId) {
            queryClient.invalidateQueries({ queryKey: ["/api/message-threads", threadId, "messages"] });
            queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
            setTypingUser(null);
            markRead.mutate();
          }
          if (d.type === "thread_messages_read" && d.threadId === threadId && d.readBy !== userId) {
            queryClient.invalidateQueries({ queryKey: ["/api/message-threads", threadId, "messages"] });
          }
          if (d.type === "thread_typing" && d.threadId === threadId && d.userId !== userId) {
            setTypingUser(d.userName);
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 3000);
          }
        } catch {}
      };
      ws.onclose = () => { wsRef.current = null; if (!disposed) reconnect = setTimeout(connect, 2000); };
      ws.onerror = () => ws?.close();
    }
    connect();
    const handleVis = () => {
      if (document.visibilityState === "visible") {
        markRead.mutate();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "viewing_thread", threadId, userId }));
        } else connect();
      }
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVis);
      if (reconnect) clearTimeout(reconnect);
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "left_thread", threadId, userId }));
      ws?.close();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [threadId, userId]);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  };
  useEffect(() => {
    const count = messages?.length || 0;
    if (count > prevCountRef.current && prevCountRef.current > 0 && isNearBottomRef.current) scrollToBottom();
    else if (count > 0 && prevCountRef.current === 0) scrollToBottom("auto");
    prevCountRef.current = count;
  }, [messages]);

  const sendTyping = () => {
    if (Date.now() - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = Date.now();
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN && user) {
      ws.send(JSON.stringify({ type: "thread_typing", threadId, userId, userName: user.fullName }));
    }
  };

  const sendMut = useMutation({
    mutationFn: async (body: string) => {
      const r = await fetch(`/api/message-threads/${threadId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }), credentials: "include",
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/message-threads", threadId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
    },
    onError: () => toast({ title: "Failed to send", variant: "destructive" }),
  });

  const handleSend = () => {
    const t = message.trim();
    if (!t) return;
    setMessage("");
    sendMut.mutate(t);
    if (isNearBottomRef.current) setTimeout(() => scrollToBottom(), 50);
    setTimeout(() => {
      const el = messageInputRef.current;
      if (el) { el.style.height = "auto"; el.focus(); }
    }, 0);
  };

  return (
    <div className="flex flex-col h-[500px] sm:h-[600px]" data-testid="admin-thread-chat">
      <div className="flex items-center gap-2 p-2 border-b flex-shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} data-testid="button-admin-thread-back">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{thread?.subject || "Loading..."}</p>
          <p className="text-xs text-muted-foreground truncate">{thread?.customerName}</p>
        </div>
      </div>
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-1 min-h-0">
        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-3/4" />)}</div>
        ) : (messages || []).map((msg, idx) => {
          const isMe = msg.senderId === userId;
          const msgDate = new Date(msg.createdAt);
          const prevDate = idx > 0 ? new Date((messages || [])[idx - 1].createdAt) : null;
          const dayStr = (d: Date) => d.toDateString();
          const showSep = !prevDate || dayStr(msgDate) !== dayStr(prevDate);
          return (
            <div key={msg.id}>
              {showSep && (
                <div className="flex items-center justify-center my-3">
                  <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{format(msgDate, "MMMM d, yyyy")}</span>
                </div>
              )}
              <div className={`flex ${isMe ? "justify-end" : "justify-start"} mb-1`}>
                <div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-2 ${isMe ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {!isMe && <p className="text-[10px] font-medium mb-0.5 opacity-70">{msg.senderName}</p>}
                  <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                  <p className={`text-[10px] mt-0.5 ${isMe ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                    {format(msgDate, "h:mm a")}
                    {isMe && msg.readAt && <span className="ml-1.5">· Read</span>}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      <div className="border-t p-2 flex-shrink-0">
        {typingUser && (
          <div className="flex items-center gap-1.5 mb-1.5 px-1">
            <span className="text-xs text-muted-foreground">{typingUser} is typing</span>
            <span className="inline-flex items-center gap-0.5">
              {[0, 1, 2].map(i => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground" style={{ animation: "bounce-dot 1.4s infinite ease-in-out both", animationDelay: `${i * 0.16}s` }} />
              ))}
            </span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            ref={messageInputRef}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              if (e.target.value.trim()) sendTyping();
              const el = e.target;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend(); }
            }}
            placeholder="Type a message..."
            className="flex-1 min-h-[36px] max-h-[120px] resize-none text-sm"
            rows={1}
            data-testid="input-admin-thread-message"
          />
          <Button size="icon" className="flex-shrink-0 h-9 w-9" onClick={handleSend} disabled={!message.trim() || sendMut.isPending} data-testid="button-admin-send-thread">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessagesTab({ canManage = true }: { canManage?: boolean }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const { data: users } = useQuery<User[]>({ queryKey: ["/api/admin/users"] });
  const { data: threads, isLoading } = useQuery<AdminEnrichedThread[]>({
    queryKey: ["/api/message-threads"],
    refetchInterval: 15000,
  });
  const { data: sentMessages } = useQuery<import("@shared/schema").PrivateMessage[]>({
    queryKey: ["/api/admin/private-messages/sent"],
  });
  const userMap = new Map(users?.map((u) => [u.id, u.fullName]) || []);

  const customers = users?.filter((u) => u.role === "customer") || [];

  const form = useForm({
    resolver: zodResolver(newThreadSchema),
    defaultValues: { customerId: "", subject: "", body: "" },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof newThreadSchema>) => {
      const res = await fetch("/api/message-threads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data), credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: (data) => {
      setDialogOpen(false);
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
      toast({ title: "Conversation started" });
      if (data.thread?.id) setActiveThreadId(data.thread.id);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/message-threads/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
      toast({ title: "Thread deleted" });
      setActiveThreadId(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (activeThreadId && user) {
    return (
      <div className="space-y-4">
        <AdminThreadChat threadId={activeThreadId} onBack={() => setActiveThreadId(null)} userId={user.id} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold">Conversations</h3>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          {canManage && <DialogTrigger asChild>
            <Button size="sm" data-testid="button-new-conversation"><MessageSquare className="w-4 h-4 mr-1" /> New Conversation</Button>
          </DialogTrigger>}
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
            <DialogHeader><DialogTitle>Start Conversation</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="space-y-3">
                <FormField control={form.control} name="customerId" render={({ field }) => (
                  <FormItem><FormLabel>Customer</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-thread-customer"><SelectValue placeholder="Select a customer" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {customers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>{u.fullName} (@{u.username})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  <FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="subject" render={({ field }) => (
                  <FormItem><FormLabel>Subject</FormLabel><FormControl><Input data-testid="input-thread-subject" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="body" render={({ field }) => (
                  <FormItem><FormLabel>First Message</FormLabel><FormControl><Textarea className="min-h-[100px]" data-testid="input-thread-body" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-start-conversation">
                  {createMutation.isPending ? "Starting..." : "Start Conversation"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : !threads || threads.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <div className="text-center py-6">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-threads">No conversations yet. Start one using the button above.</p>
            </div>
          </CardContent>
        </Card>
      ) : (() => {
        const grouped = new Map<string, AdminEnrichedThread[]>();
        threads.forEach((t) => {
          const key = t.customerId;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(t);
        });
        const groups = Array.from(grouped.entries()).sort((a, b) => {
          const aLatest = Math.max(...a[1].map(t => new Date(t.lastMessageAt).getTime()));
          const bLatest = Math.max(...b[1].map(t => new Date(t.lastMessageAt).getTime()));
          return bLatest - aLatest;
        });
        return (
          <div className="space-y-4">
            {groups.map(([customerId, customerThreads]) => (
              <div key={customerId}>
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <h4 className="text-sm font-medium">{customerThreads[0].customerName}</h4>
                  <Badge variant="outline" className="text-[10px]">{customerThreads.length}</Badge>
                </div>
                <div className="space-y-2 ml-6">
                  {customerThreads.map((t) => (
                    <Card
                      key={t.id}
                      className={`cursor-pointer hover-elevate transition-colors ${t.unreadCount > 0 ? "border-primary/40 bg-primary/5" : ""}`}
                      onClick={() => setActiveThreadId(t.id)}
                      data-testid={`card-admin-thread-${t.id}`}
                    >
                      <CardContent className="flex items-center justify-between gap-3 p-3 sm:p-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-medium truncate ${t.unreadCount > 0 ? "" : "text-muted-foreground"}`}>{t.subject}</p>
                            {t.unreadCount > 0 && (
                              <Badge variant="destructive" className="text-[10px] h-5 min-w-5 flex items-center justify-center px-1">{t.unreadCount}</Badge>
                            )}
                          </div>
                          {t.lastMessage && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {t.lastMessage.senderId === user?.id ? "You: " : ""}{t.lastMessage.body}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[10px] text-muted-foreground">
                            {t.lastMessage ? format(new Date(t.lastMessage.createdAt), "MMM d") : format(new Date(t.createdAt), "MMM d")}
                          </span>
                          {canManage && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => e.stopPropagation()} data-testid={`button-delete-thread-${t.id}`}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Conversation</AlertDialogTitle>
                                  <AlertDialogDescription>Delete this entire conversation and all messages? This cannot be undone.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteMutation.mutate(t.id)} data-testid="button-confirm-delete-thread">Delete</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {sentMessages && sentMessages.length > 0 && (
        <div className="space-y-3 mt-6">
          <h4 className="font-medium text-sm text-muted-foreground">Legacy Sent Messages ({sentMessages.length})</h4>
          <p className="text-xs text-muted-foreground">One-way messages sent before the conversation system.</p>
          {sentMessages.map((msg) => (
            <Card key={msg.id} data-testid={`card-legacy-sent-${msg.id}`}>
              <CardContent className="p-3 sm:p-4 space-y-1">
                <p className="text-sm font-medium truncate">{msg.subject}</p>
                <p className="text-xs text-muted-foreground">To: {userMap.get(msg.recipientId) || "Unknown"}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{msg.body}</p>
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {format(new Date(msg.createdAt), "MMM d, yyyy 'at' h:mm a")}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const quickResponseSchema = z.object({
  title: z.string().min(1, "Title is required"),
  message: z.string().min(1, "Message is required"),
});

function QuickResponsesTab({ canManage = true }: { canManage?: boolean }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingQr, setEditingQr] = useState<QuickResponse | null>(null);

  const { data: quickResponses, isLoading } = useQuery<QuickResponse[]>({
    queryKey: ["/api/admin/quick-responses"],
  });

  const form = useForm({
    resolver: zodResolver(quickResponseSchema),
    defaultValues: { title: "", message: "" },
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

  const openEdit = (qr: QuickResponse) => {
    setEditingQr(qr);
    form.setValue("title", qr.title);
    form.setValue("message", qr.message);
    setDialogOpen(true);
  };

  const openCreate = () => {
    setEditingQr(null);
    form.reset();
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" data-testid="text-quick-responses-title">Quick Responses</h2>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setEditingQr(null); form.reset(); } }}>
          {canManage && <DialogTrigger asChild>
            <Button size="sm" onClick={openCreate} data-testid="button-add-quick-response">
              <Plus className="w-4 h-4 mr-1" /> Add Response
            </Button>
          </DialogTrigger>}
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingQr ? "Edit Quick Response" : "Add Quick Response"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => editingQr ? updateMutation.mutate(data) : createMutation.mutate(data))} className="space-y-4">
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g. Billing Question" data-testid="input-qr-title" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="message" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Message</FormLabel>
                    <FormControl><Textarea {...field} rows={4} placeholder="The response text to send..." data-testid="input-qr-message" /></FormControl>
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

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : !quickResponses || quickResponses.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Zap className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No quick responses yet. Add one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {quickResponses.map((qr) => (
            <Card key={qr.id} data-testid={`card-quick-response-${qr.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm" data-testid={`text-qr-title-${qr.id}`}>{qr.title}</p>
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
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
    <div className="space-y-4">
      <h2 className="text-lg font-semibold" data-testid="text-reports-requests-title">Reports & Requests</h2>
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : !reports || reports.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <FileText className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No reports or requests yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((rr) => (
            <Card key={rr.id} data-testid={`card-report-${rr.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
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
                            <ClickableVideo src={rr.imageUrl} className="max-h-32" />
                            <a href={rr.imageUrl} download target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid={`link-download-video-${rr.id}`}>
                              <Download className="w-3 h-3" />
                              <span>Download</span>
                            </a>
                          </div>
                        ) : (
                          <div>
                            <ClickableImage src={rr.imageUrl} alt="Attachment" className="max-h-32 rounded-md" />
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
                  {canManage && <div className="flex items-center gap-1 flex-shrink-0">
                    <Button size="sm" variant="outline" onClick={() => openUpdateDialog(rr)} data-testid={`button-update-report-${rr.id}`}>
                      <Edit className="w-3 h-3 mr-1" /> Update
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" data-testid={`button-delete-report-${rr.id}`}>
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
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
    description: z.string().min(1, "Description is required"),
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
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold" data-testid="text-admin-service-updates-title">Service Updates ({updates?.length || 0})</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          {canManage && <DialogTrigger asChild>
            <Button data-testid="button-add-service-update"><Plus className="w-4 h-4 mr-2" />Add Service Update</Button>
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
                      <Textarea {...field} rows={4} placeholder="Describe the update..." data-testid="input-service-update-description" />
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
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground" data-testid="text-no-admin-updates">
            No service updates yet
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {updates.map((update) => (
            <Card key={update.id} data-testid={`card-admin-update-${update.id}`}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2 cursor-pointer" onClick={() => setExpandedUpdateId(expandedUpdateId === update.id ? null : update.id)} data-testid={`button-expand-update-${update.id}`}>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {expandedUpdateId === update.id ? <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
                    <h4 className="font-semibold text-sm min-w-0 truncate">{update.title}</h4>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Badge variant="outline" className="text-[10px]">{getServiceName(update.serviceId)}</Badge>
                    {update.matureContent && <Badge variant="destructive" className="text-[10px]" data-testid={`badge-mature-${update.id}`}>Mature</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap pl-6">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {format(new Date(update.createdAt), "MMM d, yyyy h:mm a")}
                  </span>
                </div>
                {expandedUpdateId === update.id && (
                  <div className="space-y-2 pt-1 pl-6">
                    <p className="text-sm whitespace-pre-wrap">{update.description}</p>
                    <div className="flex items-center gap-1 flex-wrap">
                      {canManage && (
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openEditDialog(update); }} data-testid={`button-admin-edit-update-${update.id}`}>
                          <Edit className="w-3 h-3 mr-1" /> Edit
                        </Button>
                      )}
                      {canManage && <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="text-destructive" data-testid={`button-admin-delete-update-${update.id}`}>
                            <Trash2 className="w-3 h-3 mr-1" /> Delete
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
              <Label htmlFor="edit-update-description">Description</Label>
              <Textarea id="edit-update-description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={4} data-testid="input-edit-update-description" />
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
              disabled={editMutation.isPending || !editTitle.trim() || !editDescription.trim()}
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

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold" data-testid="text-email-templates-title">Email Templates</h2>
      <p className="text-sm text-muted-foreground">Customize the subject and body of outgoing system emails. Use variable placeholders like <code className="bg-muted px-1 py-0.5 rounded text-xs">{"{variable_name}"}</code> which get replaced automatically when emails are sent.</p>

      <div className="space-y-2">
        {templates?.map((template) => (
          <Card key={template.id} data-testid={`card-template-${template.templateKey}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm" data-testid={`text-template-name-${template.templateKey}`}>{template.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{template.description}</p>
                  <p className="text-xs text-muted-foreground mt-1 font-mono truncate">Subject: {template.subject}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{template.enabled !== false ? "On" : "Off"}</span>
                    <Switch
                      checked={template.enabled !== false}
                      onCheckedChange={(checked) => toggleEnabledMutation.mutate({ id: template.id, enabled: checked })}
                      disabled={!canManage}
                      data-testid={`switch-template-enabled-${template.templateKey}`}
                    />
                  </div>
                  {canManage && <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => openEdit(template)}
                    data-testid={`button-edit-template-${template.templateKey}`}
                  >
                    <Edit className="w-3.5 h-3.5" />
                    Edit
                  </Button>}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

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
      const res = await fetch("/api/admin/downloads", { method: "POST", body: formData, credentials: "include" });
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
      const res = await fetch(`/api/admin/downloads/${editItem.id}`, { method: "PATCH", body: formData, credentials: "include" });
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold">Downloads ({downloads?.length || 0})</h3>
        {canManage && (
          <Button size="sm" onClick={openAddDialog} data-testid="button-add-download">
            <Plus className="w-4 h-4 mr-1" /> Add Download
          </Button>
        )}
      </div>

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
        <Skeleton className="h-40" />
      ) : !downloads || downloads.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Download className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No downloads yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {downloads.map((dl) => (
            <Card key={dl.id} data-testid={`card-admin-download-${dl.id}`}>
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  {dl.imageUrl ? (
                    <img src={dl.imageUrl} alt={dl.title} className="w-14 h-14 rounded-md object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Download className="w-6 h-6 text-primary" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{dl.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{dl.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono">{dl.downloaderCode}</p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openEditDialog(dl)} data-testid={`button-edit-download-${dl.id}`}>
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" data-testid={`button-delete-download-${dl.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
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
              </CardContent>
            </Card>
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
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <Select value={category} onValueChange={(v) => { setCategory(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-log-category">
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
            className="flex-1"
            data-testid="input-log-search"
          />
          <Button size="icon" variant="outline" onClick={handleSearch} data-testid="button-log-search">
            <Search className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">{total} log entries</div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No log entries found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => {
            const config = LOG_CATEGORY_CONFIG[log.category] || { label: log.category, color: "bg-gray-500/10 text-gray-500", icon: ScrollText };
            const Icon = config.icon;
            const isExpanded = expandedLogId === log.id;
            return (
              <Card key={log.id} data-testid={`card-log-${log.id}`}>
                <CardContent className="p-3 space-y-1.5">
                  <div
                    className="flex items-center gap-2 cursor-pointer"
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                    data-testid={`button-expand-log-${log.id}`}
                  >
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />}
                    <div className={`rounded-full p-1 ${config.color.split(" ")[0]}`}>
                      <Icon className={`w-3 h-3 ${config.color.split(" ")[1]}`} />
                    </div>
                    <span className="text-sm flex-1 min-w-0 truncate">{log.summary}</span>
                    {hasPreview(log) && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 flex-shrink-0"
                        onClick={(e) => { e.stopPropagation(); setPreviewLog(log); }}
                        data-testid={`button-preview-log-${log.id}`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${config.color}`}>{config.label}</Badge>
                  </div>
                  <div className="flex items-center gap-2 pl-7 flex-wrap">
                    {log.actorName && (
                      <span className="text-[10px] text-muted-foreground">by {log.actorName}</span>
                    )}
                    {log.recipientName && (
                      <span className="text-[10px] text-muted-foreground">→ {log.recipientName}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {format(new Date(log.createdAt), "MMM d, yyyy h:mm a")}
                    </span>
                  </div>
                  {isExpanded && log.details && (
                    <div className="mt-2 pl-7 border-l-2 border-muted ml-2 pl-4 py-2">
                      {renderDetails(log)}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="button-log-prev">
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)} data-testid="button-log-next">
            Next
          </Button>
        </div>
      )}

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

function MonitoringTab({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const { data: monitors = [], isLoading } = useQuery<UrlMonitor[]>({ queryKey: ["/api/admin/monitors"], refetchInterval: 15000 });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UrlMonitor | null>(null);
  const [selectedMonitor, setSelectedMonitor] = useState<UrlMonitor | null>(null);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [monitorType, setMonitorType] = useState("url_availability");
  const [checkInterval, setCheckInterval] = useState("60");
  const [expectedStatus, setExpectedStatus] = useState("200");
  const [timeout, setTimeout_] = useState("10");
  const [failureThreshold, setFailureThreshold] = useState("3");
  const [emailNotif, setEmailNotif] = useState(true);

  const resetForm = () => {
    setName("");
    setUrl("");
    setMonitorType("url_availability");
    setCheckInterval("60");
    setExpectedStatus("200");
    setTimeout_("10");
    setFailureThreshold("3");
    setEmailNotif(true);
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

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" data-testid="text-monitoring-title">URL Monitors</h2>
        {canManage && (
          <Button size="sm" onClick={() => { resetForm(); setDialogOpen(true); }} data-testid="button-add-monitor">
            <Plus className="w-4 h-4 mr-1" /> Add Monitor
          </Button>
        )}
      </div>

      {monitors.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Globe className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No URL monitors configured yet.</p>
            {canManage && <p className="text-sm mt-1">Add a monitor to start tracking URL health.</p>}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {monitors.map(m => (
            <Card key={m.id} className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => setSelectedMonitor(m)} data-testid={`card-monitor-${m.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`rounded-full p-2 ${getStatusBg(m.status, m.enabled)}`}>
                    <Circle className={`w-4 h-4 ${getStatusColor(m.status, m.enabled)} ${m.enabled && m.status === "up" ? "animate-status-glow fill-current" : m.enabled && m.status === "down" ? "animate-status-down fill-current" : ""}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium truncate max-w-[50vw] sm:max-w-none" data-testid={`text-monitor-name-${m.id}`}>{m.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">{m.monitorType === "http_status" ? "HTTP Status" : "Availability"}</Badge>
                      {!m.enabled && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 flex-shrink-0">Paused</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{m.url}</p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground hidden sm:block">
                    {m.lastCheckedAt && <p>Checked {format(new Date(m.lastCheckedAt), "MMM d, h:mm a")}</p>}
                    {m.lastResponseTimeMs != null && m.status === "up" && <p>{m.lastResponseTimeMs}ms</p>}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleMutation.mutate({ id: m.id, enabled: !m.enabled })} data-testid={`button-toggle-monitor-${m.id}`}>
                        {m.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(m)} data-testid={`button-edit-monitor-${m.id}`}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" data-testid={`button-delete-monitor-${m.id}`}>
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <Circle className={`w-5 h-5 flex-shrink-0 mt-1 ${getStatusColor(m.status, m.enabled)} ${m.enabled && m.status === "up" ? "animate-status-glow fill-current" : m.enabled && m.status === "down" ? "animate-status-down fill-current" : ""}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-semibold" data-testid="text-monitor-detail-name">{m.name}</h3>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">{m.monitorType === "http_status" ? "HTTP Status" : "Availability"}</Badge>
                  <Badge className={`flex-shrink-0 ${!m.enabled ? "bg-muted text-muted-foreground border-muted" : m.status === "up" ? "bg-green-500/10 text-green-600 border-green-500/20" : m.status === "down" ? "bg-red-500/10 text-red-600 border-red-500/20" : ""}`} variant="outline">
                    {getStatusLabel(m.status, m.enabled)}
                  </Badge>
                </div>
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 break-all" data-testid="link-monitor-url">
                  {m.url} <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-muted-foreground text-xs">Check Interval</p>
              <p className="font-medium">{m.checkIntervalSeconds}s</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-muted-foreground text-xs">Response Time</p>
              <p className="font-medium">{m.lastResponseTimeMs != null ? `${m.lastResponseTimeMs}ms` : "—"}</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-muted-foreground text-xs">Last Checked</p>
              <p className="font-medium">{m.lastCheckedAt ? format(new Date(m.lastCheckedAt), "h:mm:ss a") : "Never"}</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-muted-foreground text-xs">Status Since</p>
              <p className="font-medium">{m.lastStatusChange ? format(new Date(m.lastStatusChange), "MMM d, h:mm a") : "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <h3 className="text-base font-semibold mb-3" data-testid="text-incidents-title">Incident History</h3>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
          </div>
        ) : incidents.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              <Activity className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p>No incidents recorded yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {incidents.map(inc => (
              <Card key={inc.id} data-testid={`card-incident-${inc.id}`}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 rounded-full p-1.5 ${inc.resolvedAt ? "bg-green-500/10" : "bg-red-500/10"}`}>
                      {inc.resolvedAt ? <Activity className="w-3.5 h-3.5 text-green-500" /> : <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={inc.resolvedAt ? "secondary" : "destructive"} className="text-xs">
                          {inc.resolvedAt ? "Resolved" : "Ongoing"}
                        </Badge>
                        {inc.durationSeconds != null && (
                          <span className="text-xs text-muted-foreground">Duration: {formatDuration(inc.durationSeconds)}</span>
                        )}
                      </div>
                      {inc.failureReason && <p className="text-sm mt-1">{inc.failureReason}</p>}
                      <div className="text-xs text-muted-foreground mt-1">
                        Started: {format(new Date(inc.startedAt), "MMM d, yyyy h:mm:ss a")}
                        {inc.resolvedAt && <> · Resolved: {format(new Date(inc.resolvedAt), "MMM d, yyyy h:mm:ss a")}</>}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
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
  { category: "Downloads", perms: ["downloads.view", "downloads.manage"] },
  { category: "Support Tickets", perms: ["support_tickets"] },
  { category: "Admin Chat", perms: ["admin_chat"] },
  { category: "Logs", perms: ["logs.view"] },
  { category: "URL Monitoring", perms: ["monitoring.view", "monitoring.manage"] },
  { category: "Announcements", perms: ["announcements"] },
];

function AdminManagementTab() {
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
    <Tabs defaultValue="roles" className="space-y-4">
      <TabsList data-testid="tabs-admin-management">
        <TabsTrigger value="roles" data-testid="tab-roles">Roles</TabsTrigger>
        <TabsTrigger value="categories" data-testid="tab-categories">Ticket Categories</TabsTrigger>
        <TabsTrigger value="user-roles" data-testid="tab-user-roles">User Roles</TabsTrigger>
        <TabsTrigger value="broadcast" data-testid="tab-broadcast">Broadcast Push</TabsTrigger>
      </TabsList>

      <TabsContent value="roles" className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Admin Roles</h3>
          <Button size="sm" className="gap-1" onClick={() => openRoleDialog()} data-testid="button-create-role">
            <Plus className="w-4 h-4" /> Create Role
          </Button>
        </div>
        <div className="space-y-2">
          {roles.map(role => (
            <Card key={role.id} data-testid={`card-role-${role.id}`}>
              <CardContent className="flex items-center justify-between py-3 px-4">
                <div>
                  <p className="font-medium">{role.name}</p>
                  <p className="text-xs text-muted-foreground">{(role.permissions || []).length} permissions</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openRoleDialog(role)} data-testid={`button-edit-role-${role.id}`}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" data-testid={`button-delete-role-${role.id}`}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Role</AlertDialogTitle>
                        <AlertDialogDescription>This will remove the role from all assigned admins. Continue?</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteRoleMutation.mutate(role.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
          {roles.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No roles created yet</p>}
        </div>

        <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingRole ? "Edit Role" : "Create Role"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Role Name</Label>
                <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="e.g. Tier 1 Support" data-testid="input-role-name" />
              </div>
              <div>
                <Label className="mb-2 block">Permissions</Label>
                <div className="space-y-3">
                  {ALL_PERMISSIONS.map(({ category, perms }) => (
                    <div key={category} className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">{category}</p>
                      <div className="flex flex-wrap gap-3 ml-2">
                        {perms.map(p => (
                          <label key={p} className="flex items-center gap-1.5 text-sm cursor-pointer">
                            <Checkbox checked={rolePermissions.includes(p)} onCheckedChange={() => togglePermission(p)} data-testid={`checkbox-perm-${p}`} />
                            {p.split(".").pop()}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <Button
                className="w-full"
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

      <TabsContent value="categories" className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Ticket Categories</h3>
          <Button size="sm" className="gap-1" onClick={() => openCatDialog()} data-testid="button-create-category">
            <Plus className="w-4 h-4" /> Create Category
          </Button>
        </div>
        <div className="space-y-2">
          {categories.map(cat => (
            <Card key={cat.id} data-testid={`card-category-${cat.id}`}>
              <CardContent className="flex items-center justify-between py-3 px-4">
                <div>
                  <p className="font-medium">{cat.name}</p>
                  <p className="text-xs text-muted-foreground">{cat.description || "No description"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {(cat.assignedRoleIds || []).length} role(s) assigned
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openCatDialog(cat)} data-testid={`button-edit-category-${cat.id}`}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" data-testid={`button-delete-category-${cat.id}`}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Category</AlertDialogTitle>
                        <AlertDialogDescription>Tickets in this category will become uncategorized. Continue?</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteCatMutation.mutate(cat.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
          {categories.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No categories created yet</p>}
        </div>

        <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingCat ? "Edit Category" : "Create Category"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Category Name</Label>
                <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="e.g. Billing" data-testid="input-category-name" />
              </div>
              <div>
                <Label>Description</Label>
                <Input value={catDescription} onChange={(e) => setCatDescription(e.target.value)} placeholder="Optional description" data-testid="input-category-description" />
              </div>
              <div>
                <Label className="mb-2 block">Assigned Admin Roles</Label>
                <div className="space-y-2">
                  {roles.map(role => (
                    <label key={role.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={catRoleIds.includes(role.id)} onCheckedChange={() => toggleCatRole(role.id)} data-testid={`checkbox-cat-role-${role.id}`} />
                      {role.name}
                    </label>
                  ))}
                  {roles.length === 0 && <p className="text-xs text-muted-foreground">Create admin roles first</p>}
                </div>
              </div>
              <Button
                className="w-full"
                disabled={!catName || createCatMutation.isPending || updateCatMutation.isPending}
                onClick={() => {
                  const data = { name: catName, description: catDescription, assignedRoleIds: catRoleIds };
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

      <TabsContent value="user-roles" className="space-y-4">
        <h3 className="text-lg font-semibold">Admin User Roles</h3>
        <div className="space-y-2">
          {adminUsers.filter(u => u.username !== "cowboymedia-support").map(u => (
            <Card key={u.id} data-testid={`card-admin-user-${u.id}`}>
              <CardContent className="flex items-center justify-between py-3 px-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{u.fullName}</p>
                    {u.role === "master_admin" && <Badge variant="default" className="text-xs"><Crown className="w-3 h-3 mr-1" />Master</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">@{u.username}</p>
                </div>
                {u.role !== "master_admin" && (
                  <Select
                    value={u.adminRoleId || "_none"}
                    onValueChange={(val) => updateUserRoleMutation.mutate({ id: u.id, adminRoleId: val === "_none" ? null : val })}
                  >
                    <SelectTrigger className="w-[180px]" data-testid={`select-role-${u.id}`}>
                      <SelectValue placeholder="No role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">No Role</SelectItem>
                      {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="broadcast" className="space-y-4">
        <h3 className="text-lg font-semibold">Broadcast Push Notification</h3>
        <div className="space-y-4">
          <div>
            <Label>Title</Label>
            <Input value={broadcastTitle} onChange={(e) => setBroadcastTitle(e.target.value)} placeholder="Notification title" data-testid="input-broadcast-title" />
          </div>
          <div>
            <Label>Message</Label>
            <Textarea value={broadcastMessage} onChange={(e) => setBroadcastMessage(e.target.value)} placeholder="Notification message" data-testid="input-broadcast-message" />
          </div>
          <div>
            <Label className="mb-2 block">Select Admins</Label>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {adminUsers.filter(u => u.username !== "cowboymedia-support").map(u => (
                <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={broadcastUserIds.includes(u.id)} onCheckedChange={() => toggleBroadcastUser(u.id)} data-testid={`checkbox-broadcast-${u.id}`} />
                  {u.fullName} (@{u.username})
                </label>
              ))}
            </div>
          </div>
          <Button
            className="w-full"
            disabled={!broadcastTitle || !broadcastMessage || broadcastUserIds.length === 0 || broadcastMutation.isPending}
            onClick={() => broadcastMutation.mutate({ title: broadcastTitle, message: broadcastMessage, userIds: broadcastUserIds })}
            data-testid="button-send-broadcast"
          >
            <Send className="w-4 h-4 mr-2" />
            {broadcastMutation.isPending ? "Sending..." : `Send to ${broadcastUserIds.length} admin(s)`}
          </Button>
        </div>
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

function AdminChatTab() {
  const { user, isMasterAdmin } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
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
      const res = await fetch(`/api/admin/chat/threads/${threadId}/messages`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
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
    const ws = (window as any).__ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "viewing_admin_chat", threadId: activeThreadId, userId: user?.id }));
    }
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
    if (ws) ws.addEventListener("message", handleWs);
    return () => {
      if (ws) {
        ws.removeEventListener("message", handleWs);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "left_admin_chat", threadId: activeThreadId, userId: user?.id }));
        }
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      setTypingUser(null);
    };
  }, [activeThreadId, user?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendTypingEvent = () => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    const ws = (window as any).__ws;
    if (ws && ws.readyState === WebSocket.OPEN && user && activeThreadId) {
      ws.send(JSON.stringify({ type: "admin_chat_typing", threadId: activeThreadId, userId: user.id, userName: user.fullName }));
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
    <div className={`flex ${isMobile ? "h-[calc(100dvh-12rem)]" : "h-[600px]"} rounded-lg border overflow-hidden`} data-testid="admin-chat-container">
      {showThreadList && (
      <div className={`${isMobile ? "w-full" : "w-1/3"} border-r flex flex-col`}>
        <div className="p-3 border-b flex justify-between items-center">
          <h4 className="font-semibold text-sm">Threads</h4>
          <Button size="icon" variant="ghost" onClick={() => setNewChatOpen(true)} data-testid="button-new-chat">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {threads.map(thread => {
            const hasUnread = unreadThreadIds.includes(thread.id);
            return (
            <button
              key={thread.id}
              className={`w-full text-left p-3 border-b hover:bg-accent/50 transition-colors ${activeThreadId === thread.id ? "bg-accent" : ""}`}
              onClick={() => selectThread(thread.id)}
              data-testid={`thread-${thread.id}`}
            >
              <div className="flex items-center gap-2">
                {hasUnread && <span className="w-2.5 h-2.5 rounded-full bg-destructive flex-shrink-0" data-testid={`unread-dot-${thread.id}`} />}
                <p className={`font-medium text-sm truncate ${hasUnread ? "font-bold" : ""}`}>{getThreadDisplayName(thread)}</p>
              </div>
              {thread.lastMessage && (
                <p className={`text-xs text-muted-foreground truncate mt-0.5 ${hasUnread ? "ml-[18px]" : ""}`}>{thread.lastMessage.message || "📎 File"}</p>
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
            <div className="p-3 border-b flex justify-between items-start">
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
                <div>
                  <p className="font-semibold text-sm">{getThreadDisplayName(activeThread)}</p>
                  <p className="text-xs text-muted-foreground">{activeThread.participants.map(p => p.fullName).join(", ")}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
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
                    className="text-destructive hover:text-destructive h-8 w-8"
                    onClick={() => {
                      if (confirm("Delete this thread and all its messages?")) {
                        deleteThreadMutation.mutate(activeThread.id);
                      }
                    }}
                    disabled={deleteThreadMutation.isPending}
                    data-testid="button-delete-thread"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex-1 p-3 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
              <div className="space-y-3">
                {messages.map(msg => {
                  const isMe = msg.senderId === user?.id;
                  return (
                    <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`} data-testid={`chat-msg-${msg.id}`}>
                      <div className={`max-w-[75%] min-w-0 overflow-hidden rounded-lg p-2.5 ${isMe ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                        {!isMe && <p className="text-xs font-medium mb-1">{msg.senderName}</p>}
                        {msg.message && <p className="text-sm whitespace-pre-wrap overflow-hidden" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{msg.message}</p>}
                        {msg.fileUrl && msg.fileType?.startsWith("image/") && (
                          <div className="mt-1">
                            <ClickableImage src={msg.fileUrl} alt="attachment" className="max-w-full max-h-48 rounded" />
                            <a href={msg.fileUrl} download target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1 text-xs opacity-70 hover:opacity-100 transition-opacity" data-testid="link-download-image">
                              <Download className="w-3 h-3" />
                              <span>Download</span>
                            </a>
                          </div>
                        )}
                        {msg.fileUrl && msg.fileType?.startsWith("video/") && (
                          <div className="mt-1">
                            <ClickableVideo src={msg.fileUrl} className="max-w-full max-h-48" />
                            <a href={msg.fileUrl} download target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1 text-xs opacity-70 hover:opacity-100 transition-opacity" data-testid="link-download-video">
                              <Download className="w-3 h-3" />
                              <span>Download</span>
                            </a>
                          </div>
                        )}
                        {msg.fileUrl && !msg.fileType?.startsWith("image/") && !msg.fileType?.startsWith("video/") && (
                          <a href={msg.fileUrl} download target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-2 p-1.5 rounded hover:bg-background/20 transition-colors" data-testid="file-attachment">
                            <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="text-xs underline break-all">{msg.fileName || "Download file"}</span>
                            <Download className="w-3 h-3 flex-shrink-0 ml-auto" />
                          </a>
                        )}
                        <p className="text-[10px] opacity-60 mt-1">{format(new Date(msg.createdAt), "h:mm a")}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </div>
            {typingUser && (
              <div className="px-3 py-1">
                <p className="text-xs text-muted-foreground italic" data-testid="text-chat-typing">{typingUser} is typing...</p>
              </div>
            )}
            <div className="p-3 border-t flex gap-2 items-end">
              <div className="flex-1 space-y-1">
                {chatFile && <p className="text-xs text-muted-foreground">📎 {chatFile.name}</p>}
                <div className="flex gap-2">
                  <Input
                    value={messageText}
                    onChange={(e) => {
                      setMessageText(e.target.value);
                      if (e.target.value.trim()) sendTypingEvent();
                    }}
                    placeholder="Type a message..."
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
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
                  <Button variant="outline" size="icon" onClick={() => document.getElementById("chat-file-input")?.click()} data-testid="button-chat-attach">
                    <FileText className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
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
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <p className="text-sm">Select a thread or start a new chat</p>
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
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {adminUsers.map(u => (
                  <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={chatParticipantIds.includes(u.id)}
                      onCheckedChange={() => setChatParticipantIds(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id])}
                      data-testid={`checkbox-participant-${u.id}`}
                    />
                    {u.fullName} (@{u.username})
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
    </div>
  );
}

type BannedUser = { id: string; fullName: string; username: string; chatUsername: string | null; email: string };
type WordFilter = { id: string; word: string; createdAt: string };

function ChatAdminTab() {
  const { toast } = useToast();
  const [newWord, setNewWord] = useState("");

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
      <h3 className="font-semibold">Chat Admin</h3>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4 text-orange-500" />
            Word Filters
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Add words to automatically censor in community chat messages. Filtered words will have their middle characters replaced with asterisks.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              placeholder="Enter a word to filter..."
              className="flex-1"
              onKeyDown={(e) => { if (e.key === "Enter") handleAddWord(); }}
              data-testid="input-add-word-filter"
            />
            <Button
              size="sm"
              onClick={handleAddWord}
              disabled={newWord.trim().length < 2 || addFilterMutation.isPending}
              data-testid="button-add-word-filter"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>

          {filtersLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : wordFilters && wordFilters.length > 0 ? (
            <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
              {wordFilters.map((f) => (
                <div key={f.id} className="flex items-center justify-between px-3 py-2" data-testid={`word-filter-${f.id}`}>
                  <span className="text-sm font-mono">{f.word}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteFilterMutation.mutate(f.id)}
                    disabled={deleteFilterMutation.isPending}
                    data-testid={`button-delete-filter-${f.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-word-filters">
              No word filters configured. Add words above to keep the chat family-friendly.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-red-500" />
            Banned Users
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Users banned from community chat. You can unban them to restore their access.
          </p>
        </CardHeader>
        <CardContent>
          {bannedLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : bannedUsers && bannedUsers.length > 0 ? (
            <div className="border rounded-md divide-y">
              {bannedUsers.map((u) => (
                <div key={u.id} className="flex items-center justify-between px-3 py-2.5 gap-3" data-testid={`banned-user-${u.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{u.fullName}</p>
                    <p className="text-xs text-muted-foreground truncate">
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
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-banned-users">
              No users are currently banned from chat.
            </p>
          )}
        </CardContent>
      </Card>
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
  "downloads": "downloads.view",
  "support-tickets": "support_tickets",
  "admin-chat": "admin_chat",
  "logs": "logs.view",
  "monitoring": "monitoring.view",
  "chat-admin": "admin_chat",
  "announcements": "announcements",
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
  "downloads": "downloads.manage",
  "monitoring": "monitoring.manage",
  "announcements": "announcements",
};

const NO_LINK_VALUE = "__none__";

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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold">Announcements ({list.length})</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Only the newest Active announcement is shown to customers.
          </p>
        </div>
        <Button size="sm" onClick={openCreate} data-testid="button-create-announcement">
          <Plus className="w-4 h-4 mr-1" /> New Announcement
        </Button>
      </div>

      {activeShown && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm" data-testid="banner-active-announcement">
          <p className="font-medium">Currently shown to customers:</p>
          <p className="text-muted-foreground">{activeShown.title}</p>
        </div>
      )}

      {isLoading ? <Skeleton className="h-32" /> : list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No announcements yet.</p>
      ) : (
        <div className="space-y-2">
          {list.map(a => (
            <Card key={a.id} data-testid={`card-announcement-${a.id}`}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm truncate">{a.title}</p>
                      <Badge variant={a.active ? "default" : "secondary"} data-testid={`badge-announcement-status-${a.id}`}>
                        {a.active ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline">
                        {a.frequency === "always" ? "Every open" : "Once per user"}
                      </Badge>
                      {a.linkPath && (
                        <Badge variant="outline" className="gap-1">
                          <ExternalLink className="w-3 h-3" />
                          {getAnnouncementRouteLabel(a.linkPath) ?? a.linkPath}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Created {format(new Date(a.createdAt), "MMM d, yyyy h:mm a")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Switch
                      checked={a.active}
                      onCheckedChange={(v) => toggleActiveMutation.mutate({ id: a.id, active: v })}
                      data-testid={`switch-announcement-active-${a.id}`}
                    />
                    <Button size="icon" variant="ghost" onClick={() => openEdit(a)} data-testid={`button-edit-announcement-${a.id}`}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" data-testid={`button-delete-announcement-${a.id}`}>
                          <Trash2 className="w-4 h-4 text-destructive" />
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
                <div
                  className="prose prose-sm dark:prose-invert max-w-none text-sm text-muted-foreground line-clamp-2"
                  dangerouslySetInnerHTML={{ __html: a.bodyHtml }}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
              <RichTextEditor value={bodyHtml} onChange={setBodyHtml} testIdPrefix="announcement" />
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

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-40 w-full" /></div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Send className="w-5 h-5" /> Telegram Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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

          <div>
            <Label htmlFor="telegram-chat-id">Telegram Chat ID</Label>
            <Input
              id="telegram-chat-id"
              placeholder="e.g. -1001234567890"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              data-testid="input-telegram-chat-id"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Add your bot to the group, then use @RawDataBot or a similar helper bot to obtain the group's chat ID (usually a negative number for groups).
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Enable Telegram notifications</p>
              <p className="text-xs text-muted-foreground">
                When enabled, alerts, service updates, and news are posted to the configured chat.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              data-testid="switch-telegram-enabled"
            />
          </div>

          <div className="rounded-md border p-3 space-y-3">
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

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">What gets sent:</p>
            <p>🚨 Service alerts (created / updated / resolved) — with service name and impact</p>
            <p>📢 Service updates — with service name</p>
            <p>📰 News stories — title and preview</p>
            <p className="mt-2">If Telegram fails or is disabled, your app notifications still send normally.</p>
          </div>
        </CardContent>
      </Card>
    </div>
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

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-64 w-full" /></div>;

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
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" /> Business Hours
            {settings?.enabled && (
              <Badge variant={settings.isOpen ? "default" : "secondary"} className="ml-2 text-xs" data-testid="badge-bh-status">
                {settings.isOpen ? "Currently open" : "Currently closed"}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Enable business hours</p>
              <p className="text-xs text-muted-foreground">
                When enabled, customers see an after-hours warning when opening or replying to tickets outside the configured hours.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              data-testid="switch-bh-enabled"
            />
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <p className="text-sm font-medium">Business days</p>
            <div className="flex flex-wrap gap-3">
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bh-start">Open time</Label>
              <Input
                id="bh-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                data-testid="input-bh-start-time"
              />
            </div>
            <div>
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

          <div>
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

          <div>
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

          <div className="flex flex-wrap gap-2">
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
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminPortal() {
  const { isAdmin, isMasterAdmin, hasPermission } = useAuth();
  const [, navigate] = useLocation();

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

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <Shield className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-lg font-semibold">Access Denied</p>
        <p className="text-sm text-muted-foreground mt-1">You must be an admin to access this page</p>
      </div>
    );
  }

  const [activeSection, setActiveSection] = useState<string | null>(null);

  const allSections = [
    { key: "users", label: "Users", icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
    { key: "services", label: "Services", icon: Server, color: "text-green-500", bg: "bg-green-500/10" },
    { key: "alerts", label: "Alerts", icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10" },
    { key: "news", label: "News", icon: Newspaper, color: "text-purple-500", bg: "bg-purple-500/10" },
    { key: "messages", label: "Messages", icon: Mail, color: "text-rose-500", bg: "bg-rose-500/10" },
    { key: "quick-responses", label: "Quick Responses", icon: Zap, color: "text-orange-500", bg: "bg-orange-500/10" },
    { key: "service-updates", label: "Service Updates", icon: RefreshCw, color: "text-teal-500", bg: "bg-teal-500/10" },
    { key: "reports-requests", label: "Reports/Requests", icon: FileText, color: "text-cyan-500", bg: "bg-cyan-500/10" },
    { key: "email-templates", label: "Email Templates", icon: MailOpen, color: "text-indigo-500", bg: "bg-indigo-500/10" },
    { key: "downloads", label: "Downloads", icon: Download, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { key: "support-tickets", label: "Support Tickets", icon: LifeBuoy, color: "text-sky-500", bg: "bg-sky-500/10", navigateTo: "/tickets" },
    { key: "admin-chat", label: "Admin Chat", icon: MessageSquare, color: "text-pink-500", bg: "bg-pink-500/10" },
    { key: "chat-admin", label: "Chat Admin", icon: ShieldCheck, color: "text-violet-500", bg: "bg-violet-500/10" },
    { key: "monitoring", label: "URL Monitoring", icon: Globe, color: "text-lime-500", bg: "bg-lime-500/10" },
    { key: "logs", label: "Logs", icon: ScrollText, color: "text-slate-500", bg: "bg-slate-500/10" },
    { key: "telegram", label: "Telegram", icon: Send, color: "text-blue-400", bg: "bg-blue-400/10" },
    { key: "business-hours", label: "Business Hours", icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10" },
    { key: "announcements", label: "Announcements", icon: Megaphone, color: "text-fuchsia-500", bg: "bg-fuchsia-500/10" },
    { key: "admin-management", label: "Admin Management", icon: Crown, color: "text-yellow-500", bg: "bg-yellow-500/10", masterOnly: true },
  ];

  const sections = allSections.filter(s => {
    if (s.masterOnly) return isMasterAdmin;
    const perm = TILE_PERM_MAP[s.key];
    return perm ? hasPermission(perm) : true;
  });

  const canManageSection = (key: string) => {
    if (isMasterAdmin) return true;
    const perm = TILE_MANAGE_MAP[key];
    return perm ? hasPermission(perm) : false;
  };

  const renderContent = () => {
    switch (activeSection) {
      case "users": return <UsersTab canManage={canManageSection("users")} />;
      case "services": return <ServicesTab canManage={canManageSection("services")} />;
      case "alerts": return <AlertsTab canManage={canManageSection("alerts")} />;
      case "news": return <NewsTab canManage={canManageSection("news")} />;
      case "messages": return <MessagesTab canManage={canManageSection("messages")} />;
      case "quick-responses": return <QuickResponsesTab canManage={canManageSection("quick-responses")} />;
      case "service-updates": return <ServiceUpdatesTab canManage={canManageSection("service-updates")} />;
      case "reports-requests": return <ReportsRequestsTab canManage={canManageSection("reports-requests")} />;
      case "email-templates": return <EmailTemplatesTab canManage={canManageSection("email-templates")} />;
      case "downloads": return <DownloadsTab canManage={canManageSection("downloads")} />;
      case "admin-chat": return <AdminChatTab />;
      case "chat-admin": return <ChatAdminTab />;
      case "monitoring": return <MonitoringTab canManage={canManageSection("monitoring")} />;
      case "logs": return <LogsTab />;
      case "telegram": return <TelegramTab />;
      case "business-hours": return <BusinessHoursTab />;
      case "announcements": return <AnnouncementsTab />;
      case "admin-management": return isMasterAdmin ? <AdminManagementTab /> : null;
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {sections.map((s) => {
            const Icon = s.icon;
            const badgeCategory = tileBadgeMap[s.key];
            let badgeCount = badgeCategory && contentCounts ? (contentCounts[badgeCategory] ?? 0) : 0;
            if (s.key === "admin-chat" && chatUnreadData) badgeCount = chatUnreadData.count;
            return (
              <button
                key={s.key}
                onClick={() => s.navigateTo ? navigate(s.navigateTo) : setActiveSection(s.key)}
                className="relative flex flex-col items-center justify-center gap-3 p-6 sm:p-8 rounded-xl border bg-card hover:bg-accent/50 transition-colors active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid={`tile-admin-${s.key}`}
              >
                {badgeCount > 0 && (
                  <Badge variant="destructive" className="absolute top-2 right-2 text-xs px-1.5 py-0.5 min-w-[20px] text-center" data-testid={`badge-tile-${s.key}`}>
                    {badgeCount}
                  </Badge>
                )}
                <div className={`rounded-full p-4 ${s.bg}`}>
                  <Icon className={`w-7 h-7 sm:w-8 sm:h-8 ${s.color}`} />
                </div>
                <span className="font-semibold text-sm sm:text-base">{s.label}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveSection(null)}
            className="gap-1 -ml-2 text-muted-foreground hover:text-foreground"
            data-testid="button-admin-back"
          >
            <RotateCcw className="w-4 h-4" />
            Back to Admin Menu
          </Button>
          {renderContent()}
        </div>
      )}
    </div>
  );
}
