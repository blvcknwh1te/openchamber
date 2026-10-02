import { describe, expect, test } from 'bun:test';
import {
  applyCommandAutocompleteSourceResult,
  commandAutocompleteKindOf,
  createCommandAutocompleteReadiness,
  groupCommandAutocompleteItems,
  isCommandAutocompleteLoading,
  isCommandAutocompleteReady,
  loadCommandAutocompleteSources,
} from '../commandAutocompleteItems';
import type { CommandAutocompleteReadiness } from '../commandAutocompleteItems';

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Promise not initialized'); };
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve: (value: T) => resolve(value) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('groupCommandAutocompleteItems', () => {
  test('puts commands above skills and rules, and asks for section headers', () => {
    const grouped = groupCommandAutocompleteItems([
      { name: 'ship', isSkill: true },
      { name: 'review' },
      { name: 'explore', isSkill: true },
      { name: 'undo' },
      { name: 'assume-then-act', kind: 'rule' },
    ]);

    expect(grouped.sections).toBe(true);
    expect(grouped.items.map((item) => item.name)).toEqual([
      'review', 'undo', 'ship', 'explore', 'assume-then-act',
    ]);
  });

  test('keeps the original list when the query matched a single kind', () => {
    const items = [{ name: 'ship', isSkill: true }, { name: 'explore', isSkill: true }];
    const grouped = groupCommandAutocompleteItems(items);

    expect(grouped.sections).toBe(false);
    expect(grouped.items).toBe(items);
  });

  test('treats skills and rules as different kinds, not one non-command group', () => {
    const grouped = groupCommandAutocompleteItems([
      { name: 'ship', isSkill: true },
      { name: 'assume-then-act', kind: 'rule' },
    ]);

    expect(grouped.sections).toBe(true);
    expect(grouped.items.map((item) => item.name)).toEqual(['ship', 'assume-then-act']);
  });
});

describe('commandAutocompleteKindOf', () => {
  test('reads an explicit kind first and falls back to the legacy flag', () => {
    expect(commandAutocompleteKindOf({ name: 'a' })).toBe('command');
    expect(commandAutocompleteKindOf({ name: 'a', isSkill: true })).toBe('skill');
    expect(commandAutocompleteKindOf({ name: 'a', kind: 'rule' })).toBe('rule');
    // An explicit kind wins over the stale legacy flag on the same item.
    expect(commandAutocompleteKindOf({ name: 'a', kind: 'rule', isSkill: true })).toBe('rule');
  });
});

describe('loadCommandAutocompleteSources', () => {
  test('waits for all three sources instead of reporting whichever answered first', async () => {
    const commands = deferred<boolean>();
    const skills = deferred<boolean>();
    const rules = deferred<boolean>();
    let settled: CommandAutocompleteReadiness | null = null;

    const loading = loadCommandAutocompleteSources({
      loadCommands: () => commands.promise,
      loadSkills: () => skills.promise,
      loadRules: () => rules.promise,
    }).then((readiness) => {
      settled = readiness;
      return readiness;
    });

    skills.resolve(true);
    rules.resolve(true);
    await flush();
    expect(settled).toBeNull();

    commands.resolve(true);
    expect(await loading).toEqual({ commands: 'ready', skills: 'ready', rules: 'ready' });
  });

  test('starts every discovery pass before either one answers', async () => {
    const commands = deferred<boolean>();
    const skills = deferred<boolean>();
    const rules = deferred<boolean>();
    const calls: string[] = [];

    const loading = loadCommandAutocompleteSources({
      loadCommands: () => {
        calls.push('commands');
        return commands.promise;
      },
      loadSkills: () => {
        calls.push('skills');
        return skills.promise;
      },
      loadRules: () => {
        calls.push('rules');
        return rules.promise;
      },
    });

    expect(calls.sort()).toEqual(['commands', 'rules', 'skills']);

    commands.resolve(true);
    skills.resolve(true);
    rules.resolve(true);
    expect(await loading).toEqual({ commands: 'ready', skills: 'ready', rules: 'ready' });
  });

  test('re-requests a failed source once and leaves the healthy ones alone', async () => {
    let commandCalls = 0;
    let skillCalls = 0;
    let ruleCalls = 0;

    const readiness = await loadCommandAutocompleteSources({
      loadCommands: async () => {
        commandCalls += 1;
        return true;
      },
      loadSkills: async () => {
        skillCalls += 1;
        return skillCalls > 1;
      },
      loadRules: async () => {
        ruleCalls += 1;
        return true;
      },
    });

    expect(readiness).toEqual({ commands: 'ready', skills: 'ready', rules: 'ready' });
    expect(commandCalls).toBe(1);
    expect(skillCalls).toBe(2);
    expect(ruleCalls).toBe(1);
  });

  test('settles a source as failed when the re-request fails too', async () => {
    let skillCalls = 0;

    const readiness = await loadCommandAutocompleteSources({
      loadCommands: async () => true,
      loadSkills: async () => {
        skillCalls += 1;
        return false;
      },
      loadRules: async () => true,
    });

    expect(readiness).toEqual({ commands: 'ready', skills: 'failed', rules: 'ready' });
    expect(skillCalls).toBe(2);
  });
});

describe('palette source readiness', () => {
  test('is only ready once every source has answered', () => {
    const commandsAnswered = applyCommandAutocompleteSourceResult(
      createCommandAutocompleteReadiness(),
      'commands',
      true,
    );

    expect(isCommandAutocompleteReady(commandsAnswered)).toBe(false);
    const skillsAnswered = applyCommandAutocompleteSourceResult(commandsAnswered, 'skills', false);
    expect(isCommandAutocompleteReady(skillsAnswered)).toBe(false);
    expect(isCommandAutocompleteReady(applyCommandAutocompleteSourceResult(skillsAnswered, 'rules', true))).toBe(true);
  });

  test('shows progress only while the palette has nothing to show', () => {
    const pending = createCommandAutocompleteReadiness();
    expect(isCommandAutocompleteLoading(pending, 0)).toBe(true);
    expect(isCommandAutocompleteLoading(pending, 3)).toBe(false);

    const answered = applyCommandAutocompleteSourceResult(pending, 'commands', true);
    expect(isCommandAutocompleteLoading(answered, 0)).toBe(true);

    expect(isCommandAutocompleteLoading(applyCommandAutocompleteSourceResult(answered, 'skills', true), 0)).toBe(true);
    const settled = applyCommandAutocompleteSourceResult(
      applyCommandAutocompleteSourceResult(answered, 'skills', true),
      'rules',
      false,
    );
    expect(isCommandAutocompleteLoading(settled, 0)).toBe(false);
  });

  test('keeps the same object when an answer repeats', () => {
    const ready = applyCommandAutocompleteSourceResult(createCommandAutocompleteReadiness(), 'commands', true);
    expect(applyCommandAutocompleteSourceResult(ready, 'commands', true)).toBe(ready);

    const settled = applyCommandAutocompleteSourceResult(ready, 'skills', false);
    expect(applyCommandAutocompleteSourceResult(settled, 'skills', false)).toBe(settled);
  });
});
