#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const { issueKey } = require('../core/keys.cjs');
const { loadIssuer, createIssuer, exportBackup, importBackup, verificationKey } = require('../core/issuer.cjs');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2), command = args.shift();
function option(name, fallback) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; }
const issuer = path.resolve(option('issuer', path.join(os.homedir(), '.spider-donut-owner', 'issuer-private.pem')));
if (issuer === root || issuer.startsWith(root + path.sep)) throw new Error('Keep the private signing key outside the project.');
const script = path.join(root, 'worker/protect-issuer.ps1');
const configFile = path.join(root, 'config.json');
const config = JSON.parse(fs.readFileSync(configFile));
async function password() {
  if (args.includes('--password-stdin')) {
    process.stdin.setEncoding('utf8');
    let text = '';
    for await (const chunk of process.stdin) {
      text += chunk.toString('utf8');
      if (Buffer.byteLength(text) > 4096) throw new Error('Password input is too long.');
    }
    return text.replace(/\r?\n$/, '');
  }
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal, or --password-stdin. Never put a password in a command-line argument.');
  process.stdout.write('Password (hidden; at least 16 characters when creating a file): ');
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const prompt = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
  try { return await new Promise((resolve, reject) => { prompt.once('SIGINT', () => reject(new Error('Key operation cancelled.'))); prompt.question('', resolve); }); }
  finally { prompt.close(); process.stdout.write('\n'); }
}
(async () => {
if (command === 'init') {
  if (fs.existsSync(issuer)) throw new Error('An issuer key already exists. It has not been overwritten.');
  const pair = crypto.generateKeyPairSync('ed25519');
  config.developerPublicKey = verificationKey(pair.privateKey);
  await createIssuer(issuer, pair.privateKey, config.developerPublicKey, script);
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  console.log('Windows-protected issuer stored at: ' + issuer + '\nPublic verification key configured. Export an encrypted backup.');
} else if (command === 'protect') {
  await loadIssuer(issuer, config.developerPublicKey, script);
  console.log('Issuer protected for this Windows account. Signing identity preserved.');
} else if (command === 'issue') {
  const subject = option('name'), expires = option('expires'), out = option('out');
  if (!subject || !expires || !out) throw new Error('Use issue --name "Developer" --expires YYYY-MM-DD --out developer.spiderkey');
  const expiresAt = new Date(expires + 'T23:59:59.000Z').toISOString();
  if (expiresAt.slice(0, 10) !== expires) throw new Error('Choose a valid calendar date.');
  if (Date.parse(expiresAt) <= Date.now()) throw new Error('Choose an expiry date in the future.');
  const key = await loadIssuer(issuer, config.developerPublicKey, script);
  const text = await issueKey(key, { subject, ref: option('ref', 'main'), expiresAt }, await password());
  fs.writeFileSync(path.resolve(out), text, { flag: 'wx', mode: 0o600 });
  console.log('Encrypted developer file written to: ' + path.resolve(out) + '\nGive its password to the developer separately.');
} else if (command === 'backup') {
  const out = option('out'); if (!out) throw new Error('Use backup --out owner.spiderbackup');
  const key = await loadIssuer(issuer, config.developerPublicKey, script);
  fs.writeFileSync(path.resolve(out), await exportBackup(key, config.developerPublicKey, await password()), { flag: 'wx', mode: 0o600 });
  console.log('Encrypted owner backup saved. Keep it and its password private.');
} else if (command === 'restore') {
  const backup = option('backup'); if (!backup) throw new Error('Use restore --backup owner.spiderbackup');
  if (fs.existsSync(issuer)) throw new Error('An issuer file already exists. Restore to a new --issuer path, or move the old file aside first.');
  if (fs.statSync(backup).size > 16384) throw new Error('The backup file is too large.');
  const key = await importBackup(fs.readFileSync(backup, 'utf8'), config.developerPublicKey, await password());
  await createIssuer(issuer, key, config.developerPublicKey, script);
  console.log('Signing identity restored and protected for this Windows account.');
} else {
  console.log('Initialize once: node tools/keys.cjs init\nProtect legacy issuer: node tools/keys.cjs protect\nIssue: node tools/keys.cjs issue --name "Developer" --expires YYYY-MM-DD --out developer.spiderkey\nBackup: node tools/keys.cjs backup --out owner.spiderbackup\nRestore: node tools/keys.cjs restore --backup owner.spiderbackup\nPasswords are prompted without echo; automation can use --password-stdin.');
}
})().catch(error => { console.error(error.message); process.exitCode = 1; });
