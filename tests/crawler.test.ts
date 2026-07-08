import path from 'node:path';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runLinkCheck } from '../src/core/crawler.js';
import type { LinkTesterResult, ValidationRecord } from '../src/types.js';
import { startStaticServer, type StaticServer } from './helpers/staticServer.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(dirname, 'fixtures/site');

type TestServer = StaticServer & {
  server: Server;
};

const closeServer = async (server: Server): Promise<void> =>
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const startTestServer = async (
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
): Promise<TestServer> => {
  const server = createServer((request, response) => {
    void handler(request, response);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Unable to determine server address.');
  }

  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => await closeServer(server),
  };
};

const writeHtml = (response: ServerResponse, body: string): void => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(body);
};

const writeText = (
  response: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): void => {
  response.writeHead(status, { 'content-type': 'text/plain', ...headers });
  response.end(body);
};

const createDeferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve: resolve! };
};

const findRecord = (result: LinkTesterResult, url: string): ValidationRecord => {
  const record = result.validatedUrls.find((candidate) => candidate.url === url);

  if (record === undefined) {
    throw new Error(`Expected to find record for ${url}`);
  }

  return record;
};

describe('runLinkCheck', () => {
  let remoteServer: StaticServer;
  let localServer: StaticServer;
  let result: LinkTesterResult;

  beforeAll(async () => {
    remoteServer = await startStaticServer(fixtureRoot);
    localServer = await startStaticServer(fixtureRoot, {
      '%REMOTE_ORIGIN%': remoteServer.origin,
    });
    result = await runLinkCheck({
      urls: [`${localServer.origin}/`],
      concurrency: 2,
      timeout: 10_000,
    });
  });

  afterAll(async () => {
    await localServer.close();
    await remoteServer.close();
  });

  it('visits local HTML pages and does not visit remote pages', () => {
    expect(result.visitedPages.map((page) => page.url).toSorted()).toEqual([
      `${localServer.origin}/`,
      `${localServer.origin}/about.html`,
      `${localServer.origin}/contact.html`,
    ]);
  });

  it('validates local URLs and skips external URLs by default', () => {
    expect(findRecord(result, `${localServer.origin}/styles.css`).status).toBe('ok');
    expect(findRecord(result, `${localServer.origin}/image.png`).status).toBe('ok');
    expect(findRecord(result, `${localServer.origin}/document.pdf`).status).toBe('ok');
    expect(findRecord(result, `${remoteServer.origin}/ok.html`).status).toBe('skipped');
    expect(result.summary.skippedUrlCount).toBe(2);
  });

  it('reports local 404s as broken and skips external 404s by default', () => {
    const localMissing = findRecord(result, `${localServer.origin}/missing.html`);
    const remoteMissing = findRecord(result, `${remoteServer.origin}/missing.html`);

    expect(localMissing.status).toBe('broken');
    expect(localMissing.httpStatus).toBe(404);
    expect(remoteMissing.status).toBe('skipped');
    expect(remoteMissing.httpStatus).toBeUndefined();
  });

  it('dedupes validation while counting repeated sightings', () => {
    const about = findRecord(result, `${localServer.origin}/about.html`);
    const remoteOk = findRecord(result, `${remoteServer.origin}/ok.html`);

    expect(about.seenCount).toBe(2);
    expect(remoteOk.seenCount).toBe(2);
    expect(result.validatedUrls.filter((record) => record.url === about.url)).toHaveLength(1);
  });

  it('emits skipped progress only once for repeated external links', async () => {
    const skippedUrls: string[] = [];

    await runLinkCheck({
      urls: [`${localServer.origin}/`],
      concurrency: 2,
      timeout: 10_000,
      onProgress: (event) => {
        if (event.type === 'validation-skipped') {
          skippedUrls.push(event.url);
        }
      },
    });

    expect(skippedUrls.filter((url) => url === `${remoteServer.origin}/ok.html`)).toHaveLength(1);
  });

  it('skips URLs that contain configured plain text matches', async () => {
    const excludeResult = await runLinkCheck({
      urls: [`${localServer.origin}/`],
      concurrency: 2,
      timeout: 10_000,
      excludeUrlMatches: ['/missing.html', '/image.png'],
    });

    const localMissing = findRecord(excludeResult, `${localServer.origin}/missing.html`);
    const remoteMissing = findRecord(excludeResult, `${remoteServer.origin}/missing.html`);
    const image = findRecord(excludeResult, `${localServer.origin}/image.png`);

    expect(localMissing.status).toBe('skipped');
    expect(localMissing.statusText).toBe('Excluded by URL match: /missing.html');
    expect(localMissing.httpStatus).toBeUndefined();
    expect(remoteMissing.status).toBe('skipped');
    expect(image.status).toBe('skipped');
    expect(excludeResult.summary.brokenUrlCount).toBe(0);
    expect(excludeResult.summary.skippedUrlCount).toBe(4);
  });

  it('records source pages for broken links', () => {
    const localMissing = findRecord(result, `${localServer.origin}/missing.html`);

    expect(localMissing.sourcePages).toEqual([`${localServer.origin}/`]);
    expect(localMissing.sources[0]?.rawUrl).toBe('/missing.html');
  });

  it('builds page-centered and link-centered broken-link reports', () => {
    expect(result.reports.pages.map((pageReport) => pageReport.pageUrl).toSorted()).toEqual([
      `${localServer.origin}/`,
      `${localServer.origin}/about.html`,
      `${localServer.origin}/contact.html`,
    ]);

    const homePageReport = result.reports.pages.find((pageReport) => pageReport.pageUrl === `${localServer.origin}/`);
    const contactPageReport = result.reports.pages.find(
      (pageReport) => pageReport.pageUrl === `${localServer.origin}/contact.html`,
    );
    const localMissingReport = result.reports.brokenLinks.find(
      (brokenLink) => brokenLink.url === `${localServer.origin}/missing.html`,
    );

    expect(homePageReport?.brokenLinks.map((record) => record.url)).toContain(`${localServer.origin}/missing.html`);
    expect(contactPageReport?.brokenLinks).toEqual([]);
    expect(localMissingReport?.sourcePages).toEqual([`${localServer.origin}/`]);
  });

  it('ignores non-HTTP links', () => {
    expect(result.validatedUrls.some((record) => record.url.startsWith('mailto:'))).toBe(false);
  });

  it('validates but does not crawl all external domains when explicitly allowed', async () => {
    const allowExternalResult = await runLinkCheck({
      urls: [`${localServer.origin}/`],
      concurrency: 2,
      timeout: 10_000,
      allowExternal: true,
    });

    expect(findRecord(allowExternalResult, `${remoteServer.origin}/ok.html`).status).toBe('ok');
    expect(findRecord(allowExternalResult, `${remoteServer.origin}/missing.html`).status).toBe('broken');
    expect(allowExternalResult.visitedPages.map((page) => page.url)).not.toContain(`${remoteServer.origin}/ok.html`);
    expect(allowExternalResult.summary.skippedUrlCount).toBe(0);
  });

  it('stops queued local validations on cancellation after active requests finish', async () => {
    const firstRequestStarted = createDeferred();
    const releaseFirstRequest = createDeferred();
    const local = await startTestServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');

      if (requestUrl.pathname === '/') {
        writeHtml(
          response,
          '<!doctype html><a href="/one.txt">One</a><a href="/two.txt">Two</a><a href="/three.txt">Three</a>',
        );
        return;
      }

      if (requestUrl.pathname === '/one.txt') {
        firstRequestStarted.resolve();
        await releaseFirstRequest.promise;
      }

      writeText(response, 200, 'ok');
    });
    const abortController = new AbortController();

    try {
      const linkCheck = runLinkCheck({
        urls: [`${local.origin}/`],
        concurrency: 1,
        timeout: 10_000,
        signal: abortController.signal,
        onProgress: (event) => {
          if (event.type === 'validation-start' && event.url === `${local.origin}/one.txt`) {
            abortController.abort();
          }
        },
      });

      await firstRequestStarted.promise;
      releaseFirstRequest.resolve();

      const cancelledResult = await linkCheck;

      expect(cancelledResult.summary.cancelled).toBe(true);
      expect(cancelledResult.summary.pendingUrlCount).toBe(2);
      expect(findRecord(cancelledResult, `${local.origin}/one.txt`).status).toBe('ok');
      expect(findRecord(cancelledResult, `${local.origin}/two.txt`).status).toBe('pending');
      expect(findRecord(cancelledResult, `${local.origin}/three.txt`).status).toBe('pending');
    } finally {
      releaseFirstRequest.resolve();
      await local.close();
    }
  });

  it('validates but does not crawl whitelisted external domains', async () => {
    const whitelistResult = await runLinkCheck({
      urls: [`${localServer.origin}/`],
      concurrency: 2,
      timeout: 10_000,
      allowWhitelist: ['127.0.0.1'],
    });

    expect(findRecord(whitelistResult, `${remoteServer.origin}/ok.html`).status).toBe('ok');
    expect(findRecord(whitelistResult, `${remoteServer.origin}/missing.html`).status).toBe('broken');
    expect(whitelistResult.visitedPages.map((page) => page.url)).not.toContain(`${remoteServer.origin}/ok.html`);
    expect(whitelistResult.summary.skippedUrlCount).toBe(0);
  });

  it('stops queued external validations on cancellation after active requests finish', async () => {
    const requestedPaths: string[] = [];
    const firstRequestStarted = createDeferred();
    const releaseFirstRequest = createDeferred();
    const remote = await startTestServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');
      requestedPaths.push(requestUrl.pathname);

      if (requestUrl.pathname === '/robots.txt') {
        writeText(response, 404, 'not found');
        return;
      }

      if (requestUrl.pathname === '/one.html') {
        firstRequestStarted.resolve();
        await releaseFirstRequest.promise;
      }

      writeText(response, 200, 'ok');
    });
    const local = await startTestServer((_request, response) => {
      writeHtml(
        response,
        `<!doctype html><a href="${remote.origin}/one.html">One</a><a href="${remote.origin}/two.html">Two</a><a href="${remote.origin}/three.html">Three</a>`,
      );
    });
    const abortController = new AbortController();

    try {
      const linkCheck = runLinkCheck({
        urls: [`${local.origin}/`],
        concurrency: 1,
        timeout: 10_000,
        allowExternal: true,
        signal: abortController.signal,
        onProgress: (event) => {
          if (event.type === 'validation-start' && event.url === `${remote.origin}/one.html`) {
            abortController.abort();
          }
        },
      });

      await firstRequestStarted.promise;
      releaseFirstRequest.resolve();

      const cancelledResult = await linkCheck;

      expect(cancelledResult.summary.cancelled).toBe(true);
      expect(cancelledResult.summary.pendingUrlCount).toBe(2);
      expect(findRecord(cancelledResult, `${remote.origin}/one.html`).status).toBe('ok');
      expect(findRecord(cancelledResult, `${remote.origin}/two.html`).status).toBe('pending');
      expect(findRecord(cancelledResult, `${remote.origin}/three.html`).status).toBe('pending');
      expect(requestedPaths).not.toContain('/two.html');
      expect(requestedPaths).not.toContain('/three.html');
    } finally {
      releaseFirstRequest.resolve();
      await local.close();
      await remote.close();
    }
  });

  it('rejects allowing all external domains with a whitelist', async () => {
    await expect(
      runLinkCheck({
        urls: [`${localServer.origin}/`],
        concurrency: 2,
        timeout: 10_000,
        allowExternal: true,
        allowWhitelist: ['127.0.0.1'],
      }),
    ).rejects.toThrow('allowExternal and allowWhitelist are incompatible');
  });

  it('validates allowed external URLs with HEAD and the crawler user agent', async () => {
    const requests: Array<{ method: string | undefined; pathname: string; userAgent: string | undefined }> = [];
    const remote = await startTestServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');
      requests.push({
        method: request.method,
        pathname: requestUrl.pathname,
        userAgent: request.headers['user-agent'],
      });
      writeText(response, 200, 'ok');
    });
    const local = await startTestServer((_request, response) => {
      writeHtml(response, `<!doctype html><a href="${remote.origin}/ok.html">Remote</a>`);
    });

    try {
      const externalResult = await runLinkCheck({
        urls: [`${local.origin}/`],
        concurrency: 1,
        timeout: 10_000,
        allowExternal: true,
      });

      expect(findRecord(externalResult, `${remote.origin}/ok.html`).status).toBe('ok');
      expect(requests).toContainEqual({
        method: 'GET',
        pathname: '/robots.txt',
        userAgent: 'bhouston-link-checker',
      });
      expect(requests).toContainEqual({
        method: 'HEAD',
        pathname: '/ok.html',
        userAgent: 'bhouston-link-checker',
      });
    } finally {
      await local.close();
      await remote.close();
    }
  });

  it('uses the configured user agent for local crawling and external validation', async () => {
    const customUserAgent = 'custom-link-checker';
    const localUserAgents: string[] = [];
    const remoteRequests: Array<{ method: string | undefined; pathname: string; userAgent: string | undefined }> = [];
    const remote = await startTestServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');
      remoteRequests.push({
        method: request.method,
        pathname: requestUrl.pathname,
        userAgent: request.headers['user-agent'],
      });
      writeText(response, 200, 'ok');
    });
    const local = await startTestServer((request, response) => {
      localUserAgents.push(request.headers['user-agent'] ?? '');
      writeHtml(response, `<!doctype html><a href="${remote.origin}/ok.html">Remote</a>`);
    });

    try {
      const externalResult = await runLinkCheck({
        urls: [`${local.origin}/`],
        concurrency: 1,
        timeout: 10_000,
        userAgent: customUserAgent,
        allowExternal: true,
      });

      expect(findRecord(externalResult, `${remote.origin}/ok.html`).status).toBe('ok');
      expect(localUserAgents).toContain(customUserAgent);
      expect(remoteRequests).toContainEqual({
        method: 'GET',
        pathname: '/robots.txt',
        userAgent: customUserAgent,
      });
      expect(remoteRequests).toContainEqual({
        method: 'HEAD',
        pathname: '/ok.html',
        userAgent: customUserAgent,
      });
    } finally {
      await local.close();
      await remote.close();
    }
  });

  it('skips external URLs disallowed by robots.txt', async () => {
    const requestedPaths: string[] = [];
    const remote = await startTestServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');
      requestedPaths.push(requestUrl.pathname);

      if (requestUrl.pathname === '/robots.txt') {
        writeText(response, 200, 'User-agent: bhouston-link-checker\nDisallow: /blocked\n');
        return;
      }

      writeText(response, 200, 'ok');
    });
    const local = await startTestServer((_request, response) => {
      writeHtml(response, `<!doctype html><a href="${remote.origin}/blocked/page.html">Blocked</a>`);
    });

    try {
      const externalResult = await runLinkCheck({
        urls: [`${local.origin}/`],
        concurrency: 1,
        timeout: 10_000,
        allowExternal: true,
      });
      const blockedRecord = findRecord(externalResult, `${remote.origin}/blocked/page.html`);

      expect(blockedRecord.status).toBe('skipped');
      expect(blockedRecord.statusText).toBe('Disallowed by robots.txt');
      expect(requestedPaths).toEqual(['/robots.txt']);
    } finally {
      await local.close();
      await remote.close();
    }
  });

  it('serializes external requests to the same domain', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const firstRequestStarted = createDeferred();
    const releaseFirstRequest = createDeferred();
    const remote = await startTestServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');

      if (requestUrl.pathname === '/robots.txt') {
        writeText(response, 404, 'not found');
        return;
      }

      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);

      if (requestUrl.pathname === '/one.html') {
        firstRequestStarted.resolve();
        await releaseFirstRequest.promise;
      }

      inFlight -= 1;
      writeText(response, 200, 'ok');
    });
    const local = await startTestServer((_request, response) => {
      writeHtml(
        response,
        `<!doctype html><a href="${remote.origin}/one.html">One</a><a href="${remote.origin}/two.html">Two</a>`,
      );
    });

    try {
      const linkCheck = runLinkCheck({
        urls: [`${local.origin}/`],
        concurrency: 1,
        timeout: 10_000,
        allowExternal: true,
      });

      await firstRequestStarted.promise;
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
      expect(maxInFlight).toBe(1);
      releaseFirstRequest.resolve();

      const externalResult = await linkCheck;
      expect(findRecord(externalResult, `${remote.origin}/one.html`).status).toBe('ok');
      expect(findRecord(externalResult, `${remote.origin}/two.html`).status).toBe('ok');
      expect(maxInFlight).toBe(1);
    } finally {
      releaseFirstRequest.resolve();
      await local.close();
      await remote.close();
    }
  });

  it('runs external queues for different domains concurrently', async () => {
    const firstRequestStarted = createDeferred();
    const secondRequestStarted = createDeferred();
    const releaseRequests = createDeferred();
    const firstRemote = await startTestServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');

      if (requestUrl.pathname === '/robots.txt') {
        writeText(response, 404, 'not found');
        return;
      }

      firstRequestStarted.resolve();
      await secondRequestStarted.promise;
      await releaseRequests.promise;
      writeText(response, 200, 'ok');
    });
    const secondRemote = await startTestServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');

      if (requestUrl.pathname === '/robots.txt') {
        writeText(response, 404, 'not found');
        return;
      }

      secondRequestStarted.resolve();
      await releaseRequests.promise;
      writeText(response, 200, 'ok');
    });
    const local = await startTestServer((_request, response) => {
      writeHtml(
        response,
        `<!doctype html><a href="${firstRemote.origin}/one.html">One</a><a href="${secondRemote.origin}/two.html">Two</a>`,
      );
    });

    try {
      const linkCheck = runLinkCheck({
        urls: [`${local.origin}/`],
        concurrency: 1,
        timeout: 10_000,
        allowExternal: true,
      });

      await firstRequestStarted.promise;
      await secondRequestStarted.promise;
      releaseRequests.resolve();

      const externalResult = await linkCheck;
      expect(findRecord(externalResult, `${firstRemote.origin}/one.html`).status).toBe('ok');
      expect(findRecord(externalResult, `${secondRemote.origin}/two.html`).status).toBe('ok');
    } finally {
      releaseRequests.resolve();
      await local.close();
      await firstRemote.close();
      await secondRemote.close();
    }
  });

  it('retries external validation after retryable responses', async () => {
    let attempts = 0;
    const remote = await startTestServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');

      if (requestUrl.pathname === '/robots.txt') {
        writeText(response, 404, 'not found');
        return;
      }

      attempts += 1;

      if (attempts === 1) {
        writeText(response, 429, 'retry later', { 'retry-after': '0' });
        return;
      }

      writeText(response, 200, 'ok');
    });
    const local = await startTestServer((_request, response) => {
      writeHtml(response, `<!doctype html><a href="${remote.origin}/flaky.html">Flaky</a>`);
    });

    try {
      const externalResult = await runLinkCheck({
        urls: [`${local.origin}/`],
        concurrency: 1,
        timeout: 10_000,
        allowExternal: true,
      });

      expect(findRecord(externalResult, `${remote.origin}/flaky.html`).status).toBe('ok');
      expect(attempts).toBe(2);
    } finally {
      await local.close();
      await remote.close();
    }
  });
});
