# Contributing

These rules apply to every contributor, including Claude and Codex. This file is
the single source of truth for the workflow.

## Issue → branch → PR

1. Before starting a feature or fix, open a GitHub issue (or reuse a matching
   existing one) using the bug or feature template. Include a description,
   motivation, and acceptance criteria.
2. Fetch `origin` and branch from `origin/main`. Branch names are not
   enforced; use whatever name is convenient. Never commit directly to `main`.
3. Use Conventional Commits for every commit: `type(scope): description`. Types:
   `feat`, `fix`, `perf`, `docs`, `chore`, `refactor`, `test`, `style`, `build`,
   `ci`, `revert`. Husky's `commit-msg` hook runs commitlint locally.
4. Run the checks below and fix any failures before requesting review.
5. Push the branch and open a PR against `main`, with a Conventional Commit title
   and `Closes #<issue>` in the body. The `PR policy` workflow checks the PR
   title, that the linked issue exists and is open, and lints every commit in
   the PR. Fix failed checks before merging. PRs are merged with merge commits
   (`gh pr merge --merge`); never squash or rebase-merge.
6. Merging a PR into `main` never publishes by itself. Release deliberately by
   dispatching the `Release` workflow on `main` whenever you want the
   accumulated changes published.

## Commit format

- `feat: crawl sitemap links` → minor release.
- `fix: retry flaky external checks` → patch release. `perf` also produces a patch release.
- `feat!: drop node 18 support` → major release. Include a `BREAKING CHANGE: explain migration`
  footer for users. A breaking-change footer also triggers a major release without `!`.
- Other types do not normally trigger releases unless marked breaking.

## Local checks

Use the Node version in `.nvmrc` and the pnpm version pinned in `package.json`,
then install dependencies (this enables Husky's hooks):

```sh
pnpm install
pnpm build
pnpm tsc
pnpm lint
pnpm release:check
pnpm test
pnpm audit --audit-level high
pnpm format
```

`.github/workflows/ci.yml` runs the same steps, plus a check that the publishable package still
assembles, on every push and pull request to `main`.

## Automated releases

Releases are computed from Conventional Commits by [semantic-release](https://semantic-release.gitbook.io/),
never run on push: dispatch `.github/workflows/release.yml` with `gh workflow run release.yml --ref main`.
It rejects dispatches against any ref other than `main`, re-runs the quality checks against the exact
dispatched commit, and aborts if `main` has advanced past that commit before the release step runs.
`pnpm release` first assembles the package into `publish/` via `scripts/make-release.ts --assemble-only`
(build, then stage `dist/`, `package.json`, and `README.md`), since `@semantic-release/npm` expects
that directory to already exist. semantic-release then computes the version from commits since the
previous `v*` tag, generates the changelog and release notes, copies the fresh `CHANGELOG.md` into
`publish/`, creates the tag and GitHub release, and publishes `bhouston-link-checker` through npm
trusted publishing (OIDC — no stored token), bumping `publish/package.json`'s version along the way.

semantic-release does not commit a version/changelog update back to `main`; there is no
`@semantic-release/git` step. The GitHub Release for each tag is the changelog of record, so the
`version` field checked into the root `package.json` and `CHANGELOG.md` are informational, not
authoritative. Do not edit versions manually or hand-push tags.

Use the workflow's `dry_run` input (`gh workflow run release.yml --ref main -f dry_run=true`) to
verify version/changelog computation without publishing. When there are no release-worthy commits
since the last tag, the workflow succeeds as a no-op.

The migration baseline is `v1.0.0` at `5dec635b4c185d9d89534b0618392172f0b20a9e`, matching the
`gitHead` npm recorded for the already-published `1.0.0`. Do not move this tag or tag unreleased
work as a published version.

## One-time maintainer setup

1. Require the `Quality checks` and `Contribution policy` checks on contributor PRs to `main`.
2. In the npm package settings for **bhouston-link-checker**, add a GitHub Actions trusted publisher:
   - Organization or user: `bhouston`
   - Repository: `bhouston-link-tester`
   - Workflow filename: `release.yml`
   - Environment name: leave blank
3. After saving the npm settings, enable publishing with `gh variable set NPM_TRUSTED_PUBLISHING_ENABLED --body true`. Until then the release job is skipped. Do not add `NPM_TOKEN`; authentication uses `id-token: write`.
4. Merge feature PRs into `main` as they land. When ready to publish, dispatch `Release` on `main`.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[semantic-release on GitHub Actions](https://semantic-release.gitbook.io/semantic-release/recipes/ci-configurations/github-actions).

## Local package inspection

To build and inspect the publishable package without going through semantic-release:

```sh
node scripts/make-release.ts . --assemble-only
npm pack --dry-run ./publish
```
