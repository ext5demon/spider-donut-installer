const { spawn } = require('node:child_process');

function decode(buffer) {
  if (buffer.length > 1 && (buffer[1] === 0 || buffer[0] === 0xff && buffer[1] === 0xfe)) return buffer.toString('utf16le').replace(/^\ufeff/, '');
  return buffer.toString('utf8');
}

function run(command, args, { signal, onLine, cwd, encoding = 'utf8' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let tail = '', settled = false, retained = 0;
    const terminate = () => {
      if (process.platform === 'win32' && child.pid) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGTERM');
    };
    const onData = buffer => {
      chunks.push(buffer); retained += buffer.length;
      if (onLine) { tail += buffer.toString(encoding); const lines = tail.split(/\r?\n/); tail = lines.pop(); for (const line of lines) onLine(line); }
      while (retained > 2 * 1024 * 1024 && chunks.length > 4) retained -= chunks.shift().length;
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.once('error', error => { settled = true; signal?.removeEventListener('abort', terminate); reject(error); });
    child.once('close', code => {
      signal?.removeEventListener('abort', terminate); if (settled) return;
      if (tail && onLine) onLine(tail);
      if (signal?.aborted) reject(new Error('Build cancelled. Your game files have not been changed.'));
      else if (code !== 0) reject(new Error(decode(Buffer.concat(chunks)).trim().slice(-4000) || `${command} exited with code ${code}.`));
      else resolve({ code, output: decode(Buffer.concat(chunks)) });
    });
    if (signal?.aborted) terminate(); else signal?.addEventListener('abort', terminate, { once: true });
  });
}
module.exports = { run, decode };
