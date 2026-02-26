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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { Plus, Trash2, Edit, Users, Server, AlertTriangle, Newspaper, RotateCcw, Shield, ShieldCheck, Mail, Send, Clock, Zap, FileText } from "lucide-react";
import { format } from "date-fns";
import type { User, Service, ServiceAlert, NewsStory, QuickResponse, ReportRequest } from "@shared/schema";

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
  serviceId: z.string().min(1, "Service is required"),
});

const addUpdateSchema = z.object({
  message: z.string().min(1, "Message is required"),
  status: z.string().min(1, "Status is required"),
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

function UsersTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold">Users ({users?.length || 0})</h3>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-user"><Plus className="w-4 h-4 mr-1" /> Add User</Button>
          </DialogTrigger>
          <DialogContent>
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
        <DialogContent>
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

      {isLoading ? (
        <Skeleton className="h-40" />
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
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users?.map((u) => (
                <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                  <TableCell className="font-medium text-sm">{u.fullName}</TableCell>
                  <TableCell className="text-sm">{u.username}</TableCell>
                  <TableCell className="text-sm">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-xs capitalize">{u.role}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => toggleRoleMutation.mutate({ id: u.id, role: u.role === "admin" ? "customer" : "admin" })}
                        data-testid={`button-toggle-role-${u.id}`}
                      >
                        {u.role === "admin" ? <Shield className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => { setSelectedUser(u); setResetDialogOpen(true); }}
                        data-testid={`button-reset-password-${u.id}`}
                      >
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(u.id)}
                        data-testid={`button-delete-user-${u.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
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

function ServicesTab() {
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
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-service"><Plus className="w-4 h-4 mr-1" /> Add Service</Button>
          </DialogTrigger>
          <DialogContent>
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

      {isLoading ? <Skeleton className="h-40" /> : (
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
                      <Button size="icon" variant="ghost" onClick={() => openEdit(s)} data-testid={`button-edit-service-${s.id}`}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(s.id)} data-testid={`button-delete-service-${s.id}`}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
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

function AlertsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);

  const { data: alerts, isLoading } = useQuery<ServiceAlert[]>({
    queryKey: ["/api/alerts"],
  });
  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const form = useForm({
    resolver: zodResolver(createAlertSchema),
    defaultValues: { title: "", description: "", severity: "warning", serviceId: "" },
  });

  const updateForm = useForm({
    resolver: zodResolver(addUpdateSchema),
    defaultValues: { message: "", status: "investigating" },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof createAlertSchema>) => {
      await apiRequest("POST", "/api/admin/alerts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Alert created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addUpdateMutation = useMutation({
    mutationFn: async (data: z.infer<typeof addUpdateSchema>) => {
      await apiRequest("POST", `/api/admin/alerts/${selectedAlertId}/updates`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      setUpdateDialogOpen(false);
      updateForm.reset();
      toast({ title: "Update posted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resolveMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/admin/alerts/${id}/resolve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({ title: "Alert resolved" });
    },
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold">Alerts ({alerts?.length || 0})</h3>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-create-alert"><Plus className="w-4 h-4 mr-1" /> Create Alert</Button>
          </DialogTrigger>
          <DialogContent>
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
                <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-submit-alert">
                  {createMutation.isPending ? "Creating..." : "Create Alert"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent>
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
              <FormField control={updateForm.control} name="message" render={({ field }) => (
                <FormItem><FormLabel>Message</FormLabel><FormControl><Textarea data-testid="input-update-message" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <Button type="submit" className="w-full" disabled={addUpdateMutation.isPending} data-testid="button-submit-update">
                {addUpdateMutation.isPending ? "Posting..." : "Post Update"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {isLoading ? <Skeleton className="h-40" /> : (
        <div className="space-y-3">
          {alerts?.map((alert) => (
            <Card key={alert.id} data-testid={`card-admin-alert-${alert.id}`}>
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div className="space-y-1">
                  <h4 className="font-semibold text-sm">{alert.title}</h4>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={alert.severity === "critical" ? "destructive" : "secondary"} className="text-xs capitalize">{alert.severity}</Badge>
                    <Badge variant={alert.status === "resolved" ? "secondary" : "default"} className="text-xs capitalize">{alert.status}</Badge>
                    {serviceMap.get(alert.serviceId) && <Badge variant="secondary" className="text-xs">{serviceMap.get(alert.serviceId)}</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {alert.status !== "resolved" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => { setSelectedAlertId(alert.id); setUpdateDialogOpen(true); }} data-testid={`button-update-alert-${alert.id}`}>
                        Update
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => resolveMutation.mutate(alert.id)} data-testid={`button-resolve-alert-${alert.id}`}>
                        Resolve
                      </Button>
                    </>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-alert-${alert.id}`}>
                        <Trash2 className="w-4 h-4" />
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
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function NewsTab() {
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
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-create-news"><Plus className="w-4 h-4 mr-1" /> Publish Story</Button>
          </DialogTrigger>
          <DialogContent>
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
                <div className="flex gap-1 flex-shrink-0">
                  <Button size="icon" variant="ghost" onClick={() => openEditDialog(story)} data-testid={`button-edit-news-${story.id}`}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(story.id)} data-testid={`button-delete-news-${story.id}`}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editDialogOpen} onOpenChange={(open) => { if (!open) { setEditDialogOpen(false); setEditingStory(null); } }}>
        <DialogContent>
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

function MessagesTab() {
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
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-send-message"><Send className="w-4 h-4 mr-1" /> Send Message</Button>
          </DialogTrigger>
          <DialogContent>
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
                <AlertDialog>
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
                </AlertDialog>
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

function QuickResponsesTab() {
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
          <DialogTrigger asChild>
            <Button size="sm" onClick={openCreate} data-testid="button-add-quick-response">
              <Plus className="w-4 h-4 mr-1" /> Add Response
            </Button>
          </DialogTrigger>
          <DialogContent>
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
                  <div className="flex items-center gap-1 flex-shrink-0">
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
                  </div>
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

function ReportsRequestsTab() {
  const { toast } = useToast();
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updatingReport, setUpdatingReport] = useState<EnrichedReportRequest | null>(null);
  const [updateStatus, setUpdateStatus] = useState("");
  const [updateNotes, setUpdateNotes] = useState("");

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
                      <Badge variant={rr.type === "content_issue" ? "destructive" : "default"} className="text-xs">
                        {rr.type === "content_issue" ? "Content Issue" : "Movie/Series Request"}
                      </Badge>
                      {statusBadge(rr.status)}
                    </div>
                    <p className="font-medium text-sm mt-2" data-testid={`text-report-title-${rr.id}`}>{rr.title}</p>
                    {rr.description && <p className="text-xs text-muted-foreground mt-1">{rr.description}</p>}
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
                  <div className="flex items-center gap-1 flex-shrink-0">
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
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={updateDialogOpen} onOpenChange={(open) => { if (!open) { setUpdateDialogOpen(false); setUpdatingReport(null); } }}>
        <DialogContent>
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

export default function AdminPortal() {
  const { isAdmin } = useAuth();

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

  const sections = [
    { key: "users", label: "Users", icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
    { key: "services", label: "Services", icon: Server, color: "text-green-500", bg: "bg-green-500/10" },
    { key: "alerts", label: "Alerts", icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10" },
    { key: "news", label: "News", icon: Newspaper, color: "text-purple-500", bg: "bg-purple-500/10" },
    { key: "messages", label: "Messages", icon: Mail, color: "text-rose-500", bg: "bg-rose-500/10" },
    { key: "quick-responses", label: "Quick Responses", icon: Zap, color: "text-orange-500", bg: "bg-orange-500/10" },
    { key: "reports-requests", label: "Reports/Requests", icon: FileText, color: "text-cyan-500", bg: "bg-cyan-500/10" },
  ];

  const renderContent = () => {
    switch (activeSection) {
      case "users": return <UsersTab />;
      case "services": return <ServicesTab />;
      case "alerts": return <AlertsTab />;
      case "news": return <NewsTab />;
      case "messages": return <MessagesTab />;
      case "quick-responses": return <QuickResponsesTab />;
      case "reports-requests": return <ReportsRequestsTab />;
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
            return (
              <button
                key={s.key}
                onClick={() => setActiveSection(s.key)}
                className="flex flex-col items-center justify-center gap-3 p-6 sm:p-8 rounded-xl border bg-card hover:bg-accent/50 transition-colors active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid={`tile-admin-${s.key}`}
              >
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
