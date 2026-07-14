import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge as BadgeUI } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Shield, Calendar, Award } from "lucide-react";
import type { Badge } from "@shared/badges";

interface UserProfileDialogProps {
  userId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ProfileResponse {
  id: string;
  fullName: string;
  chatUsername: string | null;
  avatarUrl: string | null;
  bio: string | null;
  memberSince: string | null;
  badges: Badge[];
  ticketCount: number;
}

const TONE_CLASSES: Record<string, string> = {
  silver: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100 border-slate-300 dark:border-slate-600",
  gold: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 border-amber-300 dark:border-amber-700",
  blue: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100 border-blue-300 dark:border-blue-700",
  purple: "bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-100 border-purple-300 dark:border-purple-700",
  green: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100 border-green-300 dark:border-green-700",
  amber: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100 border-orange-300 dark:border-orange-700",
};

export function UserProfileDialog({ userId, open, onOpenChange }: UserProfileDialogProps) {
  const { data, isLoading, error } = useQuery<ProfileResponse>({
    queryKey: ["/api/users", userId, "profile"],
    enabled: !!userId && open,
  });

  const initials = (name: string) => name?.[0]?.toUpperCase() || "?";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-user-profile">
        <DialogHeader>
          <DialogTitle data-testid="text-profile-title">Profile</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-4">
              <Skeleton className="w-16 h-16 rounded-full shrink-0" />
              <div className="flex-1 space-y-2 py-1">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32 mt-2" />
              </div>
            </div>
            <Skeleton className="h-20 w-full rounded-md mt-4" />
          </div>
        ) : error || !data ? (
          <div className="px-5 py-8 text-center border rounded-xl bg-card border-card-border">
            <p className="text-sm text-muted-foreground" data-testid="text-profile-error">
              Couldn't load profile.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <Avatar className="w-16 h-16">
                {data.avatarUrl && <AvatarImage src={data.avatarUrl} alt={data.fullName} />}
                <AvatarFallback className="text-lg">{initials(data.fullName)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-base font-semibold leading-tight" data-testid="text-profile-name">
                    {data.fullName}
                  </p>
                  {data.badges.some((b) => b.key === "admin" || b.key === "master_admin") && (
                    <Shield className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  )}
                </div>
                {data.chatUsername && data.chatUsername !== data.fullName && (
                  <p className="text-xs text-muted-foreground" data-testid="text-profile-chat-username">
                    @{data.chatUsername}
                  </p>
                )}
                {data.memberSince && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1" data-testid="text-profile-member-since">
                    <Calendar className="w-3 h-3" /> Member since {format(new Date(data.memberSince), "MMM yyyy")}
                  </p>
                )}
              </div>
            </div>

            {data.bio && (
              <div className="rounded-xl border border-card-border bg-card p-4">
                <p className="text-sm whitespace-pre-wrap break-words leading-relaxed" data-testid="text-profile-bio">
                  {data.bio}
                </p>
              </div>
            )}

            {data.badges.length > 0 && (
              <div className="rounded-xl border border-card-border bg-card p-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  <Award className="w-3.5 h-3.5" /> Badges
                </div>
                <div className="flex flex-wrap gap-2" data-testid="list-profile-badges">
                  {data.badges.map((b) => (
                    <BadgeUI
                      key={b.key}
                      variant="outline"
                      className={`text-[11px] ${TONE_CLASSES[b.tone] || ""}`}
                      title={b.description}
                      data-testid={`badge-${b.key}`}
                    >
                      {b.label}
                    </BadgeUI>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
