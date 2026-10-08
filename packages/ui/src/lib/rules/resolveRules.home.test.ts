// What an `instructions` entry resolves to when the runtime has not told the UI
// where the user's home is.
//
// Rules reach the composer's picker through exactly one path: the config's
// `instructions` entries are turned into a directory to list, the listing is
// filtered by the entry's glob, and the files become picker entries. Every step
// after the first depends on a `~` entry having been expanded, so this file
// pins down what an unexpanded entry produces.
import { describe, expect, test } from 'bun:test';

import { expandHomePath } from '@/lib/path-utils';
import { expandEntryPattern, resolveEntryDirectory, selectEntryFiles } from './resolveRules';

const ENTRY = '~/.config/opencode/rules/*.md';
const HOME = '/home/tester';

describe('an instructions entry without a known home', () => {
    test('stays unexpanded, so the directory handed to the filesystem is not a real path', () => {
        expect(expandHomePath(ENTRY, null)).toBe(ENTRY);
        expect(resolveEntryDirectory(ENTRY, null)).toBe('~/.config/opencode/rules');
        expect(expandEntryPattern(ENTRY, null)).toBe(ENTRY);
    });

    test('the glob filter is unaffected, so only the listing decides whether any rule appears', () => {
        // Measured, not assumed: the extension filter never compares the whole
        // path, so an unexpanded `~` still matches. The expansion only matters
        // one step earlier, for the directory that gets listed.
        const listing = [
            { name: 'style.md', path: '/home/tester/.config/opencode/rules/style.md', isFile: true },
            { name: 'notes.txt', path: '/home/tester/.config/opencode/rules/notes.txt', isFile: true },
        ];
        expect(selectEntryFiles(expandEntryPattern(ENTRY, null), listing).map((entry) => entry.name)).toEqual(['style.md']);
    });
});

describe('the same entry with a known home', () => {
    test('resolves to a listable directory and keeps only the files the glob names', () => {
        expect(resolveEntryDirectory(ENTRY, HOME)).toBe(`${HOME}/.config/opencode/rules`);

        const listing = [
            { name: 'style.md', path: `${HOME}/.config/opencode/rules/style.md`, isFile: true },
            { name: 'notes.txt', path: `${HOME}/.config/opencode/rules/notes.txt`, isFile: true },
            { name: 'nested', path: `${HOME}/.config/opencode/rules/nested`, isFile: false },
        ];
        expect(selectEntryFiles(expandEntryPattern(ENTRY, HOME), listing).map((entry) => entry.path)).toEqual([
            `${HOME}/.config/opencode/rules/style.md`,
        ]);
    });
});
