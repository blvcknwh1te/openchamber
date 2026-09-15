import { describe, expect, test } from 'bun:test';

import { HOME_ANCHORED_PATH_TOKEN_RE, isLikelyFilePath, parseFileReference, resolveFileReference, resolveReferencePath } from './fileReferenceParser';

const collectHomeTokens = (text: string): string[] => (
  [...text.matchAll(HOME_ANCHORED_PATH_TOKEN_RE)].map((match) => match[0])
);

describe('HOME_ANCHORED_PATH_TOKEN_RE', () => {
  test('keeps the leading tilde instead of matching the path as absolute', () => {
    expect(collectHomeTokens('см. ~/.config/opencode/rules/tooling.md')).toEqual(['~/.config/opencode/rules/tooling.md']);
  });

  test('covers extension-less home directories and stops before trailing prose', () => {
    expect(collectHomeTokens('каталог ~/.config/opencode и всё')).toEqual(['~/.config/opencode']);
  });

  test('captures the line suffix and Windows separators', () => {
    expect(collectHomeTokens('~/AppData/Local/foo.ts:12:3')).toEqual(['~/AppData/Local/foo.ts:12:3']);
    expect(collectHomeTokens('~\\AppData\\Local\\foo.ts')).toEqual(['~\\AppData\\Local\\foo.ts']);
  });

  test('ignores a bare tilde', () => {
    expect(collectHomeTokens('путь ~ без слэша')).toEqual([]);
  });
});

describe('resolveReferencePath', () => {
  const homeDirectory = 'C:/Users/Bohdan';

  test('expands the tilde against the home directory', () => {
    expect(resolveReferencePath('~/.config/opencode', { directory: 'D:/proj', homeDirectory })).toBe('C:/Users/Bohdan/.config/opencode');
    expect(resolveReferencePath('~', { directory: 'D:/proj', homeDirectory })).toBe('C:/Users/Bohdan');
  });

  test('joins relative paths under the directory and keeps absolute ones', () => {
    expect(resolveReferencePath('src/app.ts', { directory: 'D:/proj', homeDirectory })).toBe('D:/proj/src/app.ts');
    expect(resolveReferencePath('D:/proj/src/app.ts', { directory: 'D:/proj', homeDirectory })).toBe('D:/proj/src/app.ts');
  });

  test('does not fabricate a path when the home directory is unknown', () => {
    expect(resolveReferencePath('~/x.ts', { directory: 'D:/proj', homeDirectory: '' })).toBe('');
    expect(resolveReferencePath('~other/x.ts', { directory: 'D:/proj', homeDirectory })).toBe('');
  });
});

describe('parseFileReference with a home anchor', () => {
  test('keeps the tilde in the path and extracts the line suffix', () => {
    const parsed = parseFileReference('~/.config/opencode/opencode.jsonc:12');
    expect(parsed?.path).toBe('~/.config/opencode/opencode.jsonc');
    expect(parsed?.line).toBe(12);
  });
});

describe('isLikelyFilePath', () => {
  test('accepts file paths and rejects prose', () => {
    expect(isLikelyFilePath('src/constants.ts:48')).toBe(true);
    expect(isLikelyFilePath('README.md')).toBe(true);
    expect(isLikelyFilePath('just some prose')).toBe(false);
  });
});

describe('resolveFileReference', () => {
  const base = { directory: 'D:/proj', homeDirectory: 'C:/Users/Bohdan' };

  test('keeps the line suffix when the annotation already stored the path', () => {
    const resolved = resolveFileReference('src/constants.ts:48', {
      ...base,
      storedPath: 'D:/elsewhere/src/constants.ts',
    });
    expect(resolved?.resolvedPath).toBe('D:/elsewhere/src/constants.ts');
    expect(resolved?.line).toBe(48);
  });

  test('parses and resolves in one step', () => {
    const resolved = resolveFileReference('src/constants.ts:48', base);
    expect(resolved?.path).toBe('src/constants.ts');
    expect(resolved?.line).toBe(48);
    expect(resolved?.resolvedPath).toBe('D:/proj/src/constants.ts');
  });

  test('expands the home anchor and keeps the line', () => {
    const resolved = resolveFileReference('~/.config/opencode/rules/tooling.md:5', base);
    expect(resolved?.resolvedPath).toBe('C:/Users/Bohdan/.config/opencode/rules/tooling.md');
    expect(resolved?.line).toBe(5);
  });

  test('rejects values that are not file references', () => {
    expect(resolveFileReference('just some prose', base)).toBeNull();
  });
});
