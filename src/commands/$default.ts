import chalk from 'chalk';
import { defineCommand } from 'yargs-file-commands';

import { runLinkCheck } from '../core/crawler.js';
import { renderJsonReport, renderTextReport } from '../core/report.js';
import type { LinkTesterProgressEvent } from '../types.js';

const formatProgressEvent = (event: LinkTesterProgressEvent): string | null => {
  switch (event.type) {
    case 'validation-start':
      return null;
    case 'validation-complete': {
      const status = event.httpStatus ?? event.error ?? event.status;

      if (event.status === 'broken') {
        return chalk.red(`Error ${event.url} (${status})`);
      }

      if (event.redirectUrl !== undefined) {
        return chalk.yellow(`Redirect ${event.url} -> ${event.redirectUrl} (${status})`);
      }

      return chalk.green(`Confirmed ${event.url} (${status})`);
    }
    case 'page-visited':
      return null;
    case 'page-visit-failed':
      return chalk.red(`Error inspecting page ${event.url} (${event.error})`);
    case 'validation-skipped':
      return chalk.gray(`Ignored ${event.url} (${event.reason})`);
  }
};

export const command = defineCommand({
  command: '$0 <urls..>',
  describe: 'Validate links discovered from one or more seed URLs.',
  builder: (yargs) =>
    yargs
      .positional('urls', {
        type: 'string',
        array: true,
        demandOption: true,
        describe: 'Seed URLs to crawl.',
      })
      .option('concurrency', {
        type: 'number',
        default: 4,
        describe: 'Maximum number of Playwright tabs to use.',
      })
      .option('timeout', {
        type: 'number',
        default: 30_000,
        describe: 'Navigation timeout in milliseconds.',
      })
      .option('user-agent', {
        type: 'string',
        describe: 'Custom user agent for Playwright requests.',
      })
      .option('show-browser', {
        alias: 'headed',
        type: 'boolean',
        default: false,
        describe: 'Show the Playwright browser while validating links.',
      })
      .option('json', {
        type: 'boolean',
        default: false,
        describe: 'Emit a machine-readable JSON report.',
      })
      .option('quiet', {
        type: 'boolean',
        default: false,
        describe: 'Suppress running progress output.',
      })
      .option('allow-external', {
        type: 'boolean',
        default: false,
        describe: 'Validate all external URLs. Incompatible with --allow-whitelist.',
      })
      .option('allow-whitelist', {
        type: 'string',
        array: true,
        describe: 'External domain that may be validated. Repeat for multiple domains.',
      })
      .option('exclude-url-match', {
        type: 'string',
        array: true,
        describe: 'Plain text URL substring to skip. Repeat for multiple matches.',
      })
      .option('fail-on-error', {
        type: 'boolean',
        default: true,
        describe: 'Exit with a non-zero code when broken links are found.',
      })
      .option('max-pages', {
        type: 'number',
        describe: 'Maximum number of local pages to visit.',
      })
      .check((argv) => {
        if (argv.allowExternal === true && Array.isArray(argv.allowWhitelist) && argv.allowWhitelist.length > 0) {
          throw new Error(
            '--allow-external and --allow-whitelist are incompatible. Choose one external validation mode.',
          );
        }

        return true;
      }),
  handler: async (argv) => {
    const result = await runLinkCheck({
      urls: argv.urls,
      concurrency: argv.concurrency,
      timeout: argv.timeout,
      userAgent: argv.userAgent,
      maxPages: argv.maxPages,
      showBrowser: argv.showBrowser,
      allowExternal: argv.allowExternal,
      allowWhitelist: argv.allowWhitelist,
      excludeUrlMatches: argv.excludeUrlMatch,
      onProgress: argv.quiet
        ? undefined
        : (event) => {
            const message = formatProgressEvent(event);

            if (message !== null) {
              process.stderr.write(`${message}\n`);
            }
          },
    });

    process.stdout.write(argv.json ? renderJsonReport(result) : renderTextReport(result));

    if (argv.failOnError && result.summary.brokenUrlCount > 0) {
      process.exitCode = 1;
    }
  },
});
