import { describe, expect, test } from 'bun:test';
import {
  applyCommandAutocompleteSourceResult,
  createCommandAutocompleteReadiness,
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

describe('loadCommandAutocompleteSources', () => {
  test('waits for both sources instead of reporting whichever answered first', async () => {
    const commands = deferred<boolean>();
    const skills = deferred<boolean>();
    let settled: CommandAutocompleteReadiness | null = null;

    const loading = loadCommandAutocompleteSources({
      loadCommands: () => commands.promise,
      loadSkills: () => skills.promise,
    }).then((readiness) => {
      settled = readiness;
      return readiness;
    });

    skills.resolve(true);
    await flush();
    expect(settled).toBeNull();

    commands.resolve(true);
    expect(await loading).toEqual({ commands: 'ready', skills: 'ready' });
  });

  test('starts both discovery passes before either one answers', async () => {
    const commands = deferred<boolean>();
    const skills = deferred<boolean>();
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
    });

    expect(calls.sort()).toEqual(['commands', 'skills']);

    commands.resolve(true);
    skills.resolve(true);
    expect(await loading).toEqual({ commands: 'ready', skills: 'ready' });
  });

  test('re-requests a failed source once and leaves the healthy one alone', async () => {
    let commandCalls = 0;
    let skillCalls = 0;

    const readiness = await loadCommandAutocompleteSources({
      loadCommands: async () => {
        commandCalls += 1;
        return true;
      },
      loadSkills: async () => {
        skillCalls += 1;
        return skillCalls > 1;
      },
    });

    expect(readiness).toEqual({ commands: 'ready', skills: 'ready' });
    expect(commandCalls).toBe(1);
    expect(skillCalls).toBe(2);
  });

  test('settles a source as failed when the re-request fails too', async () => {
    let skillCalls = 0;

    const readiness = await loadCommandAutocompleteSources({
      loadCommands: async () => true,
      loadSkills: async () => {
        skillCalls += 1;
        return false;
      },
    });

    expect(readiness).toEqual({ commands: 'ready', skills: 'failed' });
    expect(skillCalls).toBe(2);
  });
});

describe('palette source readiness', () => {
  test('is only ready once both sources have answered', () => {
    const commandsAnswered = applyCommandAutocompleteSourceResult(
      createCommandAutocompleteReadiness(),
      'commands',
      true,
    );

    expect(isCommandAutocompleteReady(commandsAnswered)).toBe(false);
    expect(isCommandAutocompleteReady(applyCommandAutocompleteSourceResult(commandsAnswered, 'skills', false))).toBe(true);
  });

  test('shows progress only while the palette has nothing to show', () => {
    const pending = createCommandAutocompleteReadiness();
    expect(isCommandAutocompleteLoading(pending, 0)).toBe(true);
    expect(isCommandAutocompleteLoading(pending, 3)).toBe(false);

    const answered = applyCommandAutocompleteSourceResult(pending, 'commands', true);
    expect(isCommandAutocompleteLoading(answered, 0)).toBe(true);

    expect(isCommandAutocompleteLoading(applyCommandAutocompleteSourceResult(answered, 'skills', true), 0)).toBe(false);
    expect(isCommandAutocompleteLoading(applyCommandAutocompleteSourceResult(answered, 'skills', false), 0)).toBe(false);
  });

  test('keeps the same object when an answer repeats', () => {
    const ready = applyCommandAutocompleteSourceResult(createCommandAutocompleteReadiness(), 'commands', true);
    expect(applyCommandAutocompleteSourceResult(ready, 'commands', true)).toBe(ready);

    const settled = applyCommandAutocompleteSourceResult(ready, 'skills', false);
    expect(applyCommandAutocompleteSourceResult(settled, 'skills', false)).toBe(settled);
  });
});
