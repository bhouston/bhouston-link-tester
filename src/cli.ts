import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { infoFromPackageJson } from '@clidoc/core';
import { createDocgenCommand, fromYargs } from '@clidoc/yargs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { fileCommands } from 'yargs-file-commands';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(dirname, '../package.json'), 'utf8'));

export const main = async (argv = hideBin(process.argv)): Promise<void> => {
  const parser = yargs(argv)
    .scriptName('bhouston-link-checker')
    .command(
      await fileCommands({
        commandDirs: [path.join(dirname, 'commands')],
        validation: false,
      }),
    );

  let document: ReturnType<typeof fromYargs>;
  parser.command(createDocgenCommand(() => document));
  // fromYargs must run after every command (including docgen) is registered but before
  // parsing, since running a command handler resets yargs' internal command registry.
  document = fromYargs(parser, infoFromPackageJson(pkg));

  await parser.strict().help().parseAsync();
};
