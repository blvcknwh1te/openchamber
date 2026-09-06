// The two settings files and how a merged document is split between them.
//
// `settings.json` holds instance facts (and, untouched, whatever legacy keys
// older builds left there). `preferences.json` holds the user's profile: the
// keys the settings registry marks `profile`, each with the time the store
// last accepted a new value for it. Device keys never reach either file.
//
// The VS Code extension host writes the same two files with the same shape
// (`packages/vscode/src/settings-files.ts`); keep the format changes in sync.
import { createRequire } from 'node:module';

const registry = createRequire(import.meta.url)('./settings-registry.json');

const PREFERENCES_FILE_NAME = 'preferences.json';
const PREFERENCES_DOCUMENT_VERSION = 1;

/** The registry scope for a key, or `null` when the registry does not know it. */
const getSettingsScope = (key) => registry.fields[key]?.scope ?? null;

export const isProfileSettingsKey = (key) => getSettingsScope(key) === 'profile';
export const isDeviceSettingsKey = (key) => getSettingsScope(key) === 'device';

export const preferencesFilePathFor = (settingsFilePath, path) => path.join(path.dirname(settingsFilePath), PREFERENCES_FILE_NAME);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const sameValue = (left, right) => {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return JSON.stringify(left) === JSON.stringify(right);
};

/**
 * Parse the text of a preferences file. A missing file is the caller's case
 * (ENOENT); anything that is not a version-1 document with a `fields` object
 * is a failure, never an empty profile.
 */
export const parsePreferencesDocument = (raw) => {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isPlainObject(parsed) || parsed.version !== PREFERENCES_DOCUMENT_VERSION || !isPlainObject(parsed.fields)) {
    return { ok: false, reason: 'not a version-1 preferences document' };
  }
  const fields = {};
  for (const [key, entry] of Object.entries(parsed.fields)) {
    if (!isPlainObject(entry) || !('value' in entry)) {
      return { ok: false, reason: `field "${key}" is not a { value, updatedAt } entry` };
    }
    const updatedAt = Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0;
    fields[key] = { value: entry.value, updatedAt };
  }
  return { ok: true, fields };
};

export const serializePreferencesDocument = (fields) => JSON.stringify({ version: PREFERENCES_DOCUMENT_VERSION, fields }, null, 2);

/** The plain key → value view of preference fields. */
export const flattenPreferences = (fields) => {
  const values = {};
  for (const [key, entry] of Object.entries(fields)) {
    values[key] = entry.value;
  }
  return values;
};

/**
 * The next preference fields for a merged document: every profile key it
 * carries, stamped `now` when its value differs from what the file held and
 * keeping the earlier stamp otherwise. Profile keys the document no longer
 * carries are dropped (that is how a cleared key leaves the file).
 */
export const buildPreferencesFields = (previousFields, document, now) => {
  const fields = {};
  for (const [key, value] of Object.entries(document)) {
    if (value === undefined || !isProfileSettingsKey(key)) continue;
    const previous = previousFields[key];
    fields[key] = previous && sameValue(previous.value, value)
      ? previous
      : { value, updatedAt: now };
  }
  return fields;
};

/**
 * The part of a merged document that belongs in `settings.json`: everything
 * that is not a profile key. Device keys older builds persisted stay in place
 * as a read-once seed for clients; the write path never adds new ones.
 */
export const instancePartOf = (document) => {
  const instance = {};
  for (const [key, value] of Object.entries(document)) {
    if (value === undefined || isProfileSettingsKey(key)) continue;
    instance[key] = value;
  }
  return instance;
};

/** The profile keys of a document, as they would seed a fresh preferences file. */
export const seedPreferencesFrom = (document, now) => buildPreferencesFields({}, document, now);

/**
 * Synchronous merged read for server modules that consult one or two profile
 * keys on a hot path (small-model resolution, goal/assist toggles). A missing
 * or unreadable preferences file contributes nothing, and the caller's own
 * default applies — the same "missing is not default" rule the clients use.
 */
export const readMergedSettingsSync = ({ fs, path, settingsFilePath }) => {
  let settings = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
    if (isPlainObject(parsed)) settings = parsed;
  } catch {
    settings = {};
  }
  let preferences = {};
  try {
    const parsed = parsePreferencesDocument(fs.readFileSync(preferencesFilePathFor(settingsFilePath, path), 'utf8'));
    if (parsed.ok) preferences = flattenPreferences(parsed.fields);
  } catch {
    preferences = {};
  }
  return { ...settings, ...preferences };
};
