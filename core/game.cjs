const fs = require('node:fs/promises');
const path = require('node:path');

async function isGame(file) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const header = Buffer.alloc(12); const { bytesRead } = await handle.read(header, 0, 12, 0);
    return bytesRead === 12 && header.toString('ascii', 0, 4) === 'FORM' && header.toString('ascii', 8, 12) === 'GEN8';
  } catch { return false; } finally { await handle?.close(); }
}

async function inspectGame(selected) {
  if (typeof selected !== 'string' || !selected || /[\0\r\n]/.test(selected)) throw new Error('Choose the folder containing your DELTARUNE copy.');
  const real = await fs.realpath(selected);
  if (!(await fs.stat(real)).isDirectory()) throw new Error('Please choose a folder, not a file.');
  let root = real;
  const single = /^chapter([1-5])_windows$/i.exec(path.basename(real));
  if (single) root = path.dirname(real);
  const candidates = [root, path.join(root, 'DELTARUNE')];
  for (const base of candidates) {
    const chapters = [];
    for (let n = 1; n <= 5; n++) {
      const directory = path.join(base, `chapter${n}_windows`);
      if (await isGame(path.join(directory, 'data.win'))) chapters.push({ number: n, directory, status: ['Fully playable', 'Playable with minor bugs', 'Fully playable', 'Playable', 'Unsupported'][n - 1] });
    }
    if (chapters.length) return { root: base, selectedPath: real, chapters, defaultChapters: single ? [Number(single[1])] : chapters.map(c => c.number) };
  }
  throw new Error('No chapter data.win files were found. Choose the DELTARUNE folder containing chapter1_windows, chapter2_windows, and so on.');
}
module.exports = { inspectGame, isGame };
