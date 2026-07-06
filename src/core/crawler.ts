import { chromium, type BrowserContext, type Page } from 'playwright';
import pLimit from 'p-limit';

import { extractLinksFromDocument } from './extractLinks.js';
import {
  isHostnameAllowed,
  isHtmlContentType,
  isLocalUrl,
  normalizeUrl,
  normalizeWhitelistDomain,
  type NormalizedUrl,
} from './url.js';
import type {
  ExtractedLink,
  LinkSource,
  LinkTesterOptions,
  LinkTesterResult,
  PageVisitRecord,
  ValidationRecord,
} from '../types.js';

type QueueTask = {
  normalizedUrl: string;
};

type MutableValidationRecord = Omit<ValidationRecord, 'sourcePages' | 'sources'> & {
  sourcePages: Set<string>;
  sources: LinkSource[];
};

type CrawlerState = {
  localOrigins: Set<string>;
  crawlableExternalDomains: Set<string>;
  validateExternal: boolean;
  onProgress: LinkTesterOptions['onProgress'];
  queue: QueueTask[];
  enqueuedUrls: Set<string>;
  validatedUrls: Map<string, MutableValidationRecord>;
  visitedPages: Map<string, PageVisitRecord>;
};

const createValidationRecord = (normalizedUrl: NormalizedUrl, isLocal: boolean): MutableValidationRecord => ({
  url: normalizedUrl.url,
  normalizedUrl: normalizedUrl.key,
  isLocal,
  status: 'pending',
  seenCount: 0,
  sourcePages: new Set(),
  sources: [],
});

const toSerializableRecord = (record: MutableValidationRecord): ValidationRecord => ({
  ...record,
  sourcePages: [...record.sourcePages].toSorted(),
  sources: [...record.sources],
});

const createResult = (state: CrawlerState, seedUrls: string[]): LinkTesterResult => {
  const validatedUrls = [...state.validatedUrls.values()]
    .map(toSerializableRecord)
    .toSorted((a, b) => a.url.localeCompare(b.url));
  const visitedPages = [...state.visitedPages.values()].toSorted((a, b) => a.url.localeCompare(b.url));
  const brokenUrls = validatedUrls.filter((record) => record.status === 'broken');
  const brokenUrlCount = validatedUrls.filter((record) => record.status === 'broken').length;
  const okUrlCount = validatedUrls.filter((record) => record.status === 'ok').length;
  const skippedUrlCount = validatedUrls.filter((record) => record.status === 'skipped').length;
  const pages = visitedPages.map((page) => ({
    pageUrl: page.normalizedUrl,
    brokenLinks: brokenUrls.filter((record) => record.sourcePages.includes(page.normalizedUrl)),
  }));
  const brokenLinks = brokenUrls.map((record) => ({
    url: record.url,
    status: record.httpStatus,
    error: record.error,
    seenCount: record.seenCount,
    sourcePages: record.sourcePages,
  }));

  return {
    summary: {
      seedUrls,
      validatedUrlCount: validatedUrls.length,
      visitedPageCount: visitedPages.filter((record) => record.status === 'visited').length,
      brokenUrlCount,
      okUrlCount,
      skippedUrlCount,
    },
    validatedUrls,
    visitedPages,
    reports: {
      pages,
      brokenLinks,
    },
  };
};

const isCrawlableUrl = (normalizedUrl: NormalizedUrl, state: CrawlerState): boolean =>
  isLocalUrl(normalizedUrl, state.localOrigins) ||
  isHostnameAllowed(normalizedUrl.hostname, state.crawlableExternalDomains);

