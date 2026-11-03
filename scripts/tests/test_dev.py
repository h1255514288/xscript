"""Behavior of the portable entry point, without downloads or device access."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("dev", Path(__file__).resolve().parents[1] / "dev.py")
dev = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dev)


class DevTests(unittest.TestCase):
    def test_node_support_includes_the_console_dependency_patch_floors(self):
        for version in ("v22.22.2", "v22.23.0", "v24.15.0", "v24.22.1", "v26.0.0"):
            with self.subTest(version=version):
                self.assertTrue(dev.supported_node(version))
        for version in ("v20.20.0", "v22.22.1", "v23.0.0", "v24.14.0", "v25.0.0"):
            with self.subTest(version=version):
                self.assertFalse(dev.supported_node(version))

    def test_dry_run_never_spawns_or_creates_a_venv(self):
        with tempfile.TemporaryDirectory(prefix="xscript dev ") as tmp:
            root = Path(tmp)
            with patch.object(dev, "ROOT", root), patch.object(dev.subprocess, "run") as spawn:
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(dev.main(["setup", "python", "console", "--dry-run"]), 0)
                    self.assertEqual(dev.main(["check", "python", "extension", "--dry-run"]), 0)
                spawn.assert_not_called()
                self.assertEqual(list(root.iterdir()), [])

    def test_missing_environment_fails_instead_of_skipping(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(dev, "ROOT", Path(tmp)):
            with contextlib.redirect_stderr(io.StringIO()) as err, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(dev.main(["check", "python"]), 1)
            self.assertIn("setup python", err.getvalue())

    def test_failed_command_stops_later_checks_and_preserves_exit_code(self):
        failure = subprocess.CalledProcessError(7, [sys.executable, "check.py"])
        with patch.object(dev, "run", side_effect=failure) as run:
            with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(dev.main(["check", "repo", "python"]), 7)
            self.assertEqual(run.call_count, 1)

    def test_does_not_overwrite_a_broken_existing_environment(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(dev, "ROOT", Path(tmp)):
            marker = Path(tmp) / ".venv" / "keep.txt"
            marker.parent.mkdir()
            marker.write_text("existing data", encoding="utf-8")
            with patch.object(dev.subprocess, "run") as spawn, contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(dev.DevError):
                    dev.setup(["python"], False)
            spawn.assert_not_called()
            self.assertEqual(marker.read_text(encoding="utf-8"), "existing data")

    def test_child_process_gets_cwd_paths_and_loopback_proxy_bypass(self):
        with tempfile.TemporaryDirectory(prefix="xscript dev ") as tmp:
            root = Path(tmp)
            script = root / "probe.py"
            script.write_text(
                "import os, pathlib\n"
                "assert pathlib.Path.cwd().name.startswith('xscript dev ')\n"
                "assert os.environ['PYTHONUTF8'] == '1'\n"
                "assert pathlib.Path(os.environ['XSCRIPT_TEST_PYTHON']).is_file()\n"
                "assert 'localhost' in os.environ['NO_PROXY'].split(',')\n"
                "assert '127.0.0.1' in os.environ['no_proxy'].split(',')\n"
                "assert pathlib.Path(os.environ['PYTHONPATH'].split(os.pathsep)[0]) == pathlib.Path.cwd() / 'backend'\n",
                encoding="utf-8",
            )
            with patch.object(dev, "ROOT", root), contextlib.redirect_stdout(io.StringIO()):
                dev.run([sys.executable, str(script)], cwd=root, python_paths=("backend",))

    def test_proxy_and_python_path_settings_are_preserved_without_mutating_parent(self):
        values = {"NO_PROXY": "example.org,localhost", "no_proxy": "example.net", "PYTHONPATH": "existing"}
        # A plain dict can represent both spellings on Windows, whose real
        # os.environ is case-insensitive. Exercise the Unix case as well.
        with patch.object(dev.os, "environ", values):
            env = dev.child_env(("backend",))
            self.assertEqual(env["NO_PROXY"], "example.org,localhost,127.0.0.1")
            self.assertEqual(env["no_proxy"], "example.net,127.0.0.1,localhost")
            self.assertTrue(env["PYTHONPATH"].endswith(os.pathsep + "existing"))
            self.assertEqual(dict(os.environ), values)

    def test_explicit_fixture_interpreters_are_preserved(self):
        values = {"PYTHON": "custom-python", "XSCRIPT_TEST_PYTHON": "another-python"}
        with patch.object(dev.os, "environ", values):
            env = dev.child_env()
            self.assertEqual(env["PYTHON"], "custom-python")
            self.assertEqual(env["XSCRIPT_TEST_PYTHON"], "another-python")

    def test_invalid_target_is_rejected_before_any_action(self):
        with patch.object(dev, "run") as run, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                dev.main(["setup", "typo"])
            self.assertEqual(error.exception.code, 2)
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
