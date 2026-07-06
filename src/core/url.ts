const ignoredProtocols = new Set(['mailto:', 'tel:', 'javascript:', 'data:', 'blob:']);

export type NormalizedUrl = {
  url: string;
  key: string;
  origin: string;
  hostname: string;
};

export const normalizeUrl = (rawUrl: string, baseUrl?: string): NormalizedUrl | null => {
  const trimmedUrl = rawUrl.trim();

  if (trimmedUrl.length === 0) {
    return null;
  }

  let parsedUrl: URL;

  try {
    parsedUrl = baseUrl === undefined ? new URL(trimmedUrl) : new URL(trimmedUrl, baseUrl);
  } catch {
    return null;
  }

  if (ignoredProtocols.has(parsedUrl.protocol) || (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')) {
    return null;
  }

  parsedUrl.hash = '';

  return {
    url: parsedUrl.href,
    key: parsedUrl.href,
    origin: parsedUrl.origin,
    hostname: parsedUrl.hostname.toLowerCase(),
  };
};

export const isLocalUrl = (normalizedUrl: NormalizedUrl, localOrigins: ReadonlySet<string>): boolean =>
  localOrigins.has(normalizedUrl.origin);

export const isHtmlContentType = (contentType: string | undefined): boolean => {
  if (contentType === undefined) {
    return false;
  }

  return contentType.toLowerCase().split(';', 1)[0]?.trim() === 'text/html';
};

export const normalizeWhitelistDomain = (rawDomain: string): string | null => {
  const trimmedDomain = rawDomain.trim().toLowerCase();

  if (trimmedDomain.length === 0) {
    return null;
  }

  try {
    return new URL(trimmedDomain).hostname.toLowerCase();
  } catch {
    return trimmedDomain.replace(/^\*\./, '');
  }
};

export const isHostnameAllowed = (hostname: string, allowedDomains: ReadonlySet<string>): boolean => {
  const normalizedHostname = hostname.toLowerCase();

  for (const domain of allowedDomains) {
    if (normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`)) {
      return true;
    }
  }

  return false;
};
