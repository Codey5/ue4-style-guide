// Bundles the game into a single self-contained HTML file.
//   node tools/build.mjs          -> dist/beam-reach.html (open it directly in a browser)
//   node tools/build.mjs --serve  -> dev server on http://localhost:8000 (uses ES modules from src/)
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

if (process.argv.includes('--serve')) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const port = Number(process.env.PORT ?? 8000);
  createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    const file = join(root, path === '' ? 'index.html' : path);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  }).listen(port, () => console.log(`Beam Reach dev server: http://localhost:${port}/`));
} else {
  const result = await build({
    entryPoints: [join(root, 'src/main.js')], bundle: true, minify: true, format: 'iife',
    target: 'es2020', write: false, legalComments: 'none',
  });
  const code = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const cut = (a, b) => html.slice(html.indexOf(a) + a.length, html.indexOf(b));
  const head = cut('<!--BUILD:HEAD-START-->', '<!--BUILD:HEAD-END-->').trim();
  const body = cut('<!--BUILD:BODY-START-->', '<!--BUILD:BODY-END-->').trim();
  const script = `<script>${code}</script>`;
  await mkdir(join(root, 'dist'), { recursive: true });
  const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>
${body}
${script}
</body>
</html>
`;
  await writeFile(join(root, 'dist/beam-reach.html'), full);
  // Variant without the document skeleton, for hosts that wrap the page themselves.
  await writeFile(join(root, 'dist/beam-reach.embed.html'), `${head}\n${body}\n${script}\n`);
  console.log(`dist/beam-reach.html  ${(full.length / 1024).toFixed(0)} KB`);
}
