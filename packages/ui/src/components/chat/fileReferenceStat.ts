import { isVSCodeRuntime } from '@/lib/desktop';
import { runtimeFetch } from '@/lib/runtime-fetch';

import { normalizeReferencePath } from './fileReferenceParser';

const FILE_REFERENCE_STAT_CONCURRENCY = 4;
const FILE_REFERENCE_STAT_CACHE_MAX = 1000;
const VSCODE_FILE_REFERENCE_STAT_CACHE_MAX = 200;
// A miss is only true for the moment it was probed: a path the assistant has
// just announced can exist a few seconds later, and a settled message only
// re-probes once the entry expires. Confirmed paths stay cached for the session.
const FILE_REFERENCE_STAT_MISS_TTL_MS = 5_000;

export type FileReferenceStat = {
  exists: boolean;
  isDirectory: boolean;
};

const MISSING_FILE_REFERENCE_STAT: FileReferenceStat = { exists: false, isDirectory: false };

type FileReferenceStatCacheEntry = {
  stat: Promise<FileReferenceStat>;
  // `null` for a confirmed path; a timestamp while the answer is only a miss.
  expiresAt: number | null;
};

// `cacheable: false` marks an answer built on a failed request: the runtime
// rejected the probe, so it says nothing about the path and must never be
// remembered as "missing".
type FileReferenceStatProbe = {
  stat: FileReferenceStat;
  cacheable: boolean;
};

const FILE_REFERENCE_STAT_CACHE = new Map<string, FileReferenceStatCacheEntry>();
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

const probeFileReferenceStat = async (normalizedPath: string, effectiveDirectory: string): Promise<FileReferenceStatProbe> => {
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
    return { stat: { exists: payload?.exists !== false, isDirectory: false }, cacheable: true };
  }

  // Directories answer 400 on `/api/fs/stat` in both web and VS Code, so a
  // rejected file probe falls back to the directory route before giving up.
  const directoryResponse = await runtimeFetch(`/api/fs/directory-stat?path=${requestPath}&optional=true`, {
    method: 'GET',
    cache: 'no-store',
    headers,
  });
  if (!directoryResponse.ok) {
    return { stat: MISSING_FILE_REFERENCE_STAT, cacheable: false };
  }

  // SAFETY: `/api/fs/directory-stat` answers JSON with an optional `exists`
  // flag and `isDirectory`; a non-JSON body degrades to null.
  const payload = await directoryResponse.json().catch(() => null) as { exists?: unknown; isDirectory?: unknown } | null;
  // The VS Code bridge answers an optional miss on this route with a 200 and
  // `{ exists: false }`, so the flag decides before `isDirectory` does.
  if (payload?.exists === false) {
    return { stat: MISSING_FILE_REFERENCE_STAT, cacheable: true };
  }
  return { stat: { exists: true, isDirectory: payload?.isDirectory === true }, cacheable: true };
};

const trimFileReferenceStatCache = (maxCacheEntries: number): void => {
  while (FILE_REFERENCE_STAT_CACHE.size >= maxCacheEntries) {
    const oldest = FILE_REFERENCE_STAT_CACHE.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    FILE_REFERENCE_STAT_CACHE.delete(oldest);
  }
};

const settleFileReferenceStatEntry = (
  cacheKey: string,
  entry: FileReferenceStatCacheEntry,
  probe: FileReferenceStatProbe,
): void => {
  if (FILE_REFERENCE_STAT_CACHE.get(cacheKey) !== entry) {
    return;
  }
  if (!probe.cacheable) {
    FILE_REFERENCE_STAT_CACHE.delete(cacheKey);
    return;
  }
  entry.expiresAt = probe.stat.exists ? null : Date.now() + FILE_REFERENCE_STAT_MISS_TTL_MS;
};

export const fileReferenceStat = (resolvedPath: string, effectiveDirectory: string): Promise<FileReferenceStat> => {
  const normalizedPath = normalizeReferencePath(resolvedPath);
  if (!normalizedPath) {
    return Promise.resolve(MISSING_FILE_REFERENCE_STAT);
  }

  const cacheKey = statCacheKey(effectiveDirectory, normalizedPath);
  const cached = FILE_REFERENCE_STAT_CACHE.get(cacheKey);
  if (cached && (cached.expiresAt === null || cached.expiresAt > Date.now())) {
    FILE_REFERENCE_STAT_CACHE.delete(cacheKey);
    FILE_REFERENCE_STAT_CACHE.set(cacheKey, cached);
    return cached.stat;
  }
  if (cached) {
    FILE_REFERENCE_STAT_CACHE.delete(cacheKey);
  }

  const entry: FileReferenceStatCacheEntry = {
    // Until the probe answers, the key counts as a miss, so a lookup landing
    // after the TTL re-probes instead of waiting on a stale promise.
    expiresAt: Date.now() + FILE_REFERENCE_STAT_MISS_TTL_MS,
    stat: new Promise<FileReferenceStat>((resolve) => {
      const run = () => {
        activeFileReferenceStatCount += 1;
        void probeFileReferenceStat(normalizedPath, effectiveDirectory)
          .then((probe) => {
            settleFileReferenceStatEntry(cacheKey, entry, probe);
            resolve(probe.stat);
          })
          .catch(() => {
            if (FILE_REFERENCE_STAT_CACHE.get(cacheKey) === entry) {
              FILE_REFERENCE_STAT_CACHE.delete(cacheKey);
            }
            resolve(MISSING_FILE_REFERENCE_STAT);
          })
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
    }),
  };

  trimFileReferenceStatCache(getFileReferenceStatCacheMax());
  FILE_REFERENCE_STAT_CACHE.set(cacheKey, entry);
  return entry.stat;
};

export const fileReferenceExists = async (resolvedPath: string, effectiveDirectory: string): Promise<boolean> => {
  const { exists } = await fileReferenceStat(resolvedPath, effectiveDirectory);
  return exists;
};
