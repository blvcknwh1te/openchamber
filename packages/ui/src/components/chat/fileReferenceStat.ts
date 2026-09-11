import { isVSCodeRuntime } from '@/lib/desktop';
import { runtimeFetch } from '@/lib/runtime-fetch';

import { normalizeReferencePath } from './fileReferenceParser';

const FILE_REFERENCE_STAT_CONCURRENCY = 4;
const FILE_REFERENCE_STAT_CACHE_MAX = 1000;
const VSCODE_FILE_REFERENCE_STAT_CACHE_MAX = 200;

export type FileReferenceStat = {
  exists: boolean;
  isDirectory: boolean;
};

const MISSING_FILE_REFERENCE_STAT: FileReferenceStat = { exists: false, isDirectory: false };

const FILE_REFERENCE_STAT_CACHE = new Map<string, Promise<FileReferenceStat>>();
let activeFileReferenceStatCount = 0;
const pendingFileReferenceStats: Array<() => void> = [];

const getFileReferenceStatCacheMax = (): number => (
  isVSCodeRuntime() ? VSCODE_FILE_REFERENCE_STAT_CACHE_MAX : FILE_REFERENCE_STAT_CACHE_MAX
);

// NUL cannot occur in a real path, so a directory-qualified key cannot collide
// with a differently scoped entry.
const statCacheKey = (directory: string, normalizedPath: string): string => `${directory}\u0000${normalizedPath}`;

// The stat routes resolve the workspace from this header. Without it the server
// falls back to the browsed lastDirectory, which rejects session-local paths
// with 400 whenever the two directories differ.
const directoryHeaders = (effectiveDirectory: string): HeadersInit | undefined => (
  effectiveDirectory ? { 'x-opencode-directory': effectiveDirectory } : undefined
);

const probeFileReferenceStat = async (normalizedPath: string, effectiveDirectory: string): Promise<FileReferenceStat> => {
  const requestPath = encodeURIComponent(normalizedPath);
  const headers = directoryHeaders(effectiveDirectory);

  const statResponse = await runtimeFetch(`/api/fs/stat?path=${requestPath}&optional=true`, {
    method: 'GET',
    cache: 'no-store',
    headers,
  });
  if (statResponse.ok) {
    // SAFETY: `/api/fs/stat` answers JSON with an optional `exists` flag; a
    // non-JSON body degrades to null and is treated as existing.
    const payload = await statResponse.json().catch(() => null) as { exists?: unknown } | null;
    return { exists: payload?.exists !== false, isDirectory: false };
  }

  // Directories answer 400 on `/api/fs/stat` in both web and VS Code, so a
  // rejected file probe falls back to the directory route before giving up.
  const directoryResponse = await runtimeFetch(`/api/fs/directory-stat?path=${requestPath}&optional=true`, {
    method: 'GET',
    cache: 'no-store',
    headers,
  });
  if (!directoryResponse.ok) {
    return MISSING_FILE_REFERENCE_STAT;
  }

  // SAFETY: `/api/fs/directory-stat` answers JSON with an optional
  // `isDirectory` flag; a non-JSON body degrades to null and counts as a file.
  const payload = await directoryResponse.json().catch(() => null) as { isDirectory?: unknown } | null;
  return { exists: true, isDirectory: payload?.isDirectory === true };
};

export const fileReferenceStat = (resolvedPath: string, effectiveDirectory: string): Promise<FileReferenceStat> => {
  const normalizedPath = normalizeReferencePath(resolvedPath);
  if (!normalizedPath) {
    return Promise.resolve(MISSING_FILE_REFERENCE_STAT);
  }

  const cacheKey = statCacheKey(effectiveDirectory, normalizedPath);
  const cached = FILE_REFERENCE_STAT_CACHE.get(cacheKey);
  if (cached) {
    FILE_REFERENCE_STAT_CACHE.delete(cacheKey);
    FILE_REFERENCE_STAT_CACHE.set(cacheKey, cached);
    return cached;
  }

  const request = new Promise<FileReferenceStat>((resolve) => {
    const run = () => {
      activeFileReferenceStatCount += 1;
      void probeFileReferenceStat(normalizedPath, effectiveDirectory)
        .then(resolve)
        .catch(() => resolve(MISSING_FILE_REFERENCE_STAT))
        .finally(() => {
          activeFileReferenceStatCount = Math.max(0, activeFileReferenceStatCount - 1);
          pendingFileReferenceStats.shift()?.();
        });
    };

    if (activeFileReferenceStatCount < FILE_REFERENCE_STAT_CONCURRENCY) {
      run();
      return;
    }

    pendingFileReferenceStats.push(run);
  });

  const maxCacheEntries = getFileReferenceStatCacheMax();
  while (FILE_REFERENCE_STAT_CACHE.size >= maxCacheEntries) {
    const oldest = FILE_REFERENCE_STAT_CACHE.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    FILE_REFERENCE_STAT_CACHE.delete(oldest);
  }
  FILE_REFERENCE_STAT_CACHE.set(cacheKey, request);
  return request;
};

export const fileReferenceExists = async (resolvedPath: string, effectiveDirectory: string): Promise<boolean> => {
  const { exists } = await fileReferenceStat(resolvedPath, effectiveDirectory);
  return exists;
};
