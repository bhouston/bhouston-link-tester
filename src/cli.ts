import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { infoFromPackageJson } from '@clidoc/core';
import { createDocgenCommand, fromYargsAsync } from '@clidoc/yargs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { fileCommands } from 'yargs-file-commands';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(dirname, '../package.json'), 'utf8'));

export const main = async (argv = hideBin(process.argv)): Promise<void> => {
  const commands = await fileCommands({ commandDirs: [path.join(dirname, 'commands')] });
  const docgen = createDocgenCommand(() => fromYargsAsync([...commands, docgen], infoFromPackageJson(pkg)));
  const parser = yargs(argv)
    .scriptName('bhouston-link-checker')
    .command([...commands, docgen]);

  await parser.strict().help().parseAsync();
};
