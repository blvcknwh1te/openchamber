// What the picker ends up with after a rules load.
//
// Rules come from two places at once: the config's `instructions` entries and
// the project's own `.agents/rules` directory. Both are discovered in one pass
// and land in one list, so a rule the reader can see is a rule the agent is
// told about; this file pins down that the project's rules arrive without a
// config line naming them, and that they are marked as the project's.
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const PROJECT = '/home/tester/work/app';
const USER_RULES = '/home/tester/.config/opencode/rules';
const PROJECT_RULES = `${PROJECT}/.agents/rules`;

const listCalls: string[] = [];
const projectRuleNames = ['ui-styles'];

const entriesFor = (path: string) => {
    if (path === USER_RULES) {
        return [
            { name: 'assume-then-act.md', path: `${USER_RULES}/assume-then-act.md`, isFile: true },
            { name: 'readme.txt', path: `${USER_RULES}/readme.txt`, isFile: true },
        ];
    }
    if (path === PROJECT_RULES) {
        return projectRuleNames.map((name) => ({
            name: `${name}.md`,
            path: `${PROJECT_RULES}/${name}.md`,
            isFile: true,
        }));
    }
    throw new Error(`unexpected listing: ${path}`);
};

mock.module('@/lib/opencode/client', () => ({
    opencodeClient: {
        getConfig: mock(async () => ({ instructions: ['~/.config/opencode/rules/*.md'] })),
        getDirectory: mock(() => PROJECT),
        listLocalDirectory: mock(async (path: string) => {
            listCalls.push(path);
            return entriesFor(path);
        }),
    },
}));

mock.module('@/lib/configSync', () => ({
    emitConfigChange: mock(() => undefined),
    scopeMatches: mock(() => false),
    subscribeToConfigChanges: mock(() => () => undefined),
}));

mock.module('./useDirectoryStore', () => ({
    useDirectoryStore: {
        getState: () => ({ homeDirectory: '/home/tester' }),
    },
}));

const { useRulesStore } = await import(`./useRulesStore?project-test=${Date.now()}`);

describe('a rules load', () => {
    beforeEach(() => {
        listCalls.length = 0;
        useRulesStore.getState().resetForRuntimeSwitch();
    });

    test('lists the config directory and the project rules directory', async () => {
        await useRulesStore.getState().loadRules(PROJECT);

        expect(listCalls).toEqual([USER_RULES, PROJECT_RULES]);
    });

    test('shows the project\'s rules even though no config entry names them', async () => {
        await useRulesStore.getState().loadRules(PROJECT);

        const rules = useRulesStore.getState().rules;
        expect(rules.map((rule: { name: string; scope: string }) => [rule.name, rule.scope])).toEqual([
            ['assume-then-act', 'user'],
            ['ui-styles', 'project'],
        ]);
    });

    test('a project without that directory still shows the user\'s rules', async () => {
        projectRuleNames.length = 0;
        await useRulesStore.getState().loadRules(PROJECT);

        expect(useRulesStore.getState().rules.map((rule: { name: string }) => rule.name)).toEqual(['assume-then-act']);
    });
});
