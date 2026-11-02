const path = require('node:path');
const asar = require('@electron/asar');
function audit(archive) {
  let count = 0;
  for (const name of asar.listPackage(archive)) {
    const relative = name.replace(/^[/\\]/, '');
    const stat = asar.statFile(archive, relative);
    if (stat.files) continue;
    if (/\.(?:pem|key|spiderkey|spiderbackup|win|mp4|ogg|pyc)$/i.test(relative) || /(?:^|[/\\])(?:\.env(?:\..*)?|credentials\.json|secrets\.json|textures\.bin)$/i.test(relative)) throw new Error('Release audit rejected a private or generated file: ' + relative);
    const bytes = asar.extractFile(archive, relative), text = bytes.toString('utf8');
    if (/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/.test(text)) throw new Error('Release audit found private-key material in: ' + relative);
    try {
      const record = JSON.parse(text);
      if (record?.format === 'spider-donut-owner-dpapi' || record?.format === 'spider-donut-sealed' || record?.payload && record?.signature) throw new Error('Private record');
    } catch (error) { if (error.message === 'Private record') throw new Error('Release audit found an owner/developer record in: ' + relative); }
    count++;
  }
  return count;
}
module.exports = async context => {
  const archive = path.join(context.appOutDir, 'resources/app.asar');
  console.log('  • release privacy audit passed: ' + audit(archive) + ' files');
};
module.exports.audit = audit;
