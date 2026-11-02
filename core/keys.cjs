const crypto = require('node:crypto');
const encryption = require('./encryption.cjs');
const PURPOSE = 'developer-key-v2';

function validate(payload, now = new Date()) {
  if (!payload || payload.version !== 2 || payload.audience !== 'spider-donut-installer' || payload.channel !== 'dev') throw new Error('This key does not grant Dev Beta access.');
  if (typeof payload.subject !== 'string' || !payload.subject.trim() || payload.subject.length > 100 || /[\x00-\x1f\x7f]/.test(payload.subject)) throw new Error('The developer name is invalid.');
  if (typeof payload.ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(payload.ref) || payload.ref.includes('..')) throw new Error('The development revision is invalid.');
  if (typeof payload.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(payload.id)) throw new Error('The key identity is invalid.');
  const expires = typeof payload.expiresAt === 'string' ? Date.parse(payload.expiresAt) : NaN;
  const issued = typeof payload.issuedAt === 'string' ? Date.parse(payload.issuedAt) : NaN;
  if (!Number.isFinite(expires) || !Number.isFinite(issued) || expires <= now.getTime() || expires <= issued) throw new Error('This developer key has expired or has invalid dates. Ask for a new key file.');
  if (issued > now.getTime() + 300000) throw new Error('This key is not valid yet. Check your computer clock.');
  return payload;
}

function inspectKey(text, publicKey) { encryption.inspect(text, publicKey, PURPOSE); return true; }
async function verifyKey(text, publicKey, password, now = new Date()) {
  return validate(await encryption.open(text, publicKey, password, PURPOSE), now);
}
async function issueKey(privateKey, { subject, ref = 'main', expiresAt }, password) {
  const payload = { version: 2, audience: 'spider-donut-installer', channel: 'dev', subject, ref,
    issuedAt: new Date().toISOString(), expiresAt, id: crypto.randomUUID() };
  validate(payload);
  return encryption.seal(payload, privateKey, password, PURPOSE);
}

module.exports = { verifyKey, inspectKey, issueKey, validate };
