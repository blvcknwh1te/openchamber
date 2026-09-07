import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelWalkthroughGeneration as clientCancelWalkthroughGeneration,
  fetchWalkthrough as clientFetchWalkthrough,
  fetchWalkthroughStage as clientFetchWalkthroughStage,
  generateWalkthrough as clientGenerateWalkthrough,
} from '../../../../ui/src/lib/walkthrough/api.ts';
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from '../../../../ui/src/lib/runtime-url.ts';
import { registerWalkthroughRoutes } from './routes.js';

// These run over real HTTP on purpose. The bug this file exists for was
// invisible to unit tests: the service and the store were both correct, and the
// response was dropped by a disconnect check that misread a healthy request.

const SOURCE = { kind: 'working-tree', scope: 'all' };
const PR_SOURCE = { kind: 'pr', number: 22 };
const PR_CONTEXT = {
  provider: 'github',
  instance: 'github.com',
  accountId: 'github.com#7',
  repositoryId: 'repo-1',
  bindingRevision: 4,
  primaryRemote: 'upstream',
};

describe('walkthrough routes', () => {
  let server;
  let base;
  let releaseJob;
  let job;
  let generationRequestCount;

  let lastArgs;
  let getWalkthroughService;
  let validateReadContext;

  const service = {
    async getWalkthrough(args) {
      lastArgs = args;
      const result = {
        source: args.source,
        walkthrough: null,
        hunks: [],
        hunkCount: 0,
        generating: Boolean(job),
      };
      if (args.readContext) result.readContext = args.readContext;
      return result;
    },
    async generateWalkthrough(args) {
      lastArgs = args;
      generationRequestCount += 1;
      if (job) return job;
      job = new Promise((resolve) => {
        releaseJob = () => {
          const result = {
            source: args.source,
            walkthrough: { title: 'DONE' },
            hunks: [],
            hunkCount: 1,
          };
          if (args.readContext) result.readContext = args.readContext;
          resolve(result);
        };
      }).finally(() => { job = null; });
      return job;
    },
    async cancelWalkthroughGeneration(args) {
      const result = { cancelled: Boolean(job) };
      if (args.readContext) result.readContext = args.readContext;
      return result;
    },
    async getRepositoryRootFor() {
      return { repoRoot: '/repo', sourceKey: 'pr:22' };
    },
    getGenerationStage() {
      return job ? 'asking' : null;
    },
  };

  const generate = (signal) => fetch(`${base}/api/walkthrough/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directory: '/repo', source: SOURCE }),
    signal,
  });

  beforeEach(async () => {
    job = null;
    generationRequestCount = 0;
    releaseJob = undefined;
    lastArgs = undefined;
    const app = express();
    app.use(express.json());
    getWalkthroughService = vi.fn(async () => service);
    validateReadContext = vi.fn(async (context) => ({ ...context, instance: 'github.com' }));
    registerWalkthroughRoutes(app, { getWalkthroughService, validateReadContext });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('answers a generation request that nobody interrupted', async () => {
    const pending = generate();
    await vi.waitFor(() => expect(generationRequestCount).toBe(1));
    releaseJob();

    const body = await (await pending).json();

    expect(body.walkthrough).toEqual({ title: 'DONE' });
  });

  it('delivers the result to a client that reconnected after a refresh', async () => {
    const controller = new AbortController();
    generate(controller.signal).catch(() => {});
    await vi.waitFor(() => expect(generationRequestCount).toBe(1));
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The reloaded page sees work in progress and re-attaches to it.
    const read = await (await fetch(
      `${base}/api/walkthrough?directory=/repo&source=${encodeURIComponent(JSON.stringify(SOURCE))}`,
    )).json();
    expect(read.generating).toBe(true);

    const reattached = generate();
    await vi.waitFor(() => expect(generationRequestCount).toBe(2));
    releaseJob();

    const body = await (await reattached).json();
    expect(body.walkthrough).toEqual({ title: 'DONE' });
  });

  it('rejects a request without a directory before touching the service', async () => {
    const response = await fetch(`${base}/api/walkthrough/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: SOURCE }),
    });

    expect(response.status).toBe(400);
    expect(job).toBeNull();
  });

  // The language belongs to the request, not to a setting, so both the read
  // and the generation have to carry it: readiness is computed from a prompt
  // that contains the language instruction.
  it('carries the requested language into the service', async () => {
    await fetch(
      `${base}/api/walkthrough?directory=/repo&language=uk&source=${encodeURIComponent(JSON.stringify(SOURCE))}`,
    );
    expect(lastArgs.language).toBe('uk');

    const pending = fetch(`${base}/api/walkthrough/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: '/repo', source: SOURCE, language: 'ja' }),
    });
    await vi.waitFor(() => expect(generationRequestCount).toBe(1));
    releaseJob();
    await pending;

    expect(lastArgs.language).toBe('ja');
  });

  it('ignores a language that is not a string', async () => {
    await fetch(
      `${base}/api/walkthrough?directory=/repo&language[]=uk&source=${encodeURIComponent(JSON.stringify(SOURCE))}`,
    );

    expect(lastArgs.language).toBeUndefined();
  });

  it('cancels through its own endpoint rather than a dropped connection', async () => {
    generate().catch(() => {});
    await vi.waitFor(() => expect(generationRequestCount).toBe(1));

    const response = await fetch(`${base}/api/walkthrough/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: '/repo', source: SOURCE }),
    });

    expect(await response.json()).toEqual({ cancelled: true });
    releaseJob();
  });

  it.each([
    ['read', () => fetch(`${base}/api/walkthrough?directory=/repo&source=${encodeURIComponent(JSON.stringify(PR_SOURCE))}`)],
    ['generate', () => fetch(`${base}/api/walkthrough/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ directory: '/repo', source: PR_SOURCE }),
    })],
    ['progress', () => fetch(`${base}/api/walkthrough/progress?directory=/repo&source=${encodeURIComponent(JSON.stringify(PR_SOURCE))}`)],
    ['cancel', () => fetch(`${base}/api/walkthrough/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ directory: '/repo', source: PR_SOURCE }),
    })],
  ])('validates PR context before service work for %s', async (_name, request) => {
    const failure = Object.assign(new Error('Source control read context is required'), {
      code: 'INVALID_SOURCE_CONTROL_BINDING',
    });
    validateReadContext.mockRejectedValue(failure);

    const response = await request();

    expect(response.status).toBe(400);
    expect(getWalkthroughService).not.toHaveBeenCalled();
    expect(validateReadContext).toHaveBeenCalledWith(expect.objectContaining({
      directory: '/repo',
      provider: undefined,
      bindingRevision: Number.NaN,
    }));
  });

  it('passes the trusted immutable context to a PR read', async () => {
    const query = new URLSearchParams({
      directory: '/repo',
      source: JSON.stringify(PR_SOURCE),
      ...Object.fromEntries(Object.entries(PR_CONTEXT).map(([key, value]) => [key, String(value)])),
    });

    await fetch(`${base}/api/walkthrough?${query}`);

    expect(lastArgs.readContext).toEqual({ ...PR_CONTEXT, directory: '/repo' });
    expect(validateReadContext.mock.invocationCallOrder[0])
      .toBeLessThan(getWalkthroughService.mock.invocationCallOrder[0]);
  });

  it('accepts the UI client wire shape for every PR walkthrough route', async () => {
    const previousResolver = getRuntimeUrlResolver();
    configureRuntimeUrlResolver({ apiBaseUrl: base });
    const target = { source: PR_SOURCE, context: { ...PR_CONTEXT, directory: '/repo' } };

    try {
      await clientFetchWalkthrough('/repo', target);

      const generation = clientGenerateWalkthrough('/repo', target);
      await vi.waitFor(() => expect(generationRequestCount).toBe(1));
      releaseJob();
      await generation;

      expect(await clientFetchWalkthroughStage('/repo', target)).toBeNull();
      await clientCancelWalkthroughGeneration('/repo', target);
    } finally {
      setRuntimeUrlResolver(previousResolver);
    }

    expect(validateReadContext).toHaveBeenCalledTimes(4);
    for (const [context] of validateReadContext.mock.calls) {
      expect(context).toEqual({ ...PR_CONTEXT, directory: '/repo' });
    }
  });

  it('rejects a validated non-GitHub PR context explicitly', async () => {
    validateReadContext.mockResolvedValue({ ...PR_CONTEXT, directory: '/repo', provider: 'gitlab', instance: 'https://gitlab.com' });
    const response = await fetch(`${base}/api/walkthrough/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: '/repo', source: PR_SOURCE, ...PR_CONTEXT, provider: 'gitlab', instance: 'https://gitlab.com' }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'UNSUPPORTED_WALKTHROUGH_PROVIDER' });
    expect(getWalkthroughService).not.toHaveBeenCalled();
  });
});
