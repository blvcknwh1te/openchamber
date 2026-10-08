// The project's own rules, discovered next to the config's entries.
//
// A project states its rules the way the user does: markdown files in a rules
// directory, `.agents/rules` at the project root. The picker has to reach them
// through the same path it uses for `instructions` entries, so these tests pin
// down the three decisions that path makes: the entry becomes absolute against
// the project, the listing is filtered by the glob, and the resulting rules are
// marked as the project's rather than the user's.
import { describe, expect, test } from 'bun:test';

import { resolveProjectRuleFiles, ruleScopeForPath, toRuleSourceEntry } from './resolveRules';

const PROJECT = '/home/tester/work/app';

const listing = (paths: readonly string[]) =>
    paths.map((path) => ({ name: path.slice(path.lastIndexOf('/') + 1), path, isFile: true }));

describe('a relative instructions entry', () => {
    test('is resolved against the project directory, because the server may run elsewhere', () => {
        expect(toRuleSourceEntry('.agents/rules/*.md', PROJECT)).toBe(`${PROJECT}/.agents/rules/*.md`);
        expect(toRuleSourceEntry('rules/style.md', PROJECT)).toBe(`${PROJECT}/rules/style.md`);
    });

    test('an absolute entry is left alone and an empty one stays empty', () => {
        expect(toRuleSourceEntry('/etc/opencode/rules/*.md', PROJECT)).toBe('/etc/opencode/rules/*.md');
        expect(toRuleSourceEntry('  ', PROJECT)).toBe('');
    });

    test('a `~` entry stays the user\'s own, so the project cannot claim it', () => {
        expect(toRuleSourceEntry('~/.config/opencode/rules/*.md', PROJECT)).toBe('~/.config/opencode/rules/*.md');
    });
});

describe('the project rules directory', () => {
    test('yields one entry per markdown file, marked as the project scope', async () => {
        const rules = await resolveProjectRuleFiles(PROJECT, async (path) => {
            expect(path).toBe(`${PROJECT}/.agents/rules`);
            return listing([
                `${PROJECT}/.agents/rules/ui-styles.md`,
                `${PROJECT}/.agents/rules/specs.md`,
                `${PROJECT}/.agents/rules/notes.txt`,
            ]);
        });

        expect(rules).toEqual([
            { name: 'ui-styles', path: `${PROJECT}/.agents/rules/ui-styles.md`, scope: 'project' },
            { name: 'specs', path: `${PROJECT}/.agents/rules/specs.md`, scope: 'project' },
        ]);
    });

    test('a project without that directory is not an error, it simply has no rules', async () => {
        const rules = await resolveProjectRuleFiles(PROJECT, async () => {
            throw new Error('ENOENT');
        });

        expect(rules).toEqual([]);
    });

    test('without a project directory there is nothing to resolve', async () => {
        let listed = false;
        const rules = await resolveProjectRuleFiles(null, async () => {
            listed = true;
            return [];
        });

        expect(rules).toEqual([]);
        expect(listed).toBe(false);
    });
});

describe('the scope a rule is shown under', () => {
    test('a file inside the project is the project\'s, one outside it is the user\'s', () => {
        expect(ruleScopeForPath(`${PROJECT}/.agents/rules/ui-styles.md`, PROJECT)).toBe('project');
        expect(ruleScopeForPath(`${PROJECT}/nested/deep/rule.md`, PROJECT)).toBe('project');
        expect(ruleScopeForPath('/home/tester/.config/opencode/rules/assume-then-act.md', PROJECT)).toBe('user');
        expect(ruleScopeForPath(`${PROJECT}/.agents/rules/ui-styles.md`, null)).toBe('user');
    });
});
