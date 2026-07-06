import type { BrokenLinkReport, LinkTesterResult, PageBrokenLinkReport, ValidationRecord } from '../types.js';

const formatLinkStatus = (record: Pick<ValidationRecord, 'httpStatus' | 'error'>): string =>
  String(record.httpStatus ?? record.error ?? 'unknown error');

const formatBrokenLinkForPage = (record: ValidationRecord): string[] => [
  `  - ${record.url}`,
  `    Status: ${formatLinkStatus(record)}`,
  `    Seen: ${record.seenCount}`,
];

const formatPageReport = (pageReport: PageBrokenLinkReport): string[] => {
  if (pageReport.brokenLinks.length === 0) {
    return [`- ${pageReport.pageUrl}`, '  No broken links found.'];
  }

  return [`- ${pageReport.pageUrl}`, ...pageReport.brokenLinks.flatMap(formatBrokenLinkForPage)];
};

const formatSourcesForLink = (record: BrokenLinkReport): string[] => {
  if (record.sourcePages.length === 0) {
    return ['  Source pages: seed URL'];
  }

  return record.sourcePages.map((sourcePage) => `  Source page: ${sourcePage}`);
};

const formatBrokenLinkReport = (record: BrokenLinkReport): string[] => [
  `- ${record.url}`,
  `  Status: ${record.status ?? record.error ?? 'unknown error'}`,
  `  Seen: ${record.seenCount}`,
  ...formatSourcesForLink(record),
];

const formatRedirectRecord = (record: ValidationRecord): string | null => {
  if (record.redirectUrl === undefined) {
    return null;
  }

  return `- ${record.url} -> ${record.redirectUrl}`;
};

export const renderJsonReport = (result: LinkTesterResult): string => `${JSON.stringify(result, null, 2)}\n`;

export const renderTextReport = (result: LinkTesterResult): string => {
  const redirects = result.validatedUrls.map(formatRedirectRecord).filter((line): line is string => line !== null);
  const lines = [
    'Link check complete',
    '',
    `Seed URLs: ${result.summary.seedUrls.length}`,
    `Visited pages: ${result.summary.visitedPageCount}`,
    `Validated URLs: ${result.summary.validatedUrlCount}`,
    `OK URLs: ${result.summary.okUrlCount}`,
    `Broken URLs: ${result.summary.brokenUrlCount}`,
    `Skipped URLs: ${result.summary.skippedUrlCount}`,
  ];

  lines.push('', 'Pages viewed:');

  for (const pageReport of result.reports.pages) {
    lines.push(...formatPageReport(pageReport));
  }

  if (result.reports.brokenLinks.length > 0) {
    lines.push('', 'Broken links by URL:');

    for (const record of result.reports.brokenLinks) {
      lines.push(...formatBrokenLinkReport(record));
    }
  }

  if (redirects.length > 0) {
    lines.push('', 'Redirects:');
    lines.push(...redirects);
  }

  return `${lines.join('\n')}\n`;
};
