import { describe, expect, test } from 'bun:test';

import type { ProjectFileSearchHit } from '@/lib/opencode/client';

import { FILE_REFERENCE_LOOKUP_LIMIT, lookupWorkspaceFileReference, type FileReferenceSearcher } from './fileReferenceLookup';

const WORKSPACE = 'D:\\Temp\\Work\\fork';

const hit = (relativePath: string): ProjectFileSearchHit => ({
  name: relativePath.split('/').pop() ?? relativePath,
  path: `${WORKSPACE}\\${relativePath.replace(/\//g, '\\')}`,
  relativePath,
});

type SearchCall = { directory: string; query: string; limit: number; type?: 'file' | 'directory' };

const createSearcher = (hits: ProjectFileSearchHit[]) => {
  const calls: SearchCall[] = [];
  const searchFiles: FileReferenceSearcher = async (directory, query, limit, options) => {
    calls.push({ directory, query, limit, type: options?.type });
    return hits;
  };
  return { searchFiles, calls };
};

const failingSearcher: FileReferenceSearcher = async () => {
  throw new Error('file search unavailable');
};

describe('lookupWorkspaceFileReference', () => {
  test('finds a reference written from the repository root inside the opened folder', async () => {
    const { searchFiles } = createSearcher([hit('openchamber-src/packages/ui/src/app.tsx')]);

    const resolved = await lookupWorkspaceFileReference(
      `${WORKSPACE}\\packages\\ui\\src\\app.tsx`,
      WORKSPACE,
      searchFiles,
    );

    expect(resolved).toBe(`${WORKSPACE}\\openchamber-src\\packages\\ui\\src\\app.tsx`);
  });

  test('rejects a hit that only shares the basename of a longer reference', async () => {
    const { searchFiles } = createSearcher([hit('vendor/app.tsx')]);

    const resolved = await lookupWorkspaceFileReference(
      `${WORKSPACE}\\packages\\ui\\src\\app.tsx`,
      WORKSPACE,
      searchFiles,
    );

    expect(resolved).toBeNull();
  });

  test('leaves the reference alone when two files repeat the same segments', async () => {
    const { searchFiles } = createSearcher([
      hit('first/packages/ui/src/app.tsx'),
      hit('second/packages/ui/src/app.tsx'),
    ]);

    const resolved = await lookupWorkspaceFileReference(
      `${WORKSPACE}\\packages\\ui\\src\\app.tsx`,
      WORKSPACE,
      searchFiles,
    );

    expect(resolved).toBeNull();
  });

  test('matches a reference outside the workspace by its own segments', async () => {
    const { searchFiles } = createSearcher([hit('skills/grill-with-docs/SKILL.md')]);

    const resolved = await lookupWorkspaceFileReference(
      `${WORKSPACE}\\skills\\grill-with-docs\\SKILL.md`,
      WORKSPACE,
      searchFiles,
    );

    expect(resolved).toBe(`${WORKSPACE}\\skills\\grill-with-docs\\SKILL.md`);
  });

  test('searches the basename of the reference inside the active directory', async () => {
    const { searchFiles, calls } = createSearcher([]);

    await lookupWorkspaceFileReference(`${WORKSPACE}\\packages\\ui\\src\\app.tsx`, `  ${WORKSPACE}  `, searchFiles);

    expect(calls).toEqual([
      { directory: WORKSPACE, query: 'app.tsx', limit: FILE_REFERENCE_LOOKUP_LIMIT, type: 'file' },
    ]);
  });

  test('finds a reference written from the repository root of an opened subfolder', async () => {
    const subfolder = `${WORKSPACE}\\packages\\ui`;
    const { searchFiles, calls } = createSearcher([hit('src/app.tsx')]);

    const resolved = await lookupWorkspaceFileReference(`${subfolder}\\src\\app.tsx`, subfolder, searchFiles);

    expect(resolved).toBe(`${WORKSPACE}\\src\\app.tsx`);
    expect(calls).toEqual([
      { directory: subfolder, query: 'app.tsx', limit: FILE_REFERENCE_LOOKUP_LIMIT, type: 'file' },
    ]);
  });

  test('does not accept a hit that keeps only the file name of a longer reference', async () => {
    const { searchFiles } = createSearcher([hit('app.tsx')]);

    const resolved = await lookupWorkspaceFileReference(
      `${WORKSPACE}\\packages\\ui\\src\\app.tsx`,
      WORKSPACE,
      searchFiles,
    );

    expect(resolved).toBeNull();
  });

  test('asks for directories when the reference has no extension', async () => {
    const { searchFiles, calls } = createSearcher([hit('packages/ui/src/lib/i18n/messages\\')]);

    const resolved = await lookupWorkspaceFileReference(
      `${WORKSPACE}\\packages\\ui\\src\\lib\\i18n\\messages`,
      WORKSPACE,
      searchFiles,
    );

    expect(resolved).toBe(`${WORKSPACE}\\packages\\ui\\src\\lib\\i18n\\messages\\`);
    expect(calls).toEqual([
      { directory: WORKSPACE, query: 'messages', limit: FILE_REFERENCE_LOOKUP_LIMIT, type: 'directory' },
    ]);
  });

  test('reports unknown when the search fails', async () => {
    const resolved = await lookupWorkspaceFileReference(
      `${WORKSPACE}\\packages\\ui\\src\\app.tsx`,
      WORKSPACE,
      failingSearcher,
    );

    expect(resolved).toBeNull();
  });

  test('does not search without an active directory', async () => {
    const { searchFiles, calls } = createSearcher([hit('packages/ui/src/app.tsx')]);

    const resolved = await lookupWorkspaceFileReference(`${WORKSPACE}\\packages\\ui\\src\\app.tsx`, '   ', searchFiles);

    expect(resolved).toBeNull();
    expect(calls).toEqual([]);
  });
});
