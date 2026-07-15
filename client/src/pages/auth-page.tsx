import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { loginSchema, registerSchema, type LoginData, type RegisterData } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandLogo } from "@/components/brand-logo";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { serverActionErrorMessage } from "@/lib/server-error";
import { Shield, Wifi, Bell, MessageSquare } from "lucide-react";
import { Link } from "wouter";

function SectionIcon({ icon: Icon, tone }: { icon: any; tone: string }) {
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${tone}`}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

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
      toast({ title: "Login failed", description: serverActionErrorMessage(e, "Couldn't sign you in. Please check your details and try again."), variant: "destructive" });
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
      toast({ title: "Registration failed", description: serverActionErrorMessage(e, "Couldn't create your account. Please try again."), variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (user) return null;

  return (
    <div className="min-h-dvh flex bg-background">
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <BrandLogo className="mx-auto h-24 sm:h-32 mb-4" />
            <p className="text-sm text-muted-foreground">Monitor services, get alerts, submit tickets</p>
          </div>

          <div className="relative rounded-xl border border-card-border bg-card overflow-hidden shadow-sm animate-slide-up">
            <span className="pointer-events-none absolute inset-0 animate-hero-sweep" aria-hidden="true" />
            <div className="p-6 sm:p-8">
              {pendingChallengeId ? (
                <form onSubmit={handleVerifyTwoFactor} className="space-y-6" data-testid="form-two-factor">
                  <div className="space-y-2 text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                      <Shield className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="text-xl font-bold" data-testid="text-2fa-title">Two-step verification</h3>
                    <p className="text-sm text-muted-foreground">
                      Enter the 6-digit code from your authenticator app, or one of your backup codes.
                    </p>
                  </div>
                  <div className="space-y-4">
                    <Input
                      autoFocus
                      inputMode="text"
                      autoComplete="one-time-code"
                      placeholder="123456 or backup code"
                      value={twoFactorCode}
                      onChange={(e) => setTwoFactorCode(e.target.value)}
                      data-testid="input-2fa-code"
                      className="text-center text-lg tracking-widest"
                    />
                    <div className="space-y-2">
                      <Button type="submit" className="w-full" disabled={isSubmitting || twoFactorCode.length < 6} data-testid="button-2fa-verify">
                        {isSubmitting ? "Verifying..." : "Verify"}
                      </Button>
                      <Button type="button" variant="ghost" className="w-full" onClick={handleCancelTwoFactor} data-testid="button-2fa-cancel">
                        Cancel
                      </Button>
                    </div>
                  </div>
                </form>
              ) : (
                <Tabs defaultValue="login" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-6">
                    <TabsTrigger value="login" data-testid="tab-login">Sign In</TabsTrigger>
                    <TabsTrigger value="register" data-testid="tab-register">Sign Up</TabsTrigger>
                  </TabsList>

                  <TabsContent value="login" className="mt-0">
                    <Form {...loginForm}>
                      <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-5">
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
                        <div className="pt-2 space-y-4">
                          <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="button-login">
                            {isSubmitting ? "Signing in..." : "Sign In"}
                          </Button>
                          <div className="text-center">
                            <Link href="/forgot-password" className="text-sm text-muted-foreground hover:text-primary transition-colors" data-testid="link-forgot-password">
                              Forgot your password?
                            </Link>
                          </div>
                        </div>
                      </form>
                    </Form>
                  </TabsContent>

                  <TabsContent value="register" className="mt-0">
                    <Form {...registerForm}>
                      <form onSubmit={registerForm.handleSubmit(handleRegister)} className="space-y-5">
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
                        <div className="pt-2">
                          <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="button-register">
                            {isSubmitting ? "Creating account..." : "Create Account"}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </TabsContent>
                </Tabs>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 bg-muted/30 border-l border-border items-center justify-center p-12">
        <div className="max-w-md space-y-8">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tight">Stay Connected</h2>
            <p className="text-muted-foreground text-lg">Manage your services in one place.</p>
          </div>
          
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <SectionIcon icon={Wifi} tone="bg-status-online/10 text-status-online" />
              <div>
                <h3 className="font-semibold">Service Status</h3>
                <p className="text-sm text-muted-foreground mt-1">Real-time monitoring of all your subscribed services</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <SectionIcon icon={Bell} tone="bg-status-away/10 text-status-away" />
              <div>
                <h3 className="font-semibold">Instant Alerts</h3>
                <p className="text-sm text-muted-foreground mt-1">Get notified immediately when issues arise</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <SectionIcon icon={MessageSquare} tone="bg-primary/10 text-primary" />
              <div>
                <h3 className="font-semibold">Support Tickets</h3>
                <p className="text-sm text-muted-foreground mt-1">Open tickets and communicate with support in real-time</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
