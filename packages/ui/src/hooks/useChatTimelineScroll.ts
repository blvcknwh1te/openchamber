import React from 'react';

import { MessageFreshnessDetector } from '@/lib/messageFreshness';
import { createScrollSpy } from '@/components/chat/lib/scroll/scrollSpy';
import { useViewportStore } from '@/sync/viewport-store';
import { useUIStore } from '@/stores/useUIStore';
import type { TimelineRevealGate } from '@/components/chat/timelineRevealGate';
import {
    getRowBottom,
    resolveRealContentEndOffset,
    resolveTimelineIsAtEnd,
    resolveTopPinOffset,
    TIMELINE_FOLLOW_REARM_THRESHOLD_PX,
    type TimelineListMeasurementState,
    type TimelineScrollMode,
} from '@/components/chat/lib/scroll/timelineScrollAnchoring';
import { measureMessageTop } from '@/components/chat/lib/scroll/messageAnchor';
import {
    isFollowReleaseKey,
    isMiddleButtonPan,
    nestedScrollableConsumesWheelUp,
} from '@/components/chat/lib/scroll/timelineScrollIntent';

// ──────────────────────────────────────────────────────────────────────────
// Chat timeline scroll ownership.
//
// The virtualized list owns the scroll position; this hook only decides which
// of two mutually exclusive modes is active and, when a mode calls for it,
// issues ONE deterministic scroll command:
//
//   • `following-end`      — pinned to the live edge. The list keeps us there
//     through `maintainScrollAtEnd`; we only re-assert after a data change.
//   • `free-scrolling`     — the user took over. Nothing moves until they opt
//     back in by returning to the end.
//
// Opting out of automatic movement is driven by REAL gestures (wheel /
// touchmove / pointerdown), not by inferring intent from scroll positions. Each
// gesture bumps a generation counter; any in-flight automatic movement compares
// its captured generation against the current one and aborts if they differ.
// That comparison replaces the timer windows the previous implementation needed
// to tell its own writes apart from the user's, which is why there are no
// guard/settle/entry-stick timers here.
// ──────────────────────────────────────────────────────────────────────────

// ── input boundaries ───────────────────────────────────────────────────────
// Two external representations reach this hook: the platform capabilities a
// runtime may not provide, and the rows the virtualized list carries. Both are
// resolved once here, at the boundary, so the code below branches on domain
// values instead of probing the raw representation with `typeof`.

// DOM-less runtimes (SSR) and this hook's test harness have no `window`,
// `ResizeObserver`, or `MutationObserver`. DOM lib declares all three as always
// present, so they are read as optional capabilities off the global object.
interface PlatformCapabilities {
    readonly window?: Window;
    readonly ResizeObserver?: typeof ResizeObserver;
    readonly MutationObserver?: typeof MutationObserver;
}
const platform: PlatformCapabilities = globalThis;

// A width the resize observer reported, or null when no entry carried one.
const parseReportedWidth = (entries: readonly ResizeObserverEntry[]): number | null => {
    const width = entries[entries.length - 1]?.contentRect.width;
    return width === undefined ? null : width;
};

// The subset of the list ref this hook drives. Declared structurally so the
// hook stays testable without a renderer and does not hard-depend on the list
// implementation.
export interface TimelineListHandle {
    getState: () => TimelineListMeasurementState & {
        readonly scroll: number;
        readonly listen?: (
            listenerType: 'totalSize',
            callback: (value: number) => void,
        ) => () => void;
    };
    getScrollableNode: () => HTMLElement | null;
    scrollToEnd: (options?: { animated?: boolean }) => void;
    scrollToOffset: (params: { offset: number; animated?: boolean }) => void;
    scrollToIndex: (params: {
        index: number;
        animated?: boolean;
        viewPosition?: number;
        viewOffset?: number;
    }) => void;
}

interface UseChatTimelineScrollOptions {
    currentSessionId: string | null;
    currentSessionKey: string | null;
    sessionMessageCount: number;
    composerOverlayHeight: number;
    // True while the session is producing output. Follow corrections glide
    // only then. Outside a live stream — entering a session, a tab becoming
    // active, rows re-measuring after a switch — the viewport must land on
    // the end instantly: an animated catch-up scrolls visibly through the
    // conversation and gets cut short by the next measurement.
    sessionIsWorking: boolean;
    // Reveal gate of the session being opened. Held until the viewport is
    // pinned to the end, so the session is never shown scrolled to the top.
    revealGate?: TimelineRevealGate | null;
    onActiveTurnChange?: (turnId: string | null) => void;
    // The assistant message currently streaming, or null. A transition to a new
    // id starts a top pin: the answer holds its OWN top edge at the top of the
    // viewport while its text streams downward.
    activeStreamingMessageId?: string | null;
    // The FIRST assistant message of the answer being produced, or null when no
    // answer is in flight. One answer is several assistant messages — a step per
    // message — and `activeStreamingMessageId` is only the step that is
    // streaming right now, so a hold armed from it lands on whatever step
    // happened to be tall enough first, mid-answer. This id is the answer's own
    // first pixel: the hold belongs there, and it keeps belonging there as later
    // steps append below it.
    answerAnchorMessageId?: string | null;
}



export interface UseChatTimelineScrollResult {
    scrollRef: React.RefObject<HTMLDivElement | null>;
    // The live scroll element, as state, so effects that must re-bind when the
    // list remounts (session switch) can depend on it.
    scrollNode: HTMLDivElement | null;
    isPinned: boolean;
    registerList: (list: TimelineListHandle | null) => void;
    onIsAtEndChange: (isAtEnd: boolean) => void;
    onListMetricsChange: (metrics: { readonly footerSize: number }) => void;
    onManualNavigation: () => void;
    onTimelineDataChange: () => void;
    showScrollButton: boolean;
    /** A real gesture took the scroll; flips back on any explicit opt-in. */
    userOwnsScroll: boolean;
    isFollowingProgrammatically: boolean;
    /** True while a streaming answer holds its own top edge at the viewport top. */
    isTopPinned: boolean;
    goToBottom: (mode?: 'instant' | 'smooth') => void;
    scrollToBottomOnSend: () => void;
    saveSnapshotNow: () => void;
    restoreSnapshot: () => Promise<boolean>;
}

// Showing the pill is debounced so it does not flash while a thread switch
// settles (the list reports isAtEnd=false until its initial end-scroll lands).
// Hiding is always immediate.
const SHOW_SCROLL_BUTTON_DELAY_MS = 150;
const SAVE_DEBOUNCE_MS = 150;

