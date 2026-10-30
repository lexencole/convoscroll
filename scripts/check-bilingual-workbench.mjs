// Production-browser checks for language independence, portable data and narrow UI.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright-core';
import { unzipSync, strFromU8 } from 'fflate';
const origin = process.env.CONVOSCROLL_REVIEW_URL ?? 'http://127.0.0.1:43181';
const output = process.env.CONVOSCROLL_OUTPUT ?? 'output/playwright/phase-09e-r46/browser';
await mkdir(output, { recursive: true });
const reports = [];
const english = JSON.parse(await readFile('fixtures/basic-en.fixture.json', 'utf8'));
for (const engine of process.env.ENGINE ? [process.env.ENGINE] : ['chrome', 'webkit']) {
  const browser = await (engine === 'chrome' ? chromium.launch({ channel: 'chrome' }) : webkit.launch());
  try {
    for (const width of process.env.WIDTH ? [Number(process.env.WIDTH)] : [1280, 320, 375, 390, 430]) {
      const context = await browser.newContext({ locale: 'en-US', viewport: { width, height: 844 }, hasTouch: width < 600, isMobile: width < 600, reducedMotion: 'reduce' });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      const errors = [], external = [], uploads = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
      page.on('request', request => { if (!request.url().startsWith(origin) && !/^(data|blob):/.test(request.url())) external.push(request.url()); if (request.method() !== 'GET') uploads.push(request.method()); });
      async function noOverflow(label) {
        const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(dimensions.scroll <= dimensions.width, `${label}: ${JSON.stringify(dimensions)}`);
      }
      async function menu(item) { await page.getByRole('button', { name: 'Document', exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click(); }
      async function importFile(file) {
        await page.getByTestId('project-import-input').setInputFiles(file);
        await page.getByRole('button', { name: 'Replace current project', exact: true }).click();
        await page.getByRole('dialog', { name: 'Import preview', exact: true }).waitFor({ state: 'hidden' });
      }
      async function saved() { await page.waitForFunction(() => document.querySelector('.inline-save-status')?.dataset.state === 'saved'); }
      async function closeSettings() { await page.getByRole('button', { name: 'Done', exact: true }).click(); await page.locator('.workbench-settings').waitFor({ state: 'hidden' }); }
      async function imageLanguage(language) {
        await menu('Title and description'); await page.getByRole('combobox', { name: 'Image language', exact: true }).click();
        await page.getByRole('option', { name: language, exact: true }).click(); await closeSettings(); await saved();
      }
      try {
        await page.goto(origin); await page.getByTestId('conversation-canvas').waitFor();
        assert.equal(await page.locator('html').getAttribute('lang'), 'en');
        assert.equal(await page.getByTestId('conversation-canvas').getAttribute('lang'), 'en');
        assert.equal(await page.locator('.canvas-header h1').textContent(), english.metadata.title);
        await noOverflow('initial');
        await page.screenshot({ path: `${output}/${engine}-${width}-initial.png` });
        await page.getByRole('button', { name: 'Document', exact: true }).press('ArrowDown');
        const documentMenu = page.getByRole('menu', { name: 'Document actions' }); await documentMenu.waitFor();
        await page.keyboard.press('End');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'About');
        await noOverflow('document menu');
        const menuRect = await documentMenu.boundingBox(); assert.ok(menuRect.x >= 0 && menuRect.x + menuRect.width <= width + 1);
        await page.screenshot({ path: `${output}/${engine}-${width}-menu.png` });
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Document');
        await menu('Title and description');
        const settings = page.getByRole('dialog', { name: 'Title and description', exact: true }); await settings.waitFor();
        await noOverflow('settings');
        await page.screenshot({ path: `${output}/${engine}-${width}-settings.png` });
        await closeSettings();
        await menu('Export settings'); await page.getByRole('dialog', { name: 'Export settings', exact: true }).waitFor();
        await noOverflow('export settings'); await page.screenshot({ path: `${output}/${engine}-${width}-export.png` });
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        if (width === 1280 || width === 390) {
          const markdown = '<!-- conversation-markdown:v2 -->\n<!-- document: {"title":"保留标题 {0}","locale":"zh-CN"} -->\n<!-- message: {"role":"user","displayName":"用户","status":"complete"} -->\n原文 English {0}\n\n命令位置\n<!-- /message -->';
          await importFile({ name: 'mixed.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) });
          await page.getByRole('button', { name: 'Edit message: 1', exact: true }).press('Enter');
          const editor = page.locator('.inline-prose');
          await editor.evaluate(el => { el.dataset.languageProbe = 'same-editor'; });
          await menu('Language · 简体中文');
          assert.equal(await editor.getAttribute('data-language-probe'), 'same-editor');
          assert.equal(await page.getByTestId('conversation-canvas').getAttribute('lang'), 'zh-CN');
          await page.getByRole('button', { name: '文档', exact: true }).click(); await page.getByRole('menuitem', { name: '语言 · English', exact: true }).click();
          await imageLanguage('English');
          assert.equal(await page.locator('.message__identity strong').first().textContent(), '用户');
          assert.equal(await page.locator('.message__status').first().textContent(), 'Completed');
          await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved();
          assert.equal(await page.getByTestId('conversation-canvas').getAttribute('lang'), 'zh-CN');
          await page.getByRole('button', { name: 'Redo', exact: true }).click(); await saved();
          await page.reload(); await page.getByTestId('conversation-canvas').waitFor();
          assert.equal(await page.locator('html').getAttribute('lang'), 'en');
          assert.equal(await page.getByTestId('conversation-canvas').getAttribute('lang'), 'en');
          assert.equal(await page.locator('.canvas-header h1').textContent(), '保留标题 {0}');
          await page.getByRole('button', { name: 'Edit identity: 用户', exact: true }).click();
          await page.getByRole('button', { name: /^More settings/ }).click();
          await page.getByRole('button', { name: 'Message date', exact: true }).click();
          const date = page.getByRole('dialog', { name: 'Choose date', exact: true }); await date.waitFor();
          assert.equal(await date.getByRole('columnheader').first().textContent(), 'Mon');
          await noOverflow('date'); await page.screenshot({ path: `${output}/${engine}-${width}-date.png` });
          await page.keyboard.press('Escape'); await closeSettings();
          await page.getByRole('button', { name: 'Edit message: 1', exact: true }).press('Enter');
          const paragraph = editor.locator('p').filter({ hasText: '命令位置' });
          await paragraph.evaluate(el => { el.closest('[contenteditable]').focus(); const range = document.createRange(); range.selectNodeContents(el); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
          await page.keyboard.insertText('/');
          const list = page.getByRole('listbox', { name: 'Add content', exact: true }); await list.waitFor();
          await list.getByRole('option').first().waitFor();
          assert.equal(await list.getByRole('option').count(), 15);
          await noOverflow('slash'); await page.screenshot({ path: `${output}/${engine}-${width}-slash.png` });
          const chooser = page.waitForEvent('filechooser'); await page.getByRole('option', { name: 'Image', exact: true }).click();
          await (await chooser).setFiles({ name: 'image.svg', mimeType: 'image/svg+xml', buffer: await readFile('fixtures/assets/sample-landscape.svg') });
          await page.locator('.conversation-canvas img[alt="image.svg"]').waitFor(); await saved();
          await page.getByTestId('project-import-input').setInputFiles({ name: 'broken.convcanvas', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
          const alert = page.getByRole('alert').filter({ hasText: /project|file|read/i }); await alert.first().waitFor();
          assert.doesNotMatch(await alert.first().innerText(), /\p{Script=Han}/u);
          assert.equal(await page.locator('.canvas-header h1').textContent(), '保留标题 {0}');
          const projectDownload = page.waitForEvent('download'); await menu('Export project');
          const projectPath = `${output}/${engine}-${width}.convcanvas`; await (await projectDownload).saveAs(projectPath);
          const archive = unzipSync(await readFile(projectPath)); const document = JSON.parse(strFromU8(archive['document.json']));
          assert.equal(document.metadata.locale, 'en'); assert.equal(document.messages[0].displayName, '用户'); assert.equal(document.assets.length, 1);
          assert.ok(document.messages[0].blocks.some(block => block.source?.includes('原文 English {0}')));
          const manifest = JSON.parse(strFromU8(archive['manifest.json']));
          assert.deepEqual(Buffer.from(archive[manifest.assets[0].path]), await readFile('fixtures/assets/sample-landscape.svg'));
          await menu('New conversation'); await importFile(projectPath);
          await page.locator('.conversation-canvas img[alt="image.svg"]').waitFor();
          const download = page.waitForEvent('download', { timeout: 90000 }); await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
          await (await download).saveAs(`${output}/${engine}-${width}.png`);
          await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
          await noOverflow('restored');
        }
        assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(uploads, []);
        reports.push({ engine, width, functional: width === 1280 || width === 390, errors, external, uploads });
        console.log(JSON.stringify(reports.at(-1)));
      } catch (error) {
        await page.screenshot({ path: `${output}/${engine}-${width}-failure.png` }).catch(() => {});
        console.log(await page.locator('body').innerText()); throw error;
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
await writeFile(`${output}/report.json`, JSON.stringify(reports, null, 2) + '\n');
