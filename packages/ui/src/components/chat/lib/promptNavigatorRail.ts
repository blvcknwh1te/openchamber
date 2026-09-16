/**
 * Rail availability and tick-window math, kept out of the component so the
 * surface rules and the window arithmetic are unit-testable.
 */

/** Below this many prompts the rail has nothing to navigate and stays hidden. */
export const PROMPT_NAVIGATOR_MIN_TURNS = 2;

type PromptNavigatorVisibilityInput = {
    isMobile: boolean;
    isDesktopExpandedInput: boolean;
    enabled: boolean;
    turnCount: number;
};

/**
 * The rail is an overlay: it takes no layout space from the transcript, and it
 * narrows its own hit zone when the message column reaches under the gutter. So
 * availability is a question of form factor and user preference, never of host
 * platform - a platform check here silently removed the rail from a surface
 * that could show it.
 */
export const shouldShowPromptNavigator = ({
    isMobile,
    isDesktopExpandedInput,
    enabled,
    turnCount,
}: PromptNavigatorVisibilityInput): boolean => !isMobile
    && !isDesktopExpandedInput
    && enabled
    && turnCount >= PROMPT_NAVIGATOR_MIN_TURNS;

/** The rail shows at most a window of ticks; hovering the gutter edges carousels the window through the rest of the prompts. */
export const PROMPT_RAIL_MAX_VISIBLE_TICKS = 30;

export const resolveVisibleTickCount = (promptCount: number): number =>
    Math.min(promptCount, PROMPT_RAIL_MAX_VISIBLE_TICKS);

type PromptTickWindow = {
    /** Ticks visible at once for the current prompt count. */
    visibleCount: number;
    /** First visible tick index, clamped into range. */
    windowStart: number;
    /** One past the last visible tick index. */
    windowEnd: number;
    /** Largest start that still shows a full window. */
    maxWindowStart: number;
    hasMoreAbove: boolean;
    hasMoreBelow: boolean;
};

export const resolvePromptTickWindow = (promptCount: number, requestedStart: number): PromptTickWindow => {
    const visibleCount = resolveVisibleTickCount(promptCount);
    const maxWindowStart = Math.max(0, promptCount - visibleCount);
    const windowStart = Math.max(0, Math.min(requestedStart, maxWindowStart));
    const windowEnd = windowStart + visibleCount;
    return {
        visibleCount,
        windowStart,
        windowEnd,
        maxWindowStart,
        hasMoreAbove: windowStart > 0,
        hasMoreBelow: windowEnd < promptCount,
    };
};

/**
 * Window start that keeps `index` inside the visible window while moving it as
 * little as possible, so stepping one tick glides the tape instead of jumping
 * to an edge.
 */
export const resolveWindowStartContaining = (
    requestedStart: number,
    index: number,
    promptCount: number,
): number => {
    const { visibleCount, windowStart, maxWindowStart } = resolvePromptTickWindow(promptCount, requestedStart);
    if (index < windowStart) {
        return Math.max(0, Math.min(maxWindowStart, index));
    }
    if (index >= windowStart + visibleCount) {
        return Math.max(0, Math.min(maxWindowStart, index - visibleCount + 1));
    }
    return windowStart;
};

/** Window start that puts `index` in the middle of the tape, clamped to range. */
export const resolveCenteredWindowStart = (index: number, promptCount: number): number => {
    const { visibleCount } = resolvePromptTickWindow(promptCount, 0);
    return resolvePromptTickWindow(promptCount, index - Math.floor(visibleCount / 2)).windowStart;
};
