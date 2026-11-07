"""The dependency installer must serialize independent script/eval processes."""

import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from xscript.runtime import sitepkgs


class InstallLockTest(unittest.TestCase):
    def test_another_process_waits_until_the_install_lock_is_released(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"XSCRIPT_PIP_HOME": tmp}):
            marker = Path(tmp) / "acquired"
            code = ("from pathlib import Path\nfrom xscript.runtime import sitepkgs\n"
                    "print('ready', flush=True)\nwith sitepkgs.lock():\n"
                    "    Path(%r).write_text('acquired')\n" % str(marker))
            child = None
            try:
                with sitepkgs.lock():
                    child = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE,
                                             stderr=subprocess.PIPE, text=True, env=os.environ.copy())
                    self.assertEqual(child.stdout.readline().strip(), "ready")
                    time.sleep(0.15)
                    self.assertIsNone(child.poll())
                    self.assertFalse(marker.exists())
                _, error = child.communicate(timeout=10)
                self.assertEqual(child.returncode, 0, error)
                self.assertEqual(marker.read_text(), "acquired")
            finally:
                if child is not None:
                    if child.poll() is None:
                        child.kill()
                    child.communicate(timeout=5)
