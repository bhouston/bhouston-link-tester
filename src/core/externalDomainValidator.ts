import http, { type Agent as HttpAgent } from 'node:http';
import https, { type Agent as HttpsAgent } from 'node:https';

import type { LinkSource, LinkTesterOptions, ValidationRecord } from '../types.js';

const MAX_REDIRECTS = 20;
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 250;
const RETRYABLE_STATUSES = new Set([403, 429, 503]);

type MutableValidationRecord = Omit<ValidationRecord, 'sourcePages' | 'sources'> & {
  sourcePages: Set<string>;
  sources: LinkSource[];
};

type RobotsRules = {
  allow: string[];
  disallow: string[];
  crawlDelayMs: number;
};

type HttpResult = {
  status: number;
  headers: http.IncomingHttpHeaders;
  url: string;
  body?: string;
};

type QueuedExternalValidation = {
  record: MutableValidationRecord;
  resolve: () => void;
  reject: (error: unknown) => void;
};

const getResponseStatusText = (status: number | undefined): string | undefined => {
  if (status === undefined) {
    return undefined;
  }

  if (status >= 400) {
    return `HTTP ${status}`;
  }

  return undefined;
};

const sleep = async (delayMs: number): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const parseRetryAfterMs = (retryAfter: string | string[] | undefined): number | null => {
  const value = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;

  if (value === undefined) {
    return null;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryDate = Date.parse(value);

  if (Number.isNaN(retryDate)) {
    return null;
  }

  return Math.max(0, retryDate - Date.now());
};

const getHeaderValue = (headers: http.IncomingHttpHeaders, name: string): string | undefined => {
  const value = headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

const matchesRobotsPath = (pattern: string, path: string): boolean => {
  if (pattern.length === 0) {
    return false;
  }

  return path.startsWith(pattern);
};

const getLongestMatchLength = (patterns: string[], path: string): number =>
  patterns
    .filter((pattern) => matchesRobotsPath(pattern, path))
    .map((pattern) => pattern.length)
    .reduce((longest, length) => Math.max(longest, length), 0);

const isPathAllowedByRobots = (rules: RobotsRules, url: string): boolean => {
  const parsedUrl = new URL(url);
  const path = `${parsedUrl.pathname}${parsedUrl.search}`;
  const allowLength = getLongestMatchLength(rules.allow, path);
  const disallowLength = getLongestMatchLength(rules.disallow, path);

  return disallowLength === 0 || allowLength >= disallowLength;
};

const createEmptyRules = (): RobotsRules => ({
  allow: [],
  disallow: [],
  crawlDelayMs: 0,
});

const parseRobotsTxt = (robotsText: string, userAgent: string): RobotsRules => {
  const groups: Array<RobotsRules & { userAgents: string[] }> = [];
  let currentGroup: (RobotsRules & { userAgents: string[] }) | null = null;
  const normalizedUserAgent = userAgent.toLowerCase();

  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.split('#', 1)[0]?.trim() ?? '';

    if (line.length === 0) {
      currentGroup = null;
      continue;
    }

    const separatorIndex = line.indexOf(':');

    if (separatorIndex === -1) {
      continue;
    }

    const field = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();

    if (field === 'user-agent') {
      if (currentGroup === null || currentGroup.allow.length > 0 || currentGroup.disallow.length > 0) {
        currentGroup = { ...createEmptyRules(), userAgents: [] };
        groups.push(currentGroup);
      }

      currentGroup.userAgents.push(value.toLowerCase());
      continue;
    }

    if (currentGroup === null) {
      continue;
    }

    if (field === 'allow') {
      currentGroup.allow.push(value);
      continue;
    }

    if (field === 'disallow') {
      if (value.length > 0) {
        currentGroup.disallow.push(value);
      }
      continue;
    }

    if (field === 'crawl-delay') {
      const delaySeconds = Number(value);

      if (Number.isFinite(delaySeconds) && delaySeconds >= 0) {
        currentGroup.crawlDelayMs = delaySeconds * 1000;
      }
    }
  }

  const exactGroup = groups.find((group) => group.userAgents.includes(normalizedUserAgent));
  const wildcardGroup = groups.find((group) => group.userAgents.includes('*'));
  const selectedGroup = exactGroup ?? wildcardGroup;

  if (selectedGroup === undefined) {
    return createEmptyRules();
  }

  return {
    allow: selectedGroup.allow,
    disallow: selectedGroup.disallow,
    crawlDelayMs: selectedGroup.crawlDelayMs,
  };
};

const createAgent = (url: URL): HttpAgent | HttpsAgent =>
  url.protocol === 'https:'
    ? new https.Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 })
    : new http.Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 });

