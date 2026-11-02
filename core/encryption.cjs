const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const POLICY = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
const PURPOSES = new Set(['developer-key-v2', 'issuer-backup-v1']);
const MAX_FILE = 16384;
const invalid = () => new Error('This encrypted Spider Donut file is invalid or has been changed.');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exact(value, keys) { return object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','); }
function decode(value, size) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > MAX_FILE) throw invalid();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value || size !== undefined && bytes.length !== size) throw invalid();
  return bytes;
}
function checkPassword(password, creating = false) {
  if (typeof password !== 'string' || !password || /[\0\r\n]/.test(password) || Buffer.byteLength(password, 'utf8') > 1024) throw new Error('Enter a password of at most 1,024 UTF-8 bytes, without line breaks.');
  if (creating && Array.from(password).length < 16) throw new Error('Use a password of at least 16 characters, or choose Generate.');
}
function domain(purpose) { return Buffer.from('Spider Donut sealed file/' + purpose + '\0', 'utf8'); }
function aad(header) {
  return Buffer.from(JSON.stringify({ purpose: header.purpose, cipher: header.cipher, kdf: header.kdf,
    N: header.N, r: header.r, p: header.p, salt: header.salt, iv: header.iv }), 'utf8');
}
function publicKey(key) {
  const result = crypto.createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' });
  if (result.asymmetricKeyType !== 'ed25519') throw invalid();
  return result;
}
function inspect(text, verificationKey, purpose) {
  if (!PURPOSES.has(purpose) || !verificationKey) throw invalid();
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_FILE) throw invalid();
  let outer;
  try { outer = JSON.parse(text); } catch { throw invalid(); }
  if (object(outer) && 'payload' in outer) throw new Error('This is an old, unencrypted key. Ask the owner to issue a new encrypted key file.');
  if (!exact(outer, ['format', 'version', 'box', 'signature']) || outer.format !== 'spider-donut-sealed' || outer.version !== 2) throw invalid();
  const bytes = decode(outer.box), signature = decode(outer.signature, 64);
  // Authenticate the complete encrypted box before parsing its parameters or
  // performing expensive password derivation. Purposes are domain-separated.
  try { if (!crypto.verify(null, Buffer.concat([domain(purpose), bytes]), publicKey(verificationKey), signature)) throw invalid(); }
  catch { throw invalid(); }
  let box;
  try { box = JSON.parse(bytes.toString('utf8')); } catch { throw invalid(); }
  if (!exact(box, ['header', 'ciphertext', 'tag']) || !exact(box.header, ['purpose', 'cipher', 'kdf', 'N', 'r', 'p', 'salt', 'iv'])) throw invalid();
  const h = box.header;
  if (h.purpose !== purpose || h.cipher !== 'aes-256-gcm' || h.kdf !== 'scrypt' || h.N !== POLICY.N || h.r !== POLICY.r || h.p !== POLICY.p) throw invalid();
  decode(h.salt, 32); decode(h.iv, 12); decode(box.tag, 16);
  if (decode(box.ciphertext).length > 8192) throw invalid();
  return box;
}
async function seal(record, signingKey, password, purpose) {
  if (!PURPOSES.has(purpose)) throw invalid();
  checkPassword(password, true);
  const keyObject = signingKey?.type === 'private' ? signingKey : crypto.createPrivateKey(signingKey);
  if (keyObject.asymmetricKeyType !== 'ed25519') throw invalid();
  const plaintext = Buffer.from(JSON.stringify(record), 'utf8');
  if (!plaintext.length || plaintext.length > 8192) throw invalid();
  const header = { purpose, cipher: 'aes-256-gcm', kdf: 'scrypt', N: POLICY.N, r: POLICY.r, p: POLICY.p,
    salt: crypto.randomBytes(32).toString('base64url'), iv: crypto.randomBytes(12).toString('base64url') };
  let key;
  try {
    key = await scrypt(password, decode(header.salt, 32), 32, POLICY);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, decode(header.iv, 12), { authTagLength: 16 });
    cipher.setAAD(aad(header));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const bytes = Buffer.from(JSON.stringify({ header, ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') }), 'utf8');
    const signature = crypto.sign(null, Buffer.concat([domain(purpose), bytes]), keyObject);
    return JSON.stringify({ format: 'spider-donut-sealed', version: 2, box: bytes.toString('base64url'), signature: signature.toString('base64url') }, null, 2) + '\n';
  } finally { key?.fill(0); plaintext.fill(0); }
}
async function open(text, verificationKey, password, purpose) {
  const box = inspect(text, verificationKey, purpose);
  checkPassword(password);
  let key, plaintext;
  try {
    key = await scrypt(password, decode(box.header.salt, 32), 32, POLICY);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, decode(box.header.iv, 12), { authTagLength: 16 });
    decipher.setAAD(aad(box.header)); decipher.setAuthTag(decode(box.tag, 16));
    // Do not release unauthenticated plaintext from update() to any caller.
    const pending = decipher.update(decode(box.ciphertext));
    try { plaintext = Buffer.concat([pending, decipher.final()]); } finally { pending.fill(0); }
    return JSON.parse(plaintext.toString('utf8'));
  } catch { throw new Error('The file could not be unlocked. Check the password and file.'); }
  finally { key?.fill(0); plaintext?.fill(0); }
}
module.exports = { seal, open, inspect, checkPassword, POLICY, MAX_FILE };
