import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TicketConversationScroller } from "../client/src/hooks/use-ticket-conversation-scroll";

const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const original = { window: globalThis.window, ResizeObserver: globalThis.ResizeObserver, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
Object.assign(globalThis, { window: dom.window });
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
globalThis.cancelAnimationFrame = id => { frames.delete(id); };
const observers = new Set<ResizeStub>();
class ResizeStub {
  disconnected = false;
  constructor(readonly callback: () => void) { observers.add(this); }
  observe() {}
  disconnect() { this.disconnected = true; observers.delete(this); }
}
globalThis.ResizeObserver = ResizeStub as unknown as typeof ResizeObserver;
function flush() {
  const queued = [...frames.values()];
  frames.clear();
  queued.forEach(callback => callback(0));
  assert.equal(frames.size, 0, "no polling/animation loop after a layout settles");
}
function resize() { observers.forEach(observer => observer.callback()); flush(); }
const messages = [{ id: "old-message", senderId: "support" }];

function fixture() {
  const element = dom.window.document.createElement("div");
  const content = dom.window.document.createElement("div");
  element.append(content);
  dom.window.document.body.append(element);
  let height = 1000, viewport = 200, top = 0, writes = 0;
  Object.defineProperties(element, {
    scrollHeight: { get: () => height },
    clientHeight: { get: () => viewport },
    scrollTop: { get: () => top, set: (value: number) => { writes++; top = Math.max(0, Math.min(value, height - viewport)); } },
  });
  const state = { showLatest: false, hasNewMessages: false };
  const controller = new TicketConversationScroller(element, content, next => Object.assign(state, next));
  const scroll = (value: number) => { top = value; element.dispatchEvent(new dom.window.Event("scroll")); };
  return {
    controller, element, content, state, scroll,
    height: (value: number) => { height = value; },
    viewport: (value: number) => { viewport = value; },
    top: () => top, writes: () => writes,
    cleanup() { controller.dispose(); element.remove(); },
  };
}

test("initial load and delayed media/keyboard layout changes follow the actual pane bottom without moving focus", () => {
  const f = fixture();
  const editor = dom.window.document.createElement("textarea");
  dom.window.document.body.append(editor);
  editor.focus();
  try {
    f.controller.commit(messages, "customer");
    assert.equal(f.top(), 800);
    f.height(1400);
    resize();
    assert.equal(f.top(), 1200, "late image growth does not turn following off");
    f.viewport(100);
    dom.window.dispatchEvent(new dom.window.Event("resize"));
    flush();
    assert.equal(f.top(), 1300, "Android zero-inset layout resizing still follows");
    assert.equal(dom.window.document.activeElement, editor);
    assert.equal(dom.window.scrollY, 0);
    assert.equal(f.state.showLatest, false);
  } finally { f.cleanup(); editor.remove(); }
});

test("scrolling older history shows Latest without incoming messages and metadata/poll updates do not steal position", () => {
  const f = fixture();
  try {
    f.controller.commit(messages, "customer");
    flush();
    f.scroll(300);
    assert.deepEqual(f.state, { showLatest: true, hasNewMessages: false });
    f.controller.commit([...messages], "customer");
    f.height(1200);
    resize();
    assert.equal(f.top(), 300);
    f.controller.commit([...messages, { id: "incoming", senderId: "support" }], "customer");
    assert.deepEqual(f.state, { showLatest: true, hasNewMessages: true });
    assert.equal(f.top(), 300);
    f.controller.followLatest(true);
    assert.equal(f.top(), 1000);
    assert.deepEqual(f.state, { showLatest: false, hasNewMessages: false });
    flush();
  } finally { f.cleanup(); }
});

for (const kind of ["text", "image", "video", "file"]) {
  test(`outgoing ${kind} from history follows after commit and remains pinned across optimistic replacement and retry`, () => {
    const f = fixture();
    try {
      f.controller.commit(messages, "customer");
      flush();
      f.scroll(200);
      f.controller.followLatest(false);
      assert.equal(f.top(), 200, "send must not pretend to scroll a bubble that has not rendered");
      f.height(1120); // optimistic bubble has committed
      f.controller.commit(messages, "customer");
      assert.equal(f.top(), 920);
      flush();
      f.height(1300); // saved reply/media replaces optimistic row
      f.controller.commit([...messages, { id: "saved-own", senderId: "customer" }], "customer");
      flush();
      assert.equal(f.top(), 1100);
      assert.equal(f.state.hasNewMessages, false);
      f.height(1500);
      f.content.dispatchEvent(new dom.window.Event(kind === "video" ? "loadedmetadata" : "load"));
      flush();
      assert.equal(f.top(), 1300);
      f.viewport(260); // cleared composer shrinks, viewport grows
      resize();
      assert.equal(f.top(), 1240);
      f.scroll(100);
      f.controller.followLatest(false); // Retry updates status, not the message count
      f.controller.commit(messages, "customer");
      assert.equal(f.top(), 1240);
    } finally { f.cleanup(); }
  });
}

test("manual wheel/history scrolling cancels queued send following and late media does not pull the reader back", () => {
  const f = fixture();
  try {
    f.controller.commit(messages, "customer");
    flush();
    f.controller.followLatest(false);
    f.height(1200);
    f.controller.commit(messages, "customer");
    f.element.dispatchEvent(new dom.window.WheelEvent("wheel", { deltaY: -50 }));
    f.scroll(400);
    assert.equal(frames.size, 0);
    f.height(1500);
    resize();
    f.controller.commit([...messages, { id: "saved", senderId: "customer" }], "customer");
    assert.equal(f.top(), 400);
    assert.equal(f.state.showLatest, true);
    assert.equal(f.state.hasNewMessages, false);
    f.scroll(1300);
    f.height(1600);
    resize();
    assert.equal(f.top(), 1400, "manually reaching the bottom resumes normal following");
  } finally { f.cleanup(); }
});

test("touch history intent cancels following even before media changes layout and the first scroll event arrives", () => {
  const f = fixture();
  try {
    f.controller.commit(messages, "customer");
    flush();
    for (const [type, y] of [["touchstart", 100], ["touchmove", 150]] as const) {
      const event = new dom.window.Event(type);
      Object.defineProperty(event, "touches", { value: [{ clientY: y }] });
      f.element.dispatchEvent(event);
    }
    f.height(1400);
    f.scroll(700);
    resize();
    assert.equal(f.top(), 700);
    assert.equal(f.state.showLatest, true);
  } finally { f.cleanup(); }
});

test("content deletion/viewport expansion clamping at the bottom does not cancel following", () => {
  const f = fixture();
  try {
    f.controller.commit(messages, "customer");
    flush();
    f.height(600);
    f.scroll(400); // browser clamps after a deleted row
    f.height(900);
    resize();
    assert.equal(f.top(), 700);
  } finally { f.cleanup(); }
});

test("navigation cleanup cancels queued work and disconnects all layout listeners", () => {
  const f = fixture();
  f.controller.commit(messages, "customer");
  assert.equal(frames.size, 1);
  f.cleanup();
  assert.equal(frames.size, 0);
  assert.equal(observers.size, 0);
  const before = f.writes();
  dom.window.dispatchEvent(new dom.window.Event("resize"));
  f.content.dispatchEvent(new dom.window.Event("load"));
  flush();
  assert.equal(f.writes(), before);
});

after(() => {
  Object.assign(globalThis, original);
  dom.window.close();
});
