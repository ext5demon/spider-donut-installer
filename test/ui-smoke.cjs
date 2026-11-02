// Run with Node and PLAYWRIGHT_MODULE pointing to the installed Playwright package.
// Synthetic game headers exercise UI detection only; no game build is started.
const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { issueKey, verifyKey } = require('../core/keys.cjs');
const { loadIssuer, importBackup, verificationKey } = require('../core/issuer.cjs');
(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'spider-ui-'));
  const game = path.join(temporary, 'DELTARUNE');
  for (const n of [1, 2, 3, 4, 5]) { const dir = path.join(game, `chapter${n}_windows`); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, 'data.win'), Buffer.from('FORM\0\0\0\0GEN8')); }
  const key = path.join(temporary, 'tester.spiderkey');
  const issuer = path.join(os.homedir(), '.spider-donut-owner/issuer-private.pem');
  const publicKey = require('../config.json').developerPublicKey;
  const password = 'UI test only: developer password';
  const backupPassword = 'UI test only: separate backup password';
  const privateKey = await loadIssuer(issuer, publicKey, path.join(root, 'worker/protect-issuer.ps1'));
  await fs.writeFile(key, await issueKey(privateKey, { subject: 'UI test fixture', ref: 'main', expiresAt: new Date(Date.now() + 3600000).toISOString() }, password));
  const issued = path.join(temporary, 'issued.spiderkey');
  const backup = path.join(temporary, 'owner.spiderbackup');
  const app = await electron.launch({ executablePath: require('electron'), args: [root], env: { ...process.env, SPIDER_TEST_GAME: game, SPIDER_TEST_KEY: key, SPIDER_TEST_SAVE_KEY: issued, SPIDER_TEST_SAVE_BACKUP: backup, SPIDER_TEST_DATA: path.join(temporary, 'profile') } });
  try {
    const page = await app.firstWindow(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.locator('#next').waitFor();
    await page.getByRole('heading', { name: /Welcome to the/ }).waitFor();
    await page.waitForTimeout(800); await page.screenshot({ path: path.join(output, '01-welcome.png') });
    await page.locator('[data-menu=application]').click(); await page.getByRole('menuitem', { name: 'Developer Keys…', exact: true }).click();
    await page.locator('#developer-name').fill('QA developer'); await page.locator('#developer-expiry').fill('2099-12-31');
    await page.locator('#generate-license-password').click(); await page.waitForFunction(() => document.querySelector('#developer-password').value.length === 43);
    assert.equal(await page.locator('#developer-password').getAttribute('type'), 'password');
    await page.locator('#developer-password').fill(password);
    await page.getByRole('button', { name: 'Save Key File…' }).click();
    await page.getByText('Saved issued.spiderkey', { exact: true }).waitFor();
    assert.equal((await verifyKey(await fs.readFile(issued, 'utf8'), publicKey, password)).subject, 'QA developer');
    await page.screenshot({ path: path.join(output, '10-owner-keys.png') });
    await page.locator('#owner-backup').click(); await page.locator('#backup-password').fill(backupPassword);
    await page.locator('#backup-password').press('Enter');
    await page.getByText('Saved owner.spiderbackup', { exact: true }).waitFor();
    assert.equal(await page.locator('#backup-password').inputValue(), backupPassword);
    assert.equal(verificationKey(await importBackup(await fs.readFile(backup, 'utf8'), publicKey, backupPassword)), publicKey);
    await page.screenshot({ path: path.join(output, '15-encrypted-backup.png') });
    await page.locator('#backup-window .close').click();
    assert.equal(await page.locator('#backup-password').inputValue(), '');
    await page.locator('#owner-window .close').click();
    await page.locator('#next').click();
    await page.locator('#catalog-status').filter({ hasText: 'Latest release:' }).waitFor();
    await page.screenshot({ path: path.join(output, '11-version.png') });
    await page.locator('#next').click(); await page.getByRole('heading', { name: 'Choose Your Chapters' }).waitFor();
    await page.locator('#back').click(); await page.locator('input[value=older]').check();
    assert.ok(await page.locator('#release-select option').count() >= 2);
    await page.locator('#release-select').selectOption('v0.1'); await page.locator('#next').click();
    await page.getByRole('heading', { name: 'Choose Your Chapters' }).waitFor(); await page.locator('#back').click();
    await page.locator('input[value=dev]').check(); await page.locator('#next').click();
    assert.equal(await page.locator('#next').isDisabled(), true);
    await page.locator('#choose-key').click(); await page.getByText('Encrypted file selected', { exact: true }).waitFor();
    assert.equal(await page.locator('#next').isDisabled(), true);
    await page.locator('#key-password').fill('wrong password'); await page.getByRole('button', { name: 'Unlock Key', exact: true }).click();
    await page.locator('#unlock-status').filter({ hasText: 'could not be unlocked' }).waitFor();
    assert.equal(await page.locator('#next').isDisabled(), true);
    await page.locator('#key-password').fill(password); await page.locator('#key-password').press('Enter');
    await page.getByText('Developer key accepted', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, '02-key.png') });
    await page.locator('#next').click(); await page.locator('#choose-game').click();
    await page.locator('#chapter-5').uncheck(); assert.equal(await page.locator('.chapter-table input:checked').count(), 4);
    await page.screenshot({ path: path.join(output, '03-chapters.png') });
    await page.locator('#next').click(); await page.getByRole('heading', { name: 'Ready to Build' }).waitFor();
    await page.screenshot({ path: path.join(output, '04-review.png') });
    // On this Windows QA host WSL is absent. Confirm setup is offered and that
    // declining it performs no Windows feature installation or compilation.
    if (process.env.SPIDER_TEST_WSL_MISSING === '1') {
      await page.locator('#next').click();
      await page.getByRole('heading', { name: 'Prepare Windows for building' }).waitFor();
      await page.screenshot({ path: path.join(output, '08-runtime-sheet.png') });
      await page.getByRole('button', { name: 'Not Now', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('heading', { name: 'Ready to Build' }).waitFor();
    }
    await page.locator('[data-menu=view]').click(); await page.getByRole('menuitem', { name: /Show Build Log/ }).click();
    await page.waitForTimeout(300); assert.equal(await page.locator('#log-drawer').isVisible(), true);
    const logRect = await page.locator('#log-drawer').boundingBox(); assert.ok(logRect.x >= 0 && logRect.x + logRect.width <= 1120);
    await page.screenshot({ path: path.join(output, '09-drawer.png') });
    await page.locator('#toggle-log').click();
    await page.waitForTimeout(300);
    await page.locator('#help-button').click(); await page.locator('#help-window').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#installer-window').evaluate(el => el.classList.contains('inactive')), true);
    await page.screenshot({ path: path.join(output, '05-help.png') });
    await page.locator('#help-window .close').click();
    const before = await page.locator('#installer-window').boundingBox();
    const bar = await page.locator('#installer-window .titlebar').boundingBox();
    await page.mouse.move(bar.x + 230, bar.y + 10); await page.mouse.down(); await page.mouse.move(bar.x + 265, bar.y + 28, { steps: 8 }); await page.mouse.up();
    const after = await page.locator('#installer-window').boundingBox(); assert.ok(after.x > before.x + 20);
    await page.locator('#installer-window .zoom').click(); const zoomed = await page.locator('#installer-window').boundingBox(); assert.ok(zoomed.width > before.width);
    await page.locator('#installer-window .zoom').click();
    await page.locator('#installer-window .minimize').click(); await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(output, '06-genie.png') });
    await page.waitForTimeout(700); assert.equal(await page.locator('#installer-window').isVisible(), false);
    await page.locator('[data-dock=restore]').click(); await page.waitForTimeout(900);
    assert.equal(await page.locator('#installer-window').isVisible(), true);
    // This is a renderer event fixture, not an actual compiled build result.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('installer:event', { type: 'error', message: 'UI test: simulated compiler failure' }));
    // Remain on review; start is intentionally not invoked on a real Windows host.
    await page.locator('#installer-window .close').click(); await page.getByRole('dialog').waitFor();
    await page.screenshot({ path: path.join(output, '07-sheet.png') }); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    // Isolated renderer-contract fixtures exercise progress and completion UI.
    // This replacement exists in the test process only; production always builds.
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('installer:start'); ipcMain.handle('installer:start', () => ({ ok: true, value: { started: true } })); });
    await page.locator('#next').click();
    await page.getByRole('heading', { name: 'Building Spider Donut' }).waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('installer:event', { type: 'progress', phase: 'compile', message: 'UI contract test: compiler output', progress: null }));
    assert.equal(await page.locator('#progress-track').evaluate(el => el.classList.contains('indeterminate')), true);
    await page.screenshot({ path: path.join(output, '12-progress-fixture.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('installer:event', { type: 'progress', phase: 'archive', message: 'UI contract test: archive progress', progress: .5 }));
    await page.locator('#progress-track[aria-valuenow="50"]').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('installer:event', { type: 'complete', archive: 'UI-contract-fixture.zip', sha256: '0'.repeat(64), files: 1, chapters: [1, 2], package: 'UI-contract-fixture.pkg' }));
    await page.getByRole('heading', { name: 'Your USB Build Is Ready' }).waitFor();
    await page.screenshot({ path: path.join(output, '13-complete-fixture.png') });
    await page.locator('#build-another').click(); await page.getByRole('heading', { name: 'Select a Version' }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: key import, chapter selection, review, menus, help, drawer, drag, zoom, Genie, sheets; no renderer errors.');
  } finally { await app.close(); await fs.rm(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
