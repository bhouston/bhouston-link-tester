# bhouston-link-checker

[![Discord](https://img.shields.io/badge/Discord-Join%20Chat-5865F2?logo=discord&logoColor=white)](https://discord.gg/fwupDN493R)

A CLI for crawling a site and reporting broken links.

The checker starts from one or more seed URLs, visits same-origin HTML pages, extracts links and common asset references, validates the discovered URLs, and reports broken links by page and by URL.

## Features

- Crawls HTML pages from the seed URL origins only.
- Checks links from `a`, `area`, `link`, `script`, images, media, iframes, forms, `object[data]`, and `srcset`.
- Skips external URLs by default so local site checks stay bounded.
- Can validate all external URLs or a domain whitelist when needed, without following links found on those external pages.
- Checks external URLs with polite per-domain queues, `robots.txt`, `HEAD` requests, and the configured user agent.
- Emits readable text reports or machine-readable JSON.
- Uses Playwright with configurable concurrency for same-origin crawling.

## Install

```sh
pnpm add -g bhouston-link-checker
```

Or run it without a global install:

```sh
pnpm dlx bhouston-link-checker http://localhost:3000/
```

## Usage

```sh
bhouston-link-checker <urls..> [options]
```

Local development examples:

```sh
pnpm build
pnpm start http://localhost:8081/ --concurrency 6 --timeout 10000
pnpm start http://localhost:3000/ --concurrency 6 --timeout 10000
```

Example timed run:

```sh
time pnpm start http://localhost:8081/ --concurrency 6 --timeout 10000
# 18.05s user 8.12s system 208% cpu 12.528 total
```

By default, the command exits with code `1` when broken links are found. Use `--no-fail-on-error` when you want a report without failing the shell command.

If the run is cancelled with `Ctrl-C` or `SIGTERM`, the checker stops scheduling new work, lets in-flight requests finish, writes a partial report, and exits with the signal-style cancellation code. URLs discovered but not checked yet are reported as pending.

## Options

- `--concurrency <number>`: Maximum number of Playwright tabs to use for same-origin crawling. Defaults to `4`.
- `--timeout <ms>`: Navigation timeout in milliseconds. Defaults to `30000`.
- `--user-agent <value>`: Custom user agent for local crawling and external validation. Defaults to `bhouston-link-checker`.
- `--show-browser`, `--headed`: Show the Playwright browser while checking links.
- `--json`: Emit a JSON report instead of text.
- `--quiet`: Suppress progress output on stderr.
- `--allow-external`: Validate all external URLs.
- `--allow-whitelist <domain>`: Validate a specific external domain. Repeat for multiple domains.
- `--exclude-url-match <text>`: Skip URLs containing a plain text match. Repeat for multiple matches.
- `--fail-on-error`, `--no-fail-on-error`: Control whether broken links produce a non-zero exit code. Defaults to failing on errors.
- `--max-pages <number>`: Limit how many local pages are visited.

`--allow-external` and `--allow-whitelist` are mutually exclusive.

## JSON Output

```sh
bhouston-link-checker http://localhost:3000/ --json --quiet --no-fail-on-error
```

The JSON report includes:

- `summary`: Seed URLs, visited page count, validated URL count, broken URL count, OK URL count, skipped URL count, pending URL count, and whether the run was cancelled.
- `validatedUrls`: Every checked or skipped URL with status, source pages, redirects, HTTP status, and errors when present.
- `visitedPages`: Crawled pages and how many URLs were discovered on each page.
- `reports.pages`: Broken links grouped by source page.
- `reports.brokenLinks`: Broken links grouped by URL.

The local `pnpm start` script runs the built CLI from `dist`, so run `pnpm build` first after changing TypeScript source files.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the issue/branch/PR workflow, local checks, and release process.
