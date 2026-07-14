import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ArrowLeft, CheckCircle, AlertTriangle, Lock } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

const resetPasswordSchema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type ResetPasswordData = z.infer<typeof resetPasswordSchema>;

export default function ResetPasswordPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const token = params.get("token");

  useEffect(() => {
    if (!success) return;
    if (countdown <= 0) {
      navigate("/auth");
      return;
    }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [success, countdown, navigate]);

  const form = useForm<ResetPasswordData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const handleSubmit = async (data: ResetPasswordData) => {
    if (!token) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/auth/reset-password", {
        token,
        password: data.password,
      });
      const result = await res.json();
      setSuccess(true);
      toast({ title: "Password reset!", description: result.message });
    } catch (e: any) {
      let errorMsg = "An error occurred. Please try again.";
      try {
        const raw = e.message || "";
        const jsonStart = raw.indexOf("{");
        if (jsonStart >= 0) {
          const parsed = JSON.parse(raw.substring(jsonStart));
          errorMsg = parsed.message || errorMsg;
        }
      } catch {}
      setError(errorMsg);
      toast({ title: "Reset failed", description: errorMsg, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <BrandLogo className="mx-auto h-24 mb-4" />
          </div>
          
          <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-border flex items-center justify-center">
              <h1 className="text-lg font-bold" data-testid="text-reset-invalid-title">Invalid Reset Link</h1>
            </div>
            <div className="p-6 space-y-6 text-center">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-status-busy/10 flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-status-busy" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground" data-testid="text-reset-no-token">
                This password reset link is invalid. Please request a new one.
              </p>
              <Link href="/forgot-password">
                <Button className="w-full" data-testid="button-request-new-link">
                  Request New Reset Link
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <BrandLogo className="mx-auto h-24 mb-4" />
        </div>
        
        <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-border flex items-center justify-center">
            <h1 className="text-lg font-bold" data-testid="text-reset-password-title">
              {success ? "Password Reset" : "Set New Password"}
            </h1>
          </div>
          <div className="p-6">
            {success ? (
              <div className="space-y-6 text-center">
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-status-online/10 flex items-center justify-center">
                    <CheckCircle className="w-8 h-8 text-status-online" />
                  </div>
                </div>
                <p className="text-sm text-foreground" data-testid="text-reset-success">
                  Your password has been successfully reset. Redirecting to sign in{countdown > 0 ? ` in ${countdown}...` : "..."}
                </p>
                <Link href="/auth">
                  <Button className="w-full gap-2 mt-2" data-testid="button-go-to-login">
                    <ArrowLeft className="w-4 h-4" />
                    Go to Sign In Now
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-6">
                <p className="text-sm text-muted-foreground text-center">
                  Enter your new password below.
                </p>
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-status-busy/10 text-status-busy text-sm border border-status-busy/20" data-testid="text-reset-error">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {error}
                  </div>
                )}
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>New Password</FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder="At least 6 characters"
                              data-testid="input-new-password"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confirm Password</FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder="Re-enter your password"
                              data-testid="input-confirm-password"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="pt-2">
                      <Button type="submit" className="w-full gap-2" disabled={isSubmitting} data-testid="button-reset-password">
                        <Lock className="w-4 h-4" />
                        {isSubmitting ? "Resetting..." : "Reset Password"}
                      </Button>
                    </div>
                  </form>
                </Form>
                <div className="text-center pt-2">
                  <Link href="/auth">
                    <Button variant="ghost" className="w-full gap-2" data-testid="button-back-to-login-reset">
                      <ArrowLeft className="w-4 h-4" />
                      Back to Sign In
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
