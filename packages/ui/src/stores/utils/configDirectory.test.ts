import { beforeEach, describe, expect, mock, test } from 'bun:test';

let clientDirectory: string | undefined;
let activeProjectPath: string | null;

mock.module('@/lib/opencode/client', () => ({
  opencodeClient: {
    getDirectory: () => clientDirectory,
  },
}));

mock.module('@/stores/useProjectsStore', () => ({
  useProjectsStore: {
    getState: () => ({
      getActiveProject: () => (activeProjectPath ? { path: activeProjectPath } : undefined),
    }),
  },
}));

const { resolveAmbientConfigDirectory } = await import('./configDirectory');

describe('resolveAmbientConfigDirectory', () => {
  beforeEach(() => {
    clientDirectory = undefined;
    activeProjectPath = null;
  });

  test('prefers the client session directory over the active project', () => {
    clientDirectory = '/workspace/session-project';
    activeProjectPath = '/workspace/active-project';

    expect(resolveAmbientConfigDirectory()).toBe('/workspace/session-project');
  });

  test('falls back to the active project when the client has no directory', () => {
    clientDirectory = undefined;
    activeProjectPath = '/workspace/active-project';

    expect(resolveAmbientConfigDirectory()).toBe('/workspace/active-project');
  });

  test('returns null when neither the client nor the active project has a directory', () => {
    clientDirectory = undefined;
    activeProjectPath = null;

    expect(resolveAmbientConfigDirectory()).toBeNull();
  });
});
