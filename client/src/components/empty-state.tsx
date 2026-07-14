import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="px-5 py-10 flex flex-col items-center justify-center text-center animate-fade-in">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">
        <Icon className="h-6 w-6 text-muted-foreground/50" />
      </span>
      <p className="text-sm font-medium" data-testid={testId}>
        {title}
      </p>
      {hint && <p className="text-xs text-muted-foreground mt-1 max-w-64">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
