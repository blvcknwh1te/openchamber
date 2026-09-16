import { describe, expect, test } from 'bun:test';

import {
    PROMPT_NAVIGATOR_MIN_TURNS,
    PROMPT_RAIL_MAX_VISIBLE_TICKS,
    resolveCenteredWindowStart,
    resolvePromptTickWindow,
    resolveVisibleTickCount,
    resolveWindowStartContaining,
    shouldShowPromptNavigator,
} from './promptNavigatorRail';

describe('shouldShowPromptNavigator', () => {
    // The VS Code webview is deliberately absent from this list: the rail is an
    // overlay, so narrow-width handling belongs to the rail's own hit-zone
    // measurement, not to a platform ban.
    test('shows on every non-mobile surface when the user has not switched it off', () => {
        expect(shouldShowPromptNavigator({
            isMobile: false,
            isDesktopExpandedInput: false,
            enabled: true,
            turnCount: 2,
        })).toBe(true);
    });

    test('needs at least two prompts to navigate', () => {
        const base = {
            isMobile: false,
            isDesktopExpandedInput: false,
            enabled: true,
        };
        expect(shouldShowPromptNavigator({ ...base, turnCount: 0 })).toBe(false);
        expect(shouldShowPromptNavigator({ ...base, turnCount: PROMPT_NAVIGATOR_MIN_TURNS - 1 })).toBe(false);
        expect(shouldShowPromptNavigator({ ...base, turnCount: PROMPT_NAVIGATOR_MIN_TURNS })).toBe(true);
    });

    test('hides on mobile, in expanded input, and when the setting is off', () => {
        const visible = {
            isMobile: false,
            isDesktopExpandedInput: false,
            enabled: true,
            turnCount: 5,
        };
        expect(shouldShowPromptNavigator({ ...visible, isMobile: true })).toBe(false);
        expect(shouldShowPromptNavigator({ ...visible, isDesktopExpandedInput: true })).toBe(false);
        expect(shouldShowPromptNavigator({ ...visible, enabled: false })).toBe(false);
    });
});

describe('resolvePromptTickWindow', () => {
    test('keeps a short prompt list fully visible', () => {
        expect(resolvePromptTickWindow(5, 0)).toEqual({
            visibleCount: 5,
            windowStart: 0,
            windowEnd: 5,
            maxWindowStart: 0,
            hasMoreAbove: false,
            hasMoreBelow: false,
        });
    });

    test('carousels only once the list exceeds the tick budget', () => {
        const window = resolvePromptTickWindow(PROMPT_RAIL_MAX_VISIBLE_TICKS + 10, 0);
        expect(window.visibleCount).toBe(PROMPT_RAIL_MAX_VISIBLE_TICKS);
        expect(window.maxWindowStart).toBe(10);
        expect(window.windowEnd).toBe(PROMPT_RAIL_MAX_VISIBLE_TICKS);
        expect(window.hasMoreAbove).toBe(false);
        expect(window.hasMoreBelow).toBe(true);
    });

    test('clamps a requested start into range', () => {
        expect(resolvePromptTickWindow(5, 99).windowStart).toBe(0);
        expect(resolvePromptTickWindow(40, 99).windowStart).toBe(10);
        expect(resolvePromptTickWindow(40, -3).windowStart).toBe(0);
    });

    test('reports an empty list as an empty window', () => {
        const window = resolvePromptTickWindow(0, 0);
        expect(window.visibleCount).toBe(0);
        expect(window.hasMoreAbove).toBe(false);
        expect(window.hasMoreBelow).toBe(false);
    });
});

describe('resolveVisibleTickCount', () => {
    test('caps the count at the tick budget', () => {
        expect(resolveVisibleTickCount(10)).toBe(10);
        expect(resolveVisibleTickCount(1_000)).toBe(PROMPT_RAIL_MAX_VISIBLE_TICKS);
    });
});

describe('resolveWindowStartContaining', () => {
    test('leaves the window alone while the index is already visible', () => {
        expect(resolveWindowStartContaining(5, 20, 40)).toBe(5);
    });

    test('moves the window up just enough for an index above it', () => {
        expect(resolveWindowStartContaining(10, 3, 40)).toBe(3);
    });

    test('moves the window down just enough for an index below it', () => {
        expect(resolveWindowStartContaining(0, 39, 40)).toBe(10);
    });

    test('returns to the first window for the first prompt', () => {
        expect(resolveWindowStartContaining(10, 0, 40)).toBe(0);
    });
});

describe('resolveCenteredWindowStart', () => {
    test('centers a middle prompt in the tape', () => {
        expect(resolveCenteredWindowStart(20, 40)).toBe(5);
    });

    test('clamps centering at both ends', () => {
        expect(resolveCenteredWindowStart(0, 40)).toBe(0);
        expect(resolveCenteredWindowStart(39, 40)).toBe(10);
    });

    test('shows a short list from the start', () => {
        expect(resolveCenteredWindowStart(2, 5)).toBe(0);
    });
});
