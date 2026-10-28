import { useEffect, useState } from "react";
import { useKeyboardInset } from "./use-keyboard-inset";

/** Visibility is separate from padding: Android can resize BOTH viewports. */
export function useKeyboardOpen(): boolean {
  const inset = useKeyboardInset();
  const [resizedKeyboard, setResizedKeyboard] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    let width = window.innerWidth;
    let baseline = window.innerHeight;
    let open = false;
    let rotatedOpenHeight: number | null = null;
    let frame: number | null = null;
    const baselines = new Map<number, number>([[width, baseline]]);
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const measure = () => {
      const height = window.innerHeight;
      const active = document.activeElement;
      const editing = active instanceof HTMLElement &&
        (active.isContentEditable ||
          (active instanceof HTMLTextAreaElement && !active.readOnly && !active.disabled) ||
          (active instanceof HTMLInputElement && !active.readOnly && !active.disabled &&
            /^(text|search|email|url|tel|password|number)$/.test(active.type)));
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        const knownBaseline = baselines.get(width);
        // Portrait keyboard height cannot predict landscape keyboard height.
        // For an unseen orientation, track the open viewport until a material
        // rebound or blur establishes its actual unobscured baseline.
        rotatedOpenHeight = knownBaseline === undefined && open ? height : null;
        baseline = knownBaseline ?? height;
      }
      if (rotatedOpenHeight !== null) {
        rotatedOpenHeight = Math.min(rotatedOpenHeight, height);
        if (!editing || height - rotatedOpenHeight >= 120) {
          open = false;
          rotatedOpenHeight = null;
          baseline = height;
          baselines.set(width, height);
        }
        setResizedKeyboard(open);
        return;
      }
      const threshold = Math.max(120, baseline * 0.18);
      const shrink = baseline - height;
      open = shrink > threshold && (editing || open);
      if (!open) {
        // Remember the unobscured size while focused too: Android Back can
        // dismiss the keyboard without blurring the textarea.
        // Keep the pre-focus baseline through the keyboard's animation;
        // several small resize steps must not erase the total height loss.
        baseline = editing ? Math.max(baseline, height) : height;
        baselines.set(width, baseline);
      }
      setResizedKeyboard(open);
    };
    const onChange = () => {
      measure();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = null; measure(); });
      for (const delay of [80, 250]) {
        const timer = setTimeout(() => { timers.delete(timer); measure(); }, delay);
        timers.add(timer);
      }
    };
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onChange);
    vv?.addEventListener("resize", onChange);
    document.addEventListener("focusin", onChange);
    document.addEventListener("focusout", onChange);
    onChange();
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
      vv?.removeEventListener("resize", onChange);
      document.removeEventListener("focusin", onChange);
      document.removeEventListener("focusout", onChange);
      if (frame !== null) cancelAnimationFrame(frame);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);
  return inset > 0 || resizedKeyboard;
}
