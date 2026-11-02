const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

async function download(url, destination, sha256, { signal, progress = () => {} } = {}) {
  if (!url.startsWith('https://')) throw new Error('Downloads must use HTTPS.');
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  if (sha256 && fs.existsSync(destination)) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(destination)) hash.update(chunk);
    if (hash.digest('hex') === sha256) { progress(1); return destination; }
  }
  const response = await fetch(url, { signal, headers: { 'User-Agent': 'Spider-Donut-Installer' } });
  if (!response.ok) throw new Error(`Download failed (${response.status}). Please try again.`);
  const total = Number(response.headers.get('content-length')) || 0;
  let received = 0, lastUpdate = 0; const hash = crypto.createHash('sha256');
  const meter = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); received += chunk.length; if (Date.now() - lastUpdate >= 80) { progress(total ? received / total : null, received, total); lastUpdate = Date.now(); } callback(null, chunk); } });
  const temporary = destination + '.partial';
  await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(temporary), { signal });
  if (sha256 && hash.digest('hex') !== sha256) { await fsp.rm(temporary, { force: true }); throw new Error('The download checksum does not match. The file was not installed.'); }
  await fsp.rename(temporary, destination); progress(1, received, total); return destination;
}
module.exports = { download };
