import type { ProjectFileSearchHit } from '@/lib/opencode/client';

import { hasFileExtension, normalizeReferencePath } from './fileReferenceParser';

/**
 * Locates a file reference the direct resolution could not reach.
 *
 * Absolute paths and paths relative to the active directory resolve before this
 * runs. What is left is a reference written from a root the workspace does not
 * share: the assistant names `packages/ui/src/app.tsx` while the opened folder
 * is the repository's parent, or the other way round. OpenCode's file search is
 * the only lookup every runtime exposes, so the basename is searched there and
 * a hit counts only when its path and the reference share a tail.
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

/**
 * Whether a search hit identifies the reference. The search reports a path
 * relative to the directory it was run in, so a hit normally repeats the
 * requested segments; when the opened folder sits inside the repository the hit
 * keeps only the tail of the reference, which still identifies it as long as it
 * does not collapse to the bare file name.
 */
const identifiesReference = (candidate: string[], requested: string[]): boolean =>
  endsWithSegments(candidate, requested)
  || (candidate.length >= 2 && endsWithSegments(requested, candidate));

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
    // A name without an extension may stand for a directory, and the file
    // search reports directories only when asked for them; a name with an
    // extension is a file, and the narrower search keeps the hit list short.
    const type = hasFileExtension(baseName) ? 'file' : 'directory';
    hits = await searchFiles(searchDirectory, baseName, FILE_REFERENCE_LOOKUP_LIMIT, { type });
  } catch {
    // A failed search says nothing about the path, so the caller must treat the
    // answer as unknown rather than as a missing file.
    return null;
  }

  const matches = hits.filter((hit) => identifiesReference(splitPathSegments(hit.relativePath), requestedSegments));
  const [match] = matches;
  // Several files repeating the same segments mean the reference does not
  // identify one file, so it is left alone.
  return matches.length === 1 && match ? match.path : null;
};
