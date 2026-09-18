# Contributing

These rules apply to every contributor, including Claude and Codex. This file is
the single source of truth for the workflow.

## Issue → branch → PR

1. Before starting a feature or fix, open a GitHub issue (or reuse a matching
   existing one). Include a description, motivation, and acceptance criteria.
2. Fetch `origin` and branch from `origin/main`. Branch names are not
   enforced; use whatever name is convenient. Never commit directly to `main`.
3. Use Conventional Commits for every commit: `type(scope): description`. Types:
   `feat`, `fix`, `perf`, `docs`, `chore`, `refactor`, `test`, `style`, `build`,
   `ci`, `revert`.
4. Run the checks below and fix any failures before requesting review.
5. Push the branch and open a PR against `main`, with a Conventional Commit title
   and `Closes #<issue>` in the body. PRs are merged with merge commits
   (`gh pr merge --merge`); never squash or rebase-merge.

## Local checks

Use the Node version in `.nvmrc` and the pnpm version pinned in `package.json`,
then install dependencies (this enables Husky's pre-commit hook):

```sh
pnpm install
pnpm build
pnpm tsc
pnpm lint
pnpm test
pnpm format
```

`.github/workflows/ci.yml` runs the same install/build/tsc/lint/test steps, plus a dependency audit
and a check that the publishable package still assembles, on every push and pull request to `main`.

## Releases

Publishing is manual and separate from merging to `main`, and there is no automated changelog —
bump the version in `package.json` yourself in a regular commit/PR before releasing.

To release:

1. Merge the version bump into `main`.
2. Dispatch the `Release` workflow: `gh workflow run release.yml --ref main`.
3. The workflow re-runs CI against the dispatched commit, aborts if `main` has advanced past it, then
   runs `node scripts/make-release.ts .`, which builds, stages `dist/`, `package.json`, and
   `README.md` into `publish/`, and runs `npm publish ./publish/ --access public` via npm trusted
   publishing (OIDC — no stored token).
4. Use `gh workflow run release.yml --ref main -f dry_run=true` to verify without publishing.

### One-time maintainer setup

In the npm package settings for **bhouston-link-checker**, add a GitHub Actions trusted publisher:

- Organization or user: `bhouston`
- Repository: `bhouston-link-tester`
- Workflow filename: `release.yml`
- Environment name: leave blank

No `NPM_TOKEN` is needed; publishing authenticates via `id-token: write`.
