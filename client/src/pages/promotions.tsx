import { liveQueryOptions } from "@/lib/queryClient";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { BadgePercent, Tag, Copy, ChevronRight, Clock } from "lucide-react";
import { format } from "date-fns";
import type { Promotion } from "@shared/schema";

const audienceLabel: Record<string, string> = {
  new: "New customers",
  existing: "Existing customers",
  both: "All customers",
};

function AudiencePill({ audience, id }: { audience: string; id: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full bg-primary/10 dark:bg-primary/20 px-2.5 py-0.5 text-[11px] font-semibold text-primary shrink-0"
      data-testid={`badge-audience-${id}`}
    >
      {audienceLabel[audience] ?? audienceLabel.both}
    </span>
  );
}

function formatCountdown(endsAt: Date, now: number): { label: string; soon: boolean } {
  const diff = endsAt.getTime() - now;
  if (diff <= 0) return { label: "Expired", soon: true };
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return { label: `Ends in ${parts.join(" ")}`, soon: diff < 24 * 60 * 60 * 1000 };
}

function PromotionDialog({
  promotion,
  onClose,
}: {
  promotion: Promotion;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!promotion.endsAt) return;
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, [promotion.endsAt]);

  const countdown = promotion.endsAt
    ? formatCountdown(new Date(promotion.endsAt), now)
    : null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(promotion.couponCode);
    } catch {
      /* clipboard may be unavailable — still show the toast */
    }
    toast({ title: "Coupon code copied" });
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="w-[calc(100vw-2rem)] sm:max-w-md"
        data-testid="dialog-promotion"
      >
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <div className="w-14 h-14 rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
              <BadgePercent className="w-7 h-7 text-primary" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl">
            {promotion.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <AudiencePill audience={promotion.audience} id={promotion.id} />
            {countdown && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  countdown.soon
                    ? "bg-destructive/10 text-destructive"
                    : "bg-primary/10 dark:bg-primary/20 text-primary"
                }`}
                data-testid={`text-promo-countdown-${promotion.id}`}
              >
                <Clock className="w-3 h-3" />
                {countdown.soon && countdown.label !== "Expired" ? `Expires soon · ${countdown.label}` : countdown.label}
              </span>
            )}
          </div>

          <p className="text-sm text-muted-foreground whitespace-pre-wrap text-center">
            {promotion.description}
          </p>

          <div className="text-xs text-muted-foreground text-center space-y-0.5">
            <p>Starts {format(new Date(promotion.startsAt), "MMMM d, yyyy")}</p>
            {promotion.endsAt && (
              <p>Ends {format(new Date(promotion.endsAt), "MMMM d, yyyy")}</p>
            )}
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="w-full flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-primary bg-primary/10 dark:bg-primary/20 px-6 py-3 tap-interactive hover-elevate"
            data-testid="button-copy-coupon"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-primary/80">
              Coupon code
            </span>
            <span
              className="text-2xl font-bold tracking-widest text-primary"
              data-testid="text-coupon-code"
            >
              {promotion.couponCode}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Copy className="w-3 h-3" /> Tap to copy
            </span>
          </button>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="w-full"
            onClick={onClose}
            data-testid="button-close-promotion"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PromotionsPage() {
  const [selected, setSelected] = useState<Promotion | null>(null);

  const { data: promotions, isLoading } = useQuery<Promotion[]>({
    queryKey: ["/api/promotions"],
    ...liveQueryOptions,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Promotions"
        subtitle="Exclusive deals and offers just for you"
        testId="text-promotions-title"
      />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-card-border bg-card p-4 space-y-3">
              <Skeleton className="h-5 w-2/3 animate-shimmer" />
              <Skeleton className="h-3 w-full animate-shimmer" />
              <Skeleton className="h-3 w-24 animate-shimmer" />
            </div>
          ))}
        </div>
      ) : !promotions || promotions.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <EmptyState
            icon={BadgePercent}
            title="No promotions right now"
            hint="Check back soon for exclusive deals and offers."
            testId="text-promotions-empty"
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {promotions.map((promo) => (
            <li key={promo.id} className="stagger-item">
              <button
                type="button"
                onClick={() => setSelected(promo)}
                className="w-full text-left rounded-xl border border-card-border bg-card p-4 hover-elevate tap-interactive flex items-start gap-3"
                data-testid={`card-promotion-${promo.id}`}
              >
                <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 dark:bg-primary/20">
                  <Tag className="h-5 w-5 text-primary" />
                </span>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="text-sm font-semibold truncate"
                      data-testid={`text-promo-title-${promo.id}`}
                    >
                      {promo.title}
                    </span>
                    <AudiencePill audience={promo.audience} id={promo.id} />
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {promo.description}
                  </p>
                  {promo.endsAt && (
                    <p className="text-[11px] text-muted-foreground">
                      Ends {format(new Date(promo.endsAt), "MMMM d, yyyy")}
                    </p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 self-center" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <PromotionDialog promotion={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
