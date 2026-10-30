// Run after `npm run build`. Uses a private browser context and a temporary local
// preview port; it never connects to the running editor or an existing draft.
// Optional: --dist <production directory> --output <evidence directory>
//           --browser chrome|chromium|webkit
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, webkit } from 'playwright-core';
import { preview } from 'vite';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  dist: { type: 'string', default: join(projectRoot, 'dist') },
  output: { type: 'string', default: join(projectRoot, 'output', 'release-boundaries') },
  browser: { type: 'string', default: 'chrome' },
} });
assert(['chrome', 'chromium', 'webkit'].includes(values.browser), 'Use --browser chrome, chromium or webkit');
const dist = resolve(values.dist);
const output = resolve(values.output);
await readFile(join(dist, 'index.html')); // Fail before launching if no production build exists.
await mkdir(output, { recursive: true });

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  }));
  return nested.flat();
}
const files = await filesIn(dist);
const forbiddenFiles = files.filter(path => /\.(?:map|convcanvas)$/.test(path) || /(?:^|[/\\])\.env(?:\.|$)/.test(path));
assert.deepEqual(forbiddenFiles, [], 'Private files or source maps in production output');
const patterns = {
  absoluteUserPath: /\/Users\/|\/home\//,
  privateKey: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  sourceMap: /sourceMappingURL/,
  labEntry: /正在载入 Visual Lab|lab-back-link/,
  cliEntry: /__convoscroll\/input|window\.convoscroll/,
  internalFixtures: /fixture-rich-v0|fixture-long-v0|fixture-broken-v1/,
};
const artifactHits = [];
for (const path of files.filter(path => ['.js', '.html', '.css', '.txt'].includes(extname(path)))) {
  const source = await readFile(path, 'utf8');
  for (const [kind, pattern] of Object.entries(patterns)) {
    if (pattern.test(source)) artifactHits.push({ file: relative(dist, path), kind });
  }
}
assert.deepEqual(artifactHits, [], 'Unexpected development or private content in production output');

const server = await preview({ root: projectRoot, build: { outDir: dist },
  preview: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'silent' });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
try {
  browser = await (values.browser === 'webkit' ? webkit.launch()
    : chromium.launch(values.browser === 'chrome' ? { channel: 'chrome' } : {}));
  const context = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'block' });
  const page = await context.newPage();
  const requests = [], errors = [], routes = [];
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  page.on('pageerror', error => errors.push(error.message));
  // Record attempted external requests, then abort them before any data can leave.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort('blockedbyclient'));
  for (const path of ['/', '/lab', '/unknown']) {
    await page.goto(origin + path);
    await page.getByTestId('conversation-canvas').waitFor();
    await page.getByRole('button', { name: '文档', exact: true }).click();
    const menus = await page.getByRole('menuitem').allTextContents();
    assert(!menus.some(text => text.includes('测试：')), `Internal fixtures visible at ${path}`);
    routes.push({ path, menus });
    await page.keyboard.press('Escape');
  }

  const fixture = JSON.parse(await readFile(join(projectRoot, 'fixtures/basic.fixture.json'), 'utf8'));
  fixture.metadata.title = 'Security audit synthetic';
  fixture.messages = [{ id: 'audit-message', role: 'user', displayName: 'Audit', blocks: [{
    id: 'audit-markdown', type: 'markdown', source: [
      '<script>window.auditExecuted=1</script>',
      '<img src="https://audit.invalid/html" onerror="window.auditExecuted=2">',
      '![remote](https://audit.invalid/image)',
      '[bad](javascript:alert(1)) [encoded](java&#x73;cript:alert(1)) [ok](https://example.com)',
      String.raw`$\includegraphics{https://audit.invalid/math}$`,
      '```html\n<img src="https://audit.invalid/code" onerror="window.auditExecuted=3">\n```',
    ].join('\n\n'),
  }] }];
  fixture.assets = [];
  // Seed only this new context's database so the same payload exercises normal restore/render paths.
  await page.evaluate(async document => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('conversation-canvas', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', 'readwrite');
        transaction.objectStore('projects').put({ key: 'current', storageVersion: 1, document, savedAt: new Date().toISOString() });
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { database.close(); }
  }, fixture);
  await page.reload();
  await page.getByTestId('conversation-canvas').waitFor();
  await page.waitForFunction(() => document.querySelector('.code-block')?.getAttribute('data-highlight-state') === 'ready');
  const dom = await page.getByTestId('conversation-canvas').evaluate(element => ({
    scripts: element.querySelectorAll('script').length,
    images: [...element.querySelectorAll('img')].map(image => image.src),
    links: [...element.querySelectorAll('a')].map(link => ({ href: link.getAttribute('href'), rel: link.rel, target: link.target })),
    executed: window.auditExecuted ?? false,
  }));
  assert.equal(dom.scripts, 0);
  assert.deepEqual(dom.images, []);
  assert.equal(dom.executed, false);
  assert(!dom.links.some(link => /javascript:/i.test(link.href ?? '')));
  assert(dom.links.every(link => link.rel.includes('noopener') && link.rel.includes('noreferrer')));

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" onload="window.auditExecuted=4"><script>window.auditExecuted=5</script><image href="https://audit.invalid/svg" width="80" height="80"/><foreignObject width="80" height="80"><img xmlns="http://www.w3.org/1999/xhtml" src="https://audit.invalid/foreign"/></foreignObject><rect width="30" height="30" fill="red"/></svg>';
  const menu = page.locator('.conversation-canvas [data-message-id]').first().getByRole('button', { name: '消息操作', exact: true });
  await menu.focus();
  await menu.press('ArrowDown');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: '图片', exact: true }).click();
  await (await chooser).setFiles({ name: 'audit.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await page.locator('.image-block img').waitFor();
  await page.waitForFunction(() => document.querySelector('.inline-save-status')?.dataset.state === 'saved');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
  await (await download).saveAs(join(output, 'synthetic.png'));
  assert.equal(await page.evaluate(() => window.auditExecuted ?? false), false);
  const external = requests.filter(request => !request.url.startsWith(`${origin}/`) && !/^(blob|data):/.test(request.url));
  const nonGet = requests.filter(request => request.method !== 'GET');
  assert.deepEqual(external, []);
  assert.deepEqual(nonGet, []);
  assert.deepEqual(errors, []);
  const report = { browser: values.browser, files: files.length, artifactHits, routes, dom,
    svgImported: true, pngExported: true, requestCount: requests.length, nonGet, external, errors };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
