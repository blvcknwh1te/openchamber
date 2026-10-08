import { describe, expect, it, mock } from 'bun:test';

const readDirectoryMock = mock(async () => [
  ['notes.md', 1],
  ['rules', 2],
  ['link', 64],
]);

mock.module('vscode', () => ({
  workspace: {
    fs: { readDirectory: readDirectoryMock },
  },
  Uri: {
    file: (fsPath) => ({ fsPath }),
    joinPath: (uri, name) => ({ fsPath: `${uri.fsPath}/${name}` }),
  },
  FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
}));

const { listDirectoryEntries } = await import('./bridge-fs-helpers-runtime');

describe('listDirectoryEntries', () => {
  it('marks every entry as file or directory, so the rules picker can filter by isFile', async () => {
    const entries = await listDirectoryEntries('/home/user/.config/opencode/rules');

    expect(entries).toEqual([
      {
        name: 'notes.md',
        path: '/home/user/.config/opencode/rules/notes.md',
        isDirectory: false,
        isFile: true,
      },
      {
        name: 'rules',
        path: '/home/user/.config/opencode/rules/rules',
        isDirectory: true,
        isFile: false,
      },
      {
        name: 'link',
        path: '/home/user/.config/opencode/rules/link',
        isDirectory: false,
        isFile: false,
      },
    ]);
  });
});
