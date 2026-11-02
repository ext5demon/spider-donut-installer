import importlib.util
from pathlib import Path
import struct
import tempfile
import threading
import time
import sys
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('worker', Path(__file__).parents[1] / 'worker/build.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def test_cleanup_is_limited_to_this_jobs_temporary_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            identity = '12345678-1234-1234-1234-123456789abc'
            work = root / 'cache/jobs' / identity
            work.mkdir(parents=True)
            (work / 'temporary.bin').write_bytes(b'temporary')
            original = root / 'original.win'; original.write_bytes(b'original')
            sibling = root / 'cache/jobs/other'; sibling.mkdir()
            worker.clean_job({'id': identity, 'cache': str(root / 'cache')})
            self.assertFalse(work.exists())
            self.assertTrue(sibling.exists())
            self.assertEqual(original.read_bytes(), b'original')
            with self.assertRaisesRegex(ValueError, 'identity'):
                worker.clean_job({'id': '../../original.win', 'cache': str(root / 'cache')})
            worker.CANCELLED.set()
            try:
                with self.assertRaisesRegex(RuntimeError, 'cancelled'):
                    worker.archive_usb(root, root / 'output', 'cancelled.zip')
                self.assertFalse((root / 'output/cancelled.partial.zip').exists())
            finally:
                worker.CANCELLED.clear()

    @unittest.skipUnless(sys.platform == 'linux', 'Linux process groups')
    def test_cancel_stops_a_running_build_process_group(self):
        with tempfile.TemporaryDirectory() as temporary:
            cancel = Path(temporary) / 'cancel'
            watcher = threading.Thread(target=worker.watch_cancel, args=(cancel,), daemon=True)
            watcher.start()
            timer = threading.Timer(.35, cancel.touch); timer.start()
            started = time.monotonic()
            try:
                with self.assertRaisesRegex(RuntimeError, 'cancelled'):
                    worker.run(['sh', '-c', 'sleep 30 & wait'])
                self.assertLess(time.monotonic() - started, 4)
            finally:
                timer.join(); watcher.join(timeout=1); worker.CANCELLED.clear()

    def test_usb_layout_excludes_pc_programs_saves_keys_and_stale_textures(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            game = root / 'game'
            chapter = game / 'chapter3_windows'
            chapter.mkdir(parents=True)
            for name in ['data.win', 'sound.ogg', 'runner.exe', 'textures.bin', 'filech3_0', 'credentials.json', 'dr.ini', '.spiderkey']:
                (chapter / name).write_bytes(name.encode())
            (chapter / 'mus').mkdir()
            (chapter / 'mus/song.ogg').write_bytes(b'original audio')
            (chapter / 'saves').mkdir()
            (chapter / 'saves/user.json').write_text('private save')
            (game / 'mus').mkdir()
            (game / 'mus/shared.ogg').write_bytes(b'shared music')
            before = {p.relative_to(game): worker.sha256(p) for p in game.rglob('*') if p.is_file()}
            usb = root / 'usb'
            worker.copy_assets([{'number': 3, 'directory': str(chapter)}], game, usb)
            stage = usb / 'DELTARUNE/chapter3_windows'
            self.assertEqual({p.relative_to(stage).as_posix() for p in stage.rglob('*') if p.is_file()}, {'data.win', 'sound.ogg', 'mus/song.ogg'})
            (stage / 'TEXTURES.BIN').write_bytes(b'converted for this chapter')
            package = usb / 'spider-donut-v0.3.pkg'
            header = bytearray(96)
            header[:4] = b'\x7fPKG'
            struct.pack_into('>Q', header, 24, 96)
            package.write_bytes(header)
            worker.validate_package(package)
            archive, checksum, count = worker.archive_usb(usb, root / 'output', 'usb.zip')
            self.assertEqual(worker.sha256(archive), checksum)
            self.assertEqual(count, 6)
            with zipfile.ZipFile(archive) as bundle:
                self.assertIsNone(bundle.testzip())
                self.assertIn('spider-donut-v0.3.pkg', bundle.namelist())
                self.assertIn('DELTARUNE/chapter3_windows/TEXTURES.BIN', bundle.namelist())
                self.assertIn('DELTARUNE/mus/shared.ogg', bundle.namelist())
                self.assertFalse(any(n.startswith('/') or '..' in n.split('/') for n in bundle.namelist()))
            self.assertEqual(before, {p.relative_to(game): worker.sha256(p) for p in game.rglob('*') if p.is_file()})

    def test_invalid_package_and_archive_traversal_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            file = root / 'bad.pkg'
            file.write_bytes(b'not a package')
            with self.assertRaisesRegex(RuntimeError, 'valid PS3'):
                worker.validate_package(file)
            import io
            import tarfile
            archive = root / 'unsafe.tar.gz'
            with tarfile.open(archive, 'w:gz') as bundle:
                entry = tarfile.TarInfo('../outside'); entry.size = 4
                bundle.addfile(entry, io.BytesIO(b'nope'))
            with self.assertRaises(tarfile.FilterError):
                worker.extract(archive, root / 'extracted')
            self.assertFalse((root / 'outside').exists())


if __name__ == '__main__':
    unittest.main()
