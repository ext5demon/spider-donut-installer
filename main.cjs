const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { Catalog } = require('./core/catalog.cjs');
const { inspectGame } = require('./core/game.cjs');
const { verifyKey, inspectKey, issueKey } = require('./core/keys.cjs');
const { loadIssuer, exportBackup } = require('./core/issuer.cjs');
const { Runtime } = require('./core/runtime.cjs');
const config = require('./config.json');
if (!app.isPackaged && process.env.SPIDER_TEST_DATA) app.setPath('userData', process.env.SPIDER_TEST_DATA);

let window, activeJob, developerKey, pendingKey, lastResult, catalog, runtime, outputFolder, protectionScript, cryptoBusy = false;
const ui = pathToFileURL(path.join(__dirname, 'ui/index.html')).href;
const data = () => app.getPath('userData');
const issuerFile = path.join(os.homedir(), '.spider-donut-owner', 'issuer-private.pem');
async function ownerKey() {
  return loadIssuer(issuerFile, config.developerPublicKey, protectionScript);
}
async function keyOperation(callback) {
  if (cryptoBusy) throw new Error('A key operation is already running. Please wait.');
  cryptoBusy = true;
  try { return await callback(); } finally { cryptoBusy = false; }
}
function emit(event) { if (window && !window.isDestroyed()) window.webContents.send('installer:event', event); }
function handler(name, callback) {
  ipcMain.handle('installer:' + name, async (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame.url !== ui) throw new Error('Untrusted application frame.');
    try { return { ok: true, value: await callback(...args) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
}

async function chooseDirectory(kind) {
  if (!app.isPackaged && process.env.SPIDER_TEST_GAME && kind === 'game') return process.env.SPIDER_TEST_GAME;
  const result = await dialog.showOpenDialog(window, { title: kind === 'game' ? 'Choose your DELTARUNE folder' : 'Save the USB archive in…',
    defaultPath: kind === 'game' ? undefined : app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : result.filePaths[0];
}

async function startBuild(request) {
  if (activeJob) throw new Error('A build is already running.');
  if (!request || !['latest', 'dev', 'older'].includes(request.channel)) throw new Error('Choose a build version.');
  let ref, label;
  if (request.channel === 'dev') {
    if (!developerKey || Date.parse(developerKey.expiresAt) <= Date.now()) throw new Error('Choose a valid developer key file first.');
    ref = developerKey.ref; label = 'Dev Beta';
  } else {
    const available = await catalog.list();
    const selected = request.channel === 'latest' ? available.releases[0] : available.releases.find(r => r.tag === request.release);
    if (!selected) throw new Error('Choose an available release.');
    ref = selected.tag; label = selected.name;
  }
  const game = await inspectGame(request.gamePath);
  if (!Array.isArray(request.chapters) || !request.chapters.length || request.chapters.some(n => !Number.isInteger(n))) throw new Error('Select at least one detected chapter.');
  const chapters = game.chapters.filter(c => request.chapters.includes(c.number));
  if (chapters.length !== new Set(request.chapters).size) throw new Error('A selected chapter could not be found.');
  const output = await fs.realpath(request.outputPath || app.getPath('downloads'));
  outputFolder = output;
  const relative = path.relative(game.root, output);
  if (relative === '' || !relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('Choose an output folder outside your original DELTARUNE folder.');
  const storage = await fs.statfs(data());
  if (Number(storage.bavail) * Number(storage.bsize) < 8 * 1024 ** 3) throw new Error('The build environment needs at least 8 GB free on the app drive. Free some space and try again.');
  const intent = { channel: request.channel, release: request.release, gamePath: request.gamePath, chapters: request.chapters, outputPath: output };
  await fs.writeFile(path.join(data(), 'pending-build.json'), JSON.stringify(intent));
  if (!(await runtime.status()).available) return { requiresRuntime: true };
  const id = crypto.randomUUID(), work = path.join(data(), 'jobs', id);
  await fs.mkdir(work, { recursive: true });
  const abort = new AbortController();
  activeJob = { id, abort, work }; lastResult = null;
  emit({ type: 'progress', phase: 'dependencies', message: 'Preparing your build…', progress: null });
  (async () => {
    const log = await fs.open(path.join(work, 'build.log'), 'a');
    const send = event => {
      // Never write keys or signatures into a build log.
      if (event.type === 'log') log.appendFile(event.line + '\n').catch(() => {});
      emit(event.type === 'complete' ? { type: 'progress', phase: 'archive', message: 'Verifying the finished archive…', progress: 1 } : event);
    };
    try {
      const source = await catalog.resolve(ref);
      const result = await runtime.build({ id, work, source, channel: request.channel, label, gameRoot: game.root, chapters, output,
        sdk: config.sdk, preprocessorCommit: config.preprocessorCommit }, send, abort.signal);
      lastResult = result;
      await fs.writeFile(path.join(data(), 'last-result.json'), JSON.stringify(result));
      await fs.rm(path.join(data(), 'pending-build.json'), { force: true });
      activeJob = null;
      emit(result);
    } catch (error) { emit({ type: abort.signal.aborted ? 'cancelled' : 'error', message: abort.signal.aborted ? 'Build cancelled. Your original game files have not been changed.' : error.message }); }
    finally { await log.close(); activeJob = null; }
  })();
  return { started: true, id };
}

app.whenReady().then(async () => {
  outputFolder = app.getPath('downloads');
  await fs.mkdir(data(), { recursive: true });
  catalog = new Catalog(path.join(data(), 'releases.json'));
  const resources = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'worker') : path.join(__dirname, 'worker');
  protectionScript = path.join(resources, 'protect-issuer.ps1');
  runtime = new Runtime(path.join(data(), 'cache'), resources);
  window = new BrowserWindow({ width: 1120, height: 820, minWidth: 940, minHeight: 700, frame: false, backgroundColor: '#12549b',
    icon: path.join(__dirname, 'assets/logo.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== ui) event.preventDefault(); });
  window.on('close', event => { if (activeJob) { event.preventDefault(); emit({ type: 'confirm-close' }); } });
  handler('init', async () => {
    let pending = null; try { pending = JSON.parse(await fs.readFile(path.join(data(), 'pending-build.json'), 'utf8')); } catch {}
    let pendingGame = null; if (pending) { try { pendingGame = await inspectGame(pending.gamePath); } catch {} }
    let owner = false, ownerError = null; try { await ownerKey(); owner = true; } catch (error) { if (error.code !== 'ENOENT') ownerError = error.message; }
    return { version: app.getVersion(), outputPath: app.getPath('downloads'), pending, pendingGame, owner, ownerError, platform: process.platform };
  });
  handler('catalog', refresh => catalog.list(Boolean(refresh)));
  handler('choose-game', async () => { const folder = await chooseDirectory('game'); return folder ? inspectGame(folder) : null; });
  handler('choose-output', async () => { const folder = await chooseDirectory('output'); if (folder) outputFolder = folder; return folder; });
  handler('choose-key', async () => {
    const result = !app.isPackaged && process.env.SPIDER_TEST_KEY ? { canceled: false, filePaths: [process.env.SPIDER_TEST_KEY] } : await dialog.showOpenDialog(window, { title: 'Choose your developer key file', properties: ['openFile'], filters: [{ name: 'Spider Donut key', extensions: ['spiderkey', 'json'] }] });
    if (result.canceled) return null;
    pendingKey = null; developerKey = null;
    const file = result.filePaths[0]; if ((await fs.stat(file)).size > 16384) throw new Error('This key file is too large.');
    const text = await fs.readFile(file, 'utf8'); inspectKey(text, config.developerPublicKey);
    pendingKey = { text, filename: path.basename(file) };
    return { filename: pendingKey.filename, requiresPassword: true };
  });
  handler('unlock-key', password => keyOperation(async () => {
    if (!pendingKey) throw new Error('Choose an encrypted key file first.');
    const file = pendingKey;
    developerKey = null;
    const verified = await verifyKey(file.text, config.developerPublicKey, password);
    if (pendingKey !== file) throw new Error('The selected key file changed. Unlock it again.');
    developerKey = verified;
    return { subject: verified.subject, expiresAt: verified.expiresAt, ref: verified.ref, filename: file.filename };
  }));
  handler('generate-password', () => crypto.randomBytes(32).toString('base64url'));
  handler('start', startBuild);
  handler('issue-key', options => keyOperation(async () => {
    const privateKey = await ownerKey();
    if (!options || !/^\d{4}-\d{2}-\d{2}$/.test(options.expires)) throw new Error('Enter an expiry date in YYYY-MM-DD format.');
    const expiresAt = new Date(options.expires + 'T23:59:59.000Z').toISOString();
    if (expiresAt.slice(0, 10) !== options.expires) throw new Error('Enter a valid calendar date.');
    const text = await issueKey(privateKey, { subject: options.subject?.trim(), ref: options.ref?.trim() || 'main', expiresAt }, options.password);
    const verified = await verifyKey(text, config.developerPublicKey, options.password);
    const result = !app.isPackaged && process.env.SPIDER_TEST_SAVE_KEY ? { canceled: false, filePath: process.env.SPIDER_TEST_SAVE_KEY } : await dialog.showSaveDialog(window, { title: 'Save developer key file', defaultPath: path.join(app.getPath('downloads'), 'Spider-Donut-Dev-' + verified.id.slice(0, 8) + '.spiderkey'), filters: [{ name: 'Spider Donut developer key', extensions: ['spiderkey'] }] });
    if (result.canceled) return null;
    await fs.writeFile(result.filePath, text, { flag: 'wx' });
    return { filename: path.basename(result.filePath), expiresAt };
  }));
  handler('backup-issuer', password => keyOperation(async () => {
    const text = await exportBackup(await ownerKey(), config.developerPublicKey, password);
    const result = !app.isPackaged && process.env.SPIDER_TEST_SAVE_BACKUP ? { canceled: false, filePath: process.env.SPIDER_TEST_SAVE_BACKUP } : await dialog.showSaveDialog(window, { title: 'Save encrypted owner backup', defaultPath: path.join(app.getPath('downloads'), 'Spider-Donut-Owner.spiderbackup'), filters: [{ name: 'Encrypted signing-key backup', extensions: ['spiderbackup'] }] });
    if (result.canceled) return null;
    await fs.writeFile(result.filePath, text, { flag: 'wx', mode: 0o600 });
    return { filename: path.basename(result.filePath) };
  }));
  handler('cancel', () => { activeJob?.abort.abort(); });
  handler('install-runtime', () => runtime.installWindowsComponents());
  handler('reveal', async () => { if (!lastResult) throw new Error('No completed archive is available yet.'); shell.showItemInFolder(lastResult.archive); });
  handler('open-output', async () => { const error = await shell.openPath(lastResult ? path.dirname(lastResult.archive) : outputFolder); if (error) throw new Error(error); });
  handler('open-link', url => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['github.com', 'learn.microsoft.com'].includes(parsed.hostname)) throw new Error('This link is not allowed.');
    return shell.openExternal(parsed.href);
  });
  handler('capture', async rect => {
    if (!rect || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k]) && rect[k] >= 0)) throw new Error('Invalid capture rectangle.');
    return (await window.webContents.capturePage(Object.fromEntries(Object.entries(rect).map(([k, v]) => [k, Math.round(v)])))).toDataURL();
  });
  handler('edit', action => { if (!['copy', 'cut', 'paste', 'selectAll', 'undo', 'redo'].includes(action)) throw new Error('Invalid edit action.'); window.webContents[action](); });
  handler('quit', async () => { if (activeJob) { activeJob.abort.abort(); return false; } app.quit(); return true; });
  await window.loadURL(ui); window.show();
});
app.on('window-all-closed', () => app.quit());
