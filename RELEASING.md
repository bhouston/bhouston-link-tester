# Releasing

Releases are computed from Conventional Commits by
[semantic-release](https://semantic-release.gitbook.io/), never run on push:
dispatch `.github/workflows/release.yml` with
`gh workflow run release.yml --ref main`. It rejects dispatches against any ref
other than `main`, re-runs the quality checks against the exact dispatched
commit, and aborts if `main` has advanced past that commit before the release
step runs. The workflow runs `pnpm build` first, then `pnpm release`.
semantic-release computes the version from commits since the previous `v*` tag,
generates release notes, creates the tag and GitHub release (the notes become
the release body), and publishes `bhouston-link-checker` straight from the
repo root via `pnpm publish` (through `@anolilab/semantic-release-pnpm`) using
npm trusted publishing (OIDC — no stored token), bumping `package.json`'s
version along the way. There is no assembled `publish/` staging directory —
`package.json`'s `files` field controls what gets published.

semantic-release does not commit a version/changelog update back to `main`;
there is no `@semantic-release/git` step and no generated `CHANGELOG.md`. The
[GitHub Releases page](https://github.com/bhouston/bhouston-link-tester/releases)
is the changelog of record; the `version` field checked into the root
`package.json` is informational, not authoritative. Do not edit it manually or
hand-push tags.

Use the workflow's `dry_run` input
(`gh workflow run release.yml --ref main -f dry_run=true`) to verify version
computation without publishing. When there are no release-worthy commits
since the last tag, the workflow succeeds as a no-op.

## Release baseline

The migration baseline is `v1.0.0` at `5dec635b4c185d9d89534b0618392172f0b20a9e`,
matching the `gitHead` npm recorded for the already-published `1.0.0`. Do not
move this tag or tag unreleased work as a published version.

## One-time maintainer setup

1. Require the `ci` and `contribution` checks on contributor PRs to `main`.
2. In the npm package settings for **bhouston-link-checker**, add a GitHub
   Actions trusted publisher:
   - Organization or user: `bhouston`
   - Repository: `bhouston-link-tester`
   - Workflow filename: `release.yml`
   - Environment name: `npm`
3. Create a GitHub Environment named `npm` on the repository (Settings ->
   Environments) so the `release` job's `environment: npm` matches. Do not add
   `NPM_TOKEN`; authentication uses `id-token: write`.
4. Merge feature PRs into `main` as they land. When ready to publish, dispatch
   `Release` on `main`.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[semantic-release on GitHub Actions](https://semantic-release.gitbook.io/semantic-release/recipes/ci-configurations/github-actions).

## Local package inspection

To build and inspect the publishable package without going through
semantic-release:

```sh
pnpm build
npm pack --dry-run
```
