const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { verifyKey, issueKey } = require('../core/keys.cjs');
const { inspectGame } = require('../core/game.cjs');
const { Catalog } = require('../core/catalog.cjs');
const { run, decode } = require('../core/process.cjs');

test('encrypted developer keys validate expiry and reject unsafe revisions', async () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const options = { subject: 'Playtester', ref: 'main', expiresAt: new Date(Date.now() + 86400000).toISOString() };
  const password = 'test-only strong password';
  const valid = await issueKey(pair.privateKey, options, password);
  assert.equal((await verifyKey(valid, publicKey, password)).subject, 'Playtester');
  await assert.rejects(verifyKey(valid, publicKey, password, new Date(Date.now() + 172800000)), /expired/);
  await assert.rejects(issueKey(pair.privateKey, { ...options, ref: '../private' }, password), /revision/);
  await assert.rejects(verifyKey('not json', publicKey, password), /invalid/);
});

test('chapter detection accepts roots and one chapter, rejects unrelated data', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spider-game-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = Buffer.from('FORM\0\0\0\0GEN8');
  for (const n of [1, 3, 5]) { const dir = path.join(root, `chapter${n}_windows`); await fs.mkdir(dir); await fs.writeFile(path.join(dir, 'data.win'), data); }
  const invalid = path.join(root, 'chapter2_windows'); await fs.mkdir(invalid); await fs.writeFile(path.join(invalid, 'data.win'), 'not a game');
  assert.deepEqual((await inspectGame(root)).defaultChapters, [1, 3, 5]);
  assert.deepEqual((await inspectGame(path.join(root, 'chapter3_windows'))).defaultChapters, [3]);
  assert.equal((await inspectGame(root)).chapters[2].status, 'Unsupported');
  await assert.rejects(inspectGame(root + '\n'), /Choose/);
  await assert.rejects(inspectGame(os.tmpdir()), /No chapter/);
});

test('release catalog filters unsupported tags and caches actual responses', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spider-catalog-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = global.fetch; t.after(() => { global.fetch = original; });
  global.fetch = async url => ({ ok: true, json: async () => url.includes('/commits/') ? { sha: 'a'.repeat(40), commit: { committer: { date: '2026-11-01T12:00:00Z' } } } : [
    { tag_name: 'v0.3', name: 'Beta 3', published_at: '2026-11-01' }, { tag_name: 'A1' }, { tag_name: 'v0.4', draft: true }
  ] });
  const catalog = new Catalog(path.join(root, 'releases.json'));
  assert.equal((await catalog.list()).releases.length, 1);
  assert.equal((await catalog.resolve('v0.3')).commit, 'a'.repeat(40));
  await assert.rejects(catalog.resolve('../main'), /Invalid/);
  global.fetch = async () => { throw new Error('offline'); };
  assert.equal((await catalog.list()).cached, true);
  await assert.rejects(catalog.list(true), /offline/);
});

test('process runner reports failures, cancellation and WSL Unicode output', async () => {
  assert.equal(decode(Buffer.from('Ubuntu\r\n', 'utf16le')), 'Ubuntu\r\n');
  await assert.rejects(run(process.execPath, ['-e', 'process.stderr.write("compiler failed");process.exit(2)']), /compiler failed/);
  const controller = new AbortController();
  const pending = run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, /cancelled/);
});