class ExternalDomainValidator {
  readonly #origin: string;
  readonly #agent: HttpAgent | HttpsAgent;
  readonly #timeout: number;
  readonly #userAgent: string;
  readonly #onProgress: LinkTesterOptions['onProgress'];
  readonly #queue: QueuedExternalValidation[] = [];
  #isRunning = false;
  #isStopping = false;
  #idlePromise: Promise<void> = Promise.resolve();
  #resolveIdle: (() => void) | null = null;
  #robotsRules: Promise<RobotsRules> | null = null;
  #nextRequestAt = 0;

  constructor(origin: string, timeout: number, userAgent: string, onProgress: LinkTesterOptions['onProgress']) {
    this.#origin = origin;
    this.#agent = createAgent(new URL(origin));
    this.#timeout = timeout;
    this.#userAgent = userAgent;
    this.#onProgress = onProgress;
  }

  enqueue(record: MutableValidationRecord): Promise<void> {
    if (this.#isStopping) {
      return Promise.resolve();
    }

    if (record.status === 'ok' || record.status === 'broken' || record.status === 'skipped') {
      return Promise.resolve();
    }

    if (this.#queue.length === 0 && !this.#isRunning) {
      this.#idlePromise = new Promise((resolve) => {
        this.#resolveIdle = resolve;
      });
    }

    const promise = new Promise<void>((resolve, reject) => {
      this.#queue.push({ record, resolve, reject });
    });

    this.#runQueue();

    return promise;
  }

  async waitForIdle(): Promise<void> {
    await this.#idlePromise;
  }

  stopAfterCurrentRequest(): void {
    this.#isStopping = true;

    for (const item of this.#queue.splice(0)) {
      item.resolve();
    }

    if (!this.#isRunning) {
      this.#resolveIdle?.();
      this.#resolveIdle = null;
    }
  }

  destroy(): void {
    this.#agent.destroy();
  }

  #runQueue(): void {
    if (this.#isRunning) {
      return;
    }

    this.#isRunning = true;
    void this.#processQueue();
  }

  async #processQueue(): Promise<void> {
    while (this.#queue.length > 0 && !this.#isStopping) {
      const item = this.#queue.shift();

      if (item === undefined) {
        continue;
      }

      try {
        await this.#validateRecord(item.record);
        item.resolve();
      } catch (error) {
        item.reject(error);
      }
    }

    this.#isRunning = false;
    this.#resolveIdle?.();
    this.#resolveIdle = null;
  }

  async #validateRecord(record: MutableValidationRecord): Promise<void> {
    record.status = 'checking';
    this.#onProgress?.({
      type: 'validation-start',
      url: record.url,
      isLocal: record.isLocal,
    });

    try {
      const robotsRules = await this.#getRobotsRules();

      if (!isPathAllowedByRobots(robotsRules, record.url)) {
        record.status = 'skipped';
        record.statusText = 'Disallowed by robots.txt';
        record.error = undefined;
        this.#onProgress?.({
          type: 'validation-skipped',
          url: record.url,
          reason: 'disallowed by robots.txt',
        });
        return;
      }

      const response = await this.#requestWithRetries(record.url, robotsRules);
      record.httpStatus = response.status;
      record.contentType = getHeaderValue(response.headers, 'content-type');
      record.redirectUrl = response.url !== record.url ? response.url : undefined;
      record.statusText = getResponseStatusText(response.status);
      record.status = response.status >= 400 ? 'broken' : 'ok';
      record.error = response.status >= 400 ? `HTTP ${response.status}` : undefined;
    } catch (error) {
      record.status = 'broken';
      record.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.#onProgress?.({
        type: 'validation-complete',
        url: record.url,
        isLocal: record.isLocal,
        status: record.status,
        httpStatus: record.httpStatus,
        redirectUrl: record.redirectUrl,
        error: record.error,
      });
    }
  }

  async #getRobotsRules(): Promise<RobotsRules> {
    this.#robotsRules ??= this.#fetchRobotsRules();

    return await this.#robotsRules;
  }

  async #fetchRobotsRules(): Promise<RobotsRules> {
    try {
      const robotsUrl = new URL('/robots.txt', this.#origin).href;
      const response = await this.#request(robotsUrl, 'GET', 0);

      if (response.status >= 400 || response.body === undefined) {
        return createEmptyRules();
      }

      return parseRobotsTxt(response.body, this.#userAgent);
    } catch {
      return createEmptyRules();
    }
  }

  async #requestWithRetries(url: string, robotsRules: RobotsRules): Promise<HttpResult> {
    let attempt = 0;
    let lastResponse: HttpResult | null = null;

    while (attempt <= MAX_RETRIES) {
      await this.#waitForNextRequestSlot(robotsRules.crawlDelayMs);
      const response = await this.#request(url, 'HEAD', MAX_REDIRECTS);

      if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_RETRIES) {
        return response;
      }

      lastResponse = response;
      const retryAfterMs = parseRetryAfterMs(response.headers['retry-after']);
      const backoffMs = retryAfterMs ?? BASE_BACKOFF_MS * 2 ** attempt;
      this.#nextRequestAt = Math.max(this.#nextRequestAt, Date.now() + backoffMs);
      attempt += 1;
    }

    if (lastResponse !== null) {
      return lastResponse;
    }

    throw new Error(`Unable to validate ${url}`);
  }

  async #waitForNextRequestSlot(crawlDelayMs: number): Promise<void> {
    const now = Date.now();
    const waitMs = Math.max(0, this.#nextRequestAt - now);

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    this.#nextRequestAt = Date.now() + crawlDelayMs;
  }

  async #request(url: string, method: 'GET' | 'HEAD', redirectsRemaining: number): Promise<HttpResult> {
    const response = await this.#requestOnce(url, method);
    const location = getHeaderValue(response.headers, 'location');

    if (location !== undefined && response.status >= 300 && response.status < 400 && redirectsRemaining > 0) {
      const redirectUrl = new URL(location, response.url).href;

      return await this.#request(redirectUrl, method, redirectsRemaining - 1);
    }

    return response;
  }

  async #requestOnce(url: string, method: 'GET' | 'HEAD'): Promise<HttpResult> {
    const parsedUrl = new URL(url);
    const requestModule = parsedUrl.protocol === 'https:' ? https : http;

    return await new Promise<HttpResult>((resolve, reject) => {
      const request = requestModule.request(
        parsedUrl,
        {
          method,
          agent: this.#agent,
          headers: {
            'user-agent': this.#userAgent,
          },
          timeout: this.#timeout,
        },
        (response) => {
          const chunks: Buffer[] = [];

          response.on('data', (chunk: Buffer) => {
            if (method === 'GET') {
              chunks.push(chunk);
            }
          });
          response.on('end', () => {
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              url,
              body: method === 'GET' ? Buffer.concat(chunks).toString('utf8') : undefined,
            });
          });
        },
      );

      request.on('timeout', () => {
        request.destroy(new Error(`Request timed out after ${this.#timeout}ms`));
      });
      request.on('error', reject);
      request.end();
    });
  }
}

