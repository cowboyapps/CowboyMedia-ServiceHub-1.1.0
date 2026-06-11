import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { loginSchema, registerSchema, type LoginData, type RegisterData } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandLogo } from "@/components/brand-logo";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Shield, Wifi, Bell, MessageSquare } from "lucide-react";
import { Link } from "wouter";

export default function AuthPage() {
  const { login, verifyTwoFactor, register, user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingChallengeId, setPendingChallengeId] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");

  const loginForm = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const registerForm = useForm<RegisterData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { username: "", password: "", email: "", fullName: "" },
  });

  // Redirect already-authenticated users away from the auth screen. This runs
  // in an effect (not during render) and only AFTER every hook above has been
  // called unconditionally. The previous version early-returned here, before
  // the useForm hooks below, so when auth resolved (null -> user) after the
  // first render the hook count changed and React crashed with "Rendered more
  // hooks than during the previous render", white-screening the page.
  useEffect(() => {
    if (user) {
      navigate((user.role === "admin" || user.role === "master_admin") ? "/admin" : "/");
    }
  }, [user, navigate]);

  const handleLogin = async (data: LoginData) => {
    setIsSubmitting(true);
    try {
      const result = await login(data);
      if (result?.twoFactorRequired && result.challengeId) {
        setPendingChallengeId(result.challengeId);
        setTwoFactorCode("");
      } else {
        toast({ title: "Welcome back!" });
      }
    } catch (e: any) {
      toast({ title: "Login failed", description: e.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingChallengeId) return;
    setIsSubmitting(true);
    try {
      await verifyTwoFactor(pendingChallengeId, twoFactorCode);
      toast({ title: "Welcome back!" });
      setPendingChallengeId(null);
      setTwoFactorCode("");
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.includes("expired") || msg.includes("Too many")) {
        setPendingChallengeId(null);
        setTwoFactorCode("");
        loginForm.reset();
      }
      toast({ title: "Verification failed", description: msg, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelTwoFactor = () => {
    setPendingChallengeId(null);
    setTwoFactorCode("");
    loginForm.reset();
  };

  const handleRegister = async (data: RegisterData) => {
    setIsSubmitting(true);
    try {
      await register(data);
      sessionStorage.setItem("showWelcome", "true");
      toast({ title: "Account created successfully!" });
    } catch (e: any) {
      toast({ title: "Registration failed", description: e.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Safe to bail here — every hook above has already run on this render, so the
  // hook count stays stable whether or not the user is signed in. The effect
  // above performs the actual redirect; this just avoids flashing the form.
  if (user) return null;

  return (
    <div className="min-h-dvh flex">
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <BrandLogo className="mx-auto h-32 mb-3" />
            <p className="text-sm text-muted-foreground mt-1">Monitor services, get alerts, submit tickets</p>
          </CardHeader>
          <CardContent>
            {pendingChallengeId ? (
              <form onSubmit={handleVerifyTwoFactor} className="space-y-4" data-testid="form-two-factor">
                <div className="space-y-1.5 text-center">
                  <Shield className="w-8 h-8 mx-auto text-primary" />
                  <h3 className="font-semibold" data-testid="text-2fa-title">Two-step verification</h3>
                  <p className="text-sm text-muted-foreground">
                    Enter the 6-digit code from your authenticator app, or one of your backup codes.
                  </p>
                </div>
                <Input
                  autoFocus
                  inputMode="text"
                  autoComplete="one-time-code"
                  placeholder="123456 or backup code"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  data-testid="input-2fa-code"
                />
                <Button type="submit" className="w-full" disabled={isSubmitting || twoFactorCode.length < 6} data-testid="button-2fa-verify">
                  {isSubmitting ? "Verifying..." : "Verify"}
                </Button>
                <Button type="button" variant="ghost" className="w-full" onClick={handleCancelTwoFactor} data-testid="button-2fa-cancel">
                  Cancel
                </Button>
              </form>
            ) : (
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login" data-testid="tab-login">Sign In</TabsTrigger>
                <TabsTrigger value="register" data-testid="tab-register">Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-4">
                <Form {...loginForm}>
                  <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
                    <FormField
                      control={loginForm.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter your username" data-testid="input-login-username" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={loginForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="Enter your password" data-testid="input-login-password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="button-login">
                      {isSubmitting ? "Signing in..." : "Sign In"}
                    </Button>
                    <div className="text-center">
                      <Link href="/forgot-password" className="text-sm text-primary hover:underline" data-testid="link-forgot-password">
                        Forgot your password?
                      </Link>
                    </div>
                  </form>
                </Form>
              </TabsContent>

              <TabsContent value="register" className="mt-4">
                <Form {...registerForm}>
                  <form onSubmit={registerForm.handleSubmit(handleRegister)} className="space-y-4">
                    <FormField
                      control={registerForm.control}
                      name="fullName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Your full name" data-testid="input-register-fullname" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="your@email.com" data-testid="input-register-email" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username</FormLabel>
                          <FormControl>
                            <Input placeholder="Choose a username" data-testid="input-register-username" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="At least 6 characters" data-testid="input-register-password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="button-register">
                      {isSubmitting ? "Creating account..." : "Create Account"}
                    </Button>
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="hidden lg:flex flex-1 bg-primary items-center justify-center p-12">
        <div className="max-w-md text-primary-foreground space-y-8">
          <h2 className="text-3xl font-bold">Stay Connected to Your Services</h2>
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-md bg-primary-foreground/20 flex items-center justify-center flex-shrink-0">
                <Wifi className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold">Service Status</h3>
                <p className="text-sm text-primary-foreground/80">Real-time monitoring of all your subscribed services</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-md bg-primary-foreground/20 flex items-center justify-center flex-shrink-0">
                <Bell className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold">Instant Alerts</h3>
                <p className="text-sm text-primary-foreground/80">Get notified immediately when issues arise</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-md bg-primary-foreground/20 flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold">Support Tickets</h3>
                <p className="text-sm text-primary-foreground/80">Open tickets and communicate with support in real-time</p>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
