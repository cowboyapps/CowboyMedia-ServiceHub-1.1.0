import { useLayoutEffect, type RefObject } from "react";

/** Fit the entire composer inside its flex panel, not half the full screen. */
export function useTicketComposerSize(
  rootRef: RefObject<HTMLDivElement>,
  toolsRef: RefObject<HTMLDivElement>,
  inputRef: RefObject<HTMLTextAreaElement>,
  message: string,
) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    const tools = toolsRef.current;
    const input = inputRef.current;
    const panel = root?.parentElement;
    if (!root || !tools || !input || !panel) return;
    let frame: number | null = null;
    const resize = () => {
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const panelHeight = panel.clientHeight || viewport;
      const available = Math.max(36, panelHeight - 24);
      // Optional chips/tools scroll separately, leaving room for the editor
      // and its Send button even in a short landscape keyboard viewport.
      tools.style.maxHeight = `${Math.max(0, available * 0.4)}px`;
      const overhead = Math.max(0, root.offsetHeight - input.offsetHeight);
      const cap = Math.max(36, Math.min(viewport * 0.5, available - overhead));
      input.style.minHeight = `${Math.min(80, cap)}px`;
      input.style.maxHeight = `${cap}px`;
      input.style.height = "auto";
      input.style.height = `${Math.min(cap, Math.max(36, input.scrollHeight + 2))}px`;
      if (document.activeElement === input) {
        if (input.selectionEnd === input.value.length) {
          input.scrollTop = input.scrollHeight;
        } else {
          // Keep a caret in the middle of a draft visible on resize without
          // scrolling the document or moving the user's selection.
          const mirror = document.createElement("div");
          const style = getComputedStyle(input);
          for (const property of ["font", "line-height", "letter-spacing", "padding", "box-sizing", "word-break", "overflow-wrap"]) {
            mirror.style.setProperty(property, style.getPropertyValue(property));
          }
          Object.assign(mirror.style, {
            position: "fixed", visibility: "hidden", pointerEvents: "none",
            top: "0", left: "0", width: `${input.clientWidth}px`, whiteSpace: "pre-wrap",
          });
          mirror.textContent = input.value.slice(0, input.selectionEnd);
          const caret = document.createElement("span");
          caret.textContent = "\u200b";
          mirror.append(caret);
          document.body.append(mirror);
          const top = caret.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
          const lineHeight = parseFloat(style.lineHeight) || 20;
          if (top < input.scrollTop) input.scrollTop = top;
          else if (top + lineHeight > input.scrollTop + input.clientHeight) {
            input.scrollTop = top + lineHeight - input.clientHeight;
          }
          mirror.remove();
        }
        input.dispatchEvent(new Event("scroll"));
      }
    };
    const schedule = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = null; resize(); });
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(panel);
    observer?.observe(tools);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    input.addEventListener("focus", schedule);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      input.removeEventListener("focus", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [rootRef, toolsRef, inputRef, message]);
}
