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
        // The hook glides its last correction through the native smooth scroll;
        // the stub lands it immediately instead of animating.
        scrollTo: ({ top }) => {
            node.scrollTop = top;
        },
        getBoundingClientRect: () => ({ top: 0, height: 700 }),
        querySelector: (selector: string) => {
            if (selector === '[data-turn-id] .sticky') {
                return stickyHeight > 0
                    ? asMeasuredElement(createMeasuredElement(() => ({ top: 0, height: stickyHeight })))
                    : null;
            }
            const messageId = /^\[data-message-id="(.+)"\]$/.exec(selector)?.[1];
            const messageTop = messageId === undefined ? undefined : messageTops[messageId];
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

    const renderPinHarness = async (
        node: ScrollNodeStub,
        streamingId: StreamingIdBox,
    ) => {
        const dom = installMinimalDom();
        const root: Root = createRoot(dom.container);
        const { handle, scrolls, endCalls } = createListHandle(node, buildState());

        let result!: UseChatTimelineScrollResult;

        const Harness = () => {
            result = useChatTimelineScroll({
                currentSessionId: 'ses_1',
                currentSessionKey: 'ses_1',
                sessionMessageCount: 2,
                composerOverlayHeight: 0,
                sessionIsWorking: true,
                activeStreamingMessageId: streamingId.value,
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
            // the live edge.
            act(() => {
                harness.result().onTimelineDataChange();
            });
            expect(node.scrollTop).toBe(3300);
            expect(harness.scrolls).toEqual([1600]);
        } finally {
            await harness.unmount();
        }
    });

    test("re-pins a new streaming message to its own top, never to the user's message", async () => {
        const node = createScrollNode({ messageTops: { msg_2: 1600, msg_3: 2400 } });
        const streamingId: StreamingIdBox = { value: null };
        const harness = await renderPinHarness(node, streamingId);

        try {
            streamingId.value = 'msg_2';
            await harness.rerender();
            await flushFrames();

            streamingId.value = 'msg_3';
            await harness.rerender();
            await flushFrames();

            expect(harness.scrolls).toEqual([1600, 2400]);
            expect(harness.scrolls).not.toContain(1200);
            expect(harness.result().isTopPinned).toBe(true);

            // The stream ends: releasing the pin scrolls nothing.
            streamingId.value = null;
            await harness.rerender();
            expect(harness.result().isTopPinned).toBe(false);
            expect(harness.scrolls).toEqual([1600, 2400]);
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
});
