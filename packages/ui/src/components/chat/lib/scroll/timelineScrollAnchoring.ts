// Scroll geometry for the chat timeline.
//
// The timeline has two mutually exclusive scroll modes:
//
//   • `following-end`  — stay pinned to the live edge as content grows, except
//     while a freshly started answer holds its own top edge at the top of the
//     viewport (the top pin, see resolveTopPinOffset).
//   • `free-scrolling` — the user took over; nothing moves the scroll
//     position until they opt back in.
//
// This module is pure geometry: it reads measurements from the virtualized
// list and answers where the real content ends and whether the viewport is
// there. Keeping it free of DOM and React makes the rules testable without a
// renderer.

export type TimelineScrollMode = 'following-end' | 'free-scrolling';

export interface TimelineListMeasurementState {
    readonly data: readonly unknown[];
    readonly scroll: number;
    readonly scrollLength: number;
    // Total measured content length, as reported by the list. Optional so the
    // pure helpers stay usable with the minimal fixture the tests build.
    readonly contentLength?: number;
    readonly positionAtIndex: (index: number) => number | undefined;
    readonly sizeAtIndex: (index: number) => number | undefined;
}

// ── measurement input boundary ─────────────────────────────────────────────
//
// The virtualized list reports geometry as optional numbers: `undefined` until
// a row has been measured, and occasionally a non-finite value while a
// measurement pass is in flight. That representation is parsed once, here, so
// every helper below branches on parsed domain values instead of re-checking
// the raw representation.
//
// A usable measurement: present and finite. `null` means "not measurable".
type MeasuredPixels = number | null;

const parseMeasuredPixels = (raw: number | undefined): MeasuredPixels => {
    if (raw === undefined || !Number.isFinite(raw)) return null;
    return raw;
};

// A number the list reports about its own scroll state. Presence is the only
// thing to establish: scroll offsets and the visible length are the list's own
// authoritative numbers and are used verbatim. The estimated content length is
// the one value that can be reported as garbage, which is why
// resolveTimelineIsAtEnd parses it as `MeasuredPixels`.
type ReportedNumber = number | null;

const parseReportedNumber = (raw: number | undefined): ReportedNumber => (
    raw === undefined ? null : raw
);

export const getRowBottom = (
    state: TimelineListMeasurementState,
    index: number,
): number | null => {
    const top = parseMeasuredPixels(state.positionAtIndex(index));
    const height = parseMeasuredPixels(state.sizeAtIndex(index));
    if (top === null || height === null) {
        return null;
    }
    // Rows measured at zero height would read as no content at all; treat
    // them as one pixel tall instead.
    return top + Math.max(1, height);
};

// The list footer (question and permission cards, error notices, the tail
// spacer) renders after the last row and is part of the real content; the
// list does not expose its size through getState, so the caller passes the
// last reported value.
export const resolveRealContentEndOffset = ({
    state,
    composerOverlayHeight,
    footerSize = 0,
}: {
    readonly state: TimelineListMeasurementState;
    readonly composerOverlayHeight: number;
    readonly footerSize?: number;
}): number | null => {
    const lastIndex = state.data.length - 1;
    if (lastIndex < 0) return null;
    const lastBottom = getRowBottom(state, lastIndex);
    if (lastBottom === null) return null;
    const visibleLength = Math.max(0, state.scrollLength - composerOverlayHeight);
    return Math.max(0, lastBottom + Math.max(0, footerSize) - visibleLength);
};

// Keep return-to-end detection in a tight band, rather than half a viewport.
export const TIMELINE_FOLLOW_REARM_THRESHOLD_PX = 40;

export const resolveTimelineIsAtEnd = (
    state: {
        readonly contentLength?: number;
        readonly scroll?: number;
        readonly scrollLength?: number;
        readonly isNearEnd?: boolean;
        readonly isAtEnd?: boolean;
    } | undefined,
): boolean | undefined => {
    if (!state) return undefined;
    const contentLength = parseMeasuredPixels(state.contentLength);
    const scroll = parseReportedNumber(state.scroll);
    const scrollLength = parseReportedNumber(state.scrollLength);
    if (contentLength === null || scroll === null || scrollLength === null) {
        return state.isNearEnd ?? state.isAtEnd;
    }
    return contentLength - (scroll + scrollLength) <= TIMELINE_FOLLOW_REARM_THRESHOLD_PX;
};

// The offset that holds a freshly started answer at the top of the viewport.
//
// `assistantTop` is the top of the ASSISTANT MESSAGE itself, measured in the
// scroll container's content space (see messageAnchor). It is deliberately not
// the top of the turn row the message belongs to: a turn row starts with the
// sticky user header, so anchoring on the row placed the viewport on the user's
// message — the upward jump this helper exists to prevent. An answer can never
// be anchored above its own first pixel, because the offset is computed from
// that pixel and only ever reduced by the sticky overlay.
//
// The sticky user header floats over the top of the viewport, so an answer
// pinned at raw `assistantTop` would be hidden underneath it. The measured
// header height is subtracted — never more than that, and never below the start
// of the content — so the answer's top edge stays at the live top edge of the
// viewport instead of sliding out of view.
//
// Returns null when the answer cannot reach the top: a short answer that fits
// entirely on screen has nothing to pin, and scrolling it up would leave the
// viewport looking empty, and an unmeasured row is waited for by the caller.
export const resolveTopPinOffset = ({
    assistantTop,
    stickyHeaderHeight = 0,
    contentLength,
    scrollLength,
}: {
    readonly assistantTop: number | undefined;
    readonly stickyHeaderHeight?: number;
    readonly contentLength: number | undefined;
    readonly scrollLength: number | undefined;
}): number | null => {
    const top = parseMeasuredPixels(assistantTop);
    const content = parseMeasuredPixels(contentLength);
    const viewport = parseMeasuredPixels(scrollLength);
    if (top === null || content === null || viewport === null) return null;
    if (content - top <= viewport) return null;
    const header = Number.isFinite(stickyHeaderHeight) ? Math.max(0, stickyHeaderHeight) : 0;
    return Math.max(0, top - header);
};
