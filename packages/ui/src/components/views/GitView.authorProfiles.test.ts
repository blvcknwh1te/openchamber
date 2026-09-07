import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { GitIdentityProfile } from '@/lib/api/types';

// Execute the component's actual author callbacks without mocking React or exporting UI internals.
const readAuthorCallback = (file: URL, name: string): string => {
  const source = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node): ts.ArrowFunction | undefined => {
    let call: ts.CallExpression | undefined;
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      call = node.initializer;
    } else if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const expression = node.expression;
      const dependencies = expression.arguments[1];
      if (expression.expression.getText(source) === 'React.useEffect'
        && dependencies && ts.isArrayLiteralExpression(dependencies)
        && dependencies.elements.some((dependency) => ts.isIdentifier(dependency) && dependency.text === name)) {
        call = expression;
      }
    }
    if (call?.arguments[0] && ts.isArrowFunction(call.arguments[0])) return call.arguments[0];
    return ts.forEachChild(node, visit);
  };
  const callback = visit(source);
  if (!callback) throw new Error(`Author callback not found: ${name}`);
  return ts.transpileModule(`(${callback.getText(source)})()`, {
    compilerOptions: { target: ts.ScriptTarget.ESNext },
  }).outputText;
};

const cloneDefault = readAuthorCallback(new URL('../session/DirectoryExplorerDialog.tsx', import.meta.url), 'selectedGitIdentityId');
const availableAuthors = readAuthorCallback(new URL('./GitView.tsx', import.meta.url), 'availableIdentities');
const activeAuthor = readAuthorCallback(new URL('./GitView.tsx', import.meta.url), 'activeIdentityProfile');

const globalIdentity: GitIdentityProfile = { id: 'global', name: 'Global', userName: 'Global Author', userEmail: 'global@example.com' };
const work: GitIdentityProfile = { id: 'work', name: 'Work', userName: 'Work Author', userEmail: 'work@example.com' };
const signed: GitIdentityProfile = {
  id: 'signed', name: 'Signed author', userName: 'Signed Author', userEmail: 'signed@example.com',
  signCommits: true, signingKey: '/public/signing.pub',
};
const plain: GitIdentityProfile = { id: 'plain', name: 'Author', userName: 'Plain Author', userEmail: 'plain@example.com' };
const profiles = [work, signed, plain];

const cloneState = {
  open: true,
  isCloneMode: true,
  selectedGitIdentityId: null,
  defaultGitIdentityId: null,
  availableGitIdentities: [globalIdentity, ...profiles],
};

const applyCloneDefault = (state: {
  open: boolean;
  isCloneMode: boolean;
  selectedGitIdentityId: string | null;
  defaultGitIdentityId: string | null;
  availableGitIdentities: GitIdentityProfile[];
}) => {
  let selectedId = state.selectedGitIdentityId;
  const writes: string[] = [];
  runInNewContext(cloneDefault, {
    ...state,
    setSelectedGitIdentityId: (id: string) => { selectedId = id; writes.push(id); },
  });
  return { selectedId, writes };
};

describe('clone author precedence', () => {
  test('keeps an explicit author ahead of the configured default', () => {
    expect(applyCloneDefault({ ...cloneState, selectedGitIdentityId: signed.id, defaultGitIdentityId: work.id }))
      .toEqual({ selectedId: signed.id, writes: [] });
  });

  test('does not replace an explicit choice when the inventory is temporarily empty', () => {
    expect(applyCloneDefault({ ...cloneState, selectedGitIdentityId: signed.id, defaultGitIdentityId: work.id, availableGitIdentities: [] }))
      .toEqual({ selectedId: signed.id, writes: [] });
  });

  for (const profile of [globalIdentity, signed, plain, work]) {
    test(`honors the configured ${profile.id} author`, () => {
      expect(applyCloneDefault({ ...cloneState, defaultGitIdentityId: ` ${profile.id} ` }))
        .toEqual({ selectedId: profile.id, writes: [profile.id] });
    });
  }

  test('does not infer an author when a valid default is absent', () => {
    for (const defaultGitIdentityId of [null, '', 'missing']) {
      expect(applyCloneDefault({ ...cloneState, defaultGitIdentityId })).toEqual({ selectedId: null, writes: [] });
    }
  });

  test('waits for the configured author to arrive instead of selecting another profile', () => {
    const waiting = { ...cloneState, defaultGitIdentityId: signed.id, availableGitIdentities: [work] };
    expect(applyCloneDefault(waiting)).toEqual({ selectedId: null, writes: [] });
    expect(applyCloneDefault({ ...waiting, availableGitIdentities: profiles }))
      .toEqual({ selectedId: signed.id, writes: [signed.id] });
  });

  test('does not choose an author while closed or browsing', () => {
    expect(applyCloneDefault({ ...cloneState, defaultGitIdentityId: signed.id, open: false })).toEqual({ selectedId: null, writes: [] });
    expect(applyCloneDefault({ ...cloneState, defaultGitIdentityId: signed.id, isCloneMode: false })).toEqual({ selectedId: null, writes: [] });
  });
});

describe('Git view authors', () => {
  test('offers every author for unrelated HTTPS, SSH, and absent remotes', () => {
    expect(runInNewContext(availableAuthors, { profiles, globalIdentity })).toEqual([globalIdentity, ...profiles]);
  });

  test('retains ID deduplication, ordering, and stored signing data', () => {
    expect(runInNewContext(availableAuthors, { profiles: [signed, work, signed], globalIdentity }))
      .toEqual([globalIdentity, signed, work]);
    expect(runInNewContext(availableAuthors, { profiles: [signed], globalIdentity: null })[0]).toBe(signed);
  });

  test('prefers a matching stored author over a matching global author and preserves signing', () => {
    expect(runInNewContext(activeAuthor, {
      profiles, globalIdentity: { ...globalIdentity, userName: signed.userName, userEmail: signed.userEmail },
      currentIdentity: { userName: signed.userName, userEmail: signed.userEmail },
    })).toBe(signed);
  });

  test('uses the matching global author when no stored author matches', () => {
    expect(runInNewContext(activeAuthor, {
      profiles, globalIdentity, currentIdentity: { userName: globalIdentity.userName, userEmail: globalIdentity.userEmail },
    })).toBe(globalIdentity);
  });

  test('derives a local author from name and email without transport fields', () => {
    expect(runInNewContext(activeAuthor, {
      profiles, globalIdentity, currentIdentity: { userName: 'Local Author', userEmail: 'local@example.com' },
    })).toEqual({
      id: 'local-config', name: 'Local Author', userName: 'Local Author', userEmail: 'local@example.com', color: 'info', icon: 'user',
    });
  });

  test('preserves the global fallback when current author data is absent or incomplete', () => {
    for (const currentIdentity of [null, { userName: 'Incomplete', userEmail: null }]) {
      expect(runInNewContext(activeAuthor, { profiles, globalIdentity, currentIdentity })).toBe(globalIdentity);
    }
    expect(runInNewContext(activeAuthor, { profiles: [], globalIdentity: null, currentIdentity: null })).toBeNull();
  });
});
