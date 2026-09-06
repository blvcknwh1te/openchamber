// The two settings files and how a merged document is split between them.
//
// `settings.json` holds instance facts (and, untouched, whatever legacy keys
// older builds left there). `preferences.json` holds the user's profile: the
// keys the settings registry marks `profile`, each with the time the store
// last accepted a new value for it. Device keys never reach either file.
//
// Mirrors the server implementation in
// `packages/web/server/lib/opencode/settings-files.js`; both sides must write
// byte-compatible files, so keep format changes in sync.
//
// Kept free of `vscode` imports so it is unit-tested directly.
import * as path from 'path';
import { SETTINGS_REGISTRY_FIELDS } from './settings-registry-gate';

const PREFERENCES_FILE_NAME = 'preferences.json';
const PREFERENCES_DOCUMENT_VERSION = 1;

// Boundary parser: values are whatever JSON the file (or the webview) carries.
type PreferenceField = { value: unknown; updatedAt: number };
export type PreferenceFields = Record<string, PreferenceField>;

type ParsedPreferencesDocument =
  | { ok: true; fields: PreferenceFields }
  | { ok: false; reason: string };

/** The registry scope for a key, or `null` when the registry does not know it. */
const getSettingsScope = (key: string): string | null =>
  Object.prototype.hasOwnProperty.call(SETTINGS_REGISTRY_FIELDS, key) ? SETTINGS_REGISTRY_FIELDS[key].scope : null;

export const isProfileSettingsKey = (key: string): boolean => getSettingsScope(key) === 'profile';
export const isDeviceSettingsKey = (key: string): boolean => getSettingsScope(key) === 'device';

export const preferencesFilePathFor = (settingsFilePath: string): string =>
  path.join(path.dirname(settingsFilePath), PREFERENCES_FILE_NAME);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const sameValue = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return JSON.stringify(left) === JSON.stringify(right);
};

/**
 * Parse the text of a preferences file. A missing file is the caller's case
 * (ENOENT); anything that is not a version-1 document with a `fields` object
 * is a failure, never an empty profile.
 */
export const parsePreferencesDocument = (raw: string): ParsedPreferencesDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isPlainObject(parsed) || parsed.version !== PREFERENCES_DOCUMENT_VERSION || !isPlainObject(parsed.fields)) {
    return { ok: false, reason: 'not a version-1 preferences document' };
  }
  const fields: PreferenceFields = {};
  for (const [key, entry] of Object.entries(parsed.fields)) {
    if (!isPlainObject(entry) || !('value' in entry)) {
      return { ok: false, reason: `field "${key}" is not a { value, updatedAt } entry` };
    }
    const updatedAt = typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0;
    fields[key] = { value: entry.value, updatedAt };
  }
  return { ok: true, fields };
};

export const serializePreferencesDocument = (fields: PreferenceFields): string =>
  JSON.stringify({ version: PREFERENCES_DOCUMENT_VERSION, fields }, null, 2);

/** The plain key → value view of preference fields. */
export const flattenPreferences = (fields: PreferenceFields): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
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
export const buildPreferencesFields = (
  previousFields: PreferenceFields,
  document: Record<string, unknown>,
  now: number,
): PreferenceFields => {
  const fields: PreferenceFields = {};
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
 * that is not a profile key. Device keys are already filtered by the registry
 * gate on the write path; ones older builds persisted stay in place.
 */
export const instancePartOf = (document: Record<string, unknown>): Record<string, unknown> => {
  const instance: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (value === undefined || isProfileSettingsKey(key)) continue;
    instance[key] = value;
  }
  return instance;
};

/** The profile keys of a document, as they would seed a fresh preferences file. */
export const seedPreferencesFrom = (document: Record<string, unknown>, now: number): PreferenceFields =>
  buildPreferencesFields({}, document, now);