const enqueueUrl = (
  state: CrawlerState,
  rawUrl: string,
  source: LinkSource | undefined,
  baseUrl?: string,
): MutableValidationRecord | null => {
  const normalizedUrl = normalizeUrl(rawUrl, baseUrl);

  if (normalizedUrl === null) {
    return null;
  }

  let record = state.validatedUrls.get(normalizedUrl.key);

  if (record === undefined) {
    record = createValidationRecord(normalizedUrl, isCrawlableUrl(normalizedUrl, state));
    state.validatedUrls.set(normalizedUrl.key, record);
  }

  record.seenCount += 1;

  if (source !== undefined) {
    record.sourcePages.add(source.pageUrl);
    record.sources.push(source);
  }

  if (!record.isLocal && optionsShouldSkipExternal(state, record)) {
    record.status = 'skipped';
    record.statusText = 'External validation disabled';
    record.error = undefined;
    state.onProgress?.({
      type: 'validation-skipped',
      url: record.url,
      reason: 'external validation disabled',
    });
    return record;
  }

  if (!state.enqueuedUrls.has(normalizedUrl.key)) {
    state.enqueuedUrls.add(normalizedUrl.key);
    state.queue.push({ normalizedUrl: normalizedUrl.key });
  }

  return record;
};

const optionsShouldSkipExternal = (state: CrawlerState, record: MutableValidationRecord): boolean =>
  state.localOrigins.size > 0 && !record.isLocal && state.validateExternal === false;

const getResponseStatusText = (status: number | undefined): string | undefined => {
  if (status === undefined) {
    return undefined;
  }

  if (status >= 400) {
    return `HTTP ${status}`;
  }

  return undefined;
};

const validateWithPage = async (
  page: Page,
  context: BrowserContext,
  state: CrawlerState,
  record: MutableValidationRecord,
  options: LinkTesterOptions,
) => {
  record.status = 'checking';
  options.onProgress?.({
    type: 'validation-start',
    url: record.url,
    isLocal: record.isLocal,
  });

  try {
    const response = await page.goto(record.url, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeout,
    });
    if (response === null) {
      record.status = 'broken';
      record.error = 'No response returned for navigation.';
      return;
    }

    const status = response.status();
    const contentType = response.headers()['content-type'];
    const redirectUrl = page.url() !== record.url ? page.url() : undefined;

    record.httpStatus = status;
    record.contentType = contentType;
    record.redirectUrl = redirectUrl;
    record.statusText = getResponseStatusText(status);

    if (status >= 400) {
      record.status = 'broken';
      record.error = `HTTP ${status}`;
      return;
    }

    record.status = 'ok';
    record.error = undefined;

    await visitLocalPageIfNeeded(page, context, state, record, options);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Download is starting')) {
      await validateWithRequest(context, record, options);
      return;
    }

    record.status = 'broken';
    record.error = error instanceof Error ? error.message : String(error);
  } finally {
    options.onProgress?.({
      type: 'validation-complete',
      url: record.url,
      isLocal: record.isLocal,
      status: record.status,
      httpStatus: record.httpStatus,
      error: record.error,
    });
  }
};

const validateWithRequest = async (
  context: BrowserContext,
  record: MutableValidationRecord,
  options: LinkTesterOptions,
) => {
  try {
    const response = await context.request.get(record.url, {
      timeout: options.timeout,
      maxRedirects: 20,
    });
    const status = response.status();
    const redirectUrl = response.url() !== record.url ? response.url() : undefined;

    record.httpStatus = status;
    record.contentType = response.headers()['content-type'];
    record.redirectUrl = redirectUrl;
    record.statusText = getResponseStatusText(status);
    record.status = status >= 400 ? 'broken' : 'ok';
    record.error = status >= 400 ? `HTTP ${status}` : undefined;
  } catch (error) {
    record.status = 'broken';
    record.error = error instanceof Error ? error.message : String(error);
  }
};

const shouldVisitPage = (state: CrawlerState, record: MutableValidationRecord, options: LinkTesterOptions): boolean => {
  if (!record.isLocal || record.status !== 'ok' || !isHtmlContentType(record.contentType)) {
    return false;
  }

  if (state.visitedPages.has(record.normalizedUrl)) {
    return false;
  }

  return options.maxPages === undefined || state.visitedPages.size < options.maxPages;
};

