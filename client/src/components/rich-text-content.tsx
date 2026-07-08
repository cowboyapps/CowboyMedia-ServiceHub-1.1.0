import DOMPurify from "dompurify";
import { isHtmlContent } from "@/components/rich-text-editor";

// Sanitized renderer for alert descriptions and update messages authored with
// the rich text editor. Legacy plain-text content falls back to a
// whitespace-preserving paragraph. Images are intentionally NOT allowed here —
// alerts use the dedicated image-attachment field, not inline images.
const ALLOWED_TAGS = ["p", "br", "strong", "em", "u", "s", "span", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "a", "code", "pre"];
const ALLOWED_ATTR = ["style", "href", "target", "rel"];

export function RichTextContent({ content, className = "", testId }: { content: string; className?: string; testId?: string }) {
  if (isHtmlContent(content)) {
    return (
      <div
        className={`prose prose-sm dark:prose-invert max-w-none break-words ${className}`}
        data-testid={testId}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content, { ALLOWED_TAGS, ALLOWED_ATTR }) }}
      />
    );
  }
  return (
    <p className={`whitespace-pre-wrap break-words ${className}`} data-testid={testId}>
      {content}
    </p>
  );
}
