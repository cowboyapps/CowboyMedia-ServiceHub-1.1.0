import { memo, useMemo } from "react";
import { parseChatMarkdown, hasChatMarkup, type ChatInlineNode } from "@shared/chat-markdown";

interface ChatMessageContentProps {
  content: string;
  /** The viewing user's chat username — their own mentions get emphasis. */
  selfUsername?: string | null;
  /** Render on a primary (own-message) bubble — adjusts pill/link colors. */
  onPrimary?: boolean;
  className?: string;
  "data-testid"?: string;
}

function renderNodes(
  nodes: ChatInlineNode[],
  selfUsername: string | null | undefined,
  onPrimary: boolean,
  keyPrefix = "",
): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}${i}`;
    switch (node.type) {
      case "text":
        return <span key={key}>{node.text}</span>;
      case "code":
        return (
          <code
            key={key}
            className={`px-1 py-0.5 rounded text-[0.85em] font-mono ${onPrimary ? "bg-primary-foreground/20" : "bg-foreground/10"}`}
          >
            {node.text}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline underline-offset-2 break-all ${onPrimary ? "text-primary-foreground" : "text-primary"}`}
          >
            {node.text}
          </a>
        );
      case "mention": {
        const isSelf = !!selfUsername && node.username.toLowerCase() === selfUsername.toLowerCase();
        const isEveryone = node.username.toLowerCase() === "everyone";
        const base = "inline-block px-1 rounded font-medium";
        const tone = isSelf || isEveryone
          ? onPrimary
            ? "bg-primary-foreground/30 text-primary-foreground"
            : "bg-primary/20 text-primary"
          : onPrimary
            ? "bg-primary-foreground/15 text-primary-foreground"
            : "bg-primary/10 text-primary";
        return (
          <span key={key} className={`${base} ${tone}`} data-testid={`mention-pill-${node.username}`}>
            @{node.username}
          </span>
        );
      }
      case "bold":
        return <strong key={key}>{renderNodes(node.children, selfUsername, onPrimary, `${key}-`)}</strong>;
      case "italic":
        return <em key={key}>{renderNodes(node.children, selfUsername, onPrimary, `${key}-`)}</em>;
      case "strike":
        return <s key={key}>{renderNodes(node.children, selfUsername, onPrimary, `${key}-`)}</s>;
    }
  });
}

/**
 * Renders chat message text with Telegram-style markdown shorthand
 * (**bold**, *italic*, ~~strike~~, `code`), clickable links, and @mention
 * pills. Parses the raw text into a node tree — no HTML is ever injected.
 */
export const ChatMessageContent = memo(function ChatMessageContent({
  content,
  selfUsername,
  onPrimary = false,
  className,
  "data-testid": testId,
}: ChatMessageContentProps) {
  const nodes = useMemo(
    () => (hasChatMarkup(content) ? parseChatMarkdown(content) : null),
    [content],
  );
  return (
    <p className={className ?? "text-sm whitespace-pre-wrap break-words overflow-hidden"} data-testid={testId}>
      {nodes ? renderNodes(nodes, selfUsername, onPrimary) : content}
    </p>
  );
});
