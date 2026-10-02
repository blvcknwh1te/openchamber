/**
 * Turning the config's `instructions` list into concrete rule files.
 *
 * OpenCode injects rules through `instructions`, a list of file paths and
 * patterns. The picker needs the individual files behind those patterns, and
 * this module is the whole of that translation: pattern parsing, directory
 * parents, file filtering and deduplication. It is pure (no store, no network)
 * so the picker's list can be reasoned about and tested on its own.
 */

import { expandHomePath, normalizeFilePath } from '@/lib/path-utils';

export type RuleScope = 'user' | 'project';

export interface RuleInfo {
  /** Display name: the file name without its extension. */
  name: string;
  /** Absolute path of the markdown file that defines the rule. */
  path: string;
  scope: RuleScope;
  description?: string;
}

export interface RuleListEntry {
  name: string;
  path: string;
  isFile: boolean;
}

const GLOB_CHARS_PATTERN = /[*?[\]{}]/;
const EXTENSION_PATTERN = /\.[A-Za-z0-9]+$/;
const FIRST_HEADING_PATTERN = /^#\s+(.+?)\s*$/;

export const isGlobPattern = (value: string): boolean => GLOB_CHARS_PATTERN.test(value);

const globExtension = (pattern: string): string | null => {
  const match = EXTENSION_PATTERN.exec(pattern);
  return match ? match[0].toLowerCase() : null;
};

/**
 * Absolute, `~`-expanded directory a pattern entry lives in.
 *
 * A glob segment cannot be listed, so the entry is cut back to the last
 * directory before the first glob and that parent is listed instead; the glob's
 * extension then filters the listing. `~/.config/opencode/rules/*.md` becomes
 * `~/.config/opencode/rules`.
 */
export const resolveEntryDirectory = (entry: string, home: string | null): string | null => {
  let candidate = entry.trim();
  if (!candidate) return null;

  const globIndex = candidate.search(GLOB_CHARS_PATTERN);
  if (globIndex >= 0) {
    const lastSlash = candidate.lastIndexOf('/', globIndex);
    candidate = lastSlash >= 0 ? candidate.slice(0, lastSlash) : candidate.slice(0, globIndex);
  }
  if (!candidate.trim()) return null;

  return expandHomePath(candidate, home) || null;
};

/**
 * The `~`-expanded form of an entry, glob and all.
 *
 * `selectEntryFiles` compares a file entry with the absolute paths a listing
 * returns, so the entry has to be expanded before it is compared. Expansion
 * only rewrites the leading `~`, which is what leaves the glob part intact.
 */
export const expandEntryPattern = (entry: string, home: string | null): string =>
  expandHomePath(entry.trim(), home) || entry.trim();

const stripExtension = (fileName: string): string => fileName.replace(EXTENSION_PATTERN, '');

const basename = (filePath: string): string => {
  const normalized = normalizeFilePath(filePath);
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(index + 1) : normalized;
};

const canonicalPath = (filePath: string): string => normalizeFilePath(filePath).toLowerCase();

/**
 * Picks the files one `instructions` entry points at.
 *
 * `entry` must already be `~`-expanded (see `resolveEntryDirectory`), otherwise
 * a file entry cannot be compared with the absolute paths a listing returns.
 *
 * An entry that names a file directly is matched by path, so a parent listing
 * cannot silently widen it to its siblings. An entry with a glob keeps only the
 * files whose extension matches that glob. An entry without either accepts
 * every file in the directory it names.
 */
export const selectEntryFiles = (
  entry: string,
  entries: readonly RuleListEntry[],
): RuleListEntry[] => {
  const hasGlob = isGlobPattern(entry);
  const extension = hasGlob ? globExtension(entry) : null;
  const namesAFile = !hasGlob && EXTENSION_PATTERN.test(entry.trim());

  return entries
    .filter((walked) => walked.isFile)
    .filter((walked) => {
      if (namesAFile) return canonicalPath(walked.path) === canonicalPath(entry);
      if (!extension) return true;
      return normalizeFilePath(walked.path).toLowerCase().endsWith(extension);
    });
};

/** The picker's entry for one rule file. */
export const toRuleInfo = (file: RuleListEntry, scope: RuleScope): RuleInfo => ({
  name: stripExtension(basename(file.path)),
  path: normalizeFilePath(file.path),
  scope,
});

/**
 * Deduplicates by canonical path, first occurrence wins, so the same file
 * claimed by two patterns (or by both a user and a project entry) is listed
 * once. Order is preserved: the config's own order is the display order.
 */
export const dedupeRules = (rules: readonly RuleInfo[]): RuleInfo[] => {
  const seen = new Set<string>();
  const unique: RuleInfo[] = [];
  for (const rule of rules) {
    const key = canonicalPath(rule.path);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(rule);
  }
  return unique;
};

/**
 * The rule name a heading declares, or the file's own name. Kept for callers
 * that already hold the file's text; the picker itself never reads rule files,
 * because they live outside the workspace where a read is denied.
 */
export const readRuleName = (content: string, fallbackName: string): string => {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  const heading = FIRST_HEADING_PATTERN.exec(firstLine);
  const title = heading?.[1]?.trim();
  return title ? title : fallbackName;
};
