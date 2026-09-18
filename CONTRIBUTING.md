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

## Releases

Releases are cut manually and are not run by CI. From `main`, run
`pnpm make-release`, which builds the package, stages `dist/`, `package.json`,
and `README.md` into `publish/`, and runs `npm publish ./publish/ --access public`.
Bump the version in `package.json` before releasing; there is no automated
changelog.