const visitLocalPageIfNeeded = async (
  page: Page,
  _context: BrowserContext,
  state: CrawlerState,
  record: MutableValidationRecord,
  options: LinkTesterOptions,
) => {
  if (!shouldVisitPage(state, record, options)) {
    return;
  }

  let discoveredLinks: ExtractedLink[] = [];

  try {
    discoveredLinks = await page.evaluate(extractLinksFromDocument);
  } catch (error) {
    state.visitedPages.set(record.normalizedUrl, {
      url: record.url,
      normalizedUrl: record.normalizedUrl,
      status: 'failed',
      httpStatus: record.httpStatus,
      contentType: record.contentType,
      discoveredUrlCount: 0,
      error: error instanceof Error ? error.message : String(error),
    });
    options.onProgress?.({
      type: 'page-visit-failed',
      url: record.url,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  state.visitedPages.set(record.normalizedUrl, {
    url: record.url,
    normalizedUrl: record.normalizedUrl,
    status: 'visited',
    httpStatus: record.httpStatus,
    contentType: record.contentType,
    discoveredUrlCount: discoveredLinks.length,
  });
  options.onProgress?.({
    type: 'page-visited',
    url: record.url,
    discoveredUrlCount: discoveredLinks.length,
  });

  for (const link of discoveredLinks) {
    enqueueUrl(
      state,
      link.url,
      {
        pageUrl: record.normalizedUrl,
        rawUrl: link.rawUrl,
        attribute: link.attribute,
      },
      record.url,
    );
  }
};

const validateTask = async (
  context: BrowserContext,
  state: CrawlerState,
  options: LinkTesterOptions,
  task: QueueTask,
) => {
  const record = state.validatedUrls.get(task.normalizedUrl);

  if (record === undefined || record.status === 'ok' || record.status === 'broken' || record.status === 'skipped') {
    return;
  }

  const page = await context.newPage();

  try {
    await validateWithPage(page, context, state, record, options);
  } finally {
    await page.close();
  }
};

const validateQueue = async (context: BrowserContext, state: CrawlerState, options: LinkTesterOptions) => {
  const limit = pLimit(options.concurrency);
  const inFlight = new Set<Promise<void>>();

  const scheduleQueuedTasks = () => {
    while (state.queue.length > 0) {
      const task = state.queue.shift();

      if (task === undefined) {
        continue;
      }

      const promise = limit(async () => {
        await validateTask(context, state, options, task);
      }).finally(() => {
        inFlight.delete(promise);
      });

      inFlight.add(promise);
    }
  };

  scheduleQueuedTasks();

  while (inFlight.size > 0) {
    await Promise.race(inFlight);
    scheduleQueuedTasks();
  }
};

export const runLinkCheck = async (options: LinkTesterOptions): Promise<LinkTesterResult> => {
  if (options.urls.length === 0) {
    throw new Error('At least one URL is required.');
  }

  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error('Concurrency must be a positive integer.');
  }

  const normalizedSeeds: NormalizedUrl[] = [];

  for (const url of options.urls) {
    const normalizedUrl = normalizeUrl(url);

    if (normalizedUrl === null) {
      throw new Error('All seed URLs must be absolute HTTP or HTTPS URLs.');
    }

    normalizedSeeds.push(normalizedUrl);
  }

  const seedUrls = normalizedSeeds.map((url) => url.url);
  const state: CrawlerState = {
    localOrigins: new Set(normalizedSeeds.map((url) => url.origin)),
    crawlableExternalDomains: new Set(
      (options.externalWhitelist ?? [])
        .map(normalizeWhitelistDomain)
        .filter((domain): domain is string => domain !== null),
    ),
    validateExternal: options.validateExternal !== false,
    onProgress: options.onProgress,
    queue: [],
    enqueuedUrls: new Set(),
    validatedUrls: new Map(),
    visitedPages: new Map(),
  };
  const browser = await chromium.launch({
    headless: options.showBrowser !== true,
  });
  const context = await browser.newContext({
    userAgent: options.userAgent,
  });

  try {
    for (const seedUrl of seedUrls) {
      enqueueUrl(state, seedUrl, undefined);
    }

    await validateQueue(context, state, options);
  } finally {
    await context.close();
    await browser.close();
  }

  return createResult(state, seedUrls);
};
