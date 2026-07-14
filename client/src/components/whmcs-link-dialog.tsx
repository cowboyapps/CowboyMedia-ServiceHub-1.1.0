import { useEffect, useState } from "react";
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
import { AlertCircle, CheckCircle2, Link2, Loader2, MailCheck } from "lucide-react";

type Step = "email" | "code" | "success" | "conflict";

// How long the "Resend code" button stays disabled after a code is sent.
const RESEND_COOLDOWN_SECONDS = 45;

/**
 * Pulls `retryAfterSeconds` out of a 429 error thrown by `apiRequest`.
 * The thrown message looks like `429: {"error":"...","retryAfterSeconds":42}`.
 * Returns null when the error isn't a rate-limit (429) response.
 */
function parseRetryAfter(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  if (!error.message.startsWith("429")) return null;
  const match = error.message.match(/"retryAfterSeconds"\s*:\s*(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

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
  // Inline error shown under the email field (no_match / unavailable).
  const [emailError, setEmailError] = useState<string | null>(null);
  // Number of failed email lookups — after the first, we surface a
  // "Proceed without linking" escape hatch so the user is never trapped.
  const [failedLookups, setFailedLookups] = useState(0);
  // Seconds remaining before another code can be requested. Ticks down to 0.
  const [cooldown, setCooldown] = useState(0);
  // Friendly rate-limit notice shown on the code step when the limiter trips.
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);

  // Tick the resend cooldown down to zero, one second at a time.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const reset = () => {
    setStep("email");
    setEmail("");
    setCode("");
    setEmailError(null);
    setFailedLookups(0);
    setCooldown(0);
    setRateLimitMessage(null);
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
          setEmailError(null);
          setRateLimitMessage(null);
          setCooldown(RESEND_COOLDOWN_SECONDS);
          setStep("code");
          toast({ title: "Check your email", description: "We sent a 6-digit code to that address." });
          break;
        case "no_match":
          setFailedLookups((n) => n + 1);
          setEmailError(
            "We couldn't find an account with that email. Please double-check it and try again.",
          );
          break;
        case "conflict":
          setStep("conflict");
          break;
        case "already_linked":
          toast({ title: "You're already linked", description: "Your account is already connected." });
          handleOpenChange(false);
          break;
        default:
          setFailedLookups((n) => n + 1);
          setEmailError("Account linking isn't available right now. Please try again later.");
      }
    },
    onError: (error) => {
      const retryAfter = parseRetryAfter(error);
      if (retryAfter != null) {
        setCooldown(retryAfter);
        const msg = `Too many requests. Please try again in ${retryAfter} second${
          retryAfter === 1 ? "" : "s"
        }.`;
        if (step === "code") {
          setRateLimitMessage(msg);
        } else {
          setEmailError(msg);
        }
        return;
      }
      setFailedLookups((n) => n + 1);
      setEmailError("Something went wrong. Please try again in a moment.");
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
            description:
              remaining > 0
                ? `That code didn't match. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`
                : "That code didn't match.",
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
          setCode("");
          setStep("email");
          break;
        case "too_many_attempts":
          toast({
            title: "Too many attempts",
            description: "Please request a new code and try again.",
            variant: "destructive",
          });
          setCode("");
          setStep("email");
          break;
        case "conflict":
          setStep("conflict");
          break;
        case "already_linked":
          toast({ title: "You're already linked", description: "Your account is already connected." });
          handleOpenChange(false);
          break;
      }
    },
    onError: (error) => {
      const retryAfter = parseRetryAfter(error);
      if (retryAfter != null) {
        setCooldown(retryAfter);
        setRateLimitMessage(
          `Too many attempts. Please try again in ${retryAfter} second${
            retryAfter === 1 ? "" : "s"
          }.`,
        );
        return;
      }
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
            <DialogHeader className="pt-2 pb-4">
              <div className="flex justify-center mb-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
                  <Link2 className="w-6 h-6 text-primary" />
                </div>
              </div>
              <DialogTitle className="text-center text-xl" data-testid="text-whmcs-link-title">
                Link your account
              </DialogTitle>
              <DialogDescription className="text-center mt-1.5 leading-relaxed">
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
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError(null);
                  }}
                  data-testid="input-whmcs-link-email"
                />
                {emailError && (
                  <p
                    className="flex items-start gap-1.5 text-sm text-destructive"
                    data-testid="text-whmcs-link-error"
                  >
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{emailError}</span>
                  </p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={!emailValid || requestMutation.isPending || cooldown > 0}
                data-testid="button-whmcs-link-send-code"
              >
                {requestMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending code...
                  </>
                ) : cooldown > 0 ? (
                  `Try again in ${cooldown}s`
                ) : (
                  "Send code"
                )}
              </Button>
              {failedLookups > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => handleOpenChange(false)}
                  data-testid="button-whmcs-link-proceed-without"
                >
                  Proceed to ServiceHub without account linking
                </Button>
              )}
            </form>
          </>
        )}

        {step === "code" && (
          <>
            <DialogHeader className="pt-2 pb-4">
              <div className="flex justify-center mb-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
                  <MailCheck className="w-6 h-6 text-primary" />
                </div>
              </div>
              <DialogTitle className="text-center text-xl" data-testid="text-whmcs-code-title">
                Enter your code
              </DialogTitle>
              <DialogDescription className="text-center mt-1.5 leading-relaxed">
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
                  onClick={() => {
                    setCode("");
                    setStep("email");
                  }}
                  data-testid="button-whmcs-link-change-email"
                >
                  Change email
                </button>
                <button
                  type="button"
                  className="text-primary underline-offset-2 hover:underline disabled:opacity-50 disabled:no-underline"
                  onClick={() => requestMutation.mutate()}
                  disabled={requestMutation.isPending || cooldown > 0}
                  data-testid="button-whmcs-link-resend"
                >
                  {requestMutation.isPending
                    ? "Sending..."
                    : cooldown > 0
                      ? `Resend in ${cooldown}s`
                      : "Resend code"}
                </button>
              </div>
              {rateLimitMessage && (
                <p
                  className="flex items-start gap-1.5 text-sm text-destructive"
                  data-testid="text-whmcs-link-rate-limit"
                >
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{rateLimitMessage}</span>
                </p>
              )}
            </form>
          </>
        )}

        {step === "conflict" && (
          <>
            <DialogHeader className="pt-2 pb-4">
              <div className="flex justify-center mb-3">
                <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center ring-1 ring-amber-500/20">
                  <AlertCircle className="w-6 h-6 text-amber-500" />
                </div>
              </div>
              <DialogTitle className="text-center text-xl" data-testid="text-whmcs-conflict-title">
                Account already connected
              </DialogTitle>
              <DialogDescription className="text-center mt-1.5 leading-relaxed">
                This billing account is already connected to another ServiceHub login. If you believe this
                is a mistake, please contact support and we'll help sort it out.
              </DialogDescription>
            </DialogHeader>
            <Button
              className="w-full"
              onClick={() => handleOpenChange(false)}
              data-testid="button-whmcs-conflict-close"
            >
              Close
            </Button>
          </>
        )}

        {step === "success" && (
          <>
            <DialogHeader className="pt-2 pb-4">
              <div className="flex justify-center mb-3">
                <div className="w-12 h-12 rounded-full bg-status-online/10 flex items-center justify-center ring-1 ring-status-online/20">
                  <CheckCircle2 className="w-6 h-6 text-status-online" />
                </div>
              </div>
              <DialogTitle className="text-center text-xl" data-testid="text-whmcs-success-title">
                Account linked!
              </DialogTitle>
              <DialogDescription className="text-center mt-1.5 leading-relaxed">
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
