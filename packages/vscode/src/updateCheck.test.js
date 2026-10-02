import { describe, expect, mock, test } from 'bun:test';

mock.module('vscode', () => ({
  l10n: { t: (_message, ...args) => [String(_message), ...args].join(' ') },
  window: { showInformationMessage: mock(async () => undefined), showWarningMessage: mock(async () => undefined) },
  env: { openExternal: mock(async () => true) },
  commands: { executeCommand: mock(async () => undefined) },
  Uri: { file: (fsPath) => ({ scheme: 'file', fsPath }), parse: (value) => ({ value }) },
}));

const {
  parseVersion,
  compareVersions,
  normalizeForkTag,
  findVsixAssetUrl,
  parseGitHubLatestRelease,
  buildForkUpdateResult,
} = await import('./updateCheck.ts');

describe('parseVersion', () => {
  test('accepts the plain and prefixed fork scheme', () => {
    expect(parseVersion('1.23.0')).toEqual({ core: [1, 23, 0], prerelease: [] });
    expect(parseVersion('v1.23.0-bnw.41')).toEqual({
      core: [1, 23, 0],
      prerelease: [{ kind: 'text', value: 'bnw' }, { kind: 'numeric', value: 41 }],
    });
  });

  test('tolerates short and long numeric cores', () => {
    expect(parseVersion('1')).toEqual({ core: [1, 0, 0], prerelease: [] });
    expect(parseVersion('1.2')).toEqual({ core: [1, 2, 0], prerelease: [] });
    expect(parseVersion('1.2.3.4')).toEqual({ core: [1, 2, 3], prerelease: [] });
  });

  test('returns null for unparseable input', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('   ')).toBeNull();
    expect(parseVersion('unknown')).toBeNull();
    expect(parseVersion('1.x.0')).toBeNull();
  });
});

describe('compareVersions', () => {
  test('orders core segments', () => {
    expect(compareVersions('1.23.0', '1.23.1')).toBe(-1);
    expect(compareVersions('1.23.1', '1.23.0')).toBe(1);
    expect(compareVersions('1.24.0', '1.23.9')).toBe(1);
  });

  test('treats equal versions as equal', () => {
    expect(compareVersions('1.23.0-bnw.41', '1.23.0-bnw.41')).toBe(0);
    expect(compareVersions('v1.23.0-bnw.41', '1.23.0-bnw.41')).toBe(0);
  });

  test('orders prerelease identifiers numerically', () => {
    expect(compareVersions('1.23.0-bnw.41', '1.23.0-bnw.40')).toBe(1);
    expect(compareVersions('1.23.0-bnw.40', '1.23.0-bnw.41')).toBe(-1);
    expect(compareVersions('1.23.0-bnw.9', '1.23.0-bnw.40')).toBe(-1);
    expect(compareVersions('1.23.0-bnw.100', '1.23.0-bnw.99')).toBe(1);
  });

  test('a release outranks its prerelease', () => {
    expect(compareVersions('1.23.0', '1.23.0-bnw.41')).toBe(1);
    expect(compareVersions('1.23.0-bnw.41', '1.23.0')).toBe(-1);
  });

  test('a shorter prerelease is lower', () => {
    expect(compareVersions('1.23.0-bnw', '1.23.0-bnw.1')).toBe(-1);
  });

  test('differs in segment count without prerelease', () => {
    expect(compareVersions('1.23', '1.23.0')).toBe(0);
  });
});

describe('normalizeForkTag', () => {
  test('strips the leading v', () => {
    expect(normalizeForkTag('v1.23.0-bnw.41')).toBe('1.23.0-bnw.41');
    expect(normalizeForkTag('1.23.0')).toBe('1.23.0');
  });
});

describe('findVsixAssetUrl', () => {
  test('prefers the asset that matches the version', () => {
    const assets = [
      { name: 'openchamber-bnw-1.23.0-bnw.40.vsix', browserDownloadUrl: 'https://x/40' },
      { name: 'openchamber-bnw-1.23.0-bnw.41.vsix', browserDownloadUrl: 'https://x/41' },
    ];
    expect(findVsixAssetUrl(assets, '1.23.0-bnw.41')).toBe('https://x/41');
  });

  test('falls back to any vsix asset', () => {
    const assets = [{ name: 'other-build.vsix', browserDownloadUrl: 'https://x/any' }];
    expect(findVsixAssetUrl(assets, '9.9.9')).toBe('https://x/any');
  });

  test('returns null when there is no vsix', () => {
    expect(findVsixAssetUrl([{ name: 'source.zip', browserDownloadUrl: 'https://x/z' }], '1.0.0')).toBeNull();
  });
});

describe('parseGitHubLatestRelease', () => {
  test('reads tag, url, body and assets from the API payload', () => {
    const payload = {
      tag_name: 'v1.23.0-bnw.41',
      html_url: 'https://github.com/blvcknwh1te/openchamber/releases/tag/v1.23.0-bnw.41',
      body: 'notes',
      assets: [{ name: 'openchamber-bnw-1.23.0-bnw.41.vsix', browser_download_url: 'https://dl/vsix' }],
    };
    expect(parseGitHubLatestRelease(payload)).toEqual({
      tagName: 'v1.23.0-bnw.41',
      htmlUrl: 'https://github.com/blvcknwh1te/openchamber/releases/tag/v1.23.0-bnw.41',
      body: 'notes',
      assets: [{ name: 'openchamber-bnw-1.23.0-bnw.41.vsix', browserDownloadUrl: 'https://dl/vsix' }],
    });
  });

  test('rejects a payload without a tag', () => {
    expect(parseGitHubLatestRelease({ assets: [] })).toBeNull();
    expect(parseGitHubLatestRelease(null)).toBeNull();
  });

  test('drops malformed assets instead of throwing', () => {
    const release = parseGitHubLatestRelease({ tag_name: 'v1.0.0', assets: [{ name: 'x' }, null, 'nope'] });
    expect(release?.assets).toEqual([]);
  });
});

describe('buildForkUpdateResult', () => {
  const release = {
    tagName: 'v1.23.0-bnw.41',
    htmlUrl: 'https://github.com/blvcknwh1te/openchamber/releases/tag/v1.23.0-bnw.41',
    body: 'notes',
    assets: [{ name: 'openchamber-bnw-1.23.0-bnw.41.vsix', browserDownloadUrl: 'https://dl/vsix' }],
  };

  test('reports available when the release is newer', () => {
    const result = buildForkUpdateResult('1.23.0-bnw.40', release);
    expect(result.state).toBe('available');
    expect(result.info.available).toBe(true);
    expect(result.info.version).toBe('1.23.0-bnw.41');
    expect(result.info.downloadUrl).toBe('https://dl/vsix');
  });

  test('reports current when versions match', () => {
    const result = buildForkUpdateResult('1.23.0-bnw.41', release);
    expect(result.state).toBe('current');
    expect(result.info.available).toBe(false);
  });

  test('reports current when the local build is newer', () => {
    expect(buildForkUpdateResult('1.24.0', release).state).toBe('current');
  });
});
