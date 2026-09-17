import type { ProjectFileSearchHit } from '@/lib/opencode/client';

import { normalizeReferencePath } from './fileReferenceParser';

/**
 * Locates a file reference the direct resolution could not reach.
 *
 * Absolute paths and paths relative to the active directory resolve before this
 * runs. What is left is a reference written from a root the workspace does not
 * share: the assistant names `packages/ui/src/app.tsx` while the opened folder
 * is the repository's parent, or the other way round. OpenCode's file search is
 * the only lookup every runtime exposes, so the basename is searched there and
 * a hit counts only when its path repeats the whole reference.
 */

/** Search hits asked for per lookup; the path match decides, not the ranking. */
export const FILE_REFERENCE_LOOKUP_LIMIT = 20;

export type FileReferenceSearcher = (
  directory: string,
  query: string,
  limit: number,
  options?: { type?: 'file' | 'directory' },
) => Promise<ProjectFileSearchHit[]>;

const splitPathSegments = (value: string): string[] =>
  normalizeReferencePath(value).split('/').filter((segment) => segment.length > 0);

/**
 * The part of the reference the file search reports against: the segments after
 * the active directory. A reference outside that directory keeps its own
 * segments, so only a file search hit repeating them qualifies.
 */
const relativeSegmentsUnder = (resolvedPath: string, directory: string): string[] => {
  const requested = splitPathSegments(resolvedPath);
  const base = splitPathSegments(directory);
  const sharesBase = base.length > 0
    && base.length < requested.length
    && base.every((segment, index) => requested[index].toLowerCase() === segment.toLowerCase());
  return sharesBase ? requested.slice(base.length) : requested;
};

const endsWithSegments = (candidate: string[], requested: string[]): boolean => {
  if (requested.length === 0 || candidate.length < requested.length) {
    return false;
  }
  const offset = candidate.length - requested.length;
  return requested.every((segment, index) => (
    candidate[offset + index].toLowerCase() === segment.toLowerCase()
  ));
};

export const lookupWorkspaceFileReference = async (
  resolvedPath: string,
  directory: string,
  searchFiles: FileReferenceSearcher,
): Promise<string | null> => {
  const searchDirectory = directory.trim();
  if (!searchDirectory) {
    return null;
  }

  const requestedSegments = relativeSegmentsUnder(resolvedPath, searchDirectory);
  const baseName = requestedSegments[requestedSegments.length - 1];
  if (!baseName) {
    return null;
  }

  let hits: ProjectFileSearchHit[];
  try {
    hits = await searchFiles(searchDirectory, baseName, FILE_REFERENCE_LOOKUP_LIMIT, { type: 'file' });
  } catch {
    // A failed search says nothing about the path, so the caller must treat the
    // answer as unknown rather than as a missing file.
    return null;
  }

  const matches = hits.filter((hit) => endsWithSegments(splitPathSegments(hit.relativePath), requestedSegments));
  const [match] = matches;
  // Several files repeating the same segments mean the reference does not
  // identify one file, so it is left alone.
  return matches.length === 1 && match ? match.path : null;
};
