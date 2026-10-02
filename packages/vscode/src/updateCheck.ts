import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

// Single source of truth for the fork's release source. Every owner/repo/URL
// literal lives here; the rest of the fork resolves versions against these.
export const FORK_OWNER = 'blvcknwh1te';
export const FORK_REPO = 'openchamber';
export const FORK_RELEASES_LATEST_URL = `https://api.github.com/repos/${FORK_OWNER}/${FORK_REPO}/releases/latest`;
export const FORK_RELEASE_PAGE_URL = `https://github.com/${FORK_OWNER}/${FORK_REPO}/releases`;
export const VSIX_ASSET_PREFIX = 'openchamber-bnw-';
export const VSIX_ASSET_SUFFIX = '.vsix';

export const FORK_GITHUB_ACCEPT = 'application/vnd.github+json';
export const FORK_GITHUB_API_VERSION = '2022-11-28';
export const FORK_UPDATE_FETCH_TIMEOUT_MS = 10_000;
export const FORK_UPDATE_DOWNLOAD_TIMEOUT_MS = 120_000;

export type ForkUpdateInfo = {
  available: boolean;
  version: string | null;
  currentVersion: string;
  releaseUrl: string | null;
  downloadUrl: string | null;
  body: string | null;
};

// `error` is distinct from `current`: a failed fetch must never read as
// "you are up to date".
export type ForkUpdateResult =
  | { state: 'available'; info: ForkUpdateInfo }
  | { state: 'current'; info: ForkUpdateInfo }
  | { state: 'error'; error: string };

export type ForkInstallOutcome =
  | { status: 'installed' }
  | { status: 'manual'; releaseUrl: string | null; error: string };

// Optional hints the webview may attach to an update-check request.
export type ForkCheckRequest = {
  currentVersion?: string;
  notify?: boolean;
  force?: boolean;
};

export type ForkReleaseAsset = {
  name: string;
  browserDownloadUrl: string;
};

export type ForkReleaseSnapshot = {
  tagName: string;
  htmlUrl: string;
  body: string | null;
  assets: ForkReleaseAsset[];
};

// Shape of `GET /repos/{owner}/{repo}/releases/latest`. Fields are optional so
// a partial payload degrades instead of throwing.
type GitHubReleasePayload = {
  tag_name?: string;
  html_url?: string;
  body?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
};

type PrereleaseIdentifier =
  | { kind: 'numeric'; value: number }
  | { kind: 'text'; value: string };

type ParsedVersion = {
  core: [number, number, number];
  prerelease: PrereleaseIdentifier[];
};

const NUMERIC_IDENTIFIER = /^\d+$/;

/**
 * Parses the fork's version scheme: `1.23.0` and `1.23.0-bnw.41`.
 * `v`/`V` prefixes are accepted and ignored. Returns null for unparseable
 * input so callers can decide how to treat "unknown".
 */
export function parseVersion(raw: string): ParsedVersion | null {
  const trimmed = raw.trim().replace(/^[vV]/, '');
  if (!trimmed) return null;

  const dashIndex = trimmed.indexOf('-');
  const corePart = dashIndex === -1 ? trimmed : trimmed.slice(0, dashIndex);
  const prereleasePart = dashIndex === -1 ? '' : trimmed.slice(dashIndex + 1);

  const coreSegments = corePart.split('.');
  if (coreSegments.length === 0 || coreSegments.some((segment) => segment.length === 0)) return null;

  const core: [number, number, number] = [0, 0, 0];
  for (let index = 0; index < 3 && index < coreSegments.length; index += 1) {
    const segment = coreSegments[index];
    if (!NUMERIC_IDENTIFIER.test(segment)) return null;
    core[index] = Number(segment);
  }

  const prerelease: PrereleaseIdentifier[] = prereleasePart.length === 0
    ? []
    : prereleasePart.split('.').map((identifier) => (
        NUMERIC_IDENTIFIER.test(identifier)
          ? { kind: 'numeric', value: Number(identifier) }
          : { kind: 'text', value: identifier }
      ));

  return { core, prerelease };
}

const comparePrerelease = (a: PrereleaseIdentifier[], b: PrereleaseIdentifier[]): number => {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;

    if (left.kind === 'numeric' && right.kind === 'numeric') {
      if (left.value === right.value) continue;
      return left.value < right.value ? -1 : 1;
    }
    if (left.kind === 'numeric') return -1;
    if (right.kind === 'numeric') return 1;
    if (left.value === right.value) continue;
    return left.value < right.value ? -1 : 1;
  }
  return 0;
};

