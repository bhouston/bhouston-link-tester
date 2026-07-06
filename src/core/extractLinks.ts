import type { ExtractedLink } from '../types.js';

export const extractLinksFromDocument = (): ExtractedLink[] => {
  const links: ExtractedLink[] = [];
  // This helper must stay inside the evaluated function so Playwright can serialize it into the page.
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const parseSrcSet = (srcset: string): string[] =>
    srcset
      .split(',')
      .map((candidate) => candidate.trim().split(/\s+/, 1)[0])
      .filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);

  const addAttributeLinks = (selector: string, attribute: string) => {
    for (const element of document.querySelectorAll(selector)) {
      const rawUrl = element.getAttribute(attribute);

      if (rawUrl === null || rawUrl.trim().length === 0) {
        continue;
      }

      const resolvedUrl = (element as HTMLElement & Record<string, unknown>)[attribute];

      links.push({
        url: typeof resolvedUrl === 'string' && resolvedUrl.length > 0 ? resolvedUrl : rawUrl,
        rawUrl,
        attribute,
      });
    }
  };

  addAttributeLinks('a[href], area[href]', 'href');
  addAttributeLinks('link[href]', 'href');
  addAttributeLinks('script[src]', 'src');
  addAttributeLinks('img[src], iframe[src], source[src], video[src], audio[src], track[src], embed[src]', 'src');
  addAttributeLinks('object[data]', 'data');
  addAttributeLinks('form[action]', 'action');

  for (const element of document.querySelectorAll('img[srcset], source[srcset]')) {
    const srcset = element.getAttribute('srcset');

    if (srcset === null) {
      continue;
    }

    for (const rawUrl of parseSrcSet(srcset)) {
      links.push({
        url: new URL(rawUrl, document.baseURI).href,
        rawUrl,
        attribute: 'srcset',
      });
    }
  }

  return links;
};
