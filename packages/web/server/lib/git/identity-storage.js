import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { withSourceControlFileLockSync } from '../source-control/file-lock.js';

const FILE_NAME = 'git-identities.json';
const legacyDataDir = () => path.join(os.homedir(), '.config', 'openchamber');
const isPlainObject = (value) => value === Object(value)
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const isString = (value) => Object.prototype.toString.call(value) === '[object String]';
const invalidStore = (cause) => Object.assign(new Error('Git identity profile store is invalid', { cause }), {
  code: 'GIT_IDENTITY_STORE_INVALID',
});
const PUBLIC_PROFILE_KEYS = new Set([
  'id', 'name', 'userName', 'userEmail', 'signCommits', 'signingKey', 'color', 'icon',
]);
const validProfileText = (value, { required = false, max = 512 } = {}) => isString(value)
  && value.length <= max && (!required || value.trim().length > 0);

export const parsePublicGitIdentityProfile = (value, expectedId) => {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !PUBLIC_PROFILE_KEYS.has(key))
    || !validProfileText(value.id, { required: true, max: 200 })
    || (expectedId !== undefined && value.id !== expectedId)
    || !validProfileText(value.name, { required: true })
    || !validProfileText(value.userName, { required: true })
    || !validProfileText(value.userEmail, { required: true })
    || (value.signCommits !== undefined && typeof value.signCommits !== 'boolean')
    || (value.signingKey !== undefined && value.signingKey !== null && !validProfileText(value.signingKey))
    || (value.color !== undefined && value.color !== null && !validProfileText(value.color))
    || (value.icon !== undefined && value.icon !== null && !validProfileText(value.icon))) {
    throw new TypeError('Invalid public Git identity profile');
  }
  const profile = {
    id: value.id.trim(),
    name: value.name.trim(),
    userName: value.userName.trim(),
    userEmail: value.userEmail.trim(),
  };
  for (const key of ['signCommits', 'signingKey', 'color', 'icon']) {
    if (Object.hasOwn(value, key)) profile[key] = isString(value[key]) ? value[key].trim() : value[key];
  }
  return profile;
};

export const toPublicGitIdentityProfile = (value) => {
  const profile = {
    id: value.id,
    name: validProfileText(value.name, { required: true }) ? value.name : value.userName,
    userName: value.userName,
    userEmail: value.userEmail,
  };
  if (typeof value.signCommits === 'boolean') profile.signCommits = value.signCommits;
  for (const key of ['signingKey', 'color', 'icon']) {
    if (value[key] === null || validProfileText(value[key])) profile[key] = value[key];
  }
  return profile;
};

const parseState = (value) => {
  if (!isPlainObject(value) || Object.keys(value).length !== 1
    || !Array.isArray(value.profiles) || value.profiles.length > 256) throw invalidStore();
  const ids = new Set();
  for (const profile of value.profiles) {
    if (!isPlainObject(profile) || !isString(profile.id) || !profile.id
      || !isString(profile.userName) || !profile.userName
      || !isString(profile.userEmail) || !profile.userEmail || ids.has(profile.id)) throw invalidStore();
    ids.add(profile.id);
  }
  return value;
};

