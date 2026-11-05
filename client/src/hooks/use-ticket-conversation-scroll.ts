import { useCallback, useLayoutEffect, useRef, useState } from "react";

type Message = { id: string; senderId: string };
type Position = { top: number; height: number; viewport: number };
type LatestState = { showLatest: boolean; hasNewMessages: boolean };

/**
 * Following is user intent, not a measurement of the current bottom gap.
 * A new bubble, image, or keyboard resize can increase that gap without the
 * reader choosing to leave the bottom.
 */
export class TicketConversationScroller {
  private following = true;
  private frame: number | null = null;
  private disposed = false;
  private previousIds: Set<string> | null = null;
  private newMessages = false;
  private position: Position;
  private touchY: number | null = null;
  private observer: ResizeObserver | undefined;
  private cleanups: Array<() => void> = [];

  constructor(
    readonly element: HTMLElement,
    readonly content: HTMLElement,
    private publish: (state: LatestState) => void,
  ) {
    this.position = this.measure();
    const listen = (target: EventTarget, type: string, handler: EventListener, capture = false) => {
      target.addEventListener(type, handler, { passive: true, capture });
      this.cleanups.push(() => target.removeEventListener(type, handler, capture));
    };
    listen(element, "scroll", this.onScroll);
    listen(element, "wheel", event => {
      if ((event as WheelEvent).deltaY < 0) this.browseHistory();
    });
    listen(element, "touchstart", event => {
      this.touchY = (event as TouchEvent).touches[0]?.clientY ?? null;
    });
    listen(element, "touchmove", event => {
      const y = (event as TouchEvent).touches[0]?.clientY;
      if (y !== undefined && this.touchY !== null && y > this.touchY + 3) this.browseHistory();
      if (y !== undefined) this.touchY = y;
    });
    listen(element, "touchend", () => { this.touchY = null; });
    listen(element, "touchcancel", () => { this.touchY = null; });
    listen(element, "keydown", event => {
      const key = event as KeyboardEvent;
      if ((key.target as Element | null)?.closest("input,textarea,[contenteditable=true]")) return;
      if (["ArrowUp", "PageUp", "Home"].includes(key.key) || (key.key === " " && key.shiftKey)) this.browseHistory();
    });
    listen(content, "load", this.layoutChanged, true);
    listen(content, "loadedmetadata", this.layoutChanged, true);
    listen(window, "resize", this.layoutChanged);
    listen(window, "orientationchange", this.layoutChanged);
    if (window.visualViewport) listen(window.visualViewport, "resize", this.layoutChanged);
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(this.layoutChanged);
      this.observer.observe(element);
      this.observer.observe(content);
    }
    this.report();
  }

  private measure(): Position {
    return { top: this.element.scrollTop, height: this.element.scrollHeight, viewport: this.element.clientHeight };
  }

  private gap(position = this.measure()) {
    return Math.max(0, position.height - position.viewport - position.top);
  }

  private report() {
    const showLatest = this.gap() > 48;
    if (!showLatest) this.newMessages = false;
    this.publish({ showLatest, hasNewMessages: showLatest && this.newMessages });
  }

  private cancelFrame() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private scrollNow() {
    if (this.disposed || !this.following) return;
    // Explicit pane only: scrollIntoView can move the app/document on phones.
    // Use instant positioning so a second layout change cannot interrupt an
    // in-flight smooth scroll and falsely look like deliberate history browsing.
    this.element.scrollTop = Math.max(0, this.element.scrollHeight - this.element.clientHeight);
    this.position = this.measure();
    this.report();
  }

  private schedule() {
    if (this.disposed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (this.following) this.scrollNow();
      else this.report();
    });
  }

  private browseHistory() {
    this.following = false;
    this.cancelFrame();
  }

  private onScroll = () => {
    const current = this.measure();
    // Scrollbar drags / native scrolling need no wheel or touch event. A clamp
    // caused by shrinking content is not, by itself, a history-browsing gesture.
    if (current.top < this.position.top - 1 && this.gap(current) > 2) this.browseHistory();
    if (this.gap(current) <= 2) this.following = true;
    this.position = current;
    if (this.following && this.gap(current) > 2) this.schedule();
    this.report();
  };

  private layoutChanged = () => {
    // Observers/events are coalesced; no repeating timeout or animation loop.
    this.schedule();
  };

  /** Called in React's layout phase, after optimistic/saved bubbles commit. */
  commit(messages: readonly Message[] | undefined, actorId: string | undefined) {
    if (this.disposed) return;
    if (messages) {
      if (this.previousIds && !this.following && messages.some(message =>
        message.senderId !== actorId && !this.previousIds!.has(message.id))) {
        this.newMessages = true;
      }
      this.previousIds = new Set(messages.map(message => message.id));
    }
    if (this.following) {
      this.scrollNow();
      this.schedule();
    } else this.report();
  }

  /** Sending defers positioning until commit; Latest can position immediately. */
  followLatest(immediate: boolean) {
    if (this.disposed) return;
    this.following = true;
    this.newMessages = false;
    if (immediate) {
      this.scrollNow();
      this.schedule();
    }
  }

  dispose() {
    this.disposed = true;
    this.cancelFrame();
    this.observer?.disconnect();
    this.cleanups.forEach(cleanup => cleanup());
  }
}

export function useTicketConversationScroll({
  conversationId, enabled, messages, optimisticMessages, actorId,
}: {
  conversationId: string | undefined;
  enabled: boolean;
  messages: readonly Message[] | undefined;
  optimisticMessages: readonly Message[];
  actorId: string | undefined;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const active = useRef<{ id: string | undefined; scroller: TicketConversationScroller } | null>(null);
  const followRequested = useRef(false);
  const [followVersion, setFollowVersion] = useState(0);
  const [state, setState] = useState<LatestState>({ showLatest: false, hasNewMessages: false });
  const report = useCallback((next: LatestState) => setState(previous =>
    previous.showLatest === next.showLatest && previous.hasNewMessages === next.hasNewMessages ? previous : next), []);

  useLayoutEffect(() => {
    const element = enabled ? scrollContainerRef.current : null;
    const content = enabled ? contentRef.current : null;
    if (active.current && (active.current.id !== conversationId || active.current.scroller.element !== element || active.current.scroller.content !== content)) {
      active.current.scroller.dispose();
      active.current = null;
      followRequested.current = false;
    }
    if (!element || !content) return;
    if (!active.current) active.current = { id: conversationId, scroller: new TicketConversationScroller(element, content, report) };
    if (followRequested.current) {
      active.current.scroller.followLatest(false);
      followRequested.current = false;
    }
    active.current.scroller.commit(messages, actorId);
  }, [conversationId, enabled, messages, optimisticMessages, actorId, followVersion, report]);

  useLayoutEffect(() => () => {
    active.current?.scroller.dispose();
    active.current = null;
  }, []);

  const requestFollow = useCallback(() => {
    followRequested.current = true;
    active.current?.scroller.followLatest(false);
    setFollowVersion(value => value + 1);
  }, []);
  const jumpToLatest = useCallback(() => { active.current?.scroller.followLatest(true); }, []);

  return { scrollContainerRef, contentRef, requestFollow, jumpToLatest, ...state };
}
