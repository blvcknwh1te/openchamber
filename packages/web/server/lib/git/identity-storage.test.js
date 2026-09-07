import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitIdentityStore } from './identity-storage.js';
import { gitStorageProcess } from './storage-process.test-support.js';

const roots = [];
const children = [];
const profile = (id) => ({ id, name: id, userName: id, userEmail: `${id}@example.com` });
const setup = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-identities-'));
  roots.push(root);
  const dataDir = path.join(root, 'owned');
  const filePath = path.join(dataDir, 'git-identities.json');
  return { root, filePath, store: createGitIdentityStore({ dataDir }) };
};

afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => child.stop()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('git identity storage', () => {
  it('owns the injected data directory and copies shipped profiles once', async () => {
    const { root, filePath } = await setup();
    const legacyFilePath = path.join(root, 'legacy', 'git-identities.json');
    const shipped = { ...profile('legacy'), authType: 'token', sshKey: '/retained/key', credentialHelper: 'retained-helper' };
    await fs.mkdir(path.dirname(legacyFilePath), { recursive: true });
    await fs.writeFile(legacyFilePath, JSON.stringify({ profiles: [shipped] }), { mode: 0o644 });
    const store = createGitIdentityStore({ filePath, legacyFilePath });

    expect(store.getProfiles()).toEqual([shipped]);
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
    await fs.writeFile(legacyFilePath, JSON.stringify({ profiles: [profile('changed')] }), { mode: 0o644 });
    expect(store.getProfiles()).toEqual([shipped]);
  });

  it('retains server-only legacy fields while merging public author edits', async () => {
    const { filePath } = await setup();
    const legacy = {
      ...profile('legacy'),
      authType: 'token',
      sshKey: '/retained/private-key',
      host: 'legacy.example',
    };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ profiles: [legacy] }), { mode: 0o600 });
    const store = createGitIdentityStore({ filePath });

    const updated = store.updateProfile('legacy', {
      ...profile('legacy'),
      name: 'Updated author',
      signCommits: true,
      signingKey: '/public/signing-key.pub',
      color: 'string',
      icon: 'briefcase',
    });

    expect(updated).toEqual({
      ...legacy,
      name: 'Updated author',
      signCommits: true,
      signingKey: '/public/signing-key.pub',
      color: 'string',
      icon: 'briefcase',
    });
    expect(JSON.parse(await fs.readFile(filePath, 'utf8')).profiles[0]).toEqual(updated);
  });

  it('rejects legacy fields from callers', async () => {
    const { store } = await setup();
    expect(() => store.createProfile({ ...profile('new'), sshKey: '/client/key' }))
      .toThrow('Invalid public Git identity profile');
    expect(store.getProfiles()).toEqual([]);
  });

  it('distinguishes a missing store from malformed state', async () => {
    const { filePath, store } = await setup();
    expect(store.getProfiles()).toEqual([]);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '{broken', { mode: 0o600 });
    expect(() => store.getProfiles()).toThrow(expect.objectContaining({ code: 'GIT_IDENTITY_STORE_INVALID' }));
    expect(await fs.readFile(filePath, 'utf8')).toBe('{broken');
  });

  it('preserves sibling profiles written by independent processes', async () => {
    const { filePath, store } = await setup();
    const pair = await Promise.all([
      gitStorageProcess('identity', filePath),
      gitStorageProcess('identity', filePath),
    ]);
    children.push(...pair);
    const results = await Promise.all([
      pair[0].call('createProfile', [profile('one')]).result,
      pair[1].call('createProfile', [profile('two')]).result,
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(store.getProfiles().map((entry) => entry.id).sort()).toEqual(['one', 'two']);
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
    expect((await fs.readdir(path.dirname(filePath))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('retains a crashed owner lock and never treats contention as empty', async () => {
    const { filePath } = await setup();
    const owner = await gitStorageProcess('identity', filePath);
    children.push(owner);
    owner.call('hold-lock');
    await expect.poll(() => owner.events.some((event) => event.event === 'locked')).toBe(true);
    const nonce = await fs.readFile(`${filePath}.lock`, 'utf8');
    await owner.stop();
    const store = createGitIdentityStore({ filePath, lockWaitMs: 20 });
    expect(() => store.getProfiles()).toThrow(expect.objectContaining({
      code: 'SOURCE_CONTROL_LOCK_BUSY', status: 503,
    }));
    expect(await fs.readFile(`${filePath}.lock`, 'utf8')).toBe(nonce);
  });
});
