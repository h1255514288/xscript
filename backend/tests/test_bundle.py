"""Concurrent hot-update checks and OSS prewarming share a complete bundle cache."""

import tempfile
import threading
import unittest
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

from xscript_server import scripts
from xscript_server.config import Config


class BundleTest(unittest.TestCase):
    def test_concurrent_builders_publish_the_same_complete_archive_and_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(data_dir=Path(tmp))
            version = scripts.version_dir(cfg, 1, 1)
            version.mkdir(parents=True)
            with zipfile.ZipFile(version / "source.zip", "w") as archive:
                archive.writestr("__init__.py", "print('hello')\n")
                archive.writestr("res/data.txt", "payload")
            barrier = threading.Barrier(4)
            zip_dir = scripts._zip_dir

            def build(root, dest):
                barrier.wait(timeout=10)
                zip_dir(root, dest)

            with mock.patch.object(scripts, "_zip_dir", side_effect=build), ThreadPoolExecutor(4) as pool:
                results = list(pool.map(lambda _: scripts.bundle(cfg, 1, 1, False), range(4)))
            self.assertTrue(all(result == results[0] for result in results))
            path, digest, size = results[0]
            self.assertEqual(digest, scripts.sha256_file(path))
            self.assertEqual(size, path.stat().st_size)
            with zipfile.ZipFile(path) as archive:
                self.assertIsNone(archive.testzip())
                self.assertEqual(archive.read("res/data.txt"), b"payload")
            self.assertFalse(list(version.glob(".bundle-*")))
            # A cached read must not build or momentarily truncate its digest.
            with mock.patch.object(scripts, "_zip_dir", side_effect=AssertionError("rebuilt")):
                self.assertEqual(scripts.bundle(cfg, 1, 1, False), results[0])

    def test_failed_build_leaves_no_cache_or_temporary_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(data_dir=Path(tmp))
            version = scripts.version_dir(cfg, 1, 1)
            version.mkdir(parents=True)
            with zipfile.ZipFile(version / "source.zip", "w") as archive:
                archive.writestr("__init__.py", "pass\n")
            with mock.patch.object(scripts, "_zip_dir", side_effect=OSError("disk full")):
                with self.assertRaisesRegex(OSError, "disk full"):
                    scripts.bundle(cfg, 1, 1, False)
            self.assertEqual([p.name for p in version.iterdir()], ["source.zip"])


if __name__ == "__main__":
    unittest.main()
