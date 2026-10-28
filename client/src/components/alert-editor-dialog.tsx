import type { ComponentProps, HTMLAttributes } from "react";
import { DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Keep actions outside the scrolling region. In particular, a growing
// contenteditable must not set the minimum height of the whole dialog.
export function AlertEditorDialogContent({ className, ...props }: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      {...props}
      className={cn("flex min-h-0 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-md", className)}
      style={{ ...props.style, overflowY: "hidden" }}
    />
  );
}

export function AlertEditorScrollArea({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain touch-pan-y pr-1", className)} />;
}

export function AlertEditorActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("shrink-0 border-t bg-background pt-3", className)} />;
}
