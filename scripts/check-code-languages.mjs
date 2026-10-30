// Real local grammars in editing, preview and offline PNG; synthetic source only.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chromium, webkit } from 'playwright-core';
const origin = process.env.CONVOSCROLL_REVIEW_URL ?? 'http://127.0.0.1:43179';
const output = 'output/playwright/phase-09e-r33';
await mkdir(output, { recursive: true });
const samples = JSON.parse(await readFile('fixtures/syntax/samples.json', 'utf8'));
const entries = [...Object.entries(samples), ['js', samples.javascript], ['text', '<img src=x onerror=alert(1)>'], ['unlisted-lang', '原样保留 <script> & 🌊']];
const markdown = '<!-- conversation-markdown:v2 -->\n<!-- document: {"title":"常见语言高亮"} -->\n<!-- message: {"role":"assistant","displayName":"代码示例"} -->\n'
  + entries.map(([lang, code]) => `\`\`\`${lang}\n${code}\n\`\`\``).join('\n\n') + '\n<!-- /message -->\n';
await writeFile(`${output}/languages.md`, markdown);
const results = [];
async function previewColors(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('.code-block')].every(e => e.dataset.highlightState === 'ready'));
  const actual = await page.locator('.code-block').evaluateAll(elements => elements.map(e => ({
    text: e.querySelector('code').textContent,
    caption: e.querySelector('figcaption').textContent,
    colors: new Set([...e.querySelectorAll('code span[style]')].map(s => getComputedStyle(s).color)).size,
  })));
  assert.equal(actual.length, entries.length);
  for (let i = 0; i < entries.length; i++) {
    assert.equal(actual[i].text, entries[i][1]);
    if (i < 30) assert.ok(actual[i].colors > 1, `${entries[i][0]} has no colored syntax`);
    else assert.equal(actual[i].colors, 0);
  }
  assert.equal(await page.locator('.code-block img, .code-block script').count(), 0);
  return actual;
}
for (const engine of process.env.ENGINE ? [process.env.ENGINE] : ['chrome', 'webkit']) {
  const browser = await (engine === 'chrome' ? chromium.launch({ channel: 'chrome' }) : webkit.launch());
  try {
    for (const width of [1281, 390]) {
      const context = await browser.newContext({ locale: 'zh-CN', viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: 1 });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      const errors = [], external = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
      page.on('request', r => { if (!r.url().startsWith(origin) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
      await page.goto(origin); await page.getByTestId('conversation-canvas').waitFor();
      await page.getByTestId('project-import-input').setInputFiles({ name: 'languages.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) });
      await page.getByRole('button', { name: '替换当前项目', exact: true }).click();
      await page.getByRole('dialog', { name: '导入预览', exact: true }).waitFor({ state: 'hidden' });
      const colors = await previewColors(page);
      await page.getByRole('button', { name: '编辑消息正文：1', exact: true }).click({ position: { x: 20, y: 20 } });
      const editor = page.getByRole('textbox', { name: '直接编辑消息正文：1', exact: true });
      await editor.waitFor();
      await page.waitForFunction(() => document.querySelectorAll('.inline-prose pre[data-highlight-state="ready"]').length === 30);
      assert.equal(await editor.locator('pre[data-highlight-state="plain"]').count(), 2);
      const source = await editor.locator('pre code').allTextContents();
      assert.deepEqual(source, entries.map(([, code]) => code));
      await editor.locator('pre').first().click();
      const language = page.getByRole('combobox', { name: '代码语言', exact: true });
      await language.click();
      assert.ok(await page.getByRole('listbox').evaluate(e => e.clientHeight <= 280 && e.scrollHeight > e.clientHeight));
      await page.getByRole('option', { name: 'JavaScript', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.inline-prose pre')?.dataset.codeLanguage === 'javascript');
      assert.equal(await editor.locator('pre code').first().textContent(), samples.python);
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.inline-prose pre')?.dataset.codeLanguage === 'python');
      await page.getByRole('button', { name: '预览', exact: true }).click();
      await previewColors(page);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${output}/${engine}-${width}-preview.png` });
      if (engine === 'chrome' && width === 1281) {
        const download = page.waitForEvent('download', { timeout: 90000 });
        await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
        await (await download).saveAs(`${output}/web.png`);
      }
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      results.push({ engine, width, languages: colors, errors, external });
      console.log(`${engine} ${width}: 29 languages, alias, plain text, unknown language and undo passed`);
      await context.close();
    }
  } finally { await browser.close(); }
}
const cli = spawnSync(process.execPath, ['cli/convoscroll.mjs', 'render', `${output}/languages.md`, '-o', `${output}/cli.png`, '--json'], { encoding: 'utf8', timeout: 120000 });
if (cli.status !== 0) throw new Error(cli.stderr || cli.stdout);
const [web, offline] = await Promise.all([readFile(`${output}/web.png`), readFile(`${output}/cli.png`)]);
assert.equal(web.equals(offline), true, 'Web and offline PNG differ');
const png = { width: web.readUInt32BE(16), height: web.readUInt32BE(20), sha256: createHash('sha256').update(web).digest('hex') };
await writeFile(`${output}/results.json`, JSON.stringify({ results, png, cli: JSON.parse(cli.stdout) }, null, 2));
console.log(JSON.stringify({ png, identical: true }));