/**
 * Semver ordering for the fork scheme. `1` < `1.2` < `1.2.0` <
 * `1.2.0-bnw.40` < `1.2.0-bnw.41` < `1.2.0`.
 */
export function compareVersions(a: string, b: string): number {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (!parsedA && !parsedB) return 0;
  if (!parsedA) return -1;
  if (!parsedB) return 1;

  for (let index = 0; index < 3; index += 1) {
    if (parsedA.core[index] !== parsedB.core[index]) {
      return parsedA.core[index] < parsedB.core[index] ? -1 : 1;
    }
  }
  return comparePrerelease(parsedA.prerelease, parsedB.prerelease);
}

export function normalizeForkTag(tag: string): string {
  return tag.trim().replace(/^[vV]/, '');
}

export function findVsixAssetUrl(assets: readonly ForkReleaseAsset[], version: string): string | null {
  const expected = `${VSIX_ASSET_PREFIX}${version}${VSIX_ASSET_SUFFIX}`;
  const exact = assets.find((asset) => asset.name === expected);
  if (exact) return exact.browserDownloadUrl;
  const anyVsix = assets.find((asset) => asset.name.toLowerCase().endsWith(VSIX_ASSET_SUFFIX));
  return anyVsix?.browserDownloadUrl ?? null;
}

/**
 * Normalizes the GitHub Releases `latest` payload without touching the network.
 * The caller validates the JSON string and this narrows each field to the API
 * contract, so a malformed row is dropped rather than trusted.
 */
export function parseGitHubLatestRelease(payload: GitHubReleasePayload): ForkReleaseSnapshot | null {
  const tagName = payload?.tag_name?.trim() ?? '';
  if (!tagName) return null;

  const assets: ForkReleaseAsset[] = [];
  for (const entry of payload.assets ?? []) {
    const name = entry?.name ?? '';
    const url = entry?.browser_download_url ?? '';
    if (name && url) assets.push({ name, browserDownloadUrl: url });
  }

  return {
    tagName,
    htmlUrl: payload.html_url ?? '',
    body: payload.body ?? null,
    assets,
  };
}

export function buildForkUpdateResult(currentVersion: string, release: ForkReleaseSnapshot): ForkUpdateResult {
  const latestVersion = normalizeForkTag(release.tagName);
  const current = currentVersion.trim().replace(/^[vV]/, '');
  const info: ForkUpdateInfo = {
    available: false,
    version: latestVersion || null,
    currentVersion: current,
    releaseUrl: release.htmlUrl || FORK_RELEASE_PAGE_URL,
    downloadUrl: latestVersion ? findVsixAssetUrl(release.assets, latestVersion) : null,
    body: release.body,
  };

  if (!latestVersion || !current || compareVersions(latestVersion, current) <= 0) {
    return { state: 'current', info };
  }
  return { state: 'available', info: { ...info, available: true } };
}

const inFlightChecks = new Map<string, Promise<ForkUpdateResult>>();

