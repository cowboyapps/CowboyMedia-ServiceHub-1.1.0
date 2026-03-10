import { useState, useEffect, useRef } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
import { Plus, Trash2, Edit, Users, Server, AlertTriangle, Newspaper, RotateCcw, Shield, ShieldCheck, Mail, MailX, Send, Clock, Zap, FileText, RefreshCw, Bell, BellOff, MailOpen, Copy, Eye, EyeOff, RotateCw, MessageSquare, Crown, Tag, LifeBuoy, ChevronDown, ChevronRight, ScrollText, Search, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { ClickableImage, ClickableVideo } from "@/components/image-lightbox";
import { Download } from "lucide-react";
import type { User, Service, ServiceAlert, AlertUpdate, NewsStory, QuickResponse, ReportRequest, ServiceUpdate, EmailTemplate, AdminRole, TicketCategory } from "@shared/schema";

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
  content: z.string().min(1, "Content is required"),
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
  const [editFullName, setEditFullName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editEmailNotifications, setEditEmailNotifications] = useState(true);
  const [editSubscribedServices, setEditSubscribedServices] = useState<string[]>([]);
  const [newUserIds, setNewUserIds] = useState<string[]>([]);

  useEffect(() => {
    apiRequest("GET", "/api/content-notifications/unread-references/admin-users")
      .then(async (res) => {
        const ids = await res.json();
        setNewUserIds(ids);
        await apiRequest("POST", "/api/content-notifications/mark-read", { category: "admin-users" });
        queryClient.invalidateQueries({ queryKey: ["/api/content-notifications/counts"] });
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold">Users ({users?.length || 0})</h3>
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

              <div className="flex items-center justify-between border rounded-md px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Email Notifications</p>
                  <p className="text-xs text-muted-foreground">Receive email notifications for alerts, tickets, and updates</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={editEmailNotifications}
                  onClick={() => setEditEmailNotifications(!editEmailNotifications)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${editEmailNotifications ? 'bg-primary' : 'bg-input'}`}
                  data-testid="switch-email-notifications"
                >
                  <span className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${editEmailNotifications ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

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
                    <AlertDialogContent>
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

      {isLoading ? (
        <Skeleton className="h-40" />
      ) : isMobile ? (
        <div className="space-y-2">
          {users?.map((u) => (
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
                  <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                    <span title={pushStatus?.[u.id] ? "Push ON" : "Push OFF"} data-testid={`icon-push-${u.id}`}>
                      {pushStatus?.[u.id] ? <Bell className="w-3.5 h-3.5 text-green-500" /> : <BellOff className="w-3.5 h-3.5 text-muted-foreground/40" />}
                    </span>
                    <span title={u.emailNotifications !== false ? "Email ON" : "Email OFF"} data-testid={`icon-email-${u.id}`}>
                      {u.emailNotifications !== false ? <Mail className="w-3.5 h-3.5 text-green-500" /> : <MailX className="w-3.5 h-3.5 text-muted-foreground/40" />}
                    </span>
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
              {users?.map((u) => (
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
                    <div className="flex items-center gap-2">
                      <span title={pushStatus?.[u.id] ? "Push ON" : "Push OFF"} data-testid={`icon-push-${u.id}`}>
                        {pushStatus?.[u.id] ? <Bell className="w-4 h-4 text-green-500" /> : <BellOff className="w-4 h-4 text-muted-foreground/40" />}
                      </span>
                      <span title={u.emailNotifications !== false ? "Email ON" : "Email OFF"} data-testid={`icon-email-${u.id}`}>
                        {u.emailNotifications !== false ? <Mail className="w-4 h-4 text-green-500" /> : <MailX className="w-4 h-4 text-muted-foreground/40" />}
                      </span>
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
                    <p className="text-xs text-muted-foreground">{alert.description}</p>
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
                        <AlertDialogContent>
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
            <p className="text-xs">{update.message}</p>
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
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
            <DialogHeader><DialogTitle>Publish News Story</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="space-y-3">
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem><FormLabel>Title</FormLabel><FormControl><Input data-testid="input-news-title" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="content" render={({ field }) => (
                  <FormItem><FormLabel>Content</FormLabel><FormControl><Textarea className="min-h-[120px]" data-testid="input-news-content" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div>
                  <label className="text-sm font-medium">Image (optional)</label>
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
                    <p className="text-xs text-muted-foreground line-clamp-1">{story.content}</p>
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
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader><DialogTitle>Edit News Story</DialogTitle></DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((d) => editMutation.mutate(d))} className="space-y-3">
              <FormField control={editForm.control} name="title" render={({ field }) => (
                <FormItem><FormLabel>Title</FormLabel><FormControl><Input data-testid="input-edit-news-title" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={editForm.control} name="content" render={({ field }) => (
                <FormItem><FormLabel>Content</FormLabel><FormControl><Textarea className="min-h-[120px]" data-testid="input-edit-news-content" {...field} /></FormControl><FormMessage /></FormItem>
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

const sendMessageSchema = z.object({
  recipientId: z.string().min(1, "Recipient is required"),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Message is required"),
});

function MessagesTab({ canManage = true }: { canManage?: boolean }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: sentMessages, isLoading: sentLoading } = useQuery<import("@shared/schema").PrivateMessage[]>({
    queryKey: ["/api/admin/private-messages/sent"],
  });

  const customers = users?.filter((u) => u.role === "customer") || [];
  const userMap = new Map(users?.map((u) => [u.id, u.fullName]) || []);

  const form = useForm({
    resolver: zodResolver(sendMessageSchema),
    defaultValues: { recipientId: "", subject: "", body: "" },
  });

  const sendMutation = useMutation({
    mutationFn: async (data: z.infer<typeof sendMessageSchema>) => {
      await apiRequest("POST", "/api/admin/private-messages", data);
    },
    onSuccess: () => {
      setDialogOpen(false);
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/private-messages/sent"] });
      toast({ title: "Message sent successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteSentMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/private-messages/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/private-messages/sent"] });
      toast({ title: "Message deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold">Private Messages</h3>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          {canManage && <DialogTrigger asChild>
            <Button size="sm" data-testid="button-send-message"><Send className="w-4 h-4 mr-1" /> Send Message</Button>
          </DialogTrigger>}
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
            <DialogHeader><DialogTitle>Send Private Message</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((d) => sendMutation.mutate(d))} className="space-y-3">
                <FormField control={form.control} name="recipientId" render={({ field }) => (
                  <FormItem><FormLabel>Recipient</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-message-recipient"><SelectValue placeholder="Select a customer" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {customers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>{u.fullName} (@{u.username})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  <FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="subject" render={({ field }) => (
                  <FormItem><FormLabel>Subject</FormLabel><FormControl><Input data-testid="input-message-subject" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="body" render={({ field }) => (
                  <FormItem><FormLabel>Message</FormLabel><FormControl><Textarea className="min-h-[120px]" data-testid="input-message-body" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={sendMutation.isPending} data-testid="button-submit-message">
                  {sendMutation.isPending ? "Sending..." : "Send Message"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <h4 className="font-medium text-sm text-muted-foreground">Sent Messages ({sentMessages?.length || 0})</h4>

      {sentLoading ? (
        <Skeleton className="h-40" />
      ) : !sentMessages || sentMessages.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <div className="text-center py-6">
              <Mail className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No sent messages yet. Use the "Send Message" button to send a private message to any customer.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sentMessages.map((msg) => (
            <Card key={msg.id} data-testid={`card-sent-message-${msg.id}`}>
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-medium truncate">{msg.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    To: {userMap.get(msg.recipientId) || "Unknown User"}
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-1">{msg.body}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {format(new Date(msg.createdAt), "MMM d, yyyy 'at' h:mm a")}
                  </p>
                </div>
                {canManage && <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost" data-testid={`button-delete-sent-message-${msg.id}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Sent Message</AlertDialogTitle>
                      <AlertDialogDescription>Are you sure you want to delete this sent message? This action cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteSentMutation.mutate(msg.id)} data-testid="button-confirm-delete-sent-message">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>}
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
                      <AlertDialogContent>
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
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/content-notifications/counts"] }))
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
                      <AlertDialogContent>
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
                        <AlertDialogContent>
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
                  <AlertDialogContent>
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

function LogsTab() {
  const [category, setCategory] = useState<string>("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
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

  const renderDetails = (log: ActivityLog) => {
    if (!log.details) return null;
    try {
      const parsed = JSON.parse(log.details);
      return (
        <div className="space-y-1.5" data-testid={`log-details-${log.id}`}>
          {Object.entries(parsed).map(([key, value]) => (
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
  { category: "Support Tickets", perms: ["support_tickets"] },
  { category: "Admin Chat", perms: ["admin_chat"] },
  { category: "Logs", perms: ["logs.view"] },
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
                    <AlertDialogContent>
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
                    <AlertDialogContent>
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
                      if (e.key === "Enter" && !e.shiftKey && (messageText.trim() || chatFile)) {
                        e.preventDefault();
                        sendMessageMutation.mutate({ threadId: activeThreadId!, message: messageText, file: chatFile });
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
  "support-tickets": "support_tickets",
  "admin-chat": "admin_chat",
  "logs": "logs.view",
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
};

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
    { key: "support-tickets", label: "Support Tickets", icon: LifeBuoy, color: "text-sky-500", bg: "bg-sky-500/10", navigateTo: "/tickets" },
    { key: "admin-chat", label: "Admin Chat", icon: MessageSquare, color: "text-pink-500", bg: "bg-pink-500/10" },
    { key: "logs", label: "Logs", icon: ScrollText, color: "text-slate-500", bg: "bg-slate-500/10" },
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
      case "admin-chat": return <AdminChatTab />;
      case "logs": return <LogsTab />;
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
