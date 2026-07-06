import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type ReplacementMap = Record<string, string>;

export type StaticServer = {
  origin: string;
  close: () => Promise<void>;
};

const contentTypes = new Map([
  ['.css', 'text/css'],
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
]);

const closeServer = async (server: Server): Promise<void> =>
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });

export const startStaticServer = async (
  rootDirectory: string,
  replacements: ReplacementMap = {},
): Promise<StaticServer> => {
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(requestUrl.pathname);

    if (pathname.includes('..')) {
      response.writeHead(400);
      response.end('Bad request');
      return;
    }

    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = path.join(rootDirectory, relativePath);

    try {
      let contents = await readFile(filePath);
      const extension = path.extname(filePath);
      const contentType = contentTypes.get(extension) ?? 'application/octet-stream';

      if (contentType.startsWith('text/')) {
        let text = contents.toString('utf8');

        for (const [key, value] of Object.entries(replacements)) {
          text = text.replaceAll(key, value);
        }

        contents = Buffer.from(text);
      }

      response.writeHead(200, { 'content-type': contentType });
      response.end(contents);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('Not found');
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Unable to determine server address.');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => await closeServer(server),
  };
};
