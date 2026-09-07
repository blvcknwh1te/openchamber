import { markGitHubAuthAccountInvalid } from '../github/auth.js';
import { getOctokitForAccountId } from '../github/octokit.js';
import { resolveGitHubRepoFromDirectory } from '../github/repo/index.js';

/**
 * Raw unified diff for a pull request.
 *
 * GitHub already returns the merge-base diff for a PR, so this matches the
 * three-dot semantics used for local branch reviews: work merged in from the
 * base branch is not part of it.
 */
export async function getPullRequestDiff(directory, number, readContext, dependencies = {}) {
  if (!readContext || readContext.provider !== 'github') {
    throw Object.assign(new Error('A trusted GitHub read context is required'), {
      statusCode: 400,
      code: 'INVALID_SOURCE_CONTROL_READ_CONTEXT',
    });
  }
  const getExactOctokit = dependencies.getOctokitForAccountId ?? getOctokitForAccountId;
  const account = await getExactOctokit(readContext.accountId, {
    onUnauthorized: async (identity, persisted) => {
      await dependencies.onAccountUnavailable?.(identity);
      if (persisted) await markGitHubAuthAccountInvalid(identity.accountId, 'unauthorized');
    },
  });
  if (!account) {
    throw Object.assign(new Error('GitHub account is unavailable'), {
      statusCode: 401,
      code: 'github-not-connected',
    });
  }

  // The resolver returns `{ repo, remoteUrl }`, not the repo itself. Reading
  // `.owner` off the wrapper made this check fail for every repository.
  const resolveRepository = dependencies.resolveGitHubRepoFromDirectory ?? resolveGitHubRepoFromDirectory;
  const { repo } = await resolveRepository(directory, readContext.primaryRemote);
  if (!repo?.owner || !repo?.repo) {
    throw Object.assign(new Error('This directory has no GitHub remote'), {
      statusCode: 400,
      code: 'no-github-remote',
    });
  }

  const response = await account.octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner: repo.owner,
    repo: repo.repo,
    pull_number: number,
    headers: { accept: 'application/vnd.github.v3.diff' },
  });

  const patch = typeof response?.data === 'string' ? response.data : '';
  if (!patch.trim()) {
    throw Object.assign(new Error(`Pull request #${number} has no diff`), {
      statusCode: 404,
      code: 'empty-diff',
    });
  }

  return { patch, meta: { owner: repo.owner, repo: repo.repo, number } };
}
