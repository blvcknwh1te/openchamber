import { describe, expect, test } from 'bun:test';

import {
  expandHomePath,
  getDirectoryForFilePath,
  getRelativeFilePath,
  isAbsoluteFilePath,
  isFilePathWithinDirectory,
  normalizeFilePath,
  toAbsoluteFilePath,
} from './path-utils';

describe('path-utils', () => {
  test('normalizes Windows paths without losing drive roots', () => {
    expect(normalizeFilePath('C:\\Users\\Bohdan Triapitsyn\\projects\\openchamber\\')).toBe('C:/Users/Bohdan Triapitsyn/projects/openchamber');
    expect(normalizeFilePath('C:/')).toBe('C:/');
    expect(normalizeFilePath('\\\\server\\share\\project')).toBe('//server/share/project');
  });

  test('recognizes Windows absolute paths', () => {
    expect(isAbsoluteFilePath('C:/Users/file.ts')).toBe(true);
    expect(isAbsoluteFilePath('C:\\Users\\file.ts')).toBe(true);
    expect(isAbsoluteFilePath('C:relative/file.ts')).toBe(false);
    expect(isAbsoluteFilePath('src/file.ts')).toBe(false);
  });

  test('does not prefix Windows absolute targets with the workspace directory', () => {
    expect(toAbsoluteFilePath('C:/Users/Bohdan Triapitsyn/projects/openchamber', 'C:/Users/Bohdan Triapitsyn/projects/openchamber/packages/ui/Button.tsx')).toBe(
      'C:/Users/Bohdan Triapitsyn/projects/openchamber/packages/ui/Button.tsx',
    );
  });

  test('joins relative targets under Windows workspaces', () => {
    expect(toAbsoluteFilePath('C:/Users/Bohdan Triapitsyn/projects/openchamber', 'packages/ui/Button.tsx')).toBe(
      'C:/Users/Bohdan Triapitsyn/projects/openchamber/packages/ui/Button.tsx',
    );
    expect(toAbsoluteFilePath('C:/Users/Bohdan Triapitsyn/projects/openchamber/packages/ui', '../web/package.json')).toBe(
      'C:/Users/Bohdan Triapitsyn/projects/openchamber/packages/web/package.json',
    );
  });

  test('compares Windows workspace containment case-insensitively', () => {
    expect(isFilePathWithinDirectory(
      'c:/users/bohdan triapitsyn/projects/openchamber/packages/ui/button.tsx',
      'C:/Users/Bohdan Triapitsyn/projects/openchamber',
    )).toBe(true);
    expect(getRelativeFilePath(
      'C:/Users/Bohdan Triapitsyn/projects/openchamber/packages/ui/Button.tsx',
      'c:/users/bohdan triapitsyn/projects/openchamber',
    )).toBe('packages/ui/Button.tsx');
  });

  test('falls back to file parent when current directory does not contain the path', () => {
    expect(getDirectoryForFilePath(
      'C:/Users/Bohdan Triapitsyn/projects/other',
      'C:/Users/Bohdan Triapitsyn/projects/openchamber/packages/ui/Button.tsx',
    )).toBe('C:/Users/Bohdan Triapitsyn/projects/openchamber/packages/ui');
    expect(getDirectoryForFilePath('', '/tmp/file.txt')).toBe('/tmp');
  });

  test('expands tilde paths against the home directory', () => {
    expect(expandHomePath('~/projects/app.ts', 'C:/Users/Bohdan Triapitsyn')).toBe('C:/Users/Bohdan Triapitsyn/projects/app.ts');
    expect(expandHomePath('~', 'C:/Users/Bohdan Triapitsyn')).toBe('C:/Users/Bohdan Triapitsyn');
    expect(expandHomePath('~\\.config\\opencode', 'C:/Users/Bohdan Triapitsyn')).toBe('C:/Users/Bohdan Triapitsyn/.config/opencode');
    expect(expandHomePath('C:/projects/app.ts', 'C:/Users/Bohdan Triapitsyn')).toBe('C:/projects/app.ts');
    expect(expandHomePath('src/app.ts', 'C:/Users/Bohdan Triapitsyn')).toBe('src/app.ts');
  });

  test('leaves tilde paths untouched when the home directory is unknown or the form is unsupported', () => {
    expect(expandHomePath('~/projects/app.ts', null)).toBe('~/projects/app.ts');
    expect(expandHomePath('~/projects/app.ts', '')).toBe('~/projects/app.ts');
    expect(expandHomePath('~other/app.ts', 'C:/Users/Bohdan Triapitsyn')).toBe('~other/app.ts');
  });
});
