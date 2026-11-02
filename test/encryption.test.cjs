const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { issueKey, verifyKey, inspectKey } = require('../core/keys.cjs');
const { seal, open, inspect } = require('../core/encryption.cjs');
const { loadIssuer, createIssuer, exportBackup, importBackup, verificationKey, FORMAT } = require('../core/issuer.cjs');
const pair = crypto.generateKeyPairSync('ed25519');
const publicKey = verificationKey(pair.privateKey);
const password = 'test-only passphrase: long and unique';
const purpose = 'developer-key-v2';
const options = { subject: 'Private Developer Name', ref: 'main', expiresAt: new Date(Date.now() + 86400000).toISOString() };
function changed(text, mutate, resign = false) {
  const outer = JSON.parse(text), box = JSON.parse(Buffer.from(outer.box, 'base64url'));
  mutate(box); const bytes = Buffer.from(JSON.stringify(box)); outer.box = bytes.toString('base64url');
  if (resign) outer.signature = crypto.sign(null, Buffer.concat([Buffer.from('Spider Donut sealed file/' + purpose + '\0'), bytes]), pair.privateKey).toString('base64url');
  return JSON.stringify(outer);
}
test('encrypted licenses conceal developer records and require both issuer signature and password', async () => {
  const text = await issueKey(pair.privateKey, options, password);
  const decoded = Buffer.from(JSON.parse(text).box, 'base64url').toString();
  assert.ok(!text.includes(options.subject) && !decoded.includes(options.subject));
  assert.equal((await verifyKey(text, publicKey, password)).subject, options.subject);
  await assert.rejects(verifyKey(text, publicKey, 'incorrect password'), /could not be unlocked/);
  const attacker = crypto.generateKeyPairSync('ed25519');
  await assert.rejects(verifyKey(await issueKey(attacker.privateKey, options, password), publicKey, password), /invalid/);
  await assert.rejects(issueKey(pair.privateKey, options, 'short'), /16 characters/);
});
test('each encrypted record uses fresh salt and nonce', async () => {
  const first = inspect(await seal({ same: true }, pair.privateKey, password, purpose), publicKey, purpose);
  const second = inspect(await seal({ same: true }, pair.privateKey, password, purpose), publicKey, purpose);
  assert.notEqual(first.header.salt, second.header.salt); assert.notEqual(first.header.iv, second.header.iv);
  assert.equal(Buffer.from(first.header.salt, 'base64url').length, 32);
  assert.equal(Buffer.from(first.header.iv, 'base64url').length, 12);
  assert.equal(Buffer.from(first.tag, 'base64url').length, 16);
});
test('altered ciphertext, tags, nonces and KDF parameters fail before password work', async () => {
  const text = await issueKey(pair.privateKey, options, password);
  for (const mutate of [b => { b.ciphertext = 'AAAA'; }, b => { b.tag = 'A'.repeat(22); }, b => { b.header.iv = 'A'.repeat(16); }, b => { b.header.salt = 'A'.repeat(43); }, b => { b.header.N = 2 ** 30; }]) {
    assert.throws(() => inspectKey(changed(text, mutate), publicKey), /invalid/);
  }
  for (const mutate of [b => { b.header.N = 2 ** 30; }, b => { b.header.cipher = 'aes-256-cbc'; }, b => { b.header.iv = 'AA'; }]) {
    assert.throws(() => inspectKey(changed(text, mutate, true), publicKey), /invalid/);
  }
  // A correctly signed box with a damaged authentication tag must still fail GCM.
  await assert.rejects(verifyKey(changed(text, b => { const tag = Buffer.from(b.tag, 'base64url'); tag[0] ^= 1; b.tag = tag.toString('base64url'); }, true), publicKey, password), /could not be unlocked/);
});
test('legacy plaintext keys, oversized envelopes and backup/license confusion are rejected', async () => {
  assert.throws(() => inspectKey(JSON.stringify({ payload: 'e30', signature: 'AA' }), publicKey), /old, unencrypted/);
  for (const text of ['null', '[]', '{}', 'x'.repeat(16385)]) assert.throws(() => inspectKey(text, publicKey), /invalid/);
  const backup = await exportBackup(pair.privateKey, publicKey, password);
  assert.throws(() => inspectKey(backup, publicKey), /invalid/);
  assert.equal(verificationKey(await importBackup(backup, publicKey, password)), publicKey);
  await assert.rejects(importBackup(backup, publicKey, 'wrong backup password'), /could not be unlocked/);
  await assert.rejects(open(await issueKey(pair.privateKey, options, password), publicKey, password, 'issuer-backup-v1'), /invalid/);
});
test('valid encryption cannot override signed authorization scope', async () => {
  const bad = { version: 2, audience: 'another-app', channel: 'dev', subject: 'test', ref: 'main', id: crypto.randomUUID(), issuedAt: new Date().toISOString(), expiresAt: options.expiresAt };
  await assert.rejects(verifyKey(await seal(bad, pair.privateKey, password, purpose), publicKey, password), /access/);
});
test('Windows protects and migrates issuer storage without rotating its identity', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spider-dpapi-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'issuer.pem'), script = path.resolve(__dirname, '../worker/protect-issuer.ps1');
  await fs.writeFile(file, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.equal(verificationKey(await loadIssuer(file, publicKey, script)), publicKey);
  const stored = await fs.readFile(file, 'utf8'); assert.equal(JSON.parse(stored).format, FORMAT); assert.ok(!stored.includes('BEGIN PRIVATE KEY'));
  assert.equal(verificationKey(await loadIssuer(file, publicKey, script)), publicKey);
  const restored = path.join(root, 'restored.pem');
  await createIssuer(restored, await importBackup(await exportBackup(pair.privateKey, publicKey, password), publicKey, password), publicKey, script);
  assert.equal(verificationKey(await loadIssuer(restored, publicKey, script)), publicKey);
  const record = JSON.parse(stored), bytes = Buffer.from(record.ciphertext, 'base64'); bytes[bytes.length - 1] ^= 1; record.ciphertext = bytes.toString('base64');
  await fs.writeFile(file, JSON.stringify(record));
  await assert.rejects(loadIssuer(file, publicKey, script), /Windows could not/);
});
