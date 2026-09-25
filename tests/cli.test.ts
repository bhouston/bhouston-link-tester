import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commandLine } from 'vitest-command-line';

import type { LinkTesterResult } from '../src/types.js';
import { startStaticServer, type StaticServer } from './helpers/staticServer.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(dirname, '..');
const fixtureRoot = path.join(dirname, 'fixtures/site');

describe('bhouston-link-checker CLI', () => {
  const cli = commandLine({
    command: ['node', './dist/bin/bhouston-link-checker.js'],
    cwd: projectRoot,
    env: { FORCE_COLOR: '0' },
    stripAnsi: true,
  });
  let remoteServer: StaticServer;
  let localServer: StaticServer;

  beforeAll(async () => {
    remoteServer = await startStaticServer(fixtureRoot);
    localServer = await startStaticServer(fixtureRoot, {
      '%REMOTE_ORIGIN%': remoteServer.origin,
    });
  });

  afterAll(async () => {
    await localServer.close();
    await remoteServer.close();
  });

  it('emits JSON reports', async () => {
    const result = await cli.run([
      `${localServer.origin}/`,
      '--concurrency',
      '2',
      '--timeout',
      '10000',
      '--json',
      '--no-fail-on-error',
    ]);
    const report = result.json<LinkTesterResult>();

    expect(result.success).toBe(true);
    expect(result.stderr).toContain('Confirmed ');
    expect(result.stderr).toContain('Error ');
    expect(result.stderr).toContain('Ignored ');
    expect(result.stderr).not.toContain('Checking ');
    expect(result.stderr).not.toContain('Visited page:');
    expect(report.summary.visitedPageCount).toBe(3);
    expect(report.summary.brokenUrlCount).toBe(1);
    expect(report.summary.skippedUrlCount).toBe(2);
    expect(report.reports.pages).toHaveLength(3);
    expect(report.reports.brokenLinks.map((brokenLink) => brokenLink.url)).toContain(
      `${localServer.origin}/missing.html`,
    );
  });

  it('fails by default when broken links are found', async () => {
    const result = await cli.run([`${localServer.origin}/`, '--concurrency', '2', '--timeout', '10000']);

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Broken URLs: 1');
    expect(result.stdout).toContain('Pages viewed:');
    expect(result.stdout).toContain('Broken links by URL:');
    expect(result.stdout).toContain('No broken links found.');
    expect(result.stdout).toContain(`${localServer.origin}/missing.html`);
  });

  it('can suppress progress output', async () => {
    const result = await cli.run([
      `${localServer.origin}/`,
      '--concurrency',
      '2',
      '--timeout',
      '10000',
      '--quiet',
      '--no-fail-on-error',
    ]);

    expect(result.success).toBe(true);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Link check complete');
  });

  it('skips external URLs by default', async () => {
    const result = await cli.run([
      `${localServer.origin}/`,
      '--concurrency',
      '2',
      '--timeout',
      '10000',
      '--json',
      '--quiet',
      '--no-fail-on-error',
    ]);
    const report = result.json<LinkTesterResult>();

    expect(result.success).toBe(true);
    expect(report.summary.brokenUrlCount).toBe(1);
    expect(report.summary.skippedUrlCount).toBe(2);
    expect(report.validatedUrls.find((record) => record.url === `${remoteServer.origin}/ok.html`)?.status).toBe(
      'skipped',
    );
  });

  it('can allow whitelisted external domains for validation', async () => {
    const result = await cli.run([
      `${localServer.origin}/`,
      '--concurrency',
      '2',
      '--timeout',
      '10000',
      '--json',
      '--quiet',
      '--allow-whitelist',
      '127.0.0.1',
      '--no-fail-on-error',
    ]);
    const report = result.json<LinkTesterResult>();

    expect(result.success).toBe(true);
    expect(report.summary.skippedUrlCount).toBe(0);
    expect(report.validatedUrls.find((record) => record.url === `${remoteServer.origin}/ok.html`)?.status).toBe('ok');
    expect(report.visitedPages.map((page) => page.url)).not.toContain(`${remoteServer.origin}/ok.html`);
  });

  it('can exclude URLs with repeated plain text matches', async () => {
    const result = await cli.run([
      `${localServer.origin}/`,
      '--concurrency',
      '2',
      '--timeout',
      '10000',
      '--json',
      '--quiet',
      '--exclude-url-match',
      '/missing.html',
      '--exclude-url-match',
      '/image.png',
      '--no-fail-on-error',
    ]);
    const report = result.json<LinkTesterResult>();

    expect(result.success).toBe(true);
    expect(report.summary.brokenUrlCount).toBe(0);
    expect(report.summary.skippedUrlCount).toBe(4);
    expect(report.validatedUrls.find((record) => record.url === `${localServer.origin}/missing.html`)?.status).toBe(
      'skipped',
    );
    expect(report.validatedUrls.find((record) => record.url === `${localServer.origin}/image.png`)?.status).toBe(
      'skipped',
    );
  });

  it('rejects allowing all external domains with a whitelist', async () => {
    const result = await cli.run([
      `${localServer.origin}/`,
      '--allow-external',
      '--allow-whitelist',
      '127.0.0.1',
      '--no-fail-on-error',
    ]);

    expect(result.success).toBe(false);
    expect(result.stderr).toContain('--allow-external and --allow-whitelist are incompatible');
  });

  it('generates an OpenCLI document describing its own commands', async () => {
    const result = await cli.run(['docgen']);
    const document = result.json<{
      opencliVersion: string;
      commands: Record<string, { flags?: { name: string }[] }>;
    }>();

    expect(result.success).toBe(true);
    expect(document.opencliVersion).toBeTruthy();
    expect(document.commands['bhouston-link-checker']?.flags?.map((flag) => flag.name)).toContain('concurrency');
    expect(document.commands['bhouston-link-checker docgen']).toBeDefined();
  });

  it('documents the headed browser option', async () => {
    const result = await cli.run(['--help']);

    expect(result.success).toBe(true);
    expect(result.stdout).toContain('--show-browser');
    expect(result.stdout).toContain('--headed');
    expect(result.stdout).toContain('--quiet');
    expect(result.stdout).toContain('--allow-external');
    expect(result.stdout).toContain('--allow-whitelist');
    expect(result.stdout).toContain('--exclude-url-match');
  });
});
