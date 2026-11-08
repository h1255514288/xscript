"""OSS settings and delivery; no cloud account or network access required."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from xscript_server.config import Config
from xscript_server import oss


class OssTest(unittest.TestCase):
    def setUp(self):
        self.config = Config(data_dir=Path(tempfile.gettempdir()) / "xs-oss-test")
        self.settings = {
            "oss_enabled": True,
            "oss_endpoint": "https://oss-cn-hangzhou.aliyuncs.com/",
            "oss_bucket": "xscript-bundles",
            "oss_access_key_id": "test-access-id",
            "oss_access_key_secret": "test-access-secret",
            "oss_prefix": "scripts/updates",
        }

    def test_configuration_reports_missing_fields_without_secrets(self):
        cfg = oss.from_settings(self.config, self.settings)
        self.assertTrue(cfg.active)
        self.assertEqual(cfg.endpoint, "https://oss-cn-hangzhou.aliyuncs.com")
        self.assertTrue(cfg.status()["secret_set"])
        self.assertNotIn("test-access-secret", str(cfg.status()))
        self.assertEqual(oss.bundle_key(cfg, "ch_123", 9, "a" * 64),
                         "scripts/updates/ch_123/9-aaaaaaaaaaaa.zip")
        missing = oss.from_settings(self.config, {"oss_enabled": True})
        self.assertFalse(missing.active)
        self.assertIn("AccessKey Secret", missing.missing)

    def test_environment_configuration_overrides_saved_settings(self):
        cfg = Config(data_dir=self.config.data_dir, oss_enabled=True,
                     oss_endpoint="https://env-oss.example.com", oss_bucket="env-bucket",
                     oss_access_key="env-id", oss_access_secret="env-secret",
                     oss_prefix="env-prefix", oss_url_expire=120)
        result = oss.from_settings(cfg, {**self.settings, "oss_url_expire": 7200})
        self.assertEqual((result.endpoint, result.bucket, result.access_key, result.access_secret,
                          result.prefix, result.url_expire),
                         ("https://env-oss.example.com", "env-bucket", "env-id", "env-secret", "env-prefix", 120))
        self.assertEqual(oss.from_settings(self.config, {**self.settings, "oss_url_expire": 7200}).url_expire, 7200)

    def test_prefix_rejects_parent_segments(self):
        with self.assertRaisesRegex(ValueError, "不能包含"):
            oss.normalize_prefix("scripts/../private")
        self.assertEqual(oss.normalize_prefix("/scripts//updates/"), "scripts/updates")

    def test_private_urls_are_signed_and_existing_bundles_are_reused(self):
        cfg = oss.from_settings(self.config, self.settings)
        bucket = mock.Mock()
        bucket.object_exists.return_value = False
        bucket.sign_url.return_value = "https://bucket.example.com/bundle?signature=test"
        with mock.patch.object(oss, "_bucket", return_value=bucket):
            self.assertEqual(oss.publish(cfg, Path("bundle.zip"), "bundle"), bucket.sign_url.return_value)
            bucket.put_object_from_file.assert_called_once()
            bucket.sign_url.assert_called_with("GET", "bundle", 3600, slash_safe=True)
            bucket.object_exists.return_value = True
            oss.publish(cfg, Path("bundle.zip"), "bundle")
            self.assertEqual(bucket.put_object_from_file.call_count, 1)

    def test_cdn_urls_escape_object_names_and_upload_failures_propagate(self):
        cfg = oss.from_settings(self.config, {**self.settings, "oss_public_base": "https://cdn.example.com/"})
        self.assertEqual(oss.url(cfg, "scripts/中文 #.zip"), "https://cdn.example.com/scripts/%E4%B8%AD%E6%96%87%20%23.zip")
        bucket = mock.Mock()
        bucket.object_exists.return_value = False
        bucket.put_object_from_file.side_effect = OSError("offline")
        with mock.patch.object(oss, "_bucket", return_value=bucket):
            with self.assertRaisesRegex(OSError, "offline"):
                oss.publish(cfg, Path("bundle.zip"), "bundle")

    def test_probe_removes_the_object_even_if_signing_fails(self):
        cfg = oss.from_settings(self.config, self.settings)
        bucket = mock.Mock()
        bucket.sign_url.side_effect = OSError("sign failed")
        with mock.patch.object(oss, "_bucket", return_value=bucket):
            with self.assertRaisesRegex(OSError, "sign failed"):
                oss.probe(cfg)
        bucket.put_object.assert_called_once()
        bucket.delete_object.assert_called_once_with("scripts/updates/.probe")