export const useChatTimelineScroll = ({
    currentSessionId,
    currentSessionKey,
    sessionMessageCount,
    composerOverlayHeight,
    sessionIsWorking,
    revealGate = null,
    onActiveTurnChange,
    activeStreamingMessageId = null,
    answerAnchorMessageId = null,
}: UseChatTimelineScrollOptions): UseChatTimelineScrollResult => {
    const sessionIsWorkingRef = React.useRef(sessionIsWorking);
    sessionIsWorkingRef.current = sessionIsWorking;
    const scrollRef = React.useRef<HTMLDivElement | null>(null);
    const listRef = React.useRef<TimelineListHandle | null>(null);

    const [scrollNode, setScrollNode] = React.useState<HTMLDivElement | null>(null);
    const [showScrollButton, setShowScrollButton] = React.useState(false);
    // "Pinned" is the live edge, which history pagination uses to decide whether
    // it may load older pages without disturbing the read position.
    const [isPinned, setIsPinned] = React.useState(true);
    const [isFollowingProgrammatically, setIsFollowingProgrammatically] = React.useState(false);
    // True after a real gesture until an explicit opt back in; drives the
    // overlay scrollbar suppression instead of the anchor's mere existence.
    const [userOwnsScroll, setUserOwnsScroll] = React.useState(false);
    const userOwnsScrollRef = React.useRef(userOwnsScroll);
    userOwnsScrollRef.current = userOwnsScroll;

    const modeRef = React.useRef<TimelineScrollMode>('following-end');
    const isAtEndRef = React.useRef(true);
    // Incremented by every real user gesture. Automatic movement is only valid
    // while `liveFollowGenerationRef` still equals it.
    const userGenerationRef = React.useRef(0);
    const liveFollowGenerationRef = React.useRef<number | null>(0);
    const showButtonTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── top pin ─────────────────────────────────────────────────────────────
    // The assistant message whose own top edge is held at the top of the
    // viewport, or null when no pin is active. The pin suppresses bottom
    // following, it does NOT leave the following mode: a real gesture drops it
    // (the reader keeps their place) and reaching the end drops it too, so
    // ordinary end following resumes as soon as the reader asks for the edge.
    const [topPinnedMessageId, setTopPinnedMessageId] = React.useState<string | null>(null);
    const topPinnedMessageIdRef = React.useRef<string | null>(null);
    topPinnedMessageIdRef.current = topPinnedMessageId;
    // The streaming id the pin was last evaluated against, so a re-render of
    // the same answer does not restart the pin, while a new answer re-pins.
    const lastStreamingMessageIdRef = React.useRef<string | null>(null);
    // The answer the hold was armed for, so one answer costs one arming. Cleared
    // with the session, never on a step boundary: the answer's first message does
    // not change while the answer runs.
    const lastTopPinAnchorRef = React.useRef<string | null>(null);
    // A pin waiting for its hold to land: the streaming answer whose top edge
    // belongs at the top of the viewport but whose geometry is not usable yet
    // (the row is still an estimate) or whose answer does not reach the
    // viewport top yet. The request survives until it lands and is retried by
    // the content-growth signal the list already emits, so nothing runs per
    // frame while it waits.
    const topPinRequestRef = React.useRef<string | null>(null);
    // The live attempt, read by `onTimelineDataChange` (declared above the pin
    // block). Assigned during render, like the refs above.
    const attemptTopPinRef = React.useRef<(messageId: string) => boolean>(() => false);
    // The streaming id as of the last render, for the growth signal that must
    // arm a pin without an id transition (a session opened mid-answer).
    const activeStreamingMessageIdRef = React.useRef<string | null>(activeStreamingMessageId);
    activeStreamingMessageIdRef.current = activeStreamingMessageId;
    const answerAnchorMessageIdRef = React.useRef<string | null>(answerAnchorMessageId);
    answerAnchorMessageIdRef.current = answerAnchorMessageId;
    // Set when the reader explicitly asks for the live edge while an answer is
    // still streaming: they want to watch the tail, so the top edge must not
    // pull them back. Lifted by the reader's own gesture, by a later request for
    // the edge made while nothing is streaming (a fresh send), and on the next
    // session. Without it the pin would re-arm one signal after the "scroll to
    // bottom" pill and undo the reader's own command.
    const pinOptOutRef = React.useRef(false);

    // The single release path for the pin: the request and the hold are dropped
    // together and NOTHING is scrolled, so releasing can never move the
    // viewport — the reader keeps the position they hold and ordinary
    // end-following rules take over from there.
    const releaseTopPin = React.useCallback(() => {
        topPinRequestRef.current = null;
        if (topPinnedMessageIdRef.current === null) return;
        topPinnedMessageIdRef.current = null;
        setTopPinnedMessageId(null);
    }, []);

    const composerOverlayHeightRef = React.useRef(composerOverlayHeight);
    composerOverlayHeightRef.current = composerOverlayHeight;
    // Size of the list footer, reported by the list as it is measured; the
    // real content end sits below the last row by this much.
    const listFooterSizeRef = React.useRef(0);
    const onListMetricsChange = React.useCallback((metrics: { readonly footerSize: number }) => {
        listFooterSizeRef.current = Number.isFinite(metrics.footerSize) ? metrics.footerSize : 0;
    }, []);

    // Where the viewport sits relative to the MEASURED end of the content.
    // `above` means the reader is reading away from the end — the only state a
    // top pin belongs in. The list reports its own at-end flag from the
    // ESTIMATED total length, which it recomputes whenever rows are re-measured:
    // while a pin holds the viewport mid-answer that estimate can briefly shrink
    // enough to claim the end is in view. Every decision that follows from a
    // reported `isAtEnd` therefore measures the real rows instead — the same
    // measurement the follow corrections use. `unknown` means nothing is
    // measurable yet, and callers keep their previous behaviour.
    const realContentEndRelation = React.useCallback((): 'above' | 'at-or-below' | 'unknown' => {
        const node = scrollRef.current;
        const state = listRef.current?.getState();
        const measuredEnd = state
            ? resolveRealContentEndOffset({
                state,
                composerOverlayHeight: composerOverlayHeightRef.current,
                footerSize: listFooterSizeRef.current,
            })
            : null;
        if (measuredEnd === null) {
            // No measurable row: the scroll node's own end is all there is.
            if (!node) return 'unknown';
            const end = Math.max(0, node.scrollHeight - node.clientHeight);
            return end - node.scrollTop > 1 ? 'above' : 'at-or-below';
        }
        if (!node) return 'unknown';
        return measuredEnd - node.scrollTop > 1 ? 'above' : 'at-or-below';
    }, []);
    const sessionMessageCountRef = React.useRef(sessionMessageCount);
    sessionMessageCountRef.current = sessionMessageCount;
    const currentSessionIdRef = React.useRef(currentSessionId);
    currentSessionIdRef.current = currentSessionId;
    const currentSessionKeyRef = React.useRef(currentSessionKey);
    currentSessionKeyRef.current = currentSessionKey;

    const updateViewportAnchor = useViewportStore((state) => state.updateViewportAnchor);

    const cancelShowButtonTimer = React.useCallback(() => {
        if (showButtonTimerRef.current !== null) {
            clearTimeout(showButtonTimerRef.current);
            showButtonTimerRef.current = null;
        }
    }, []);

    const hideScrollButton = React.useCallback(() => {
        cancelShowButtonTimer();
        setShowScrollButton(false);
    }, [cancelShowButtonTimer]);

    const scheduleShowScrollButton = React.useCallback(() => {
        if (showButtonTimerRef.current !== null) return;
        showButtonTimerRef.current = setTimeout(() => {
            showButtonTimerRef.current = null;
            setShowScrollButton(true);
        }, SHOW_SCROLL_BUTTON_DELAY_MS);
    }, []);

    // ── follow correction scheduling ────────────────────────────────────────
    // Stream growth fires the correction many times per frame. It is coalesced
    // into one animation frame that reads the LIVE end when it runs, so a burst
    // of growth costs one write instead of one smooth scroll per tick. The
    // frame is cancelled the instant the reader takes the scroll (a wheel,
    // touch, key, or scrollbar-thumb drag), so no correction queued before the
    // gesture can move the viewport after it — that trailing glide is what made
    // the viewport keep creeping down after the reader pulled it up.
    const followFrameRef = React.useRef<number | null>(null);
    const cancelScheduledFollow = React.useCallback(() => {
        if (followFrameRef.current === null) return;
        cancelAnimationFrame(followFrameRef.current);
        followFrameRef.current = null;
    }, []);

    // A real gesture: stop every automatic movement until the user opts back
    // in. This is the single release path for bottom following, so "the user
    // scrolled" is detected in exactly one place. It also drops the top pin:
    // the reader is driving the viewport now, so the answer's top edge must not
    // pull the view back.
    const onManualNavigation = React.useCallback(() => {
        // Before anything else: a queued correction must not fire after the
        // gesture and drag the viewport back down.
        cancelScheduledFollow();
        userGenerationRef.current += 1;
        modeRef.current = 'free-scrolling';
        liveFollowGenerationRef.current = null;
        setUserOwnsScroll(true);
        releaseTopPin();
        // The reader drives again: an explicit "watch the tail" choice made
        // earlier does not survive their own gesture. Returning to the end
        // afterwards re-arms ordinary following, and a fresh answer may pin
        // again from there.
        pinOptOutRef.current = false;
        // The end may already have been left by our own movement, in which
        // case no further at-end transition will fire — while a follow
        // correction is pending, isAtEndRef is deliberately not updated, so
        // measure the real distance instead of trusting it. This is an explicit
        // gesture — show the pill immediately, no debounce.
        const listState = listRef.current?.getState();
        const atEndNow = (listState ? resolveTimelineIsAtEnd(listState) : undefined) ?? isAtEndRef.current;
        isAtEndRef.current = atEndNow;
        if (!atEndNow) {
            cancelShowButtonTimer();
            setShowScrollButton(true);
        }
    }, [cancelShowButtonTimer, cancelScheduledFollow, releaseTopPin]);

    const isLiveFollowActive = React.useCallback(() => (
        liveFollowGenerationRef.current === userGenerationRef.current
    ), []);

    // ── snapshot persistence ────────────────────────────────────────────────
    const pendingSaveRef = React.useRef<{ sessionId: string; anchor: number } | null>(null);
    const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const flushSave = React.useCallback(() => {
        if (saveTimerRef.current !== null) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        const pending = pendingSaveRef.current;
        if (!pending) return;
        const container = scrollRef.current;
        if (!container) {
            pendingSaveRef.current = null;
            return;
        }
        updateViewportAnchor(pending.sessionId, pending.anchor, {
            scrollTop: container.scrollTop,
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight,
        });
        pendingSaveRef.current = null;
    }, [updateViewportAnchor]);

    const queueSave = React.useCallback(() => {
        const sessionId = currentSessionIdRef.current;
        if (!sessionId) return;
        const container = scrollRef.current;
        if (!container) return;

        const { scrollTop, scrollHeight, clientHeight } = container;
        const anchorRatio = scrollHeight > 0
            ? (scrollTop + clientHeight / 2) / scrollHeight
            : 0;
        const anchor = Math.floor(anchorRatio * sessionMessageCountRef.current);

        pendingSaveRef.current = { sessionId, anchor };
        if (saveTimerRef.current !== null) return;
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            flushSave();
        }, SAVE_DEBOUNCE_MS);
    }, [flushSave]);

    const saveSnapshotNow = React.useCallback(() => {
        flushSave();
    }, [flushSave]);

    // ── scroll commands ─────────────────────────────────────────────────────
    const goToBottomReassertTimersRef = React.useRef<Array<ReturnType<typeof setTimeout>>>([]);
    const clearGoToBottomReasserts = React.useCallback(() => {
        for (const timer of goToBottomReassertTimersRef.current) clearTimeout(timer);
        goToBottomReassertTimersRef.current = [];
    }, []);

    const goToBottom = React.useCallback((mode: 'instant' | 'smooth' = 'instant') => {
        isAtEndRef.current = true;
        setIsPinned(true);
        setUserOwnsScroll(false);
        modeRef.current = 'following-end';
        // Asking for the live edge ends any top pin: the reader wants the edge.
        releaseTopPin();
        // Asked for the edge while an answer is streaming: the reader wants to
        // watch the tail of THAT answer, so the top pin stays out until they
        // opt in again (a gesture and back to the end) or a later send starts a
        // fresh answer. Outside a stream there is nothing to opt out of.
        pinOptOutRef.current = activeStreamingMessageIdRef.current !== null;
        liveFollowGenerationRef.current = userGenerationRef.current;
        hideScrollButton();
        void listRef.current?.scrollToEnd({ animated: mode === 'smooth' });
        // While a stream is growing the content, a single jump lands on the
        // end as of that moment and the list's own follow may not have
        // re-armed yet — re-assert a few times until the edge holds, then the
        // library follows onward. A new user gesture invalidates the window.
        clearGoToBottomReasserts();
        const generation = userGenerationRef.current;
        for (const delay of [150, 400, 800]) {
            goToBottomReassertTimersRef.current.push(setTimeout(() => {
                if (userGenerationRef.current !== generation) return;
                if (modeRef.current !== 'following-end') return;
                // The reply that this send started is streaming again by now:
                // its top pin — armed or already holding — is the reader's
                // reading position, and landing on the end under it would be
                // the up/down jiggle the pin exists to remove. The pin releases
                // this window itself the moment the reader gestures or asks for
                // the edge.
                if (topPinnedMessageIdRef.current !== null || topPinRequestRef.current !== null) return;
                const state = listRef.current?.getState();
                if (state && resolveTimelineIsAtEnd(state) === true) return;
                void listRef.current?.scrollToEnd({ animated: false });
            }, delay));
        }
    }, [clearGoToBottomReasserts, hideScrollButton, releaseTopPin]);

    // User preference: with auto-follow off, streaming growth never moves the
    // viewport. Sending from the live edge still lands on the end; sending
    // from mid-history leaves the viewport untouched.
    const streamingAutoFollowEnabled = useUIStore((state) => state.streamingAutoFollowEnabled);
    const streamingAutoFollowEnabledRef = React.useRef(streamingAutoFollowEnabled);
    streamingAutoFollowEnabledRef.current = streamingAutoFollowEnabled;

    // Sending is an explicit return to the live edge: the sent row and the
    // reply that follows it stay in view through ordinary end-follow.
    const scrollToBottomOnSend = React.useCallback(() => {
        // With auto-follow off, a reader who scrolled away from the end stays
        // exactly where they are; the scroll-to-bottom pill (already showing)
        // leads to the sent message.
        if (!streamingAutoFollowEnabledRef.current && !isAtEndRef.current) return;
        goToBottom('instant');
    }, [goToBottom]);

    const restoreSnapshot = React.useCallback(async (): Promise<boolean> => {
        const sessionKey = currentSessionKeyRef.current;
        if (!sessionKey) return false;

        // A hold (or the wait for one) that belongs to an answer still
        // streaming IS the position this session opens with: the reader is
        // meant to watch the live answer from its own top edge, and settling
        // the end here would both move them and drop the hold for the rest of
        // the step. A session opened with no answer in flight has nothing to
        // pin and always lands on the end.
        if (
            activeStreamingMessageIdRef.current !== null
            && (topPinnedMessageIdRef.current !== null || topPinRequestRef.current !== null)
        ) {
            return false;
        }

        // Entering a session always returns to the live edge. Late async growth
        // is handled by the list staying at the end, not by a timed hold.
        isAtEndRef.current = true;
        setUserOwnsScroll(false);
        modeRef.current = 'following-end';
        releaseTopPin();
        // A fresh entry always shows the end; a pin opted out of in the session
        // that was just left does not carry over.
        pinOptOutRef.current = false;
        liveFollowGenerationRef.current = userGenerationRef.current;
        hideScrollButton();
        void listRef.current?.scrollToEnd({ animated: false });
        return false;
    }, [hideScrollButton, releaseTopPin]);

    // ── list callbacks ──────────────────────────────────────────────────────
    const registerList = React.useCallback((list: TimelineListHandle | null) => {
        listRef.current = list;
        // SAFETY: `getScrollableNode` is the list's own scroll container, which
        // the timeline renders as a <div>; the structural handle type only
        // promises an HTMLElement, and narrowing by tag name would reject the
        // test harness's equivalent node stub.
        const node = (list?.getScrollableNode() as HTMLDivElement | null) ?? null;
        scrollRef.current = node;
        setScrollNode(node);
    }, []);

    const onIsAtEndChange = React.useCallback((isAtEnd: boolean) => {
        // Reaching the end means the reader chose the live edge, so a pin that
        // still holds is dropped here: ordinary end following resumes. The
        // reported flag alone is not enough: while a pin holds the viewport
        // mid-answer, the list's total-length ESTIMATE — the number behind the
        // flag — can dip below what is measured for a moment and claim an end
        // the reader is nowhere near. Dropping the pin there handed the
        // viewport back to end maintenance, which then rode it down to the
        // real end in one jump. Only a viewport that MEASURES as the end
        // releases the hold.
        if (isAtEnd && realContentEndRelation() !== 'above') releaseTopPin();
        // While an automatic movement owns the viewport, leaving the end is our
        // own doing (the glide trails its target between corrections) — not a
        // reason to offer the pill. Only a
        // real gesture (free-scrolling) shows it.
        if (!isAtEnd && isLiveFollowActive()) {
            hideScrollButton();
            return;
        }
        if (isAtEndRef.current === isAtEnd) return;
        isAtEndRef.current = isAtEnd;
        setIsPinned(isAtEnd);
        if (isAtEnd) {
            modeRef.current = 'following-end';
            liveFollowGenerationRef.current = userGenerationRef.current;
            setUserOwnsScroll(false);
            hideScrollButton();
        } else {
            modeRef.current = 'free-scrolling';
            liveFollowGenerationRef.current = null;
            scheduleShowScrollButton();
        }
        queueSave();
    }, [
        hideScrollButton,
        isLiveFollowActive,
        queueSave,
        realContentEndRelation,
        releaseTopPin,
        scheduleShowScrollButton,
    ]);

    // Whether the real rows are tall enough to scroll at all.
    const realContentOverflowsViewport = React.useCallback((list: TimelineListHandle): boolean => {
        const state = list.getState();
        if (state.data.length === 0) return false;

        const lastRowBottom = getRowBottom(state, state.data.length - 1);
        if (lastRowBottom === null) return false;

        const visibleScrollLength = Math.max(0, state.scrollLength - composerOverlayHeightRef.current);
        return lastRowBottom > visibleScrollLength;
    }, []);

    // While the list width is resizing every row re-wraps, and the list's
    // total content length lags a frame behind the rows it contains: it
    // still carries pre-wrap row sizes, so any end computed from it (the
    // list's own maintainScrollAtEnd, the scroll node's scrollHeight) lands
    // on a blank tail or short of the real end and the viewport bounces.
    // A pinned reader — streaming or idle — stays on the end throughout: the
    // pinned-end observer below re-asserts the MEASURED end of the last real
    // row on every layout write, and once the resize settles the end is
    // asserted one last time against the same measurement. An unpinned
    // reader is held in place by the list's size compensation instead and
    // is never scrolled.
    const widthResizingRef = React.useRef(false);
    React.useEffect(() => {
        if (!scrollNode || platform.ResizeObserver === undefined) return;
        let lastWidth: number | null = null;
        let quietTimer: ReturnType<typeof setTimeout> | null = null;
        const observer = new ResizeObserver((observerEntries) => {
            const width = parseReportedWidth(observerEntries);
            if (width === null) return;
            if (lastWidth === null) {
                lastWidth = width;
                return;
            }
            if (Math.abs(width - lastWidth) < 1) return;
            lastWidth = width;
            widthResizingRef.current = true;
            if (quietTimer !== null) clearTimeout(quietTimer);
            quietTimer = setTimeout(() => {
                quietTimer = null;
                widthResizingRef.current = false;
                if (!isAtEndRef.current) return;
                if (userOwnsScrollRef.current || modeRef.current !== 'following-end') return;
                const list = listRef.current;
                const state = list?.getState();
                const offset = state
                    ? resolveRealContentEndOffset({
                        state,
                        composerOverlayHeight: composerOverlayHeightRef.current,
                        footerSize: listFooterSizeRef.current,
                    })
                    : null;
                if (list && offset !== null) {
                    void list.scrollToOffset({ offset, animated: false });
                } else {
                    void list?.scrollToEnd({ animated: false });
                }
            }, 350);
        });
        observer.observe(scrollNode);
        return () => {
            observer.disconnect();
            if (quietTimer !== null) clearTimeout(quietTimer);
        };
    }, [scrollNode]);

    // Keep the live edge in view after content growth. Writes go to the scroll
    // node directly: routing each chunk through the list's scrollToEnd
    // bookkeeping roughly doubled frame production when measured.
    //
    // A burst of growth is coalesced into one animation frame per correction:
    // the frame re-reads the live end when it runs, so N ticks in one frame
    // cost one write. The frame is dropped by `cancelScheduledFollow` on any
    // real gesture — no queued or in-flight correction survives the moment the
    // reader takes the scroll.
    const followWrite = React.useCallback(() => {
        followFrameRef.current = null;
        // Re-check the mode: a gesture may have landed between the schedule and
        // this frame; the queued write already belongs to a follow that is over.
        if (modeRef.current !== 'following-end' || !isLiveFollowActive()) return;
        const node = scrollRef.current;
        if (!node) return;
        const end = node.scrollHeight - node.clientHeight;
        if (end - node.scrollTop <= 1) return;
        node.scrollTop = end;
    }, [isLiveFollowActive]);

    const followEnd = React.useCallback(() => {
        if (followFrameRef.current !== null) return;
        followFrameRef.current = requestAnimationFrame(followWrite);
    }, [followWrite]);

    const onTimelineDataChange = React.useCallback(() => {
        if (widthResizingRef.current) return;

        // A held top pin is the active reading position: the answer's top edge
        // stays where it was put while the tail grows below it, so nothing —
        // not even the stranded-viewport rescue — moves the viewport. The pin
        // is a suppression of movement, NOT a mode change: the hook stays in
        // `following-end`, which is why a gesture or a return to the end
        // releases it without any extra state machine.
        if (topPinnedMessageIdRef.current !== null) return;

        // A pending pin outranks everything below: the answer's top edge belongs
        // at the top of the viewport as soon as it can reach it. The retry rides
        // this growth signal, which the list already emits (the streaming tail
        // grows inside one row), so it costs one measurement per growth event
        // and only until the hold lands — no per-frame work, and no timer to
        // outrun the layout. A pin is only ever ARMED on a streaming message id
        // (see the top-pin effect), so a reader who released the hold by
        // returning to the end is not pulled off the edge again here. Auto-follow
        // off is excluded: with that preference growth must never move the
        // viewport, and a wait outliving its first attempt is exactly growth
        // moving it later.
        // A pending pin outranks everything below: the answer's top edge belongs
        // at the top of the viewport as soon as it can reach it. The retry rides
        // this growth signal, which the list already emits (the streaming tail
        // grows inside one row), so it costs one measurement per growth event
        // and only until the hold lands — no per-frame work, and no timer to
        // outrun the layout. A pin is only ever ARMED on a streaming message id
        // (see the top-pin effect), so a reader who released the hold by
        // returning to the end is not pulled off the edge again here. Auto-follow
        // off is excluded: with that preference growth must never move the
        // viewport, and a wait outliving its first attempt is exactly growth
        // moving it later.
        const pendingPinId = topPinRequestRef.current;
        if (
            pendingPinId !== null
            && streamingAutoFollowEnabledRef.current
            && attemptTopPinRef.current(pendingPinId)
        ) {
            return;
        }

        // Stranded-viewport rescue, independent of any follow mode or
        // preference: when off-screen size estimates settle smaller than
        // estimated, the measured content can end ABOVE the viewport while
        // the scroll offset stays at the stale end — the reader faces a blank
        // phantom tail with every row out of reach above. That state is never
        // intentional, so it is corrected even when auto-follow is off. Only
        // a fully blank viewport qualifies; partial visibility is left alone.
        if (!userOwnsScrollRef.current) {
            const list = listRef.current;
            if (list) {
                const state = list.getState();
                const lastIndex = state.data.length - 1;
                const lastBottom = lastIndex >= 0 ? getRowBottom(state, lastIndex) : null;
                if (lastBottom !== null && state.scroll > lastBottom) {
                    const offset = resolveRealContentEndOffset({
                        state,
                        composerOverlayHeight: composerOverlayHeightRef.current,
                        footerSize: listFooterSizeRef.current,
                    });
                    if (offset !== null) {
                        void list.scrollToOffset({ offset, animated: false });
                        return;
                    }
                }
            }
        }

        if (!streamingAutoFollowEnabledRef.current) {
            // With auto-follow off nothing moves the viewport, so a growing
            // reply slides below the visible area without a single scroll
            // event — and the at-end transition that offers the pill never
            // fires. Content growth is the signal here: once the real last
            // row extends past what the composer leaves visible, the reader
            // is factually behind and the pill must say so.
            const list = listRef.current;
            if (list && isAtEndRef.current) {
                const state = list.getState();
                const lastIndex = state.data.length - 1;
                const lastBottom = lastIndex >= 0 ? getRowBottom(state, lastIndex) : null;
                if (lastBottom !== null) {
                    const visibleBottom = state.scroll + state.scrollLength - composerOverlayHeightRef.current;
                    if (lastBottom - visibleBottom > TIMELINE_FOLLOW_REARM_THRESHOLD_PX) {
                        isAtEndRef.current = false;
                        setIsPinned(false);
                        scheduleShowScrollButton();
                    }
                }
            }
            return;
        }
        if (!isLiveFollowActive()) return;

        // Following the end is owned here, not left to the list's
        // maintainScrollAtEnd. The list's animated maintain is single-flight:
        // growth that lands while a glide is still in flight is dropped until
        // the next trigger, and its re-pin threshold is a tenth of the
        // viewport. In a narrow viewport (the VS Code sidebar) one revealed
        // block is several viewports tall, so every block left the reader a
        // second behind and multiple screens above the live edge — measured
        // at 45% of the stream time spent 500-1600px behind at 420x640.
        if (modeRef.current !== 'following-end') return;
        followEnd();
    }, [followEnd, isLiveFollowActive, scheduleShowScrollButton]);

    // The streaming tail grows inside one row without changing the entries
    // array, so data-change callbacks are silent for the entire stream. The
    // list's total content size is the authoritative growth signal; every
    // change re-runs the same guarded correction.
    const onTimelineDataChangeRef = React.useRef(onTimelineDataChange);
    onTimelineDataChangeRef.current = onTimelineDataChange;
    React.useEffect(() => {
        if (!scrollNode) return;
        const listen = listRef.current?.getState().listen;
        if (!listen) return;
        const unsubscribe = listen('totalSize', () => {
            onTimelineDataChangeRef.current();
        });
        return unsubscribe;
    }, [scrollNode]);

    // ── gesture opt-out ─────────────────────────────────────────────────────
    const onManualNavigationRef = React.useRef(onManualNavigation);
    onManualNavigationRef.current = onManualNavigation;

    React.useEffect(() => {
        if (!scrollNode) return;

        // A gesture is meaningful when the viewport can move up AT ALL:
        // either the real rows overflow the viewport, or there is scrolled
        // history above.
        const canScrollUp = () => {
            const list = listRef.current;
            if (!list) return false;
            if (list.getState().scroll > 1) return true;
            return realContentOverflowsViewport(list);
        };
        const gesture = () => {
            onManualNavigationRef.current();
        };
        const handleWheel = (event: WheelEvent) => {
            // Scrolling toward the end is not opting out of follow, and an
            // upward wheel that a nested scroller still consumes never
            // reaches the timeline.
            if (event.deltaY < 0 && !nestedScrollableConsumesWheelUp(scrollNode, event.target) && canScrollUp()) {
                gesture();
            }
        };
        // Touch mirrors wheel by finger direction, not by having already left
        // the end: while a stream keeps re-pinning the viewport, waiting for
        // an at-end transition means the drag never registers — the user
        // cannot scroll, the pill never appears, and live-follow stays armed
        // under a viewport they are fighting for.
        let touchLastY: number | null = null;
        const handleTouchStart = (event: TouchEvent) => {
            touchLastY = event.touches[0]?.clientY ?? null;
        };
        const handleTouchMove = (event: TouchEvent) => {
            const y = event.touches[0]?.clientY ?? null;
            const lastY = touchLastY;
            touchLastY = y;
            if (y === null) return;
            // A downward finger drags the content up — the touch wheel-up.
            const draggedUp = lastY !== null && y > lastY;
            if ((draggedUp || !isAtEndRef.current) && canScrollUp()) gesture();
        };
        const handleTouchEnd = () => {
            touchLastY = null;
        };
        const handlePointerDown = (event: PointerEvent) => {
            // A middle-button pan scrolls without wheel events (and is the
            // only scroll gesture for wheel-less mice), so the press is the
            // opt-out. Otherwise the scrollbar track is the scroll node
            // itself; a tap on a row only breaks follow when the viewport
            // already left the end.
            if (isMiddleButtonPan(scrollNode, event)) {
                if (canScrollUp()) gesture();
                return;
            }
            if ((event.target === scrollNode || !isAtEndRef.current) && canScrollUp()) gesture();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (isFollowReleaseKey(event) && canScrollUp()) gesture();
        };
        const handleScroll = () => {
            queueSave();
        };

        scrollNode.addEventListener('wheel', handleWheel, { passive: true });
        scrollNode.addEventListener('touchstart', handleTouchStart, { passive: true });
        scrollNode.addEventListener('touchmove', handleTouchMove, { passive: true });
        scrollNode.addEventListener('touchend', handleTouchEnd, { passive: true });
        scrollNode.addEventListener('touchcancel', handleTouchEnd, { passive: true });
        scrollNode.addEventListener('pointerdown', handlePointerDown, { passive: true });
        scrollNode.addEventListener('keydown', handleKeyDown);
        scrollNode.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            scrollNode.removeEventListener('wheel', handleWheel);
            scrollNode.removeEventListener('touchstart', handleTouchStart);
            scrollNode.removeEventListener('touchmove', handleTouchMove);
            scrollNode.removeEventListener('touchend', handleTouchEnd);
            scrollNode.removeEventListener('touchcancel', handleTouchEnd);
            scrollNode.removeEventListener('pointerdown', handlePointerDown);
            scrollNode.removeEventListener('keydown', handleKeyDown);
            scrollNode.removeEventListener('scroll', handleScroll);
        };
    }, [queueSave, realContentOverflowsViewport, scrollNode]);

    // ── entry pin ───────────────────────────────────────────────────────────
    // An opened session is shown once, already at its end: the reveal gate is
    // held until the viewport sits on the end, and the pin is one instant
    // write. The list lays its rows out before the first frame, so this
    // resolves within a frame; the gate's own cap bounds the wait.
    React.useLayoutEffect(() => {
        if (!currentSessionKey || !scrollNode) return;
        const releaseReveal = revealGate?.hold() ?? null;
        let frame: number | null = null;
        const settle = () => {
            frame = null;
            // A hold that landed in the meantime is the reading position: the
            // entry write would drag the viewport back down to the end it was
            // already given, which is the frame of flicker between opening a
            // streaming session and the answer's top edge.
            if (
                topPinnedMessageIdRef.current === null
                && !userOwnsScrollRef.current
                && modeRef.current === 'following-end'
            ) {
                const end = scrollNode.scrollHeight - scrollNode.clientHeight;
                if (end - scrollNode.scrollTop > 1) scrollNode.scrollTop = end;
            }
            releaseReveal?.();
        };
        frame = requestAnimationFrame(settle);
        return () => {
            if (frame !== null) cancelAnimationFrame(frame);
            releaseReveal?.();
        };
    }, [currentSessionKey, revealGate, scrollNode]);

    // ── pinned end ──────────────────────────────────────────────────────────
    // "At the end" is an invariant, not a one-time scroll: while the reader
    // sits on the end of a session that is not producing output, any growth
    // of the content (a footer that decides to render, a row re-measured)
    // keeps the end in view with one instant write. Output growth belongs to
    // followEnd, which coalesces its correction into one frame. A width resize
    // is the one case handled for a streaming reader as well — see the resize
    // observer above.
    React.useEffect(() => {
        if (!scrollNode || platform.MutationObserver === undefined) return;
        const content = scrollNode.firstElementChild;
        if (!content) return;
        const pin = () => {
            if (userOwnsScrollRef.current || !isAtEndRef.current || modeRef.current !== 'following-end') return;
            // A held or pending top pin owns the viewport: growth of the tail —
            // including a footer that renders after the answer finished — must
            // not drag the reader down to the end they are reading away from.
            if (topPinnedMessageIdRef.current !== null || topPinRequestRef.current !== null) return;
            if (widthResizingRef.current) {
                // Re-wrapping rows: the scroll node's scrollHeight carries the
                // list's stale total, so the end is the measured bottom of the
                // last real row. Held for a streaming reader too — output
                // growth is not what moves the viewport during a resize.
                const state = listRef.current?.getState();
                const offset = state
                    ? resolveRealContentEndOffset({
                        state,
                        composerOverlayHeight: composerOverlayHeightRef.current,
                        footerSize: listFooterSizeRef.current,
                    })
                    : null;
                if (offset !== null && Math.abs(offset - scrollNode.scrollTop) > 1) {
                    scrollNode.scrollTop = offset;
                }
                return;
            }
            if (sessionIsWorkingRef.current) return;
            const end = scrollNode.scrollHeight - scrollNode.clientHeight;
            if (end - scrollNode.scrollTop > 1) scrollNode.scrollTop = end;
        };
        // A MutationObserver runs as a microtask right after the list writes
        // its layout (row positions, container height), before the frame is
        // painted, so the pin lands in the same frame as the growth. A
        // ResizeObserver would only see the container a rendering step later
        // and let one frame paint with the end out of view.
        const mutations = new MutationObserver(pin);
        mutations.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
        const resizes = platform.ResizeObserver === undefined ? null : new ResizeObserver(pin);
        resizes?.observe(content);
        return () => {
            mutations.disconnect();
            resizes?.disconnect();
        };
    }, [scrollNode]);

    // ── session lifecycle ───────────────────────────────────────────────────
    const lastSessionKeyRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (!currentSessionId || !currentSessionKey || currentSessionKey === lastSessionKeyRef.current) {
            return;
        }
        lastSessionKeyRef.current = currentSessionKey;
        MessageFreshnessDetector.getInstance().recordSessionStart(currentSessionId);
        // Persist the outgoing session's position before the new one takes over.
        flushSave();
        isAtEndRef.current = true;
        setUserOwnsScroll(false);
        modeRef.current = 'following-end';
        releaseTopPin();
        pinOptOutRef.current = false;
        lastStreamingMessageIdRef.current = null;
        lastTopPinAnchorRef.current = null;
        liveFollowGenerationRef.current = userGenerationRef.current;
        hideScrollButton();
    }, [currentSessionId, currentSessionKey, flushSave, hideScrollButton, releaseTopPin]);

    // ── top pin ─────────────────────────────────────────────────────────────
    // A freshly started answer holds its OWN top edge at the top of the viewport
    // while its text streams downward, so the reader watches the answer grow
    // instead of chasing the live edge. The anchor is measured on the assistant
    // message element itself (see messageAnchor), never on the turn row that
    // starts with the user's sticky header — that is what used to scroll the
    // viewport up to the user's message.
    //
    // That edge belongs to the answer's FIRST message (`answerAnchorMessageId`),
    // because one answer is several assistant messages. The id of the step
    // streaming right now moves with the answer, so a hold armed from it landed
    // wherever the first step tall enough to be pinned happened to be — the
    // reader saw the hold appear mid-answer instead of at its first line.
    //
    // The pin engages only while the reader is still following the end and it
    // only suppresses movement; it never changes the mode, so a real gesture or
    // reaching the end releases it and leaves an ordinary following hook. Once
    // the hold lands it is LATCHED: a whole answer costs one write, and the
    // per-step handoff inside a turn (id → null → next id) neither drops nor
    // re-issues it. Everything else that could move the viewport — end
    // maintenance, the end-follow correction, the go-to-bottom re-asserts —
    // steps aside while a request is armed or a hold is active.
    const stickyHeaderHeight = React.useCallback((): number => {
        const container = scrollNode;
        if (!container) return 0;
        // The turn's user header is the sticky element inside the scroll
        // container. Every turn renders the same header component, so any
        // mounted one measures the same height; measure it instead of
        // hardcoding. Absent (the sticky-header setting is off, or no turn is
        // mounted yet) the answer's top goes to the very top of the viewport.
        // The header carries its own test id; a bare `.sticky` would also match
        // an unrelated sticky element that happens to sit inside a turn row.
        const sticky = container.querySelector<HTMLElement>('[data-testid="sticky-user-header"]');
        if (!sticky) return 0;
        const height = sticky.getBoundingClientRect().height;
        return Number.isFinite(height) ? Math.max(0, height) : 0;
    }, [scrollNode]);

    // One write of the hold, issued only when the anchor actually resolves.
    // `false` means "not yet": the row is still an estimate, or the answer is
    // short enough to fit on screen and has nothing to pin (pinning it would
    // leave the viewport looking empty). The caller keeps the request armed and
    // the growth signal retries, so the wait costs no frames.
    const attemptTopPin = React.useCallback((messageId: string): boolean => {
        const container = scrollNode;
        if (!container) return false;
        // A reader who took the scroll keeps it: nothing arms or re-arms under
        // a gesture.
        if (userOwnsScrollRef.current || modeRef.current !== 'following-end') return false;

        const listState = listRef.current?.getState();
        const offset = resolveTopPinOffset({
            assistantTop: measureMessageTop(container, messageId) ?? undefined,
            stickyHeaderHeight: stickyHeaderHeight(),
            contentLength: listState?.contentLength,
            scrollLength: listState?.scrollLength,
        });
        if (offset === null) return false;

        topPinRequestRef.current = null;
        topPinnedMessageIdRef.current = messageId;
        setTopPinnedMessageId(messageId);
        // The pin is not the reader leaving the end: keep the pill hidden and
        // the live-follow generation armed so a later return to the end is
        // still recognised.
        hideScrollButton();
        void listRef.current?.scrollToOffset({ offset, animated: false });
        return true;
    }, [hideScrollButton, scrollNode, stickyHeaderHeight]);
    attemptTopPinRef.current = attemptTopPin;

    React.useEffect(() => {
        // The hold is armed on the FIRST message of the answer, not on the step
        // streaming right now: one answer is several assistant messages, and the
        // step that happens to be tall enough first is not where the answer
        // starts. The caller supplies that first message; a caller that cannot
        // falls back to the streaming id, which is the previous behaviour.
        const anchorId = answerAnchorMessageId ?? activeStreamingMessageId;
        if (anchorId === null) {
            // No answer in flight: the next answer arms a hold of its own.
            lastTopPinAnchorRef.current = null;
            lastStreamingMessageIdRef.current = null;
            return;
        }

        // One arming per answer. The anchor does not change while the answer
        // runs, so a step boundary inside it — the finished step's message gets
        // `time.completed` before the next step's message exists, and the
        // streaming id goes null in that gap — neither drops the hold nor arms
        // it again: re-arming on the next step pinned the answer's top edge a
        // second time, which is the up/down jiggle the reader saw on every new
        // output.
        if (anchorId === lastTopPinAnchorRef.current) return;
        lastTopPinAnchorRef.current = anchorId;
        lastStreamingMessageIdRef.current = activeStreamingMessageId;

        // A held pin already owns this answer's top edge: the new step appends
        // BELOW the edge that is held, so re-writing the same kind of hold for
        // it would only move the viewport. One hold per answer, not per step.
        if (topPinnedMessageIdRef.current !== null) return;

        // The reader explicitly asked for the live edge while an answer was
        // streaming; that choice stands until they drive the scroll themselves.
        if (pinOptOutRef.current) return;

        // Only a reader who is still following the end gets the pin; one who
        // took over the scroll keeps their position.
        if (userOwnsScrollRef.current || modeRef.current !== 'following-end') return;

        // The pin is part of following: with auto-follow off, growth must never
        // move the viewport, and a pin is exactly growth moving it.
        if (!streamingAutoFollowEnabledRef.current) return;

        // The answer is mounted in the same commit as its id, but the list may
        // still report an estimated offset for it, and a short answer cannot
        // reach the top at all. Both are handled by arming the request: the
        // attempt below lands now when the geometry is ready, otherwise the
        // next growth signal retries it.
        topPinRequestRef.current = anchorId;
        attemptTopPin(anchorId);
    }, [activeStreamingMessageId, answerAnchorMessageId, attemptTopPin]);

    // A request that never resolved belongs to the turn that raised it: once the
    // session stops working no answer is streaming, so it is dropped. The hold
    // itself is NOT — the reader keeps reading the answer from the top edge they
    // were given, exactly as when a gesture had not happened.
    React.useEffect(() => {
        if (sessionIsWorking) return;
        topPinRequestRef.current = null;
    }, [sessionIsWorking]);

    // Suppress the overlay scrollbar thumb while automatic movement owns the
    // scroll position, so it does not jump on each correction.
    React.useEffect(() => {
        setIsFollowingProgrammatically(!showScrollButton && !userOwnsScroll);
    }, [showScrollButton, userOwnsScroll]);

    React.useEffect(() => () => {
        cancelShowButtonTimer();
        cancelScheduledFollow();
        if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    }, [cancelShowButtonTimer, cancelScheduledFollow]);

    // ── active-turn spy ─────────────────────────────────────────────────────
    // Reads turn positions straight from the DOM, so it is unaffected by which
    // list implementation owns the container. Rows mounting and unmounting
    // during virtualized scrolling are tracked through the mutation observer.
    React.useEffect(() => {
        if (!onActiveTurnChange) return;
        const container = scrollNode;
        if (!container) return;

        let lastActiveTurnId: string | null = null;
        const spy = createScrollSpy({
            onActive: (turnId) => {
                if (turnId === lastActiveTurnId) return;
                lastActiveTurnId = turnId;
                onActiveTurnChange(turnId);
            },
        });
        spy.setContainer(container);

        const elementByTurnId = new Map<string, HTMLElement>();
        const registerTurnNode = (node: HTMLElement) => {
            const turnId = node.dataset.turnId;
            if (!turnId) return false;
            elementByTurnId.set(turnId, node);
            spy.register(node, turnId);
            return true;
        };
        const unregisterTurnNode = (node: HTMLElement) => {
            const turnId = node.dataset.turnId;
            if (!turnId) return false;
            if (elementByTurnId.get(turnId) !== node) return false;
            elementByTurnId.delete(turnId);
            spy.unregister(turnId);
            return true;
        };
        const collectTurnNodes = (node: Node): HTMLElement[] => {
            if (!(node instanceof HTMLElement)) return [];
            const collected: HTMLElement[] = [];
            if (node.matches('[data-turn-id]')) collected.push(node);
            node.querySelectorAll<HTMLElement>('[data-turn-id]').forEach((el) => collected.push(el));
            return collected;
        };

        container.querySelectorAll<HTMLElement>('[data-turn-id]').forEach(registerTurnNode);
        spy.markDirty();

        const mutationObserver = new MutationObserver((records) => {
            let changed = false;
            records.forEach((record) => {
                record.removedNodes.forEach((node) => {
                    collectTurnNodes(node).forEach((turnNode) => {
                        if (unregisterTurnNode(turnNode)) changed = true;
                    });
                });
                record.addedNodes.forEach((node) => {
                    collectTurnNodes(node).forEach((turnNode) => {
                        if (registerTurnNode(turnNode)) changed = true;
                    });
                });
            });
            if (changed) spy.markDirty();
        });
        mutationObserver.observe(container, { subtree: true, childList: true });

        const onScroll = () => spy.onScroll();
        container.addEventListener('scroll', onScroll, { passive: true });

        return () => {
            container.removeEventListener('scroll', onScroll);
            mutationObserver.disconnect();
            spy.destroy();
        };
    }, [onActiveTurnChange, scrollNode]);

    return {
        scrollRef,
        scrollNode,
        isPinned,
        registerList,
        onIsAtEndChange,
        onListMetricsChange,
        onManualNavigation,
        onTimelineDataChange,
        showScrollButton,
        userOwnsScroll,
        isFollowingProgrammatically,
        isTopPinned: topPinnedMessageId !== null,
        goToBottom,
        scrollToBottomOnSend,
        saveSnapshotNow,
        restoreSnapshot,
    };
};