export class ExternalDomainValidators {
  readonly #validators = new Map<string, ExternalDomainValidator>();
  readonly #timeout: number;
  readonly #userAgent: string;
  readonly #onProgress: LinkTesterOptions['onProgress'];

  constructor(options: Pick<LinkTesterOptions, 'timeout' | 'onProgress'> & { userAgent: string }) {
    this.#timeout = options.timeout;
    this.#userAgent = options.userAgent;
    this.#onProgress = options.onProgress;
  }

  enqueue(record: MutableValidationRecord): Promise<void> {
    const origin = new URL(record.url).origin;
    let validator = this.#validators.get(origin);

    if (validator === undefined) {
      validator = new ExternalDomainValidator(origin, this.#timeout, this.#userAgent, this.#onProgress);
      this.#validators.set(origin, validator);
    }

    return validator.enqueue(record);
  }

  stopAfterCurrentRequests(): void {
    for (const validator of this.#validators.values()) {
      validator.stopAfterCurrentRequest();
    }
  }

  async waitForIdle(): Promise<void> {
    while (true) {
      const validators = [...this.#validators.values()];
      await Promise.all(validators.map(async (validator) => await validator.waitForIdle()));

      if (validators.length === this.#validators.size) {
        return;
      }
    }
  }

  destroy(): void {
    for (const validator of this.#validators.values()) {
      validator.destroy();
    }
  }
}
