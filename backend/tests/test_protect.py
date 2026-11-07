"""代码保护: compile_tree turns a project into importable bytecode only."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from xscript_server import protect  # noqa: E402

PY310 = protect.find_python()


@unittest.skipIf(not PY310, "python3.10 not available")
class ProtectTest(unittest.TestCase):
    def test_compile_and_import(self):
        tmp = Path(tempfile.mkdtemp())
        proj = tmp / "demo"
        (proj / "lib").mkdir(parents=True)
        (proj / "__init__.py").write_text("from demo.lib import helper\nprint('ok', helper.VALUE)\n")
        (proj / "lib" / "__init__.py").write_text("")
        (proj / "lib" / "helper.py").write_text("VALUE = 42\n")
        self.assertEqual(protect.compile_tree(proj), 3)
        self.assertFalse(list(proj.rglob("*.py")))
        self.assertTrue(protect.has_entry(proj))
        out = subprocess.run([PY310, "-c", "import demo"], cwd=tmp, capture_output=True, text=True,
                             env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"))
        self.assertEqual(out.stdout.strip(), "ok 42", out.stderr)

    def test_syntax_error_is_reported(self):
        proj = Path(tempfile.mkdtemp()) / "bad"
        proj.mkdir()
        (proj / "__init__.py").write_text("def broken(:\n")
        with self.assertRaises(RuntimeError) as ctx:
            protect.compile_tree(proj)
        self.assertIn("编译失败", str(ctx.exception))

    def test_wrong_interpreter_rejected(self):
        if sys.version_info[:2] == protect.TARGET:
            self.skipTest("test interpreter is 3.10")
        with self.assertRaises(RuntimeError):
            protect.compile_tree(tempfile.mkdtemp(), python=sys.executable)

    def test_protected_bundle_preserves_source_archive_and_resources(self):
        from xscript_server.config import Config
        from xscript_server import scripts

        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(data_dir=Path(tmp))
            version = scripts.version_dir(cfg, 1, 1)
            version.mkdir(parents=True)
            source = version / "source.zip"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("demo/__init__.py", "from .helper import VALUE\n")
                archive.writestr("demo/helper.py", "VALUE = 42\n")
                archive.writestr("demo/res/config.json", '{"name":"测试"}')
            original = source.read_bytes()
            bundle, digest, size = scripts.bundle(cfg, 1, 1, protect=True)
            with zipfile.ZipFile(bundle) as archive:
                self.assertEqual(sorted(archive.namelist()), ["__init__.pyc", "helper.pyc", "res/config.json"])
                self.assertEqual(archive.read("res/config.json").decode(), '{"name":"测试"}')
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(digest, scripts.sha256_file(bundle))
            self.assertEqual(size, bundle.stat().st_size)

    def test_invalid_source_never_becomes_a_published_protected_bundle(self):
        from xscript_server.config import Config
        from xscript_server import scripts

        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(data_dir=Path(tmp))
            version = scripts.version_dir(cfg, 1, 1)
            version.mkdir(parents=True)
            with zipfile.ZipFile(version / "source.zip", "w") as archive:
                archive.writestr("__init__.py", "def broken(:\n")
            with self.assertRaisesRegex(RuntimeError, "编译失败"):
                scripts.bundle(cfg, 1, 1, protect=True)
            self.assertFalse((version / "bundle-pyc.zip").exists())
            self.assertTrue((version / "source.zip").is_file())


if __name__ == "__main__":
    unittest.main()
