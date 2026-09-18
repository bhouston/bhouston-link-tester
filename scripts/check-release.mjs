import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import config from '../release.config.cjs';

// Resolve the plugins bundled with semantic-release, rather than installing
// competing copies that can drift out of compatibility with its writer.
const require = createRequire(import.meta.url);
const releaseRequire = createRequire(require.resolve('semantic-release'));
const { analyzeCommits } = await import(pathToFileURL(releaseRequire.resolve('@semantic-release/commit-analyzer')));
const { generateNotes } = await import(
  pathToFileURL(releaseRequire.resolve('@semantic-release/release-notes-generator'))
);
assert(
  !config.plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === '@semantic-release/git'),
  'main is protected and release commits are not pushed back to it; do not reintroduce @semantic-release/git.',
);
const context = {
  cwd: process.cwd(),
  logger: { log() {} },
  options: { repositoryUrl: 'https://github.com/bhouston/bhouston-link-tester' },
};

for (const [message, expected] of [
  ['feat: crawl sitemap links', 'minor'],
  ['fix: retry flaky external checks', 'patch'],
  ['docs: explain options', null],
  ['feat!: drop node 18 support', 'major'],
  ['refactor: rework the crawler queue\n\nBREAKING CHANGE: remove the legacy CLI flags', 'major'],
]) {
  const actual = await analyzeCommits(config.plugins[0][1], { ...context, commits: [{ message }] });
  assert.equal(actual, expected, message);
}

// Exercise actual note rendering: compatible analysis alone does not prove
// the Conventional Commits preset works with the installed changelog writer.
const notes = await generateNotes(config.plugins[1][1], {
  ...context,
  commits: [{ message: 'fix: retry flaky external checks', hash: 'a'.repeat(40) }],
  lastRelease: { version: '1.0.0', gitTag: 'v1.0.0' },
  nextRelease: { version: '1.0.1', gitTag: 'v1.0.1' },
});
assert.match(notes, /retry flaky external checks/);
assert.match(notes, /1\.0\.1/);
console.log('Release tooling: version rules and changelog rendering passed.');
