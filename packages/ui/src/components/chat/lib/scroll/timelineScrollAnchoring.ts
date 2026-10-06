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

// What a scroll position should be reported as, given what was reported last.
//
// `true` means "tell the owner the reader is on the end", `false` means "tell it
// they left", and `null` means "nothing to say".
//
// Reaching the end is always reported, including when the last report already
// said the end. The owner leaves following on a gesture, and a gesture whose
// own scroll events place the viewport on the edge — a scrollbar drag back to
// the bottom, a wheel whose final tick lands there — otherwise arrives as the
// same value it reported before and is swallowed by the comparison. Nothing
// then resumes following: corrections stay disabled and the viewport sits on the
// live edge with the pill hidden. Leaving the end needs no such repeat: the
// reported state is what the owner already left following for.
export const resolveEndReport = (lastReported: boolean, isAtEnd: boolean): boolean | null => {
    if (isAtEnd) return true;
    return lastReported ? false : null;
};

// Whether the entry settle keeps writing the end for another frame.
//
// Opening a session has to land the end of the REAL rows: the list lays its
// rows out from estimates and corrects them as they measure, so the total it
// reports early is not the one the session ends up with. Releasing on a single
// write — or as soon as the height stops moving for a frame, while the viewport
// is still short of the end the rows already claim — is how a long conversation
// opened mid-history.
//
// So the hold ends only when both hold: the content height has settled AND the
// viewport measures at the end of the real rows. The cap is the escape hatch for
// a session that can never settle, which would otherwise keep the settle running
// for as long as the reader stays in the session.
export const shouldHoldEntrySettle = ({
    elapsedMs,
    capMs,
    stableFrames,
    stableFramesNeeded,
    atMeasuredEnd,
}: {
    readonly elapsedMs: number;
    readonly capMs: number;
    readonly stableFrames: number;
    readonly stableFramesNeeded: number;
    readonly atMeasuredEnd: boolean;
}): boolean => elapsedMs < capMs && !(stableFrames >= stableFramesNeeded && atMeasuredEnd);

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
