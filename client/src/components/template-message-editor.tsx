import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  PLACEHOLDER_TOKEN_RE,
  QUICK_RESPONSE_VARIABLES,
  suggestKnownVariable,
} from "@shared/quick-response-vars";

export type TemplateEditorPart =
  | { kind: "text"; value: string }
  | { kind: "unknown"; raw: string; start: number; end: number; suggestion: string | null };

type Part = TemplateEditorPart;

/**
 * Tokenize a template into plain text segments and "unknown" placeholder
 * tokens (i.e. `{{...}}` whose key is not in `QUICK_RESPONSE_VARIABLES`).
 * Known variables are folded into the surrounding text since the editor
 * only highlights *unknown* tokens.
 */
export function tokenizeTemplateForEditor(value: string): TemplateEditorPart[] {
  if (!value) return [];
  const out: TemplateEditorPart[] = [];
  const re = new RegExp(PLACEHOLDER_TOKEN_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    if (m.index > last) {
      out.push({ kind: "text", value: value.slice(last, m.index) });
    }
    const key = m[1];
    const raw = m[0];
    const isKnown = (QUICK_RESPONSE_VARIABLES as readonly string[]).includes(key);
    if (isKnown) {
      out.push({ kind: "text", value: raw });
    } else {
      out.push({
        kind: "unknown",
        raw,
        start: m.index,
        end: m.index + raw.length,
        suggestion: suggestKnownVariable(raw),
      });
    }
    last = m.index + raw.length;
  }
  if (last < value.length) {
    out.push({ kind: "text", value: value.slice(last) });
  }
  return out;
}

export function hasUnknownPlaceholders(parts: TemplateEditorPart[]): boolean {
  return parts.some((p) => p.kind === "unknown");
}

/**
 * Compute the new value and resulting selection after replacing
 * `value[start:end]` with `replacement`.
 *
 * - `caret: "end"` collapses the selection to the end of the inserted
 *   replacement (used by "Remove placeholder").
 * - `caret: "select"` selects the inserted replacement (used when
 *   programmatically swapping one token for another).
 */
export function applyTemplateReplace(
  value: string,
  start: number,
  end: number,
  replacement: string,
  caret: "end" | "select",
): { next: string; selectionStart: number; selectionEnd: number } {
  const next = value.slice(0, start) + replacement + value.slice(end);
  if (caret === "select") {
    return {
      next,
      selectionStart: start,
      selectionEnd: start + replacement.length,
    };
  }
  const pos = start + replacement.length;
  return { next, selectionStart: pos, selectionEnd: pos };
}

export type TemplateMessageEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  rows?: number;
  placeholder?: string;
  name?: string;
  testId?: string;
};

export function TemplateMessageEditor({
  value,
  onChange,
  onBlur,
  rows = 4,
  placeholder,
  name,
  testId,
}: TemplateMessageEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [openTokenKey, setOpenTokenKey] = useState<string | null>(null);

  const parts = useMemo<Part[]>(() => tokenizeTemplateForEditor(value), [value]);

  const hasHighlights = useMemo(() => hasUnknownPlaceholders(parts), [parts]);

  useEffect(() => {
    if (!hasHighlights) setOpenTokenKey(null);
  }, [hasHighlights]);

  const replaceRange = useCallback(
    (start: number, end: number, replacement: string, caret: "end" | "select") => {
      const { next, selectionStart, selectionEnd } = applyTemplateReplace(
        value,
        start,
        end,
        replacement,
        caret,
      );
      onChange(next);
      setOpenTokenKey(null);
      requestAnimationFrame(() => {
        const el = taRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(selectionStart, selectionEnd);
      });
    },
    [value, onChange],
  );

  const jumpTo = useCallback((start: number, end: number) => {
    setOpenTokenKey(null);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    });
  }, []);

  const syncScroll = useCallback(() => {
    const ta = taRef.current;
    const ov = overlayRef.current;
    if (!ta || !ov) return;
    ov.scrollTop = ta.scrollTop;
    ov.scrollLeft = ta.scrollLeft;
  }, []);

  useEffect(() => {
    syncScroll();
  }, [value, syncScroll]);

  return (
    <div className="relative">
      {hasHighlights && (
        <div
          ref={overlayRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent px-3 py-2 text-base md:text-sm leading-5 text-transparent whitespace-pre-wrap break-words"
          data-testid="overlay-template-placeholder-highlights"
        >
          {parts.map((part, i) => {
            if (part.kind === "text") {
              return <span key={i}>{part.value}</span>;
            }
            const tokenKey = `${i}-${part.start}`;
            return (
              <Popover
                key={tokenKey}
                open={openTokenKey === tokenKey}
                onOpenChange={(o) => setOpenTokenKey(o ? tokenKey : null)}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="pointer-events-auto rounded bg-amber-200/70 dark:bg-amber-900/50 underline decoration-amber-600 decoration-2 underline-offset-2 text-transparent cursor-pointer p-0 m-0 border-0 align-baseline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    data-testid={`overlay-template-placeholder-token-${i}`}
                    aria-label={`Fix unknown placeholder ${part.raw}`}
                  >
                    {part.raw}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="top"
                  className="w-64 p-0 pointer-events-auto"
                  data-testid={`popover-template-placeholder-${i}`}
                >
                  <div className="p-3 space-y-1">
                    <div
                      className="text-xs font-mono break-all"
                      data-testid={`text-template-placeholder-token-${i}`}
                    >
                      {part.raw}
                    </div>
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid={`text-template-placeholder-explanation-${i}`}
                    >
                      {part.suggestion ? (
                        <>
                          This isn&apos;t a recognized variable. Did you mean{" "}
                          <code className="font-mono">{`{{${part.suggestion}}}`}</code>?
                        </>
                      ) : (
                        <>
                          This isn&apos;t a recognized variable, so it can&apos;t be
                          filled in automatically. Check for a typo.
                        </>
                      )}
                    </p>
                  </div>
                  <div className="border-t flex flex-col">
                    {part.suggestion && (
                      <button
                        type="button"
                        className="px-3 py-2 text-left text-sm hover:bg-accent"
                        onClick={() =>
                          replaceRange(
                            part.start,
                            part.end,
                            `{{${part.suggestion}}}`,
                            "end",
                          )
                        }
                        data-testid={`button-template-placeholder-suggest-${i}`}
                      >
                        Replace with <code className="font-mono">{`{{${part.suggestion}}}`}</code>
                      </button>
                    )}
                    <button
                      type="button"
                      className="px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() =>
                        replaceRange(part.start, part.end, "", "end")
                      }
                      data-testid={`button-template-placeholder-remove-${i}`}
                    >
                      Remove placeholder
                    </button>
                    <button
                      type="button"
                      className="px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => jumpTo(part.start, part.end)}
                      data-testid={`button-template-placeholder-edit-${i}`}
                    >
                      Edit manually
                    </button>
                  </div>
                </PopoverContent>
              </Popover>
            );
          })}
          {value.endsWith("\n") && "\u200b"}
        </div>
      )}
      <Textarea
        ref={taRef}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onScroll={syncScroll}
        rows={rows}
        placeholder={placeholder}
        className="leading-5"
        data-testid={testId}
      />
    </div>
  );
}
