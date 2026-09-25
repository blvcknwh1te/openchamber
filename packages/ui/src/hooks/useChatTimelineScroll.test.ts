import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, test } from 'bun:test';

import {
    useChatTimelineScroll,
    type TimelineListHandle,
    type UseChatTimelineScrollResult,
} from './useChatTimelineScroll';
import type { TimelineListMeasurementState } from '@/components/chat/lib/scroll/timelineScrollAnchoring';

// The hook owns the timeline's scroll mode machine. This suite pins the new
// `top-pinned` lifecycle: a freshly started streaming turn holds its top edge
// at the viewport top, a real gesture releases it, and the pin's own
// programmatic scroll never counts as that gesture.

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
    querySelector: () => null;
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
// real gestures the release path listens for.
const createScrollNode = (): ScrollNodeStub => {
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
        querySelector: () => null,
    };
    return node;
};

const createListHandle = (
    node: ScrollNodeStub,
    state: TimelineListMeasurementState,
) => {
    const scrolls: number[] = [];
    const handle: TimelineListHandle = {
        getState: () => ({ ...state, scroll: node.scrollTop }),
        getScrollableNode: () => asHtmlElement(node),
        scrollToEnd: () => undefined,
        scrollToOffset: ({ offset }) => {
            scrolls.push(offset);
            node.scrollTop = offset;
        },
        scrollToIndex: () => undefined,
    };
    return { handle, scrolls };
};

const flushFrames = async () => {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
};

