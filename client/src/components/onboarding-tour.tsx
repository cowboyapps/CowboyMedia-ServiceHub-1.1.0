import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Activity, AlertTriangle, BellRing, BookOpen, Download, MessageSquare, Settings as SettingsIcon, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { isPushSupported, isSubscribedToPush, subscribeToPush } from "@/lib/push-notifications";

const REPLAY_EVENT = "onboarding:replay";
const OPEN_NOTIF_PREFS_EVENT = "onboarding:open-notif-prefs";

export function replayOnboardingTour() {
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT));
}

export function dispatchOpenNotifPrefs() {
  window.dispatchEvent(new CustomEvent(OPEN_NOTIF_PREFS_EVENT));
}

export const ONBOARDING_OPEN_NOTIF_PREFS_EVENT = OPEN_NOTIF_PREFS_EVENT;

type TourStep = {
  key: string;
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
  desktopSelector?: string;
  mobileSelector?: string;
};

const STEPS: TourStep[] = [
  {
    key: "welcome",
    title: "Welcome to ServiceHub!",
    body: "A quick 1-minute tour to show you where everything lives. You can skip anytime.",
    icon: Sparkles,
  },
  {
    key: "services",
    title: "Services",
    body: "See the live status of every service you depend on at a glance.",
    icon: Activity,
    desktopSelector: '[data-testid="nav-services"]',
    mobileSelector: '[data-testid="link-bottom-nav-services"]',
  },
  {
    key: "alerts",
    title: "Alerts",
    body: "Active incidents and important warnings show up here so you're never caught off guard.",
    icon: AlertTriangle,
    desktopSelector: '[data-testid="nav-alerts"]',
    mobileSelector: '[data-testid="link-bottom-nav-alerts"]',
  },
  {
    key: "tickets",
    title: "Support Tickets",
    body: "Open a support ticket and chat with our team in real time. Replies arrive instantly.",
    icon: MessageSquare,
    desktopSelector: '[data-testid="nav-tickets"]',
    mobileSelector: '[data-testid="link-bottom-nav-tickets"]',
  },
  {
    key: "knowledge",
    title: "Knowledge Base",
    body: "Browse our knowledge base for answers to common questions before opening a ticket — you'll often find what you need in seconds.",
    icon: BookOpen,
    desktopSelector: '[data-testid="nav-knowledge-base"]',
    mobileSelector: '[data-testid="button-bottom-nav-more"]',
  },
  {
    key: "downloads",
    title: "Downloads",
    body: "Grab commonly used files, installers, and resources from the Downloads page anytime.",
    icon: Download,
    desktopSelector: '[data-testid="nav-downloads"]',
    mobileSelector: '[data-testid="button-bottom-nav-more"]',
  },
  {
    key: "settings",
    title: "Finish setup",
    body: "Enable push notifications and pick which alerts you want to receive. We'll take you to Settings now.",
    icon: SettingsIcon,
    desktopSelector: '[data-testid="nav-settings"]',
    mobileSelector: '[data-testid="button-bottom-nav-more"]',
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function useTargetRect(selector: string | undefined, active: boolean): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    if (!active || !selector) {
      setRect(null);
      return;
    }
    let raf = 0;
    const update = () => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    const interval = window.setInterval(update, 500);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
      window.clearInterval(interval);
    };
  }, [selector, active]);

  return rect;
}

