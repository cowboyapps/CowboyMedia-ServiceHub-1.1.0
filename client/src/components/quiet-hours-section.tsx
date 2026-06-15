import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Moon, Clock } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { serverActionErrorMessage } from "@/lib/server-error";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import type { User } from "@shared/schema";
import { isInQuietHours, type QuietHoursUser } from "@shared/quiet-hours";

const ME_KEY = ["/api/auth/me"] as const;

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function QuietHoursSection() {
  const { user } = useAuth();
  const { toast } = useToast();

  const u = user as QuietHoursUser | undefined;
  const [enabled, setEnabled] = useState<boolean>(!!u?.quietHoursEnabled);
  const [start, setStart] = useState<string>(u?.quietHoursStart || "22:00");
  const [end, setEnd] = useState<string>(u?.quietHoursEnd || "07:00");
  const [tz, setTz] = useState<string>(u?.quietHoursTimezone || browserTimezone());
  const [allowCritical, setAllowCritical] = useState<boolean>(u?.quietHoursAllowCritical !== false);
  const [activeNow, setActiveNow] = useState<boolean>(false);

  useEffect(() => {
    setEnabled(!!u?.quietHoursEnabled);
    setStart(u?.quietHoursStart || "22:00");
    setEnd(u?.quietHoursEnd || "07:00");
    setTz(u?.quietHoursTimezone || browserTimezone());
    setAllowCritical(u?.quietHoursAllowCritical !== false);
  }, [u?.quietHoursEnabled, u?.quietHoursStart, u?.quietHoursEnd, u?.quietHoursTimezone, u?.quietHoursAllowCritical]);

  useEffect(() => {
    const tick = () => {
      setActiveNow(isInQuietHours({
        quietHoursEnabled: enabled,
        quietHoursStart: start,
        quietHoursEnd: end,
        quietHoursTimezone: tz,
        quietHoursAllowCritical: allowCritical,
      }));
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [enabled, start, end, tz, allowCritical]);

  const mutation = useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      await apiRequest("PATCH", "/api/auth/quiet-hours", patch);
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ME_KEY });
      const previous = queryClient.getQueryData<User>(ME_KEY);
      if (previous) {
        const map: Record<string, keyof User> = {
          enabled: "quietHoursEnabled" as keyof User,
          start: "quietHoursStart" as keyof User,
          end: "quietHoursEnd" as keyof User,
          timezone: "quietHoursTimezone" as keyof User,
          allowCritical: "quietHoursAllowCritical" as keyof User,
        };
        const next: any = { ...previous };
        for (const key of Object.keys(patch)) {
          const field = map[key];
          if (field) next[field] = patch[key];
        }
        queryClient.setQueryData<User>(ME_KEY, next);
      }
      return { previous };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(ME_KEY, ctx.previous);
      toast({ title: "Failed to save quiet hours", description: serverActionErrorMessage(e, "Couldn't save your quiet hours. Please try again."), variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
  });

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    const patch: Record<string, any> = { enabled: checked };
    // If first-time enable and the user hasn't customised, also persist a sensible timezone.
    if (checked && (!u?.quietHoursTimezone || u.quietHoursTimezone === "UTC")) {
      const tzNow = browserTimezone();
      patch.timezone = tzNow;
      setTz(tzNow);
    }
    mutation.mutate(patch);
  };

  const handleAllowCritical = (checked: boolean) => {
    setAllowCritical(checked);
    mutation.mutate({ allowCritical: checked });
  };

  const commitTime = (which: "start" | "end", value: string) => {
    if (!HHMM_RE.test(value)) {
      toast({ title: "Use HH:MM 24-hour format", variant: "destructive" });
      return;
    }
    mutation.mutate({ [which]: value });
  };

  const commitTimezone = () => {
    if (!tz.trim()) return;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      toast({ title: "Unknown timezone", description: tz, variant: "destructive" });
      return;
    }
    mutation.mutate({ timezone: tz });
  };

  const useBrowserTz = () => {
    const t = browserTimezone();
    setTz(t);
    mutation.mutate({ timezone: t });
  };

  return (
    <div className="rounded-lg border bg-card p-3 sm:p-4 space-y-3" data-testid="section-quiet-hours">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Moon className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Quiet hours</p>
            {enabled && activeNow && (
              <Badge variant="secondary" className="text-[10px] px-1.5 gap-1" data-testid="badge-quiet-active">
                <Clock className="w-3 h-3" /> Active now
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Silence push and email during a chosen window. In-app notifications still record normally.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          data-testid="switch-quiet-hours-enabled"
          aria-label="Enable quiet hours"
        />
      </div>

      {enabled && (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="qh-start" className="text-xs">Start</Label>
              <Input
                id="qh-start"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                onBlur={(e) => commitTime("start", e.target.value)}
                data-testid="input-quiet-hours-start"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qh-end" className="text-xs">End</Label>
              <Input
                id="qh-end"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                onBlur={(e) => commitTime("end", e.target.value)}
                data-testid="input-quiet-hours-end"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-1">
            {start === end
              ? "Set a different start and end time."
              : timeMinutes(start) > timeMinutes(end)
                ? `Crosses midnight: silent ${start} – ${end} the next day.`
                : `Silent from ${start} to ${end}.`}
          </p>

          <div className="space-y-1">
            <Label htmlFor="qh-tz" className="text-xs">Timezone</Label>
            <div className="flex gap-2">
              <Input
                id="qh-tz"
                value={tz}
                onChange={(e) => setTz(e.target.value)}
                onBlur={commitTimezone}
                placeholder="e.g. America/New_York"
                data-testid="input-quiet-hours-timezone"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={useBrowserTz}
                data-testid="button-quiet-hours-use-browser-tz"
              >
                Use mine
              </Button>
            </div>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">Still notify me about critical alerts</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Critical service alerts will bypass quiet hours.
              </p>
            </div>
            <Switch
              checked={allowCritical}
              onCheckedChange={handleAllowCritical}
              data-testid="switch-quiet-hours-allow-critical"
              aria-label="Allow critical alerts during quiet hours"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function timeMinutes(s: string): number {
  if (!HHMM_RE.test(s)) return 0;
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}
