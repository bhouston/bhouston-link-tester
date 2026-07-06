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

  it('validates local and remote URLs', () => {
    expect(findRecord(result, `${localServer.origin}/styles.css`).status).toBe('ok');
    expect(findRecord(result, `${localServer.origin}/image.png`).status).toBe('ok');
    expect(findRecord(result, `${localServer.origin}/document.pdf`).status).toBe('ok');
    expect(findRecord(result, `${remoteServer.origin}/ok.html`).status).toBe('ok');
    expect(result.summary.skippedUrlCount).toBe(0);
  });

  it('reports local and remote 404s as broken', () => {
    const localMissing = findRecord(result, `${localServer.origin}/missing.html`);
    const remoteMissing = findRecord(result, `${remoteServer.origin}/missing.html`);

    expect(localMissing.status).toBe('broken');
    expect(localMissing.httpStatus).toBe(404);
    expect(remoteMissing.status).toBe('broken');
    expect(remoteMissing.httpStatus).toBe(404);
  });

  it('dedupes validation while counting repeated sightings', () => {
    const about = findRecord(result, `${localServer.origin}/about.html`);
    const remoteOk = findRecord(result, `${remoteServer.origin}/ok.html`);

    expect(about.seenCount).toBe(2);
    expect(remoteOk.seenCount).toBe(2);
    expect(result.validatedUrls.filter((record) => record.url === about.url)).toHaveLength(1);
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

  it('skips non-whitelisted external URLs when external validation is disabled', async () => {
    const noExternalResult = await runLinkCheck({
      urls: [`${localServer.origin}/`],
      concurrency: 2,
      timeout: 10_000,
      validateExternal: false,
    });

    expect(findRecord(noExternalResult, `${remoteServer.origin}/ok.html`).status).toBe('skipped');
    expect(findRecord(noExternalResult, `${remoteServer.origin}/missing.html`).status).toBe('skipped');
    expect(noExternalResult.summary.brokenUrlCount).toBe(1);
    expect(noExternalResult.summary.skippedUrlCount).toBe(2);
  });

  it('validates and crawls whitelisted external domains', async () => {
    const whitelistResult = await runLinkCheck({
      urls: [`${localServer.origin}/`],
      concurrency: 2,
      timeout: 10_000,
      validateExternal: false,
      externalWhitelist: ['127.0.0.1'],
    });

    expect(findRecord(whitelistResult, `${remoteServer.origin}/ok.html`).status).toBe('ok');
    expect(findRecord(whitelistResult, `${remoteServer.origin}/missing.html`).status).toBe('broken');
    expect(whitelistResult.visitedPages.map((page) => page.url)).toContain(`${remoteServer.origin}/ok.html`);
    expect(whitelistResult.summary.skippedUrlCount).toBe(0);
  });
});
