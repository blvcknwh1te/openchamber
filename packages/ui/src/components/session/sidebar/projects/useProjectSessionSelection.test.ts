import { describe, expect, test } from 'bun:test';
import { resolveMissingProjectSessionSelection } from './useProjectSessionSelection';

type Entry = { directory: string | null };

const projectA = new Map<string, Entry>([['session-a', { directory: '/a' }]]);
const projectB = new Map<string, Entry>([['session-b', { directory: '/b' }]]);
const metaByProject = new Map<string, Map<string, Entry>>([
  ['project-a', projectA],
  ['project-b', projectB],
]);

const baseArgs = {
  activeProjectId: 'project-a',
  projectMap: projectA,
  metaByProject,
  rememberedSessionId: 'session-a',
  fallbackSessionId: null,
} as const;

describe('resolveMissingProjectSessionSelection runtime gate', () => {
  test('VS Code preserves the list when the open session belongs to another project', () => {
    expect(resolveMissingProjectSessionSelection({
      ...baseArgs,
      currentSessionId: 'session-b',
      currentSessionOwnerProjectId: 'project-b',
      isVSCodeRuntime: true,
    })).toEqual({ kind: 'preserve-current' });
  });

  test('web keeps substituting the remembered session of the active project', () => {
    expect(resolveMissingProjectSessionSelection({
      ...baseArgs,
      currentSessionId: 'session-b',
      currentSessionOwnerProjectId: 'project-b',
      isVSCodeRuntime: false,
    })).toEqual({ kind: 'select-session', sessionId: 'session-a' });
  });

  test('VS Code preserves the list when the foreign session is rendered but ownership is unknown', () => {
    expect(resolveMissingProjectSessionSelection({
      ...baseArgs,
      currentSessionId: 'session-b',
      currentSessionOwnerProjectId: null,
      isVSCodeRuntime: true,
    })).toEqual({ kind: 'preserve-current' });
  });

  test('web still substitutes when a foreign session is rendered but ownership is unknown', () => {
    expect(resolveMissingProjectSessionSelection({
      ...baseArgs,
      currentSessionId: 'session-b',
      currentSessionOwnerProjectId: null,
      isVSCodeRuntime: false,
    })).toEqual({ kind: 'select-session', sessionId: 'session-a' });
  });

  test('an open session owned by the active project is always preserved', () => {
    expect(resolveMissingProjectSessionSelection({
      ...baseArgs,
      currentSessionId: 'session-a',
      currentSessionOwnerProjectId: 'project-a',
      isVSCodeRuntime: true,
    })).toEqual({ kind: 'preserve-current' });
  });

  test('VS Code preserves a session that is missing from every rendered map', () => {
    expect(resolveMissingProjectSessionSelection({
      ...baseArgs,
      currentSessionId: 'session-unknown',
      currentSessionOwnerProjectId: null,
      isVSCodeRuntime: true,
    })).toEqual({ kind: 'preserve-current' });
  });
});