describe('useChatTimelineScroll top pin', () => {
    test('pins a streaming turn to the viewport top and releases on a real gesture', async () => {
        const dom = installMinimalDom();
        const root: Root = createRoot(dom.container);
        const node = createScrollNode();
        const state: TimelineListMeasurementState = {
            data: [
                { kind: 'turn', turn: { assistantMessageIds: ['msg_1'] } },
                { kind: 'turn', turn: { assistantMessageIds: ['msg_2'] } },
            ],
            scroll: 0,
            scrollLength: 700,
            contentLength: 4000,
            positionAtIndex: (index) => (index === 1 ? 1200 : 0),
            sizeAtIndex: () => 1000,
        };
        const { handle, scrolls } = createListHandle(node, state);

        let result!: UseChatTimelineScrollResult;
        let streamingId: string | null = null;

        const Harness = () => {
            result = useChatTimelineScroll({
                currentSessionId: 'ses_1',
                currentSessionKey: 'ses_1',
                sessionMessageCount: 2,
                composerOverlayHeight: 0,
                sessionIsWorking: true,
                activeStreamingMessageId: streamingId,
            });
            React.useLayoutEffect(() => {
                result.registerList(handle);
            }, []);
            return null;
        };

        try {
            await act(async () => root.render(React.createElement(Harness)));
            expect(result.isTopPinned).toBe(false);

            // The stream starts: the answer's top edge is placed at the top of
            // the viewport, and the pin holds.
            streamingId = 'msg_2';
            await act(async () => root.render(React.createElement(Harness)));
            await flushFrames();
            expect(result.isTopPinned).toBe(true);
            expect(scrolls).toEqual([1200]);

            // Streaming growth issues no further scroll: the pin is a mode, not
            // a loop.
            await act(async () => root.render(React.createElement(Harness)));
            await flushFrames();
            expect(scrolls).toEqual([1200]);

            // The pin's own write fires a scroll event; a programmatic scroll
            // is not a gesture and must not release the pin.
            act(() => {
                node.dispatch('scroll', { target: node });
            });
            expect(result.isTopPinned).toBe(true);

            // A real upward gesture releases the pin.
            act(() => {
                node.dispatch('wheel', { deltaY: -120, target: node });
            });
            expect(result.isTopPinned).toBe(false);
        } finally {
            await act(async () => root.unmount());
            dom.restore();
        }
    });

    test('does not pin a short answer that fits on screen', async () => {
        const dom = installMinimalDom();
        const root: Root = createRoot(dom.container);
        const node = createScrollNode();
        const state: TimelineListMeasurementState = {
            data: [{ kind: 'turn', turn: { assistantMessageIds: ['msg_2'] } }],
            scroll: 0,
            scrollLength: 700,
            contentLength: 900,
            positionAtIndex: () => 600,
            sizeAtIndex: () => 300,
        };
        const { handle, scrolls } = createListHandle(node, state);

        let result!: UseChatTimelineScrollResult;
        let streamingId: string | null = null;

        const Harness = () => {
            result = useChatTimelineScroll({
                currentSessionId: 'ses_1',
                currentSessionKey: 'ses_1',
                sessionMessageCount: 1,
                composerOverlayHeight: 0,
                sessionIsWorking: true,
                activeStreamingMessageId: streamingId,
            });
            React.useLayoutEffect(() => {
                result.registerList(handle);
            }, []);
            return null;
        };

        try {
            await act(async () => root.render(React.createElement(Harness)));
            streamingId = 'msg_2';
            await act(async () => root.render(React.createElement(Harness)));
            await flushFrames();
            expect(result.isTopPinned).toBe(false);
            expect(scrolls).toEqual([]);
        } finally {
            await act(async () => root.unmount());
            dom.restore();
        }
    });

    test('releases the pin when the viewport reaches the end', async () => {
        const dom = installMinimalDom();
        const root: Root = createRoot(dom.container);
        const node = createScrollNode();
        const state: TimelineListMeasurementState = {
            data: [{ kind: 'turn', turn: { assistantMessageIds: ['msg_2'] } }],
            scroll: 0,
            scrollLength: 700,
            contentLength: 4000,
            positionAtIndex: () => 1200,
            sizeAtIndex: () => 1000,
        };
        const { handle } = createListHandle(node, state);

        let result!: UseChatTimelineScrollResult;
        let streamingId: string | null = null;

        const Harness = () => {
            result = useChatTimelineScroll({
                currentSessionId: 'ses_1',
                currentSessionKey: 'ses_1',
                sessionMessageCount: 1,
                composerOverlayHeight: 0,
                sessionIsWorking: true,
                activeStreamingMessageId: streamingId,
            });
            React.useLayoutEffect(() => {
                result.registerList(handle);
            }, []);
            return null;
        };

        try {
            await act(async () => root.render(React.createElement(Harness)));
            streamingId = 'msg_2';
            await act(async () => root.render(React.createElement(Harness)));
            await flushFrames();
            expect(result.isTopPinned).toBe(true);

            // The reader wheels down to the live edge: the pin has served its
            // purpose and bottom following takes over.
            act(() => {
                result.onIsAtEndChange(true);
            });
            expect(result.isTopPinned).toBe(false);
            expect(result.isPinned).toBe(true);
        } finally {
            await act(async () => root.unmount());
            dom.restore();
        }
    });

    test('does not pin when the reader already took over the scroll', async () => {
        const dom = installMinimalDom();
        const root: Root = createRoot(dom.container);
        const node = createScrollNode();
        const state: TimelineListMeasurementState = {
            data: [{ kind: 'turn', turn: { assistantMessageIds: ['msg_2'] } }],
            scroll: 0,
            scrollLength: 700,
            contentLength: 4000,
            positionAtIndex: () => 1200,
            sizeAtIndex: () => 1000,
        };
        const { handle, scrolls } = createListHandle(node, state);

        let result!: UseChatTimelineScrollResult;
        let streamingId: string | null = null;

        const Harness = () => {
            result = useChatTimelineScroll({
                currentSessionId: 'ses_1',
                currentSessionKey: 'ses_1',
                sessionMessageCount: 1,
                composerOverlayHeight: 0,
                sessionIsWorking: true,
                activeStreamingMessageId: streamingId,
            });
            React.useLayoutEffect(() => {
                result.registerList(handle);
            }, []);
            return null;
        };

        try {
            await act(async () => root.render(React.createElement(Harness)));
            // The reader scrolls up before the answer starts.
            node.scrollTop = 300;
            act(() => {
                node.dispatch('wheel', { deltaY: -120, target: node });
            });
            expect(result.userOwnsScroll).toBe(true);

            streamingId = 'msg_2';
            await act(async () => root.render(React.createElement(Harness)));
            await flushFrames();
            expect(result.isTopPinned).toBe(false);
            expect(scrolls).toEqual([]);
        } finally {
            await act(async () => root.unmount());
            dom.restore();
        }
    });
});
