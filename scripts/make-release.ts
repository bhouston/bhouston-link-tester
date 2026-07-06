#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function main() {
  const packagePath = process.argv[2] ?? '.';
  const resolvedPackagePath = resolve(packagePath);
  const publishPath = join(resolvedPackagePath, 'publish');

  if (!existsSync(resolvedPackagePath)) {
    throw new Error(`Error: Package directory does not exist: ${resolvedPackagePath}`);
  }

  const packageJsonPath = join(resolvedPackagePath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error(`Error: package.json not found in: ${resolvedPackagePath}`);
  }

  console.log('Cleaning publish dir');
  if (existsSync(publishPath)) {
    rmSync(publishPath, { recursive: true, force: true });
  }
  mkdirSync(publishPath, { recursive: true });

  console.log('Building package');
  execSync('pnpm -s build', { cwd: resolvedPackagePath, stdio: 'inherit' });

  console.log('Copying files to publish directory');

  const distPath = join(resolvedPackagePath, 'dist');
  if (!existsSync(distPath)) {
    throw new Error(`Error: dist directory not found at ${distPath}`);
  }
  cpSync(distPath, join(publishPath, 'dist'), { recursive: true });

  console.log('Copying package.json');
  const packageJsonContent = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
  writeFileSync(join(publishPath, 'package.json'), `${JSON.stringify(packageJsonContent, null, 2)}\n`);

  const readmePath = join(resolvedPackagePath, 'README.md');
  if (!existsSync(readmePath)) {
    throw new Error(`Error: README.md not found at ${readmePath}`);
  }
  console.log('Copying README.md');
  cpSync(readmePath, join(publishPath, 'README.md'));

  const licensePath = join(resolvedPackagePath, 'LICENSE');
  if (existsSync(licensePath)) {
    console.log('Copying LICENSE');
    cpSync(licensePath, join(publishPath, 'LICENSE'));
  }

  const npmignorePath = join(resolvedPackagePath, '.npmignore');
  if (existsSync(npmignorePath)) {
    console.log('Copying .npmignore');
    cpSync(npmignorePath, join(publishPath, '.npmignore'));
  }

  console.log('Publishing package');
  execSync('npm publish ./publish/ --access public', {
    cwd: resolvedPackagePath,
    stdio: 'inherit',
  });

  console.log('Release completed successfully!');
}

try {
  main();
} catch (error) {
  console.error(`Error: Release failed: ${error}`);
  process.exit(1);
}
