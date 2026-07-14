import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ArrowLeft, Mail, CheckCircle } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

const forgotPasswordSchema = z.object({
  usernameOrEmail: z.string().min(1, "Username or email is required"),
});

type ForgotPasswordData = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<ForgotPasswordData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { usernameOrEmail: "" },
  });

  const handleSubmit = async (data: ForgotPasswordData) => {
    setIsSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/auth/forgot-password", data);
      const result = await res.json();
      setSubmitted(true);
      toast({ title: "Check your email", description: result.message });
    } catch (e: any) {
      toast({ title: "Request sent", description: "If an account exists, a reset link has been sent." });
      setSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <BrandLogo className="mx-auto h-24 mb-4" />
        </div>
        
        <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-border flex items-center justify-center">
            <h1 className="text-lg font-bold" data-testid="text-forgot-password-title">
              {submitted ? "Check Your Email" : "Forgot Password"}
            </h1>
          </div>
          
          <div className="p-6">
            {submitted ? (
              <div className="space-y-6 text-center">
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-status-online/10 flex items-center justify-center">
                    <CheckCircle className="w-8 h-8 text-status-online" />
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-foreground" data-testid="text-forgot-password-success">
                    If an account with that username or email exists, we've sent a password reset link.
                    Please check your email and follow the instructions.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The link will expire in 60 minutes. If you don't see the email, check your spam folder.
                  </p>
                </div>
                <Link href="/auth">
                  <Button variant="outline" className="w-full gap-2 mt-4" data-testid="button-back-to-login">
                    <ArrowLeft className="w-4 h-4" />
                    Back to Sign In
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-6">
                <p className="text-sm text-muted-foreground text-center">
                  Enter your username or email address and we'll send you a link to reset your password.
                </p>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
                    <FormField
                      control={form.control}
                      name="usernameOrEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username or Email</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Enter your username or email"
                              data-testid="input-forgot-username-email"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="pt-2">
                      <Button type="submit" className="w-full gap-2" disabled={isSubmitting} data-testid="button-send-reset-link">
                        <Mail className="w-4 h-4" />
                        {isSubmitting ? "Sending..." : "Send Reset Link"}
                      </Button>
                    </div>
                  </form>
                </Form>
                <div className="text-center pt-2">
                  <Link href="/auth">
                    <Button variant="ghost" className="w-full gap-2" data-testid="button-back-to-login-form">
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
