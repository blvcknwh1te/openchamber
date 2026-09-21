import { describe, expect, test } from 'bun:test';

import { formatToolReadRange, getToolReadRange } from './toolReadRange';

describe('read tool line range', () => {
    test('derives the covered range from offset and limit', () => {
        const range = getToolReadRange({ input: { offset: 12, limit: 30 } });

        expect(range).toEqual({ offset: 12, limit: 30 });
        expect(formatToolReadRange(range)).toBe('[12-41]');
    });

    test('keeps the range open when only the offset is known', () => {
        const range = getToolReadRange({ input: { offset: 12 } });

        expect(formatToolReadRange(range)).toBe('[12-]');
    });

    test('starts at the first line when only the limit is known', () => {
        const range = getToolReadRange({ input: { limit: 30 } });

        expect(formatToolReadRange(range)).toBe('[1-30]');
    });

    test('falls back to call metadata', () => {
        const range = getToolReadRange({ metadata: { offset: 5, limit: 10 } });

        expect(formatToolReadRange(range)).toBe('[5-14]');
    });

    test('returns nothing when the whole file was read', () => {
        expect(formatToolReadRange(getToolReadRange({ input: { filePath: 'src/app.ts' } }))).toBe(null);
        expect(formatToolReadRange(getToolReadRange(undefined))).toBe(null);
    });

    test('ignores invalid values', () => {
        const range = getToolReadRange({ input: { offset: 0, limit: -3 } });

        expect(range).toEqual({ offset: undefined, limit: undefined });
        expect(formatToolReadRange(range)).toBe(null);
    });
});
