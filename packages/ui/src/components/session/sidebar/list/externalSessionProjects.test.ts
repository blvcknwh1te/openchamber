import { describe, expect, test } from 'bun:test';
import type { Project } from '@opencode-ai/sdk/v2';
import {
  buildSessionDirectoryKeys,
  mergeSessionProjects,
  resolveSessionProjects,
  selectExternalSessionProjects,
  sessionProjectDirectoryKey,
  type SessionProjectDisplayEntry,
} from './externalSessionProjects';

const globalProject = (worktree: string, id = `db-${worktree}`): Project => ({
  id,
  worktree,
  sandboxes: [],
  time: { created: 1, updated: 1 },
});

describe('sessionProjectDirectoryKey', () => {
  test('normalizes separators, drive letter, and case', () => {
    expect(sessionProjectDirectoryKey('C:\\Work\\Repo\\')).toBe('c:/work/repo');
    expect(sessionProjectDirectoryKey('/home/user/repo')).toBe('/home/user/repo');
    expect(sessionProjectDirectoryKey(null)).toBeNull();
  });
});

describe('buildSessionDirectoryKeys', () => {
  test('reads the session directory and falls back to its project worktree', () => {
    const keys = buildSessionDirectoryKeys([
      { directory: '/Home/User/Repo' },
      { directory: null, project: { worktree: '/other/Repo' } },
      { directory: null, project: null },
    ]);

    expect([...keys].sort()).toEqual(['/home/user/repo', '/other/repo']);
  });
});

describe('selectExternalSessionProjects', () => {
  test('adds database projects that own sessions and are not registered', () => {
    const result = selectExternalSessionProjects(
      [{ path: '/workspace/main' }],
      [globalProject('/workspace/main'), globalProject('/workspace/second')],
      new Set(['/workspace/main', '/workspace/second']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      path: '/workspace/second',
      label: 'second',
      external: true,
    });
    expect(result[0]?.id.startsWith('path_')).toBe(true);
  });

  test('skips registered projects and projects without sessions', () => {
    const result = selectExternalSessionProjects(
      [{ path: '/workspace/registered' }],
      [globalProject('/workspace/registered'), globalProject('/workspace/empty')],
      // Only the registered directory owns sessions; `/workspace/empty` has none.
      new Set(['/workspace/registered']),
    );

    expect(result).toEqual([]);
  });

  test('deduplicates database rows for the same directory and sorts by path', () => {
    const result = selectExternalSessionProjects(
      [],
      [globalProject('/b', 'row-1'), globalProject('/a', 'row-2'), globalProject('/b', 'row-3')],
      new Set(['/a', '/b']),
    );

    expect(result.map((project) => project.path)).toEqual(['/a', '/b']);
  });

  test('keeps a drive root label as the full path', () => {
    const result = selectExternalSessionProjects([], [globalProject('C:\\')], new Set(['c:']));

    expect(result[0]?.label).toBe('C:');
  });
});

describe('mergeSessionProjects', () => {
  test('keeps the registry order and appends discovered projects', () => {
    const registered = [{ id: 'r1', path: '/registered' }];
    const external = [{ id: 'e1', path: '/external', external: true as const }];

    expect(mergeSessionProjects(registered, external)).toEqual([...registered, ...external]);
  });
});

describe('resolveSessionProjects', () => {
  const registry: SessionProjectDisplayEntry[] = [{ id: 'registered', path: '/ws/main' }];

  test('returns the registry identity when discovery is disabled', () => {
    const result = resolveSessionProjects(
      registry,
      [globalProject('/other/repo')],
      new Set(['/other/repo']),
      false,
    );

    expect(result).toBe(registry);
  });

  test('returns the registry identity when nothing was discovered', () => {
    expect(resolveSessionProjects(registry, [], new Set(), true)).toBe(registry);
    expect(resolveSessionProjects(registry, [globalProject('/other/repo')], new Set(['/ws/main']), true)).toBe(registry);
  });

  test('appends a discovered project that owns sessions', () => {
    const result = resolveSessionProjects(
      registry,
      [globalProject('/ws/main', 'db-main'), globalProject('/other/repo', 'db-other')],
      new Set(['/other/repo']),
      true,
    );

    expect(result.map((project) => project.path)).toEqual(['/ws/main', '/other/repo']);
    expect(result[1]?.external).toBe(true);
  });
});
