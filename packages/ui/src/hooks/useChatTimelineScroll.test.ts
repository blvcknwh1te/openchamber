import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, test } from 'bun:test';

import {
    useChatTimelineScroll,
    type TimelineListHandle,
    type UseChatTimelineScrollResult,
} from './useChatTimelineScroll';
import type { TimelineListMeasurementState } from '@/components/chat/lib/scroll/timelineScrollAnchoring';

// The hook owns the timeline's scroll mode machine: end following while the
// reader is at the live edge, free scrolling once a real gesture takes over.

// A gesture the harness dispatches into the scroll node: the fields the hook's
// intent helpers read off a real wheel/pointer/key event.
interface DispatchedGesture {
    readonly target: ScrollNodeStub;
    readonly deltaY?: number;
    readonly button?: number;
    readonly key?: string;
}

type GestureListener = (event: DispatchedGesture) => void;

// The scroll node the hook binds to: the writes it makes and the gestures the
// harness dispatches into it.
interface ScrollNodeStub {
    scrollTop: number;
    readonly scrollHeight: number;
    readonly clientHeight: number;
    addEventListener: (type: string, listener: GestureListener) => void;
    removeEventListener: (type: string, listener: GestureListener) => void;
    dispatch: (type: string, gesture: DispatchedGesture) => void;
    scrollTo: (options: { readonly top: number; readonly behavior?: string }) => void;
    getBoundingClientRect: () => { readonly top: number; readonly height: number };
    // The hook measures two things in the DOM: the sticky user header and the
    // streaming answer itself (via messageAnchor). The stub answers both from
    // the fixture it is built with.
    querySelector: (selector: string) => HTMLElement | null;
}

// A mounted element the hook measures through. The stub keeps the DOM shape a
// single `as HTMLElement` needs to be a legal narrowing.
interface MeasuredElementStub {
    readonly nodeType: number;
    readonly tagName: string;
    readonly nodeName: string;
    readonly getBoundingClientRect: () => { readonly top: number; readonly height: number };
}

const asMeasuredElement = (element: MeasuredElementStub): HTMLElement => {
    // SAFETY: the hook only reads getBoundingClientRect().top/.height off the
    // elements it measures; the stub carries the node shape the DOM renderer
    // would report and nothing narrower is promised here.
    return element as HTMLElement;
};

const createMeasuredElement = (
    rect: () => { readonly top: number; readonly height: number },
): MeasuredElementStub => ({
    nodeType: 1,
    tagName: 'DIV',
    nodeName: 'DIV',
    getBoundingClientRect: rect,
});

// The streaming id the harness re-renders with. A box, so the same Harness
// closure can be rendered again with the next value.
interface StreamingIdBox {
    value: string | null;
}

// The structural DOM surface the harness installs: what React's DOM renderer
// and the hook's list handle read off the stubs.
interface ContainerStub {
    readonly nodeType: number;
    readonly tagName: string;
    readonly nodeName: string;
    readonly namespaceURI: string;
    readonly ownerDocument: DocumentStub;
    readonly addEventListener: (type: string, listener: GestureListener) => void;
    readonly removeEventListener: (type: string, listener: GestureListener) => void;
}

interface DocumentStub {
    readonly nodeType: number;
    readonly defaultView: typeof globalThis;
    readonly activeElement: null;
    readonly documentElement: ContainerStub;
    readonly body: ContainerStub;
    readonly addEventListener: (type: string, listener: GestureListener) => void;
    readonly removeEventListener: (type: string, listener: GestureListener) => void;
}

interface LocationStub {
    readonly search: string;
    readonly protocol: string;
    readonly hostname: string;
}

class ElementStub {}

// The values the harness installs on `globalThis`: the structural DOM stubs,
// the animation-frame pair, and React's act-environment flag.
interface InstalledGlobals {
    document: DocumentStub;
    window: typeof globalThis;
    location: LocationStub;
    Element: typeof ElementStub;
    HTMLElement: typeof ElementStub;
    HTMLIFrameElement: typeof ElementStub;
    IS_REACT_ACT_ENVIRONMENT: boolean;
    requestAnimationFrame: (callback: FrameRequestCallback) => ReturnType<typeof setTimeout>;
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => void;
}

// React's DOM renderer expects real DOM nodes; the harness builds structural
// stubs instead.
const asElement = (node: ContainerStub): Element => {
    // SAFETY: the container stub carries the node type, owner document, and
    // listener pair the renderer touches; nothing narrower is promised here.
    return node as Element;
};

