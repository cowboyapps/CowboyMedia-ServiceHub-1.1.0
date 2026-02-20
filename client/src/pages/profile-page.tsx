import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isPushSupported, subscribeToPush, unsubscribeFromPush, isSubscribedToPush } from "@/lib/push-notifications";
import { Input } from "@/components/ui/input";
import { User, Mail, Moon, Sun, Bell, BellOff, Download, Smartphone, ExternalLink } from "lucide-react";
import type { Service } from "@shared/schema";

export default function ProfilePage() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();

  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  const { data: services, isLoading } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const [fullName, setFullName] = useState(user?.fullName || "");

  const [selectedServices, setSelectedServices] = useState<string[]>(
    user?.subscribedServices || []
  );

  const fullNameMutation = useMutation({
    mutationFn: async (newFullName: string) => {
      await apiRequest("PATCH", "/api/auth/profile", { fullName: newFullName });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Full name updated" });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to update name", description: e.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    isPushSupported().then(setPushSupported);
    isSubscribedToPush().then(setPushEnabled);

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handlePushToggle = async (checked: boolean) => {
    setPushLoading(true);
    try {
      if (checked) {
        const success = await subscribeToPush();
        if (success) {
          setPushEnabled(true);
          toast({ title: "Push notifications enabled" });
        } else {
          toast({ title: "Could not enable notifications", description: "Please allow notifications in your browser settings", variant: "destructive" });
        }
      } else {
        await unsubscribeFromPush();
        setPushEnabled(false);
        toast({ title: "Push notifications disabled" });
      }
    } catch {
      toast({ title: "Error toggling notifications", variant: "destructive" });
    }
    setPushLoading(false);
  };

  const handleInstallApp = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const result = await installPrompt.userChoice;
      if (result.outcome === "accepted") {
        setInstallPrompt(null);
        toast({ title: "App installed successfully" });
      }
    }
  };

  const updateMutation = useMutation({
    mutationFn: async (subscribedServices: string[]) => {
      await apiRequest("PATCH", "/api/auth/profile", { subscribedServices });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Preferences saved" });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to save", description: e.message, variant: "destructive" });
    },
  });

  const toggleService = (serviceId: string) => {
    setSelectedServices((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  const savePreferences = () => {
    updateMutation.mutate(selectedServices);
  };

  if (!user) return null;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-profile-title">Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      <Card>
        <CardContent className="flex items-center gap-4 p-6">
          <Avatar className="w-16 h-16">
            <AvatarFallback className="text-lg">{user.fullName[0]}</AvatarFallback>
          </Avatar>
          <div className="space-y-0.5">
            <h2 className="font-semibold text-lg" data-testid="text-profile-name">{user.fullName}</h2>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Mail className="w-3.5 h-3.5" /> {user.email}
            </p>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <User className="w-3.5 h-3.5" /> @{user.username}
            </p>
            <Badge variant="secondary" className="text-xs capitalize mt-1">{user.role}</Badge>
          </div>
        </CardContent>
      </Card>

      {installPrompt && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              Install App
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Add to Home Screen</p>
                <p className="text-xs text-muted-foreground">Install ServiceHub for a native app experience</p>
              </div>
              <Button onClick={handleInstallApp} data-testid="button-install-app">
                <Download className="w-4 h-4 mr-2" />
                Install
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4" />
            Update Full Name
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="fullName" className="text-sm">Please enter your full name as it appears on your online account</Label>
          <Input
            id="fullName"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full Name"
            data-testid="input-full-name"
          />
          <Button
            onClick={() => fullNameMutation.mutate(fullName)}
            disabled={fullNameMutation.isPending}
            data-testid="button-save-fullname"
          >
            {fullNameMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ExternalLink className="w-4 h-4" />
            Online Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <a
            href="http://cowboymedia.net/billing"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="button-online-account"
          >
            <Button>
              <ExternalLink className="w-4 h-4 mr-2" />
              Login to my online account
            </Button>
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {theme === "dark" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            Appearance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Dark Mode</p>
              <p className="text-xs text-muted-foreground">Switch between light and dark themes</p>
            </div>
            <Switch
              checked={theme === "dark"}
              onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
              data-testid="switch-dark-mode"
            />
          </div>
        </CardContent>
      </Card>

      {pushSupported && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {pushEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              Push Notifications
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Enable Push Notifications</p>
                <p className="text-xs text-muted-foreground">Receive alerts for subscribed services and ticket updates</p>
              </div>
              <Switch
                checked={pushEnabled}
                onCheckedChange={handlePushToggle}
                disabled={pushLoading}
                data-testid="switch-push-notifications"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Service Subscriptions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">Select which services you want to receive alerts for</p>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
            </div>
          ) : !services || services.length === 0 ? (
            <p className="text-sm text-muted-foreground">No services available</p>
          ) : (
            <div className="space-y-3">
              {services.map((service) => (
                <div key={service.id} className="flex items-center gap-3" data-testid={`checkbox-service-${service.id}`}>
                  <Checkbox
                    id={service.id}
                    checked={selectedServices.includes(service.id)}
                    onCheckedChange={() => toggleService(service.id)}
                  />
                  <Label htmlFor={service.id} className="text-sm cursor-pointer flex-1">
                    {service.name}
                    {service.description && (
                      <span className="text-muted-foreground ml-1">- {service.description}</span>
                    )}
                  </Label>
                </div>
              ))}
            </div>
          )}
          <Button onClick={savePreferences} disabled={updateMutation.isPending} data-testid="button-save-preferences">
            {updateMutation.isPending ? "Saving..." : "Save Preferences"}
          </Button>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground mt-6 mb-2" data-testid="text-app-version">
        Version 1.0.1
      </p>
    </div>
  );
}