export function OnboardingTour() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [pushAvailable, setPushAvailable] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const autoTriggeredRef = useRef(false);

  const completeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/auth/onboarding-complete");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  // Auto-trigger for first-time customers.
  useEffect(() => {
    if (!user) return;
    if (user.role !== "customer") return;
    if (user.onboardingTourCompletedAt) return;
    if (autoTriggeredRef.current) return;
    if (sessionStorage.getItem("onboarding-tour-shown") === "1") return;
    autoTriggeredRef.current = true;
    sessionStorage.setItem("onboarding-tour-shown", "1");
    // small delay so layout settles after login
    const t = window.setTimeout(() => {
      setStepIndex(0);
      setActive(true);
    }, 600);
    return () => window.clearTimeout(t);
  }, [user]);

  // Replay event listener.
  useEffect(() => {
    const onReplay = () => {
      setStepIndex(0);
      setActive(true);
    };
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_EVENT, onReplay);
  }, []);

  // Push status when active.
  useEffect(() => {
    if (!active) return;
    isPushSupported().then(setPushAvailable);
    isSubscribedToPush().then(setPushOn);
  }, [active, stepIndex]);

  const step = STEPS[stepIndex];
  const selector = isMobile ? step?.mobileSelector : step?.desktopSelector;
  const rect = useTargetRect(selector, active);

  const finish = (markComplete: boolean) => {
    setActive(false);
    if (markComplete && user && !user.onboardingTourCompletedAt) {
      completeMutation.mutate();
    }
  };

  const advance = () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex((i) => i + 1);
    } else {
      finish(true);
      setLocation("/settings");
    }
  };

  const back = () => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  };

  // Keyboard handling.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Enter") {
        e.preventDefault();
        advance();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const handleEnablePush = async () => {
    if (pushOn) return;
    setPushBusy(true);
    try {
      const ok = await subscribeToPush();
      setPushOn(ok);
      if (ok) {
        toast({ title: "Push notifications enabled" });
      } else {
        toast({
          title: "Could not enable notifications",
          description: "Please allow notifications in your browser settings",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Error enabling notifications", variant: "destructive" });
    } finally {
      setPushBusy(false);
    }
  };

  const handleOpenNotifPrefs = () => {
    finish(true);
    setLocation("/settings");
    // Allow the page transition to mount before dispatching.
    window.setTimeout(() => dispatchOpenNotifPrefs(), 350);
  };

  const tooltipPosition = useMemo(() => {
    if (!step || !selector) return null;
    if (!rect) return null;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const tooltipW = Math.min(360, vw - 24);
    const tooltipH = 280;
    const margin = 12;
    const spaceBelow = vh - (rect.top + rect.height);
    const spaceAbove = rect.top;
    let top: number;
    if (isMobile) {
      // Bottom nav is at bottom — always place tooltip above it.
      top = Math.max(16, rect.top - tooltipH - margin);
    } else if (spaceBelow >= tooltipH + margin || spaceBelow >= spaceAbove) {
      top = rect.top + rect.height + margin;
    } else {
      top = Math.max(16, rect.top - tooltipH - margin);
    }
    let left = rect.left + rect.width / 2 - tooltipW / 2;
    left = Math.max(12, Math.min(left, vw - tooltipW - 12));
    return { top, left, width: tooltipW };
  }, [rect, step, selector, isMobile]);

  if (!active || !step) return null;

  const isLast = stepIndex === STEPS.length - 1;
  const isCentered = !selector || !rect || !tooltipPosition;
  const Icon = step.icon;

  const overlay = (
    <div className="fixed inset-0 z-[9990]" data-testid="onboarding-tour-root">
      {/* Click-blocking transparent layer (does not dim — spotlight does). */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => finish(true)}
        aria-hidden="true"
        data-testid="onboarding-backdrop"
      />

      {/* Spotlight cutout — uses inverse box-shadow. */}
      {!isCentered && rect && (
        <div
          className="absolute rounded-xl border-2 border-primary pointer-events-none transition-all duration-300 ease-out"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.65), 0 0 0 4px rgba(255,255,255,0.15)",
          }}
          data-testid="onboarding-spotlight"
        />
      )}

      {/* Tooltip / centered card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-step-title"
        className={
          isCentered
            ? "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(380px,calc(100vw-2rem))]"
            : "absolute"
        }
        style={
          isCentered
            ? undefined
            : { top: tooltipPosition!.top, left: tooltipPosition!.left, width: tooltipPosition!.width }
        }
        data-testid="onboarding-tooltip"
      >
        <div className="bg-background border rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-start gap-3 p-4 pb-2">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                Step {stepIndex + 1} of {STEPS.length}
              </p>
              <h3 id="onboarding-step-title" className="text-base font-semibold mt-0.5" data-testid="text-onboarding-title">
                {step.title}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => finish(true)}
              className="text-muted-foreground hover:text-foreground rounded-md p-1 -mr-1 -mt-1"
              aria-label="Skip tour"
              data-testid="button-onboarding-close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-4 pb-3 text-sm text-muted-foreground" data-testid="text-onboarding-body">
            {step.body}
          </div>

          {isLast && (
            <div className="px-4 pb-3 flex flex-col gap-2">
              {pushAvailable && (
                <Button
                  variant={pushOn ? "outline" : "default"}
                  size="sm"
                  onClick={handleEnablePush}
                  disabled={pushBusy || pushOn}
                  data-testid="button-onboarding-enable-push"
                >
                  <BellRing className="w-4 h-4 mr-1.5" />
                  {pushOn ? "Push notifications enabled" : pushBusy ? "Enabling..." : "Enable push notifications"}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenNotifPrefs}
                data-testid="button-onboarding-open-prefs"
              >
                <SlidersHorizontal className="w-4 h-4 mr-1.5" />
                Choose what to be notified about
              </Button>
            </div>
          )}

          {/* Progress dots */}
          <div className="px-4 pb-2 flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s.key}
                className={`h-1.5 rounded-full transition-all ${
                  i === stepIndex ? "w-5 bg-primary" : i < stepIndex ? "w-1.5 bg-primary/60" : "w-1.5 bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t bg-muted/40">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => finish(true)}
              data-testid="button-onboarding-skip"
            >
              {isLast ? "Close" : "Skip tour"}
            </Button>
            <div className="flex items-center gap-2">
              {stepIndex > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={back}
                  data-testid="button-onboarding-back"
                >
                  Back
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={advance}
                data-testid="button-onboarding-next"
                autoFocus
              >
                {isLast ? "Finish" : stepIndex === 0 ? "Start" : "Next"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
