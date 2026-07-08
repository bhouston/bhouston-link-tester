export type LinkStatus = 'pending' | 'checking' | 'ok' | 'broken' | 'skipped';

export type LinkSource = {
  pageUrl: string;
  rawUrl: string;
  attribute: string;
};

export type ValidationRecord = {
  url: string;
  normalizedUrl: string;
  isLocal: boolean;
  status: LinkStatus;
  seenCount: number;
  sourcePages: string[];
  sources: LinkSource[];
  httpStatus?: number;
  statusText?: string;
  contentType?: string;
  redirectUrl?: string;
  error?: string;
};

export type PageVisitRecord = {
  url: string;
  normalizedUrl: string;
  status: 'visited' | 'failed' | 'skipped';
  httpStatus?: number;
  contentType?: string;
  discoveredUrlCount: number;
  error?: string;
};

export type ExtractedLink = {
  url: string;
  rawUrl: string;
  attribute: string;
};

export type LinkTesterOptions = {
  urls: string[];
  concurrency: number;
  timeout: number;
  userAgent?: string;
  maxPages?: number;
  showBrowser?: boolean;
  allowExternal?: boolean;
  allowWhitelist?: string[];
  excludeUrlMatches?: string[];
  onProgress?: (event: LinkTesterProgressEvent) => void;
};

export type LinkTesterProgressEvent =
  | {
      type: 'validation-start';
      url: string;
      isLocal: boolean;
    }
  | {
      type: 'validation-complete';
      url: string;
      isLocal: boolean;
      status: LinkStatus;
      httpStatus?: number;
      redirectUrl?: string;
      error?: string;
    }
  | {
      type: 'validation-skipped';
      url: string;
      reason: string;
    }
  | {
      type: 'page-visited';
      url: string;
      discoveredUrlCount: number;
    }
  | {
      type: 'page-visit-failed';
      url: string;
      error: string;
    };

export type LinkTesterSummary = {
  seedUrls: string[];
  validatedUrlCount: number;
  visitedPageCount: number;
  brokenUrlCount: number;
  okUrlCount: number;
  skippedUrlCount: number;
};

export type PageBrokenLinkReport = {
  pageUrl: string;
  brokenLinks: ValidationRecord[];
};

export type BrokenLinkReport = {
  url: string;
  status?: number;
  error?: string;
  seenCount: number;
  sourcePages: string[];
};

export type LinkTesterReports = {
  pages: PageBrokenLinkReport[];
  brokenLinks: BrokenLinkReport[];
};

export type LinkTesterResult = {
  summary: LinkTesterSummary;
  validatedUrls: ValidationRecord[];
  visitedPages: PageVisitRecord[];
  reports: LinkTesterReports;
};
