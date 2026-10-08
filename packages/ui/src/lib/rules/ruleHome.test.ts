// `~` in an `instructions` entry has to expand against the user's home, not
// against the folder the UI is rooted in. In the VS Code runtime those two are
// different things, and using the rooted folder silently resolved every `~`
// rule to a non-existent path.
import { describe, expect, test } from 'bun:test';

import { resolveRuleHome } from './ruleHome';

const USER_HOME = '/home/tester';
const WORKSPACE = '/projects/app';

describe('resolveRuleHome', () => {
    test('prefers the home the host states, which is not the rooted folder', () => {
        expect(resolveRuleHome(USER_HOME, WORKSPACE)).toBe(USER_HOME);
    });

    test('falls back to the store home when the host states none', () => {
        expect(resolveRuleHome(undefined, USER_HOME)).toBe(USER_HOME);
        expect(resolveRuleHome('', USER_HOME)).toBe(USER_HOME);
        expect(resolveRuleHome('   ', USER_HOME)).toBe(USER_HOME);
    });

    test('reports no home rather than an empty string, so callers keep their own guard', () => {
        expect(resolveRuleHome(undefined, null)).toBeNull();
        expect(resolveRuleHome('', '')).toBeNull();
        expect(resolveRuleHome(undefined, undefined)).toBeNull();
    });
});
