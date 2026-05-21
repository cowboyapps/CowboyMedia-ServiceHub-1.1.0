import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell, Check, ChevronRight, Loader2 } from "lucide-react";
import type { Service } from "@shared/schema";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props {
  onDone: () => void;
}

export function ServicesPickerWizard({ onDone }: Props) {
  const { toast } = useToast();
  const { data: services = [], isLoading } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const buckets = new Map<string, Service[]>();
    for (const s of services) {
      const key = (s.category && s.category.trim()) || "Other";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(s);
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });
  }, [services]);

  const saveMutation = useMutation({
    mutationFn: async (vars: { ids: string[]; dismiss: boolean }) => {
      await apiRequest("PATCH", "/api/auth/settings", {
        subscribedServices: vars.ids,
        servicesPickerDismissed: true,
      });
      void vars.dismiss;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      onDone();
    },
    onError: (e: Error) => {
      toast({ title: "Couldn't save your picks", description: e.message, variant: "destructive" });
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(services.map((s) => s.id)));
  const clearAll = () => setSelected(new Set());

  const handleSave = () => {
    saveMutation.mutate({ ids: Array.from(selected), dismiss: true });
  };

  const handleSkip = () => {
    saveMutation.mutate({ ids: [], dismiss: true });
  };

  const isSaving = saveMutation.isPending;

  return (
    <div className="min-h-dvh bg-background flex flex-col" data-testid="page-services-wizard">
      <div className="flex-1 flex flex-col w-full max-w-2xl mx-auto px-4 py-6 sm:py-10">
        <div className="flex flex-col items-center text-center mb-6">
          <BrandLogo className="h-12 sm:h-14 mb-3" />
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <Bell className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold" data-testid="text-wizard-title">
            Which services do you use?
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-md">
            Tick the ones you want to be notified about — outages, updates, and news. You can change this anytime in Settings.
          </p>
        </div>

        <div className="flex items-center justify-between mb-3 px-1">
          <p className="text-xs text-muted-foreground" data-testid="text-wizard-selected-count">
            {selected.size} selected
          </p>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={selectAll}
              disabled={isLoading || services.length === 0}
              data-testid="button-wizard-select-all"
            >
              Select all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={clearAll}
              disabled={isLoading || selected.size === 0}
              data-testid="button-wizard-clear-all"
            >
              Clear
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 pb-4 min-h-[200px]">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : services.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-10">
              No services available yet. You can pick them later in Settings.
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map(([category, items]) => (
                <div key={category}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 px-1">
                    {category}
                  </p>
                  <div className="rounded-md border divide-y">
                    {items.map((service) => {
                      const checked = selected.has(service.id);
                      return (
                        <label
                          key={service.id}
                          htmlFor={`wiz-${service.id}`}
                          className={`flex items-start gap-3 px-3 py-3 cursor-pointer tap-interactive transition-colors ${checked ? "bg-primary/5" : "hover:bg-muted/40"}`}
                          data-testid={`row-wizard-service-${service.id}`}
                        >
                          <Checkbox
                            id={`wiz-${service.id}`}
                            checked={checked}
                            onCheckedChange={() => toggle(service.id)}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <Label htmlFor={`wiz-${service.id}`} className="text-sm font-medium cursor-pointer">
                              {service.name}
                            </Label>
                            {service.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                {service.description}
                              </p>
                            )}
                          </div>
                          {checked && <Check className="w-4 h-4 text-primary flex-shrink-0 mt-1" />}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 pt-3 border-t">
          <Button
            className="w-full gap-1.5"
            size="lg"
            onClick={handleSave}
            disabled={isSaving || isLoading}
            data-testid="button-wizard-save"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Save and continue <ChevronRight className="w-4 h-4" /></>}
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={handleSkip}
            disabled={isSaving}
            data-testid="button-wizard-skip"
          >
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ServicesPickerWizard;