const fetchLatestForkRelease = async (): Promise<ForkReleaseSnapshot> => {
  const response = await fetch(FORK_RELEASES_LATEST_URL, {
    method: 'GET',
    headers: {
      Accept: FORK_GITHUB_ACCEPT,
      'X-GitHub-Api-Version': FORK_GITHUB_API_VERSION,
    },
    signal: AbortSignal.timeout(FORK_UPDATE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GitHub Releases responded with ${response.status}`);
  }
  // SAFETY: `/releases/latest` returns a JSON object; `parseGitHubLatestRelease`
  // reads every field defensively, so a non-conforming body degrades to null.
  const payload = await response.json() as GitHubReleasePayload;
  const release = parseGitHubLatestRelease(payload);
  if (!release) {
    throw new Error('Unexpected GitHub Releases payload');
  }
  return release;
};

/**
 * Compares the running extension version against the fork's latest release.
 * Concurrent callers for the same version share one network request so the
 * hourly poll, the Settings button, and the startup check do not triple-hit
 * GitHub (60 requests/hour without a token).
 */
export async function checkForkUpdate(currentVersion: string): Promise<ForkUpdateResult> {
  const key = currentVersion.trim();
  const existing = inFlightChecks.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<ForkUpdateResult> => {
    try {
      const release = await fetchLatestForkRelease();
      return buildForkUpdateResult(currentVersion, release);
    } catch (error) {
      return { state: 'error', error: error instanceof Error ? error.message : String(error) };
    } finally {
      inFlightChecks.delete(key);
    }
  })();

  inFlightChecks.set(key, promise);
  return promise;
}

const sanitizeVersionForPath = (version: string): string => version.replace(/[^0-9A-Za-z._-]/g, '_');

const getForkUpdateCacheDir = (): string => path.join(os.tmpdir(), 'openchamber-bnw-update');

const downloadReleaseAsset = async (url: string, version: string): Promise<string> => {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/octet-stream' },
    signal: AbortSignal.timeout(FORK_UPDATE_DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Download failed with ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const directory = getForkUpdateCacheDir();
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${VSIX_ASSET_PREFIX}${sanitizeVersionForPath(version)}${VSIX_ASSET_SUFFIX}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
};

const removeFileQuietly = (filePath: string): void => {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Best-effort cleanup of the temp .vsix.
  }
};

const openReleasePage = async (url: string): Promise<void> => {
  try {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  } catch {
    // The message already tells the user where to look.
  }
};

/**
 * Downloads the release `.vsix` and asks VS Code to install it. Not every
 * build allows programmatic extension installs, so any failure falls back to
 * opening the release page and reporting that a manual install is needed.
 */
export async function installForkUpdate(info: ForkUpdateInfo): Promise<ForkInstallOutcome> {
  const version = info.version || '';
  const fallbackUrl = info.releaseUrl || FORK_RELEASE_PAGE_URL;

  if (!info.downloadUrl || !version) {
    await openReleasePage(fallbackUrl);
    return { status: 'manual', releaseUrl: fallbackUrl, error: 'Release asset is unavailable' };
  }

  try {
    const vsixPath = await downloadReleaseAsset(info.downloadUrl, version);
    try {
      await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsixPath));
      return { status: 'installed' };
    } finally {
      removeFileQuietly(vsixPath);
    }
  } catch (error) {
    await openReleasePage(fallbackUrl);
    return {
      status: 'manual',
      releaseUrl: fallbackUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const shownVersions = new Set<string>();

export type ForkUpdateAction = 'update' | 'later' | 'dismissed';

/**
 * Shows the update notification. The notification's own close button and
 * "Later" both dismiss; only "Update" installs. `force` is for an explicit
 * user request, which must always answer even if the version was shown on
 * startup.
 */
export async function showForkUpdateNotification(
  info: ForkUpdateInfo,
  onAction: (action: ForkUpdateAction) => void | Promise<void>,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  const version = info.version || '';
  if (!force && version && shownVersions.has(version)) return;
  if (version) shownVersions.add(version);

  const updateLabel = vscode.l10n.t('Update');
  const laterLabel = vscode.l10n.t('Later');
  const choice = await vscode.window.showInformationMessage(
    vscode.l10n.t('OpenChamber {0} is available', version),
    updateLabel,
    laterLabel,
  );

  if (choice === updateLabel) {
    await onAction('update');
  } else if (choice === laterLabel) {
    await onAction('later');
  } else {
    await onAction('dismissed');
  }
}

export async function handleForkUpdateNotification(info: ForkUpdateInfo, options?: { force?: boolean }): Promise<void> {
  await showForkUpdateNotification(info, async (action) => {
    if (action !== 'update') return;
    const outcome = await installForkUpdate(info);
    if (outcome.status === 'manual') {
      await vscode.window.showWarningMessage(
        vscode.l10n.t('OpenChamber could not update automatically. The release page is open; install the .vsix manually.'),
      );
    }
  }, options);
}

/** Startup check: notifies only when a newer release exists, never on failure. */
export async function checkForkUpdateAndNotify(context: vscode.ExtensionContext): Promise<void> {
  const currentVersion = String(context.extension?.packageJSON?.version || '');
  const result = await checkForkUpdate(currentVersion);
  if (result.state === 'available') {
    await handleForkUpdateNotification(result.info);
  } else if (result.state === 'error') {
    console.warn('[openchamber] Fork update check failed:', result.error);
  }
}
