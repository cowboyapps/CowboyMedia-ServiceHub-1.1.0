import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Link2, Loader2, MailCheck } from "lucide-react";

type Step = "email" | "code" | "success";

interface RequestResult {
  status: "code_sent" | "no_match" | "conflict" | "unavailable" | "already_linked" | "invalid";
}
interface VerifyResult {
  status:
    | "linked"
    | "invalid_code"
    | "expired"
    | "too_many_attempts"
    | "conflict"
    | "already_linked";
  attemptsRemaining?: number;
}

interface WhmcsLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the account has been successfully linked. */
  onLinked?: () => void;
}

export function WhmcsLinkDialog({ open, onOpenChange, onLinked }: WhmcsLinkDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  const reset = () => {
    setStep("email");
    setEmail("");
    setCode("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const requestMutation = useMutation({
    mutationFn: async (): Promise<RequestResult> => {
      const res = await apiRequest("POST", "/api/whmcs/link/request", { email: email.trim() });
      return res.json();
    },
    onSuccess: (data) => {
      switch (data.status) {
        case "code_sent":
          setStep("code");
          toast({ title: "Check your email", description: "We sent a 6-digit code to that address." });
          break;
        case "no_match":
          toast({
            title: "No matching account",
            description: "We couldn't find an account with that email. Please double-check it and try again.",
            variant: "destructive",
          });
          break;
        case "conflict":
          toast({
            title: "Already linked",
            description: "That account is already linked to another login. Please contact support if this isn't expected.",
            variant: "destructive",
          });
          break;
        case "already_linked":
          toast({ title: "You're already linked", description: "Your account is already connected." });
          handleOpenChange(false);
          break;
        default:
          toast({
            title: "Service unavailable",
            description: "Account linking isn't available right now. Please try again later.",
            variant: "destructive",
          });
      }
    },
    onError: () => {
      toast({ title: "Something went wrong", description: "Please try again in a moment.", variant: "destructive" });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async (): Promise<VerifyResult> => {
      const res = await apiRequest("POST", "/api/whmcs/link/verify", { code: code.trim() });
      return res.json();
    },
    onSuccess: (data) => {
      switch (data.status) {
        case "linked":
          setStep("success");
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          queryClient.invalidateQueries({ queryKey: ["/api/whmcs/link/status"] });
          queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
          onLinked?.();
          break;
        case "invalid_code": {
          const remaining = data.attemptsRemaining ?? 0;
          toast({
            title: "Incorrect code",
            description: remaining > 0 ? `That code didn't match. ${remaining} attempt${remaining === 1 ? "" : "s"} left.` : "That code didn't match.",
            variant: "destructive",
          });
          break;
        }
        case "expired":
          toast({
            title: "Code expired",
            description: "That code is no longer valid. Please request a new one.",
            variant: "destructive",
          });
          setStep("email");
          break;
        case "too_many_attempts":
          toast({
            title: "Too many attempts",
            description: "Please request a new code and try again.",
            variant: "destructive",
          });
          setStep("email");
          break;
        case "conflict":
          toast({
            title: "Already linked",
            description: "That account was just linked to another login. Please contact support.",
            variant: "destructive",
          });
          handleOpenChange(false);
          break;
        case "already_linked":
          toast({ title: "You're already linked", description: "Your account is already connected." });
          handleOpenChange(false);
          break;
      }
    },
    onError: () => {
      toast({ title: "Something went wrong", description: "Please try again in a moment.", variant: "destructive" });
    },
  });

  const emailValid = /\S+@\S+\.\S+/.test(email.trim());
  const codeValid = /^\d{6}$/.test(code.trim());

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-whmcs-link">
        {step === "email" && (
          <>
            <DialogHeader>
              <div className="flex justify-center mb-2">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Link2 className="w-6 h-6 text-primary" />
                </div>
              </div>
              <DialogTitle className="text-center" data-testid="text-whmcs-link-title">
                Link your account
              </DialogTitle>
              <DialogDescription className="text-center">
                Please provide the same email address you used to sign up online on our account management
                system. This will allow ServiceHub to show your account information, invoices, payments,
                reminders, and more.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (emailValid) requestMutation.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="whmcs-link-email">Account email</Label>
                <Input
                  id="whmcs-link-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="input-whmcs-link-email"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={!emailValid || requestMutation.isPending}
                data-testid="button-whmcs-link-send-code"
              >
                {requestMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending code...
                  </>
                ) : (
                  "Send code"
                )}
              </Button>
            </form>
          </>
        )}

        {step === "code" && (
          <>
            <DialogHeader>
              <div className="flex justify-center mb-2">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <MailCheck className="w-6 h-6 text-primary" />
                </div>
              </div>
              <DialogTitle className="text-center" data-testid="text-whmcs-code-title">
                Enter your code
              </DialogTitle>
              <DialogDescription className="text-center">
                We emailed a 6-digit code to <strong>{email.trim()}</strong>. Enter it below to confirm
                it's you. The code expires in 10 minutes.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (codeValid) verifyMutation.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="whmcs-link-code">Verification code</Label>
                <Input
                  id="whmcs-link-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  placeholder="123456"
                  className="text-center text-2xl tracking-[0.5em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  data-testid="input-whmcs-link-code"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={!codeValid || verifyMutation.isPending}
                data-testid="button-whmcs-link-verify"
              >
                {verifyMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verifying...
                  </>
                ) : (
                  "Verify & link"
                )}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  onClick={() => setStep("email")}
                  data-testid="button-whmcs-link-change-email"
                >
                  Change email
                </button>
                <button
                  type="button"
                  className="text-primary underline-offset-2 hover:underline disabled:opacity-50"
                  onClick={() => requestMutation.mutate()}
                  disabled={requestMutation.isPending}
                  data-testid="button-whmcs-link-resend"
                >
                  {requestMutation.isPending ? "Sending..." : "Resend code"}
                </button>
              </div>
            </form>
          </>
        )}

        {step === "success" && (
          <>
            <DialogHeader>
              <div className="flex justify-center mb-2">
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-green-500" />
                </div>
              </div>
              <DialogTitle className="text-center" data-testid="text-whmcs-success-title">
                Account linked!
              </DialogTitle>
              <DialogDescription className="text-center">
                Your account is now connected. You can view your invoices, payments, services, and
                reminders right here in the app.
              </DialogDescription>
            </DialogHeader>
            <Button
              className="w-full"
              onClick={() => handleOpenChange(false)}
              data-testid="button-whmcs-link-done"
            >
              Done
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
