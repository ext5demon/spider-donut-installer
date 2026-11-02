#!/usr/bin/env python3
"""Local build worker. The job contains paths and a public commit, never a key."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import struct
import subprocess
import sys
import tarfile
import time
import threading
import urllib.request
import zipfile

ASSET_EXTENSIONS = {'.win', '.dat', '.ogg', '.wav', '.mp3', '.flac', '.json', '.ini', '.txt', '.csv', '.png', '.jpg', '.jpeg', '.ttf', '.otf', '.bin', '.bsv'}
SKIP_DIRECTORIES = {'.git', 'logs', 'saves', '__pycache__', 'node_modules', '.codex'}
CANCELLED = threading.Event()
CHILDREN = set()


def check_cancel():
    if CANCELLED.is_set():
        raise RuntimeError('Build cancelled. Your original game files have not been changed.')


def watch_cancel(file):
    while not CANCELLED.wait(.25):
        if file.exists():
            CANCELLED.set()
            for child in list(CHILDREN):
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            return


def emit(kind='progress', **values):
    print('@SDI ' + json.dumps({'type': kind, **values}), flush=True)


def sha256(file):
    digest = hashlib.sha256()
    with open(file, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def run(arguments, cwd=None, environment=None):
    check_cancel()
    print('> ' + ' '.join(str(a) for a in arguments), flush=True)
    child = subprocess.Popen([str(a) for a in arguments], cwd=cwd, env=environment, start_new_session=True)
    CHILDREN.add(child)
    try:
        while child.poll() is None:
            if CANCELLED.wait(.25):
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                check_cancel()
        check_cancel()
        if child.returncode:
            raise subprocess.CalledProcessError(child.returncode, arguments)
    finally:
        CHILDREN.discard(child)


def download(url, output, checksum=None, phase='dependencies', message='Downloading build tools…'):
    if not url.startswith('https://'):
        raise ValueError('Only HTTPS downloads are allowed')
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.is_file() and checksum and sha256(output) == checksum:
        return
    temporary = output.with_name(output.name + '.partial')
    request = urllib.request.Request(url, headers={'User-Agent': 'Spider-Donut-Installer'})
    with urllib.request.urlopen(request, timeout=15) as response, open(temporary, 'wb') as stream:
        total = int(response.headers.get('Content-Length', 0))
        received = 0
        last = 0
        while block := response.read(1024 * 1024):
            check_cancel()
            stream.write(block)
            received += len(block)
            if time.monotonic() - last > .3:
                emit(phase=phase, message=message, progress=received / total if total else None)
                last = time.monotonic()
    if checksum and sha256(temporary) != checksum:
        temporary.unlink()
        raise ValueError('Downloaded build tools did not match their published checksum')
    os.replace(temporary, output)


def extract(archive, output):
    output.mkdir(parents=True, exist_ok=True)
    # Python's data filter rejects absolute/escaping members and unsafe links.
    with tarfile.open(archive) as stream:
        stream.extractall(output, filter='data')


def ensure_dependencies(job):
    cache = Path(job['cache'])
    marker = cache / 'host-tools-v1.ready'
    if not marker.exists():
        emit(phase='dependencies', message='Installing compiler support, Java and video tools…', progress=None)
        if sys.platform != 'linux':
            raise RuntimeError('Compilation requires the managed Linux build environment')
        prefix = [] if os.geteuid() == 0 else ['sudo', '-n']
        try:
            run(prefix + ['env', 'DEBIAN_FRONTEND=noninteractive', 'dpkg', '--configure', '-a'])
        except subprocess.CalledProcessError:
            run(prefix + ['env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', '--fix-broken', 'install', '-y'])
        run(prefix + ['apt-get', 'update'])
        run(prefix + ['env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y',
                      'build-essential', 'cmake', 'ninja-build', 'python3', 'git', 'ca-certificates',
                      'curl', 'unzip', 'xz-utils', 'bzip2', 'ffmpeg', 'openjdk-21-jdk-headless',
                      'libmpc3', 'libmpfr6', 'libgmp10', 'libisl23', 'libzstd1'])
        cache.mkdir(parents=True, exist_ok=True)
        marker.write_text('ready\n')
    sdk = Path(os.environ.get('PS3DEV', cache / 'sdk' / 'ps3dev'))
    if not (sdk / 'ppu/bin/ppu-gcc').exists():
        emit(phase='dependencies', message='Installing the PS3 compiler and packaging tools…', progress=None)
        archive = cache / 'downloads/ps3dev.tar.gz'
        download(job['sdk']['url'], archive, job['sdk']['sha256'])
        extract(archive, cache / 'sdk')
    required = ['ppu/bin/ppu-gcc', 'bin/make_self_npdrm', 'bin/sfo', 'bin/pkg', 'bin/package_finalize', 'portlibs/ppu/lib/libSDL2.a']
    missing = [p for p in required if not (sdk / p).is_file()]
    if missing:
        raise RuntimeError('The PS3 toolchain is incomplete: ' + ', '.join(missing))
    environment = dict(os.environ, PS3DEV=str(sdk), PSL1GHT=str(sdk),
                       PATH=f'{sdk}/bin:{sdk}/ppu/bin:{sdk}/spu/bin:' + os.environ['PATH'])
    jdk = Path('/usr/lib/jvm/java-21-openjdk-amd64')
    if jdk.is_dir():
        environment['JAVA_HOME'] = str(jdk)
        environment['PATH'] = str(jdk / 'bin') + ':' + environment['PATH']
    return environment


def fetch_source(url, destination, downloads, name, phase='source'):
    if destination.is_dir():
        return destination
    archive = downloads / (name + '.tar.gz')
    download(url, archive, phase=phase, message='Downloading the texture converter…' if phase == 'assets' else 'Downloading the selected Spider Donut source…')
    temporary = destination.with_name(destination.name + '-extract')
    extract(archive, temporary)
    roots = [p for p in temporary.iterdir() if p.is_dir()]
    if len(roots) != 1:
        raise RuntimeError('The source archive has an unexpected layout')
    os.replace(roots[0], destination)
    return destination


def assets(directory):
    directory = Path(directory)
    for root, dirs, files in os.walk(directory, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d.lower() not in SKIP_DIRECTORIES and not d.startswith('.') and not (Path(root) / d).is_symlink())
        for name in sorted(files):
            file = Path(root) / name
            if file.is_symlink() or name.startswith('.') or file.suffix.lower() not in ASSET_EXTENSIONS:
                continue
            if name.lower() in {'textures.bin', 'dr.ini', 'keyconfig.ini', 'credentials.json', 'secrets.json'} or name.lower().startswith(('filech', 'session-')):
                continue
            if file.stat().st_size > 0xffffffff:
                raise ValueError(f'{name} is too large for a FAT32 USB drive')
            yield file, file.relative_to(directory)


def copy_assets(chapters, game_root, usb):
    copies = []
    for chapter in chapters:
        target = usb / 'DELTARUNE' / f"chapter{chapter['number']}_windows"
        copies.extend((file, target / relative) for file, relative in assets(chapter['directory']))
    for shared in ['mus', 'audio', 'audiogroups']:
        directory = Path(game_root) / shared
        if directory.is_dir() and not directory.is_symlink():
            copies.extend((file, usb / 'DELTARUNE' / shared / relative) for file, relative in assets(directory))
    total = sum(file.stat().st_size for file, _ in copies)
    copied = 0
    for file, target in copies:
        check_cancel()
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, target)
        copied += file.stat().st_size
        emit(phase='assets', message='Copying your chapter files…', progress=copied / total if total else 1)


def validate_package(file):
    with open(file, 'rb') as stream:
        header = stream.read(96)
    if len(header) != 96 or header[:4] != b'\x7fPKG' or struct.unpack_from('>Q', header, 24)[0] != file.stat().st_size:
        raise RuntimeError('The compiler did not produce a valid PS3 package')


def archive_usb(usb, output, name):
    output.mkdir(parents=True, exist_ok=True)
    archive = output / name
    temporary = archive.with_suffix('.partial.zip')
    files = sorted(p for p in usb.rglob('*') if p.is_file())
    total = sum(p.stat().st_size for p in files)
    completed = 0
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as bundle:
            for file in files:
                check_cancel()
                if file.stat().st_size > 0xffffffff:
                    raise ValueError(f'{file.name} is too large for a FAT32 USB drive')
                relative = file.relative_to(usb).as_posix()
                if relative.startswith('/') or '..' in Path(relative).parts:
                    raise RuntimeError('An unsafe archive path was rejected')
                bundle.write(file, relative)
                completed += file.stat().st_size
                emit(phase='archive', message='Creating the USB-ready ZIP…', progress=completed / total if total else 1)
        emit(phase='archive', message='Checking the finished ZIP for damaged files…', progress=None)
        check_cancel()
        with zipfile.ZipFile(temporary) as bundle:
            if bad := bundle.testzip():
                raise RuntimeError('Archive verification failed: ' + bad)
        checksum = sha256(temporary)
        check_cancel()
        os.replace(temporary, archive)
        Path(str(archive) + '.sha256').write_text(checksum + '  ' + archive.name + '\n')
        return archive, checksum, len(files)
    finally:
        temporary.unlink(missing_ok=True)


def clean_job(job):
    if not re.fullmatch(r'[a-f0-9-]{36}', str(job.get('id', ''))):
        raise ValueError('Invalid build identity for cleanup')
    base = Path(job['cache']).resolve() / 'jobs'
    work = base / job['id']
    if work.is_symlink() or work.resolve().parent != base:
        raise ValueError('Temporary build directory is outside the job cache')
    if work.exists():
        emit(phase='archive', message='Removing temporary build files…', progress=None)
        shutil.rmtree(work)


def build(job):
    if not re.fullmatch(r'[a-f0-9-]{36}', job['id']) or not re.fullmatch(r'[a-f0-9]{40}', job['source']['commit']):
        raise ValueError('Invalid build identity')
    cache = Path(job['cache'])
    work = cache / 'jobs' / job['id']
    work.mkdir(parents=True, exist_ok=True)
    environment = ensure_dependencies(job)
    emit(phase='source', message='Downloading the selected Spider Donut source…', progress=None)
    source = fetch_source(job['source']['url'], work / 'source', cache / 'downloads', job['source']['commit'])
    if job['channel'] == 'dev':
        scripts = [p for p in (source / 'tools').glob('build-bdev*.sh') if re.fullmatch(r'build-bdev\d+\.sh', p.name)]
        if not scripts:
            raise RuntimeError('This development revision has no supported development build script')
        script = max(scripts, key=lambda p: int(re.search(r'bdev(\d+)', p.name)[1]))
    else:
        script = source / 'build.sh'
    if not script.is_file():
        raise RuntimeError('This older revision does not provide a supported PS3 build entry point')
    emit(phase='compile', message='Compiling Spider Donut and packaging the PKG…', progress=None)
    package_directory = work / 'package'
    env = dict(environment, BUILD_DIR=str(work / 'build'), OUTPUT_DIR=str(package_directory),
               SOURCE_COMMIT=job['source']['commit'], SOURCE_DATE=job['source']['date'], JOBS=str(max(1, min(os.cpu_count() or 2, 4))))
    run(['bash', script], source, env)
    packages = list(package_directory.glob('*.pkg'))
    if len(packages) != 1:
        raise RuntimeError('Exactly one compiled PS3 package was expected')
    package = packages[0]
    validate_package(package)
    emit(phase='assets', message='Preparing your chapters for PS3…', progress=None)
    usb = work / 'USB'
    usb.mkdir(exist_ok=True)
    shutil.copyfile(package, usb / package.name)
    copy_assets(job['chapters'], job['gameRoot'], usb)
    revision = job['preprocessorCommit']
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('Invalid preprocessor revision')
    preprocessor = fetch_source('https://codeload.github.com/ButterscotchRunner/ButterscotchPreprocessor/tar.gz/' + revision,
                                cache / ('preprocessor-' + revision), cache / 'downloads', 'preprocessor-' + revision, phase='assets')
    launcher = preprocessor / 'processor-cli/build/install/processor-cli/bin/processor-cli'
    if not launcher.is_file():
        emit(phase='assets', message='Preparing the PS3 texture converter…', progress=None)
        run(['bash', preprocessor / 'gradlew', '--no-daemon', ':processor-cli:installDist'], preprocessor, environment)
    for index, chapter in enumerate(job['chapters']):
        target = usb / 'DELTARUNE' / f"chapter{chapter['number']}_windows"
        original = Path(chapter['directory']) / 'data.win'
        emit(phase='assets', message=f"Converting Chapter {chapter['number']} textures…", progress=None)
        physical_mb = os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES') // (1024 * 1024)
        heap_mb = max(512, min(6144, int(physical_mb * .6)))
        texture_environment = dict(environment, JAVA_OPTS=f'-Xmx{heap_mb}m -Djava.awt.headless=true')
        run(['bash', launcher, '--target', 'ps3', '--output', target, original], preprocessor, texture_environment)
        textures = next((p for p in target.iterdir() if p.name.lower() == 'textures.bin'), None)
        if not textures or textures.stat().st_size < 32:
            raise RuntimeError('The texture converter produced no usable texture bundle')
        if textures.name != 'TEXTURES.BIN':
            os.replace(textures, target / 'TEXTURES.BIN')
        if sha256(target / 'data.win') != sha256(original):
            raise RuntimeError('The copied chapter data does not match the original')
        videos = sorted(Path(chapter['directory']).rglob('*.mp4'))
        for video in videos:
            if video.is_symlink():
                continue
            emit(phase='assets', message=f"Preparing Chapter {chapter['number']} video: {video.name}", progress=None)
            converter = source / 'tools/transcode_video.py'
            if not converter.is_file():
                raise RuntimeError('This version has no PS3 video converter; use a newer beta for chapters with videos')
            run(['python3', converter, video, '--output', target / video.relative_to(chapter['directory']).with_name(video.name + '.bsv')], source, environment)
        emit(phase='assets', message=f"Chapter {chapter['number']} is ready.", progress=(index + 1) / len(job['chapters']))
    manifest = {'version': package.stem.removeprefix('spider-donut-'), 'sourceCommit': job['source']['commit'],
                'chapters': [c['number'] for c in job['chapters']], 'packageSHA256': sha256(package)}
    (usb / 'BUILD-INFO.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (usb / 'README-FIRST.txt').write_text(
        'SPIDER DONUT — PS3 USB SETUP\n\nExtract this ZIP directly to a FAT32 USB drive.\n'
        'Keep the PKG and DELTARUNE folder at the USB root.\n'
        f'Install {package.name} using the PS3 Package Manager (HEN/CFW).\n'
        'Launch Spider Donut, select a discovered chapter and choose Play.\n'
        'Chapter 1 and 3: fully playable. Chapter 2: playable with minor bugs.\n'
        'Chapter 4: playable, with known issues. Chapter 5: unsupported.\n'
        'Chapter compatibility may differ in older versions.\n'
        'Your original PC game files were not modified.\n', encoding='utf-8')
    stamp = time.strftime('%Y%m%d-%H%M%S')
    name = f"Spider-Donut-{manifest['version']}-USB-{stamp}-{job['id'][:6]}.zip"
    archive, checksum, count = archive_usb(usb, Path(job['output']), name)
    emit('complete', archive=str(archive), sha256=checksum, files=count, chapters=manifest['chapters'], package=package.name)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--job', type=Path, required=True)
    arguments = parser.parse_args()
    threading.Thread(target=watch_cancel, args=(arguments.job.parent / 'cancel',), daemon=True).start()
    job = None
    try:
        job = json.loads(arguments.job.read_text())
        build(job)
    except (Exception, KeyboardInterrupt) as error:
        emit('error', message=str(error))
        raise SystemExit(1)
    finally:
        if job:
            try:
                clean_job(job)
            except (OSError, ValueError, KeyError) as error:
                emit('log', line='Temporary files could not be removed: ' + str(error))
