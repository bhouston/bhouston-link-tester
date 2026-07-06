import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runLinkCheck } from '../src/core/crawler.js';
import type { LinkTesterResult, ValidationRecord } from '../src/types.js';
import { startStaticServer, type StaticServer } from './helpers/staticServer.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(dirname, 'fixtures/site');

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
});