export function createGitIdentityStore({
  dataDir,
  filePath = dataDir ? path.join(dataDir, FILE_NAME) : undefined,
  fsImpl = fs,
  lockWaitMs = 2_000,
  legacyFilePath,
} = {}) {
  if (!isString(filePath) || !path.isAbsolute(filePath)
    || (legacyFilePath !== undefined && (!isString(legacyFilePath) || !path.isAbsolute(legacyFilePath)))
    || !Number.isSafeInteger(lockWaitMs) || lockWaitMs < 0) {
    throw new TypeError('Git identity store options are invalid');
  }

  const emptyState = () => ({ profiles: [] });
  const readFile = (target, allowShippedMode = false) => {
    let handle;
    try {
      handle = fsImpl.openSync(target, fsImpl.constants.O_RDONLY | fsImpl.constants.O_NOFOLLOW);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      if (error?.code === 'ELOOP') throw invalidStore(error);
      throw error;
    }
    try {
      const stats = fsImpl.fstatSync(handle);
      if (!stats.isFile()) throw invalidStore();
      const extraMode = process.platform !== 'win32' ? stats.mode & 0o077 : 0;
      if (extraMode !== 0 && (!allowShippedMode || (stats.mode & 0o022) !== 0)) throw invalidStore();
      let state;
      try { state = parseState(JSON.parse(fsImpl.readFileSync(handle, 'utf8'))); }
      catch (error) {
        if (error?.code === 'GIT_IDENTITY_STORE_INVALID') throw error;
        throw invalidStore(error);
      }
      return { state, needsModeMigration: extraMode !== 0 };
    } finally {
      fsImpl.closeSync(handle);
    }
  };
  const writeState = (state) => {
    const parsed = parseState(state);
    fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      fsImpl.writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
        encoding: 'utf8', mode: 0o600, flag: 'wx',
      });
      fsImpl.chmodSync(temporary, 0o600);
      fsImpl.renameSync(temporary, filePath);
    } catch (error) {
      try { fsImpl.rmSync(temporary, { force: true }); } catch {}
      throw error;
    }
    return parsed;
  };
  const readState = () => {
    const current = readFile(filePath, true);
    if (current) {
      if (current.needsModeMigration) writeState(current.state);
      return current.state;
    }
    if (!legacyFilePath || legacyFilePath === filePath) return emptyState();
    return withSourceControlFileLockSync(`${legacyFilePath}.lock`, () => {
      const legacy = readFile(legacyFilePath, true);
      if (!legacy) return emptyState();
      writeState(legacy.state);
      return legacy.state;
    }, { fsImpl, waitMs: lockWaitMs });
  };
  const transact = (operation) => withSourceControlFileLockSync(`${filePath}.lock`, operation, {
    fsImpl, waitMs: lockWaitMs,
  });
  const loadProfiles = () => transact(readState);
  const saveProfiles = (data) => transact(() => writeState(data));
  const getProfiles = () => transact(() => readState().profiles);
  const getProfile = (id) => transact(() => readState().profiles.find((profile) => profile.id === id) || null);
  const createProfile = (profileData) => transact(() => {
    const publicProfile = parsePublicGitIdentityProfile(profileData);
    const state = readState();
    if (state.profiles.length >= 256) throw new Error('Git identity profile limit reached');
    if (state.profiles.some((profile) => profile.id === publicProfile.id)) {
      throw new Error(`Profile with ID "${publicProfile.id}" already exists`);
    }
    const profile = {
      ...publicProfile,
      color: publicProfile.color || 'keyword',
      icon: publicProfile.icon || 'branch',
    };
    state.profiles.push(profile);
    writeState(state);
    return profile;
  });
  const updateProfile = (id, updates) => transact(() => {
    const publicUpdates = parsePublicGitIdentityProfile(updates, id);
    const state = readState();
    const index = state.profiles.findIndex((profile) => profile.id === id);
    if (index === -1) throw new Error(`Profile with ID "${id}" not found`);
    state.profiles[index] = { ...state.profiles[index], ...publicUpdates, id: state.profiles[index].id };
    writeState(state);
    return state.profiles[index];
  });
  const deleteProfile = (id) => transact(() => {
    const state = readState();
    const profiles = state.profiles.filter((profile) => profile.id !== id);
    if (profiles.length === state.profiles.length) throw new Error(`Profile with ID "${id}" not found`);
    writeState({ profiles });
    return true;
  });

  return Object.freeze({ loadProfiles, saveProfiles, getProfiles, getProfile, createProfile, updateProfile, deleteProfile });
}

const stores = new Map();
const defaultStore = () => {
  const oldFilePath = path.join(legacyDataDir(), FILE_NAME);
  const dataDir = process.env.OPENCHAMBER_DATA_DIR
    ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
    : legacyDataDir();
  const filePath = path.join(dataDir, FILE_NAME);
  let store = stores.get(filePath);
  if (!store) {
    store = createGitIdentityStore({
      filePath,
      legacyFilePath: filePath === oldFilePath ? undefined : oldFilePath,
    });
    stores.set(filePath, store);
  }
  return store;
};

export const getProfiles = () => defaultStore().getProfiles();
export const getProfile = (id) => defaultStore().getProfile(id);
export const createProfile = (profileData) => defaultStore().createProfile(profileData);
export const updateProfile = (id, updates) => defaultStore().updateProfile(id, updates);
export const deleteProfile = (id) => defaultStore().deleteProfile(id);
