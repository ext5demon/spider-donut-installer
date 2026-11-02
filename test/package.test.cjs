const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const asar = require('@electron/asar');
const { audit } = require('../tools/audit-package.cjs');
test('release audit allows source and rejects key files, disguised records and private PEM blocks', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spider-package-audit-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  async function fixture(index, filename, content) {
    const input = path.join(root, 'input-' + index); await fs.mkdir(path.dirname(path.join(input, filename)), { recursive: true });
    await fs.writeFile(path.join(input, filename), content); const archive = path.join(root, 'case-' + index + '.asar');
    await asar.createPackage(input, archive); return archive;
  }
  assert.equal(audit(await fixture(1, 'core/source.cjs', "const marker = '-----BEGIN PRIVATE KEY-----';")), 1);
  const file = await fixture(2, 'assets/developer.spiderkey', 'encrypted-file-fixture');
  assert.throws(() => audit(file), /private or generated file/);
  const record = await fixture(3, 'assets/disguised.txt', JSON.stringify({ format: 'spider-donut-owner-dpapi', ciphertext: 'test-fixture' }));
  assert.throws(() => audit(record), /owner\/developer record/);
  const pair = crypto.generateKeyPairSync('ed25519');
  const pem = await fixture(4, 'assets/disguised.bin', pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.throws(() => audit(pem), /private-key material/);
});