const asHtmlElement = (node: ScrollNodeStub): HTMLElement => {
    // SAFETY: the same stub as `asElement`, asserted as the DOM node it stands
    // in for; the hook only reads scrollTop, scrollHeight, clientHeight, and the
    // listener pair off the list's scrollable node.
    return node as ScrollNodeStub & HTMLElement;
};

const installMinimalDom = () => {
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    const setGlobal = <K extends keyof InstalledGlobals>(name: K, value: InstalledGlobals[K]) => {
        descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    };
    const container: ContainerStub = {
        nodeType: 1,
        tagName: 'DIV',
        nodeName: 'DIV',
        namespaceURI: 'http://www.w3.org/1999/xhtml',
        get ownerDocument() {
            return documentStub;
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    };
    const documentStub: DocumentStub = {
        nodeType: 9,
        defaultView: globalThis,
        activeElement: null,
        documentElement: container,
        body: container,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    };
    setGlobal('document', documentStub);
    setGlobal('window', globalThis);
    setGlobal('location', { search: '', protocol: 'http:', hostname: 'localhost' });
    setGlobal('Element', ElementStub);
    setGlobal('HTMLElement', ElementStub);
    setGlobal('HTMLIFrameElement', ElementStub);
    setGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    setGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0));
    setGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
    return {
        container: asElement(container),
        restore: () => {
            for (const [name, descriptor] of descriptors) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else Reflect.deleteProperty(globalThis, name);
            }
        },
    };
};

// A scroll node that records the writes the hook makes and can dispatch the
// real gestures the release path listens for. `messageTops` is the fixture DOM:
// the measured top of each assistant message in the container's content space,
// exactly what a turn row with a sticky user header above it would report
// differently (the row top sits at the user message, not at the answer).
const createScrollNode = ({
    messageTops = {},
    stickyHeight = 0,
}: {
    readonly messageTops?: Readonly<Record<string, number>>;
    readonly stickyHeight?: number;
} = {}): ScrollNodeStub => {
    const listeners = new Map<string, Set<GestureListener>>();
    const node: ScrollNodeStub = {
        scrollTop: 0,
        scrollHeight: 4000,
        clientHeight: 700,
        addEventListener: (type: string, listener: GestureListener) => {
            const set = listeners.get(type) ?? new Set();
            set.add(listener);
            listeners.set(type, set);
        },
        removeEventListener: (type: string, listener: GestureListener) => {
            listeners.get(type)?.delete(listener);
        },
        dispatch: (type: string, gesture: DispatchedGesture) => {
            for (const listener of listeners.get(type) ?? []) listener(gesture);
        },
        // The hook's correction lands the end directly; the stub applies it.
        scrollTo: ({ top }) => {
            node.scrollTop = top;
        },
        getBoundingClientRect: () => ({ top: 0, height: 700 }),
        querySelector: (selector: string) => {
            if (selector === '[data-testid="sticky-user-header"]') {
                return stickyHeight > 0
                    ? asMeasuredElement(createMeasuredElement(() => ({ top: 0, height: stickyHeight })))
                    : null;
            }
            const messageId = /^\[data-message-id="(.+)"\]$/.exec(selector)?.[1];
            if (messageId === undefined) {
                // The hook measures exactly two things in the DOM. An unknown
                // selector means it stopped anchoring on the assistant message
                // element or the sticky header's test id, which is the contract
                // these tests exist to hold.
                throw new Error(`unexpected selector ${selector}`);
            }
            const messageTop = messageTops[messageId];
            if (messageTop === undefined) return null;
            // The DOM agreement: getBoundingClientRect reports viewport-relative
            // coordinates, so the fixture subtracts the scroll already applied.
            return asMeasuredElement(createMeasuredElement(() => ({
                top: messageTop - node.scrollTop,
                height: 100,
            })));
        },
    };
    return node;
};

const flushFrames = async () => {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
};

// Timers that the hook arms itself (the end re-asserts) need real time.
const flushMs = async (ms: number) => {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    });
};

const createListHandle = (
    node: ScrollNodeStub,
    state: TimelineListMeasurementState,
) => {
    const scrolls: number[] = [];
    const endCalls: Array<{ readonly animated?: boolean } | undefined> = [];
    const handle: TimelineListHandle = {
        getState: () => ({ ...state, scroll: node.scrollTop }),
        getScrollableNode: () => asHtmlElement(node),
        scrollToEnd: (options) => {
            endCalls.push(options);
        },
        scrollToOffset: ({ offset }) => {
            scrolls.push(offset);
            node.scrollTop = offset;
        },
        scrollToIndex: () => undefined,
    };
    return { handle, scrolls, endCalls };
};

