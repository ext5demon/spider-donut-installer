const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const encryption = require('./encryption.cjs');
const FORMAT = 'spider-donut-owner-dpapi';
const BACKUP = 'issuer-backup-v1';
function verificationKey(privateKey) { return crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64'); }
function matching(key, expected) {
  const privateKey = key?.type === 'private' ? key : crypto.createPrivateKey(key);
  if (privateKey.asymmetricKeyType !== 'ed25519' || verificationKey(privateKey) !== expected) throw new Error('The local issuer does not match this installer.');
  return privateKey;
}
function dpapi(mode, value, script) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Owner-key storage requires Windows account protection.'));
  return new Promise((resolve, reject) => {
    const command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const child = spawn(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let length = 0, settled = false;
    const fail = () => { if (!settled) { settled = true; reject(new Error('Windows could not unlock or protect this signing key for your account.')); } };
    const timer = setTimeout(() => { child.kill(); fail(); }, 15000);
    child.stdout.on('data', chunk => { length += chunk.length; if (length > 32768) { child.kill(); fail(); } else chunks.push(chunk); });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timer); fail(); });
    child.once('close', code => {
      clearTimeout(timer);
      if (!settled && code === 0) { settled = true; resolve(Buffer.concat(chunks).toString('utf8')); }
      else fail();
      for (const chunk of chunks) chunk.fill(0);
    });
    child.stdin.end(value);
  });
}
async function protectedText(privateKey, expected, script) {
  const key = matching(privateKey, expected);
  const pem = key.export({ type: 'pkcs8', format: 'pem' });
  const ciphertext = await dpapi('Protect', pem, script);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) throw new Error('Windows returned an invalid protected signing key.');
  matching(await dpapi('Unprotect', ciphertext, script), expected);
  return JSON.stringify({ format: FORMAT, version: 1, publicKey: expected, ciphertext }, null, 2) + '\n';
}
async function loadIssuer(file, expected, script, { migrate = true } = {}) {
  if ((await fs.stat(file)).size > 32768) throw new Error('The signing-key file is too large.');
  const text = await fs.readFile(file, 'utf8');
  if (text.startsWith('-----BEGIN PRIVATE KEY-----')) {
    const key = matching(text, expected);
    if (!migrate) return key;
    const protectedKey = await protectedText(key, expected, script);
    const temporary = file + '.encrypted-' + crypto.randomUUID();
    await fs.writeFile(temporary, protectedKey, { mode: 0o600, flag: 'wx' });
    // Replace the legacy file only after a successful decrypt-and-identity check.
    // No plaintext backup or temporary file is created.
    await fs.rename(temporary, file);
    return key;
  }
  let record; try { record = JSON.parse(text); } catch { throw new Error('The protected signing-key file is invalid.'); }
  if (record?.format !== FORMAT || record.version !== 1 || record.publicKey !== expected || typeof record.ciphertext !== 'string') throw new Error('The protected signing key does not match this installer.');
  return matching(await dpapi('Unprotect', record.ciphertext, script), expected);
}
async function createIssuer(file, key, expected, script) {
  const text = await protectedText(key, expected, script);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, text, { flag: 'wx', mode: 0o600 });
}
async function exportBackup(privateKey, expected, password) {
  const key = matching(privateKey, expected);
  return encryption.seal({ privateKey: key.export({ type: 'pkcs8', format: 'pem' }), publicKey: expected }, key, password, BACKUP);
}
async function importBackup(text, expected, password) {
  const record = await encryption.open(text, expected, password, BACKUP);
  if (!record || record.publicKey !== expected || typeof record.privateKey !== 'string') throw new Error('This signing-key backup does not match the installer.');
  return matching(record.privateKey, expected);
}
module.exports = { loadIssuer, createIssuer, exportBackup, importBackup, verificationKey, FORMAT };
