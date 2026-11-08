"""The real shell entry point works from native Windows/POSIX Python with spaced paths."""

import importlib.util
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SPEC = importlib.util.spec_from_file_location("pack_tool", Path(__file__).resolve().parents[1] / "xscript_pack.py")
pack_tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pack_tool)


class PackToolTest(unittest.TestCase):
    def test_windows_reports_a_missing_bash_before_trying_to_execute_a_shell_file(self):
        with mock.patch.object(pack_tool.os, "name", "nt"), \
                mock.patch.object(pack_tool.shutil, "which", return_value=None):
            with self.assertRaisesRegex(SystemExit, "Git Bash"):
                pack_tool.build_command("pack.properties")

    def test_posix_keeps_the_executable_build_script(self):
        with mock.patch.object(pack_tool.os, "name", "posix"):
            cmd = pack_tool.build_command("/tmp/pack properties")
        self.assertEqual(cmd, [os.path.join(pack_tool.ROOT, "android", "build.sh"),
                               "-q", "-Pxscript.pack=/tmp/pack properties"])

    @unittest.skipUnless(shutil.which("bash"), "Git Bash / bash not installed")
    def test_windows_command_executes_the_shell_and_preserves_spaced_property_paths(self):
        bash = shutil.which("bash")
        with tempfile.TemporaryDirectory(prefix="xscript pack ") as tmp:
            root = Path(tmp)
            (root / "android").mkdir()
            script = root / "android/build.sh"
            script.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n', encoding="utf-8")
            props = str(root / "pack properties.properties")
            with mock.patch.object(pack_tool, "ROOT", str(root)), \
                    mock.patch.object(pack_tool.os, "name", "nt"), \
                    mock.patch.object(pack_tool.shutil, "which", return_value=bash):
                cmd = pack_tool.build_command(props)
            result = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=20)
            self.assertEqual(result.stdout.splitlines(), ["-q", "-Pxscript.pack=" + props])


if __name__ == "__main__":
    unittest.main()
