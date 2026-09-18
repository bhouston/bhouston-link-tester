import { copyFileSync, existsSync } from 'node:fs';

// `publish/` must already exist before semantic-release starts (its
// @semantic-release/npm verifyConditions step checks for publish/package.json
// before any `prepare` step runs) — see the `release` script, which assembles
// it via `make-release.ts --assemble-only` first. This prepare step only needs
// to copy in CHANGELOG.md once the changelog plugin has generated it.
export function prepare() {
  if (existsSync('CHANGELOG.md')) {
    copyFileSync('CHANGELOG.md', 'publish/CHANGELOG.md');
  }
}
