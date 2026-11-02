const path = require('node:path');
const fs = require('node:fs/promises');
const { run } = require('./process.cjs');
const { download } = require('./download.cjs');
const DISTRO = 'SpiderDonutBuilder';
const UBUNTU = 'https://cloud-images.ubuntu.com/wsl/releases/24.04/current/';

class Runtime {
  constructor(cache, resources) { this.cache = cache; this.resources = resources; }
  async status() {
    if (process.platform === 'linux') return { available: true, platform: 'linux' };
    if (process.platform !== 'win32') throw new Error('This installer currently builds on Windows or Linux.');
    try { await run('wsl.exe', ['--status']); return { available: true, platform: 'windows' }; }
    catch { return { available: false, platform: 'windows' }; }
  }
  async installWindowsComponents() {
    if (process.platform !== 'win32') throw new Error('Windows setup is only available on Windows.');
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.resources, 'install-wsl.ps1')]);
    return { restartMayBeRequired: true };
  }
  async prepare(signal, emit) {
    if (process.platform === 'linux') return;
    const distributions = (await run('wsl.exe', ['--list', '--quiet'], { signal })).output.replace(/\0/g, '').split(/\r?\n/).map(s => s.trim());
    if (distributions.includes(DISTRO)) return;
    emit({ type: 'progress', phase: 'dependencies', message: 'Downloading the Linux build environment…', progress: null });
    const response = await fetch(UBUNTU + 'SHA256SUMS', { signal });
    if (!response.ok) throw new Error('Ubuntu download checksums could not be loaded.');
    const sums = await response.text();
    const entry = sums.split('\n').map(l => l.trim().split(/\s+/)).find(a => a[1] === 'ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz');
    if (!entry || !/^[a-f0-9]{64}$/.test(entry[0])) throw new Error('Ubuntu did not publish the expected root filesystem checksum.');
    const archive = path.join(this.cache, 'ubuntu-rootfs.tar.gz');
    await download(UBUNTU + entry[1], archive, entry[0], { signal, progress: p => emit({ type: 'progress', phase: 'dependencies', message: 'Downloading the Linux build environment…', progress: p }) });
    const target = path.join(this.cache, 'linux'); await fs.mkdir(target, { recursive: true });
    emit({ type: 'progress', phase: 'dependencies', message: 'Preparing the Linux build environment…', progress: null });
    await run('wsl.exe', ['--import', DISTRO, target, archive, '--version', '2'], { signal, onLine: line => emit({ type: 'log', line }) });
  }
  async linuxPath(file, signal) {
    if (process.platform === 'linux') return file;
    return (await run('wsl.exe', ['-d', DISTRO, '-u', 'root', '--exec', 'wslpath', '-a', '-u', file], { signal })).output.trim();
  }
  async build(job, emit, signal) {
    await this.prepare(signal, emit);
    if (process.platform === 'win32') {
      emit({ type: 'progress', phase: 'dependencies', message: 'Preparing Python in the build environment…', progress: null });
      await run('wsl.exe', ['-d', DISTRO, '-u', 'root', '--exec', 'sh', '-c', 'command -v python3 >/dev/null || (apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y python3 ca-certificates)'], { signal, onLine: line => emit({ type: 'log', line }) });
    }
    const descriptor = { ...job, gameRoot: await this.linuxPath(job.gameRoot, signal), output: await this.linuxPath(job.output, signal), cache: '/root/.cache/spider-donut',
      chapters: await Promise.all(job.chapters.map(async chapter => ({ ...chapter, directory: await this.linuxPath(chapter.directory, signal) }))) };
    if (process.platform === 'linux') descriptor.cache = this.cache;
    const descriptorPath = path.join(job.work, 'job.json');
    await fs.writeFile(descriptorPath, JSON.stringify(descriptor));
    const worker = await this.linuxPath(path.join(this.resources, 'build.py'), signal);
    const jobPath = await this.linuxPath(descriptorPath, signal);
    const args = ['python3', '-u', worker, '--job', jobPath];
    const command = process.platform === 'win32' ? 'wsl.exe' : args.shift();
    const parameters = process.platform === 'win32' ? ['-d', DISTRO, '-u', 'root', '--exec', ...args] : args;
    let result;
    // A shared cancellation file lets the Linux worker stop its own subprocess
    // groups before WSL exits. Killing wsl.exe alone can leave a compiler behind.
    const cancel = () => fs.writeFile(path.join(job.work, 'cancel'), '').catch(() => {});
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) await cancel();
    try { await run(command, parameters, { onLine: line => {
      if (line.startsWith('@SDI ')) {
        try { const event = JSON.parse(line.slice(5)); if (event.type === 'complete') result = event; emit(event); } catch (error) { emit({ type: 'log', line }); }
      } else emit({ type: 'log', line });
    } }); } finally { signal.removeEventListener('abort', cancel); }
    if (signal.aborted) throw new Error('Build cancelled. Your game files have not been changed.');
    if (!result) throw new Error('The build ended without producing a verified USB archive.');
    // Linux reports a path inside WSL; expose the selected Windows output path.
    return { ...result, archive: path.join(job.output, path.basename(result.archive)) };
  }
}
module.exports = { Runtime, DISTRO };