// The hook owns the timeline's scroll mode machine. A streaming answer holds
// its OWN top edge while the reader is following the end; the anchor is the
// assistant message element, never the turn row that starts with the user's
// sticky header (anchoring on the row scrolled the viewport up to the user's
// message). A gesture or a return to the end releases the pin back into
// ordinary end following.
describe('useChatTimelineScroll end following', () => {
    const buildState = (): TimelineListMeasurementState => ({
        data: [
            { kind: 'turn', turn: { assistantMessageIds: ['msg_1'] } },
            { kind: 'turn', turn: { assistantMessageIds: ['msg_2'] } },
        ],
        scroll: 0,
        scrollLength: 700,
        contentLength: 4000,
        // The turn row starts at the user's sticky header; the answer that
        // streams inside it sits 400px lower, which is what the DOM fixture
        // reports through `messageTops`.
        positionAtIndex: (index) => (index === 1 ? 1200 : 0),
        sizeAtIndex: () => 1000,
    });

    // A tall timeline that overflows the viewport, so an upward wheel is a
    // valid release and an end correction actually has somewhere to move.
    const overflowingState = (): TimelineListMeasurementState => ({
        data: [{ kind: 'turn', turn: { assistantMessageIds: ['msg_2'] } }],
        scroll: 0,
        scrollLength: 700,
        contentLength: 4000,
        positionAtIndex: () => 0,
        sizeAtIndex: () => 4000,
    });

    const renderPinHarness = async (
        node: ScrollNodeStub,
        streamingId: StreamingIdBox,
        options: {
            // Whether the turn is still producing output. A box, so a test can
            // retire the turn and re-render.
            readonly working?: { value: boolean };
            // The list's reported geometry, when a test needs an answer that
            // cannot reach the viewport top yet.
            readonly state?: TimelineListMeasurementState;
            // The FIRST message of the running answer. A real turn reports it,
            // and a turn is one message per step: without it the hold falls back
            // to the step streaming right now.
            readonly anchor?: StreamingIdBox;
        } = {},
    ) => {
        const dom = installMinimalDom();
        const root: Root = createRoot(dom.container);
        const working = options.working ?? { value: true };
        const { handle, scrolls, endCalls } = createListHandle(node, options.state ?? buildState());

        let result!: UseChatTimelineScrollResult;

        const Harness = () => {
            result = useChatTimelineScroll({
                currentSessionId: 'ses_1',
                currentSessionKey: 'ses_1',
                sessionMessageCount: 2,
                composerOverlayHeight: 0,
                sessionIsWorking: working.value,
                activeStreamingMessageId: streamingId.value,
                answerAnchorMessageId: options.anchor?.value ?? streamingId.value,
            });
            React.useLayoutEffect(() => {
                result.registerList(handle);
            }, []);
            return null;
        };

        const rerender = async () => {
            await act(async () => root.render(React.createElement(Harness)));
        };

        await rerender();

        return {
            result: () => result,
            scrolls,
            endCalls,
            rerender,
            unmount: async () => {
                await act(async () => root.unmount());
                dom.restore();
            },
        };
    };

    test("holds the streaming answer's own top edge, never the turn row", async () => {
        const node = createScrollNode({ messageTops: { msg_2: 1600 } });
        const streamingId: StreamingIdBox = { value: null };
        const harness = await renderPinHarness(node, streamingId);

        try {
            expect(harness.result().isTopPinned).toBe(false);

            streamingId.value = 'msg_2';
            await harness.rerender();
            await flushFrames();

            expect(harness.result().isTopPinned).toBe(true);
            // 1600 is the assistant message top; 1200 is the turn row top the
            // old pin used, which is where the user's message lives.
            expect(harness.scrolls).toEqual([1600]);
            expect(harness.scrolls[0]).toBeGreaterThan(1200);
            expect(node.scrollTop).toBe(1600);

            // Streaming growth moves nothing: the held position is the pin.
            act(() => {
                harness.result().onTimelineDataChange();
            });
            expect(harness.scrolls).toEqual([1600]);
            expect(node.scrollTop).toBe(1600);
        } finally {
            await harness.unmount();
        }
    });

    test("holds the answer's FIRST message, not the step streaming right now", async () => {
        // One answer, two steps. The second step is the one streaming now (and
        // the first one tall enough to be pinned), but the answer starts at the
        // first step: the hold belongs to its top edge.
        const node = createScrollNode({ messageTops: { msg_1: 1000, msg_2: 1600 } });
        const streamingId: StreamingIdBox = { value: null };
        const anchor: StreamingIdBox = { value: null };
        // The answer starts short enough that pinning it would leave the viewport
        // looking empty, so the hold waits for the answer to outgrow the viewport.
        // Mutable on purpose: the growth is what the list reports through its own
        // measurement state.
        const state = {
            data: [{ kind: 'turn', turn: { assistantMessageIds: ['msg_1', 'msg_2'] } }],
            scroll: 0,
            scrollLength: 700,
            // The answer's first line sits 1000px down, and the content ends
            // 600px below it: the answer still fits under the viewport.
            contentLength: 1600,
            positionAtIndex: () => 1000,
            sizeAtIndex: () => 600,
        };
        const harness = await renderPinHarness(node, streamingId, { anchor, state });

        try {
            // The answer starts: its first step mounts, nothing is pinned yet.
            anchor.value = 'msg_1';
            streamingId.value = 'msg_1';
            await harness.rerender();
            await flushFrames();
            expect(harness.scrolls).toEqual([]);

            // The answer grows past the viewport while the NEXT step streams. The
            // wait for the answer's first line resolves on this growth: the hold
            // lands there, not on the step that happens to be streaming when the
            // geometry becomes pinnable.
            state.contentLength = 4000;
            streamingId.value = 'msg_2';
            await harness.rerender();
            act(() => {
                harness.result().onTimelineDataChange();
            });

            expect(harness.result().isTopPinned).toBe(true);
            expect(harness.scrolls).toEqual([1000]);
            expect(node.scrollTop).toBe(1000);

            // The step boundary inside the answer: the finished step completes
            // before the next one exists, so the streaming id goes null while the
            // answer keeps coming. The hold stays on the answer's first message.
            streamingId.value = null;
            await harness.rerender();
            await flushFrames();

            expect(harness.scrolls).toEqual([1000]);
            expect(node.scrollTop).toBe(1000);
        } finally {
            await harness.unmount();
        }
    });

    test('keeps the answer below the sticky user header without going above it', async () => {
        const node = createScrollNode({ messageTops: { msg_2: 1600 }, stickyHeight: 96 });
        const streamingId: StreamingIdBox = { value: null };
        const harness = await renderPinHarness(node, streamingId);

        try {
            streamingId.value = 'msg_2';
            await harness.rerender();
            await flushFrames();

            expect(harness.scrolls).toEqual([1504]);
            // The viewport never moves above the answer's own top edge: the
            // offset only ever accounts for the floating header's height.
            expect(node.scrollTop).toBeLessThanOrEqual(1600);
        } finally {
            await harness.unmount();
        }
    });

    test("keeps the reader's place after a manual scroll up", async () => {
        const node = createScrollNode({ messageTops: { msg_2: 1600 } });
        const streamingId: StreamingIdBox = { value: null };
        const harness = await renderPinHarness(node, streamingId);

        try {
            streamingId.value = 'msg_2';
            await harness.rerender();
            await flushFrames();
            expect(harness.result().isTopPinned).toBe(true);

            // The reader wheels up into the history: the pin is dropped and the
            // viewport is left exactly where the gesture put it.
            node.scrollTop = 300;
            act(() => {
                node.dispatch('wheel', { deltaY: -120, target: node });
            });
            expect(harness.result().userOwnsScroll).toBe(true);
            expect(harness.result().isTopPinned).toBe(false);

            act(() => {
                harness.result().onTimelineDataChange();
            });

            expect(node.scrollTop).toBe(300);
            expect(harness.scrolls).toEqual([1600]);

            // The next output of the turn does not win the scroll back: after a
            // gesture the reader owns the viewport until they opt in again.
            streamingId.value = 'msg_3';
            await harness.rerender();
            await flushFrames();

            act(() => {
                harness.result().onTimelineDataChange();
            });

            expect(harness.result().isTopPinned).toBe(false);
            expect(harness.scrolls).toEqual([1600]);
            expect(node.scrollTop).toBe(300);
        } finally {
            await harness.unmount();
        }
    });

    test('does not pin at all once the reader already took the scroll', async () => {
        const node = createScrollNode({ messageTops: { msg_2: 1600 } });
        const streamingId: StreamingIdBox = { value: null };
        const harness = await renderPinHarness(node, streamingId);

        try {
            node.scrollTop = 300;
            act(() => {
                node.dispatch('wheel', { deltaY: -120, target: node });
            });
            expect(harness.result().userOwnsScroll).toBe(true);

            streamingId.value = 'msg_2';
            await harness.rerender();
            await flushFrames();

            expect(harness.result().isTopPinned).toBe(false);
            expect(harness.scrolls).toEqual([]);
            expect(node.scrollTop).toBe(300);
        } finally {
            await harness.unmount();
        }
    });

    test('returning to the bottom releases the pin back to end following', async () => {
        const node = createScrollNode({ messageTops: { msg_2: 1600 } });
        const streamingId: StreamingIdBox = { value: null };
        const harness = await renderPinHarness(node, streamingId);

        try {
            streamingId.value = 'msg_2';
            await harness.rerender();
            await flushFrames();
            expect(harness.result().isTopPinned).toBe(true);

            act(() => {
                harness.result().onIsAtEndChange(true);
            });
            expect(harness.result().isTopPinned).toBe(false);
            expect(harness.result().isPinned).toBe(true);

            // End following owns the viewport again: the next growth lands on
            // the live edge. The correction is one animation frame later.
            act(() => {
                harness.result().onTimelineDataChange();
            });
            await flushFrames();
            expect(node.scrollTop).toBe(3300);
            expect(harness.scrolls).toEqual([1600]);
        } finally {
            await harness.unmount();
        }
    });

    test('holds the edge when the list reports an end the viewport has not reached', async () => {
        const node = createScrollNode({ messageTops: { msg_2: 1600 } });
        const streamingId: StreamingIdBox = { value: null };
        // The measured rows put the real end 3300px down, far below the held
        // edge — the state a reader is in while watching an answer grow.
        const harness = await renderPinHarness(node, streamingId, { state: overflowingState() });

        try {
            streamingId.value = 'msg_2';
            await harness.rerender();
            await flushFrames();
            expect(harness.result().isTopPinned).toBe(true);
            expect(node.scrollTop).toBe(1600);

            // The list recomputes its ESTIMATED total length while the pin holds
            // the viewport mid-answer, and the estimate briefly claims the end
            // is in view. The hold must survive it: releasing here hands the
            // viewport back to end maintenance, which rides it down to the real
            // end in a single jump — the answer leaving the top of the screen
            // while it is still streaming.
            act(() => {
                harness.result().onIsAtEndChange(true);
            });

            expect(harness.result().isTopPinned).toBe(true);
            expect(harness.result().userOwnsScroll).toBe(false);
            expect(node.scrollTop).toBe(1600);

            // Growth still moves nothing: the held edge is the reading position.
            act(() => {
                harness.result().onTimelineDataChange();
            });
            await flushFrames();
            expect(node.scrollTop).toBe(1600);
            expect(harness.scrolls).toEqual([1600]);
        } finally {
            await harness.unmount();
        }
    });

    test('holds one pin per answer across the step handoff of a running turn', async () => {
        const node = createScrollNode({ messageTops: { msg_2: 1600, msg_3: 2400 } });
        const streamingId: StreamingIdBox = { value: null };
        const harness = await renderPinHarness(node, streamingId);

        try {
            streamingId.value = 'msg_2';
            await harness.rerender();
            await flushFrames();

            expect(harness.result().isTopPinned).toBe(true);
            expect(harness.scrolls).toEqual([1600]);

            // The step boundary: the finished step's message gets
            // `time.completed` before the next step's message exists, so the
            // trailing id goes null while the turn keeps running. The hold must
            // survive it — dropping it here hands the viewport back to end
            // maintenance for the rest of the step.
            streamingId.value = null;
            await harness.rerender();
            await flushFrames();

            expect(harness.result().isTopPinned).toBe(true);
            expect(harness.scrolls).toEqual([1600]);
            expect(node.scrollTop).toBe(1600);

            // The next step of the SAME turn appends below the edge that is
            // already held: no second write, no second jump.
            streamingId.value = 'msg_3';
            await harness.rerender();
            await flushFrames();

            expect(harness.result().isTopPinned).toBe(true);
            expect(harness.scrolls).toEqual([1600]);
            expect(harness.scrolls).not.toContain(1200);
            expect(node.scrollTop).toBe(1600);

            // Growth inside the step moves nothing either: the held edge is the
            // reading position.
            act(() => {
                harness.result().onTimelineDataChange();
            });

            expect(harness.scrolls).toEqual([1600]);
            expect(node.scrollTop).toBe(1600);
        } finally {
            await harness.unmount();
        }
    });

    test('keeps the held edge when the turn retires and drops only the waiting request', async () => {
        const node = createScrollNode({ messageTops: { msg_2: 1600 } });
        const streamingId: StreamingIdBox = { value: 'msg_2' };
        const working = { value: true };
        // The answer is shorter than the viewport, so there is nothing to pin
        // yet: the request waits instead of writing a clamped offset.
        const state: TimelineListMeasurementState = {
            data: [{ kind: 'turn', turn: { assistantMessageIds: ['msg_2'] } }],
            scroll: 0,
            scrollLength: 700,
            contentLength: 2000,
            positionAtIndex: () => 1200,
            sizeAtIndex: () => 1000,
        };
        const harness = await renderPinHarness(node, streamingId, { working, state });

        try {
            await flushFrames();
            expect(harness.result().isTopPinned).toBe(false);
            expect(harness.scrolls).toEqual([]);

            // The turn retires while the answer never reached the top: the
            // waiting request belongs to that turn and is dropped, so no later
            // growth measures or scrolls for it.
            working.value = false;
            await harness.rerender();
            await flushFrames();

            expect(harness.result().isTopPinned).toBe(false);
            expect(harness.scrolls).toEqual([]);
        } finally {
            await harness.unmount();
        }
    });

    test('pins an answer that only becomes tall enough after it started', async () => {
        const node = createScrollNode({ messageTops: { msg_2: 1600 } });
        const streamingId: StreamingIdBox = { value: 'msg_2' };
        // Mutable on purpose: the growth of the streaming answer is what the
        // list reports through its own measurement state.
        const state = {
            data: [{ kind: 'turn', turn: { assistantMessageIds: ['msg_2'] } }],
            scroll: 0,
            scrollLength: 700,
            contentLength: 2000,
            positionAtIndex: () => 1200,
            sizeAtIndex: () => 1000,
        };
        const harness = await renderPinHarness(node, streamingId, { state });

        try {
            await flushFrames();
            expect(harness.scrolls).toEqual([]);

            // The stream grows past the viewport: the growth signal the list
            // already emits retries the wait, so the hold lands without any new
            // message id and without a frame loop.
            state.contentLength = 4000;
            act(() => {
                harness.result().onTimelineDataChange();
            });

            expect(harness.result().isTopPinned).toBe(true);
            expect(harness.scrolls).toEqual([1600]);
            expect(node.scrollTop).toBe(1600);
        } finally {
            await harness.unmount();
        }
    });

    test('opens a streaming session on the answer top, not on the end', async () => {
        const node = createScrollNode({ messageTops: { msg_2: 1600 } });
        const streamingId: StreamingIdBox = { value: 'msg_2' };
        const harness = await renderPinHarness(node, streamingId);

        try {
            await flushFrames();

            // The answer is already streaming when the session opens: its own
            // top edge is the position the session is meant to show, so the
            // growth signal lands the hold.
            act(() => {
                harness.result().onTimelineDataChange();
            });
            expect(harness.result().isTopPinned).toBe(true);
            expect(harness.scrolls).toEqual([1600]);

            // The entry settle arrives right after the session opened: while a
            // hold belongs to the live answer, it must not settle the end —
            // that would move the reader and drop the hold for the rest of the
            // step, which is how the hold "worked only sometimes" at open.
            await act(async () => {
                await harness.result().restoreSnapshot();
            });
            await flushFrames();

            expect(harness.result().isTopPinned).toBe(true);
            expect(harness.endCalls).toEqual([]);
            expect(node.scrollTop).toBe(1600);
        } finally {
            await harness.unmount();
        }
    });

    test('opens an idle session on the end', async () => {
        const node = createScrollNode();
        const streamingId: StreamingIdBox = { value: null };
        const harness = await renderPinHarness(node, streamingId);

        try {
            await flushFrames();

            await act(async () => {
                await harness.result().restoreSnapshot();
            });

            expect(harness.endCalls.length).toBe(1);
            expect(harness.result().isTopPinned).toBe(false);
        } finally {
            await harness.unmount();
        }
    });

    test('lands the end of an opened session through the entry settle, not one snapshot write', async () => {
        const node = createScrollNode();
        const streamingId: StreamingIdBox = { value: null };
        // The list lays its rows out from ESTIMATES: every read of the content
        // height during the first pass measures taller content, until the real
        // total lands. A single write reads the first estimate and stops there.
        let reads = 0;
        Object.defineProperty(node, 'scrollHeight', {
            configurable: true,
            get: () => {
                reads += 1;
                return Math.min(4000, 1200 + reads * 600);
            },
        });
        const harness = await renderPinHarness(node, streamingId);

        try {
            // The caller asks for the entered session's snapshot while the entry
            // settle is still moving the viewport. Settling the end here would
            // fight the settle's own writes.
            await act(async () => {
                await harness.result().restoreSnapshot();
            });
            expect(harness.endCalls).toEqual([]);

            // The settle re-asserts the end every frame, so it is what actually
            // reaches the real end as the estimates resolve into measurements —
            // a single write left the session wherever the last estimate had put
            // it, which is an opened session sitting mid-conversation.
            await flushFrames();
            expect(node.scrollTop).toBe(3300);
            expect(harness.endCalls).toEqual([]);
        } finally {
            await harness.unmount();
        }
    });

    test('lets a running answer pin again after a gesture and a return to the end', async () => {
        const node = createScrollNode({ messageTops: { msg_2: 1600, msg_3: 2400 } });
        const streamingId: StreamingIdBox = { value: 'msg_2' };
        // The answer's FIRST message: it does not change while the answer runs,
        // so a step boundary inside the answer leaves the anchor alone.
        const anchor: StreamingIdBox = { value: 'msg_2' };
        const harness = await renderPinHarness(node, streamingId, { anchor });

        try {
            await flushFrames();
            act(() => {
                harness.result().onTimelineDataChange();
            });
            expect(harness.result().isTopPinned).toBe(true);
            expect(harness.scrolls).toEqual([1600]);

            // The reader wheels up: the hold is dropped and the viewport is
            // theirs.
            node.scrollTop = 300;
            act(() => {
                node.dispatch('wheel', { deltaY: -120, target: node });
            });
            expect(harness.result().userOwnsScroll).toBe(true);
            expect(harness.result().isTopPinned).toBe(false);

            // They come back to the live edge — still inside the SAME answer.
            act(() => {
                harness.result().onIsAtEndChange(true);
            });
            expect(harness.result().userOwnsScroll).toBe(false);

            // The answer's next step must be able to pin the answer's top edge
            // again. The arming is latched once per answer, and the anchor does
            // not change inside an answer: a latch that survives the gesture
            // reads the next step as "already armed" and the answer stays
            // unpinned for the rest of its life.
            streamingId.value = 'msg_3';
            await harness.rerender();
            await flushFrames();
            act(() => {
                harness.result().onTimelineDataChange();
            });

            expect(harness.result().isTopPinned).toBe(true);
            // The hold is the answer's first message, not the step streaming now.
            expect(harness.scrolls).toEqual([1600, 1600]);
            expect(node.scrollTop).toBe(1600);
        } finally {
            await harness.unmount();
        }
    });

    test('a send during a stream leaves the next answer free to pin', async () => {
        const node = createScrollNode({ messageTops: { msg_2: 1600, msg_3: 2400 } });
        const streamingId: StreamingIdBox = { value: null };
        const anchor: StreamingIdBox = { value: null };
        const harness = await renderPinHarness(node, streamingId, { anchor });

        try {
            anchor.value = 'msg_2';
            streamingId.value = 'msg_2';
            await harness.rerender();
            await flushFrames();
            expect(harness.result().isTopPinned).toBe(true);

            // Sending mid-answer is the reader's own command, and it is how a
            // conversation continues: the reply it starts is exactly the answer
            // whose top edge they want held. It must not stand in for the
            // explicit "watch the tail" pill, which is what opts out.
            act(() => {
                harness.result().scrollToBottomOnSend();
            });
            expect(harness.result().isTopPinned).toBe(false);

            // The queued reply starts streaming.
            anchor.value = 'msg_3';
            streamingId.value = 'msg_3';
            await harness.rerender();
            await flushFrames();

            expect(harness.result().isTopPinned).toBe(true);
            expect(harness.scrolls).toEqual([1600, 2400]);
            expect(node.scrollTop).toBe(2400);
        } finally {
            await harness.unmount();
        }
    });

    test('keeps the end re-asserts of a send away from an active pin', async () => {
        const node = createScrollNode({ messageTops: { msg_2: 1600 } });
        const streamingId: StreamingIdBox = { value: null };
        const harness = await renderPinHarness(node, streamingId);

        try {
            // A send asks for the live edge while no answer is streaming yet.
            act(() => {
                harness.result().scrollToBottomOnSend();
            });
            expect(harness.endCalls.length).toBe(1);

            // The reply starts streaming and its top edge is pinned.
            streamingId.value = 'msg_2';
            await harness.rerender();
            await flushFrames();
            expect(harness.result().isTopPinned).toBe(true);

            // Every scheduled re-assert (150/400/800ms) lands inside the pin
            // window; none of them may drag the viewport back to the end.
            await flushMs(900);

            expect(harness.endCalls.length).toBe(1);
            expect(harness.result().isTopPinned).toBe(true);
            expect(node.scrollTop).toBe(1600);
        } finally {
            await harness.unmount();
        }
    });

    test('a request for the edge during a stream outranks the pin until the reader drives again', async () => {
        const node = createScrollNode({ messageTops: { msg_2: 1600, msg_3: 2400 } });
        const streamingId: StreamingIdBox = { value: null };
        const harness = await renderPinHarness(node, streamingId);

        try {
            streamingId.value = 'msg_2';
            await harness.rerender();
            await flushFrames();
            expect(harness.result().isTopPinned).toBe(true);

            // The reader asks for the live edge while the answer is streaming:
            // an explicit command, so the pin must not come back on the next
            // output — not for this answer and not for the step that follows it.
            act(() => {
                harness.result().goToBottom();
            });
            expect(harness.result().isTopPinned).toBe(false);

            streamingId.value = 'msg_3';
            await harness.rerender();
            await flushFrames();
            expect(harness.result().isTopPinned).toBe(false);
            expect(harness.scrolls).toEqual([1600]);

            // Growth follows the end again, as the reader asked.
            act(() => {
                harness.result().onTimelineDataChange();
            });
            await flushFrames();
            expect(node.scrollTop).toBe(3300);
        } finally {
            await harness.unmount();
        }
    });

    test('returns to the live edge when the reader sends a message', async () => {
        const dom = installMinimalDom();
        const root: Root = createRoot(dom.container);
        const node = createScrollNode();
        const { handle, endCalls } = createListHandle(node, buildState());

        let result!: UseChatTimelineScrollResult;

        const Harness = () => {
            result = useChatTimelineScroll({
                currentSessionId: 'ses_1',
                currentSessionKey: 'ses_1',
                sessionMessageCount: 2,
                composerOverlayHeight: 0,
                sessionIsWorking: true,
            });
            React.useLayoutEffect(() => {
                result.registerList(handle);
            }, []);
            return null;
        };

        try {
            await act(async () => root.render(React.createElement(Harness)));

            act(() => {
                result.scrollToBottomOnSend();
            });

            expect(endCalls.length).toBeGreaterThan(0);
            expect(result.isPinned).toBe(true);
            expect(result.userOwnsScroll).toBe(false);
        } finally {
            await act(async () => root.unmount());
            dom.restore();
        }
    });

    test('drops a queued end correction when the reader gestures instead of gliding after it', async () => {
        const node = createScrollNode();
        const streamingId: StreamingIdBox = { value: null };
        const harness = await renderPinHarness(node, streamingId, { state: overflowingState() });

        try {
            // Growth schedules ONE correction for the next frame.
            act(() => {
                harness.result().onTimelineDataChange();
            });

            // The reader wheels up before that frame runs. The scheduled
            // correction must be dropped, so nothing creeps the viewport back
            // down after the gesture — the endless drift the top edge and the
            // gesture release exist to stop.
            node.scrollTop = 300;
            act(() => {
                node.dispatch('wheel', { deltaY: -120, target: node });
            });
            await flushFrames();

            expect(harness.result().userOwnsScroll).toBe(true);
            expect(node.scrollTop).toBe(300);
        } finally {
            await harness.unmount();
        }
    });

    test('re-arms follow once the reader returns to the real bottom after a gesture', async () => {
        const node = createScrollNode();
        const streamingId: StreamingIdBox = { value: null };
        const harness = await renderPinHarness(node, streamingId, { state: overflowingState() });

        try {
            node.scrollTop = 300;
            act(() => {
                node.dispatch('wheel', { deltaY: -120, target: node });
            });
            expect(harness.result().userOwnsScroll).toBe(true);

            // The reader returns to the live edge: follow is re-armed and the
            // next growth correction lands the end again.
            act(() => {
                harness.result().onIsAtEndChange(true);
            });
            expect(harness.result().userOwnsScroll).toBe(false);
            expect(harness.result().isPinned).toBe(true);

            node.scrollTop = 3200;
            act(() => {
                harness.result().onTimelineDataChange();
            });
            await flushFrames();
            expect(node.scrollTop).toBe(3300);
        } finally {
            await harness.unmount();
        }
    });
});
