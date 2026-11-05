import { useMemo } from "react";
import { ExternalLink, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { splitMessageLinks } from "./safe-message-links";
import { Link } from "wouter";

export function MessageBody({ message, id }: { message: string; id: string }) {
  const { toast } = useToast();
  const parts = useMemo(() => splitMessageLinks(message), [message]);
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Couldn’t copy link", description: "Select and copy the full address instead.", variant: "destructive" });
    }
  };
  return (
    <span data-testid={`message-body-${id}`}>
      {parts.map((part, index) => part.type === "text" ? (
        <span key={index}>{part.value}</span>
      ) : part.internal ? (
        <span key={index} className="inline-flex max-w-full align-baseline items-center gap-1 rounded-md bg-black/5 dark:bg-white/10 px-1.5 py-0.5 mx-0.5 text-[0.92em]">
          <Link href={part.href} title={part.value} className="min-w-0 max-w-[min(24rem,70vw)] truncate underline underline-offset-2">{part.label}</Link>
          <button type="button" onClick={() => copy(part.value)} aria-label={`Copy full link ${part.label}`} className="shrink-0 rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10"><Copy className="w-3 h-3" /></button>
        </span>
      ) : (
        <span key={index} className="inline-flex max-w-full align-baseline items-center gap-1 rounded-md bg-black/5 dark:bg-white/10 px-1.5 py-0.5 mx-0.5 text-[0.92em]">
          <a href={part.href} target="_blank" rel="noopener noreferrer" title={part.value} className="min-w-0 max-w-[min(24rem,70vw)] truncate underline underline-offset-2">
            {part.label}
          </a>
          <a href={part.href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${part.label}`} className="shrink-0">
            <ExternalLink className="w-3 h-3" />
          </a>
          <button type="button" onClick={() => copy(part.value)} aria-label={`Copy full link ${part.label}`} className="shrink-0 rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10">
            <Copy className="w-3 h-3" />
          </button>
        </span>
      ))}
    </span>
  );
}
