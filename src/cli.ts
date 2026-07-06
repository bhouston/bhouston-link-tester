import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { fileCommands } from 'yargs-file-commands';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export const main = async (argv = hideBin(process.argv)): Promise<void> => {
  await yargs(argv)
    .scriptName('bhouston-link-checker')
    .command(
      await fileCommands({
        commandDirs: [path.join(dirname, 'commands')],
        validation: false,
      }),
    )
    .strict()
    .help()
    .parseAsync();
};
