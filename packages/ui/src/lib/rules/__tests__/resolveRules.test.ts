import { describe, expect, test } from 'bun:test';
import {
  dedupeRules,
  expandEntryPattern,
  isGlobPattern,
  readRuleName,
  resolveEntryDirectory,
  selectEntryFiles,
  toRuleInfo,
} from '../resolveRules';
import type { RuleInfo, RuleListEntry } from '../resolveRules';

const HOME = '/home/user';

const file = (path: string, name?: string): RuleListEntry => ({
  name: name ?? path.split('/').pop() ?? path,
  path,
  isFile: true,
});

const dir = (path: string): RuleListEntry => ({
  name: path.split('/').pop() ?? path,
  path,
  isFile: false,
});

describe('isGlobPattern', () => {
  test('detects the glob characters an instruction entry can carry', () => {
    expect(isGlobPattern('~/.config/opencode/rules/*.md')).toBe(true);
    expect(isGlobPattern('/a/**/b.md')).toBe(true);
    expect(isGlobPattern('/a/{b,c}.md')).toBe(true);
    expect(isGlobPattern('/a/b?.md')).toBe(true);
    expect(isGlobPattern('/a/AGENTS.md')).toBe(false);
    expect(isGlobPattern('/a/b c.md')).toBe(false);
  });
});

describe('resolveEntryDirectory', () => {
  test('expands ~ against the home directory', () => {
    expect(resolveEntryDirectory('~/.config/opencode/rules/assume-then-act.md', HOME))
      .toBe('/home/user/.config/opencode/rules/assume-then-act.md');
  });

  test('cuts a globbed entry back to the directory it lists', () => {
    expect(resolveEntryDirectory('~/.config/opencode/rules/*.md', HOME))
      .toBe('/home/user/.config/opencode/rules');
    expect(resolveEntryDirectory('/workspace/**/*.md', HOME)).toBe('/workspace');
  });

  test('leaves an absolute entry untouched and normalizes its separators', () => {
    expect(resolveEntryDirectory('C:\\work\\.config\\rules\\a.md', HOME))
      .toBe('C:/work/.config/rules/a.md');
  });

  test('returns null for an empty entry instead of the process directory', () => {
    expect(resolveEntryDirectory('   ', HOME)).toBeNull();
    expect(resolveEntryDirectory('', HOME)).toBeNull();
  });
});

describe('selectEntryFiles', () => {
  const listing: RuleListEntry[] = [
    file('/home/user/.config/opencode/rules/assume-then-act.md'),
    file('/home/user/.config/opencode/rules/code-comments.md'),
    file('/home/user/.config/opencode/rules/notes.txt'),
    dir('/home/user/.config/opencode/rules/nested'),
  ];

  test('a glob entry keeps the files whose extension matches it', () => {
    const selected = selectEntryFiles(expandEntryPattern('~/.config/opencode/rules/*.md', HOME), listing);
    expect(selected.map((entry) => entry.name)).toEqual(['assume-then-act.md', 'code-comments.md']);
  });

  test('a glob entry never returns directories', () => {
    const selected = selectEntryFiles(expandEntryPattern('~/.config/opencode/rules/*', HOME), listing);
    expect(selected.every((entry) => entry.isFile)).toBe(true);
    expect(selected.map((entry) => entry.name)).not.toContain('nested');
  });

  test('a file entry matches only itself, not its siblings', () => {
    const selected = selectEntryFiles(
      expandEntryPattern('~/.config/opencode/rules/assume-then-act.md', HOME),
      listing,
    );
    expect(selected.map((entry) => entry.name)).toEqual(['assume-then-act.md']);
  });

  test('a directory entry without a glob accepts every file', () => {
    const selected = selectEntryFiles(expandEntryPattern('~/.config/opencode/rules', HOME), listing);
    expect(selected.map((entry) => entry.name)).toEqual([
      'assume-then-act.md', 'code-comments.md', 'notes.txt',
    ]);
  });
});

describe('expandEntryPattern', () => {
  test('expands the leading ~ and leaves the glob intact', () => {
    expect(expandEntryPattern('~/.config/opencode/rules/*.md', HOME))
      .toBe('/home/user/.config/opencode/rules/*.md');
  });

  test('keeps the entry unchanged when there is no home to expand against', () => {
    expect(expandEntryPattern('~/.config/rules/*.md', null)).toBe('~/.config/rules/*.md');
  });
});

describe('toRuleInfo', () => {
  test('names the rule after the file, without the extension', () => {
    const rule = toRuleInfo(file('C:\\work\\.config\\rules\\assume-then-act.md'), 'user');
    expect(rule).toEqual({
      name: 'assume-then-act',
      path: 'C:/work/.config/rules/assume-then-act.md',
      scope: 'user',
    });
  });
});

describe('dedupeRules', () => {
  const rule = (path: string, name: string, scope: RuleInfo['scope'] = 'user'): RuleInfo => ({
    path,
    name,
    scope,
  });

  test('keeps one entry per canonical path, first occurrence wins', () => {
    const deduped = dedupeRules([
      rule('/home/user/.config/opencode/rules/a.md', 'first'),
      rule('/home/user/.config/opencode/rules/b.md', 'b'),
      rule('/home/user/.config/opencode/rules/a.md', 'second'),
    ]);

    expect(deduped.map((entry) => entry.name)).toEqual(['first', 'b']);
  });

  test('treats a backslash path and a slash path as the same file', () => {
    const deduped = dedupeRules([
      rule('C:\\work\\rules\\a.md', 'a', 'user'),
      rule('C:/work/rules/a.md', 'a', 'project'),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].scope).toBe('user');
  });

  test('preserves the config order of the surviving rules', () => {
    const deduped = dedupeRules([
      rule('/rules/c.md', 'c'),
      rule('/rules/a.md', 'a'),
      rule('/rules/b.md', 'b'),
    ]);

    expect(deduped.map((entry) => entry.name)).toEqual(['c', 'a', 'b']);
  });
});

describe('readRuleName', () => {
  test('reads the first heading when a file is available', () => {
    expect(readRuleName('# assume-then-act\n\nbody', 'fallback')).toBe('assume-then-act');
  });

  test('falls back to the file name when the heading is missing or empty', () => {
    expect(readRuleName('body without a heading', 'fallback')).toBe('fallback');
    expect(readRuleName('#   \nbody', 'fallback')).toBe('fallback');
  });
});
