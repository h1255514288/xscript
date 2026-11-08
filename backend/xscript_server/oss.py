"""Aliyun OSS for 热更新 bundles (optional CDN delivery).

When OSS is enabled and configured, `/pub/update` uploads the published bundle once and hands
the app an OSS URL (a signed URL, or a CDN/custom domain when `oss_public_base` is set). If the
upload fails the endpoint falls back to serving `/pub/bundle/...` itself, so hot updates keep
working even when OSS is down or misconfigured. The signed manifest is unchanged: the app still
checks the zip's sha256 before installing it.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import quote

from .config import Config

log = logging.getLogger(__name__)

DEFAULT_PREFIX = "xscript/hot-update"
MAX_URL_EXPIRE = 7 * 24 * 3600


class OssError(RuntimeError):
    pass


@dataclass(frozen=True)
class OssConfig:
    enabled: bool
    endpoint: str
    bucket: str
    access_key: str
    access_secret: str
    prefix: str = DEFAULT_PREFIX
    public_base: str = ""
    url_expire: int = 3600
    missing: tuple[str, ...] = field(default=())

    @property
    def configured(self) -> bool:
        return not self.missing

    @property
    def active(self) -> bool:
        return self.enabled and self.configured

    def status(self) -> dict[str, Any]:
        """What the settings page shows; never includes the secret."""
        return {
            "enabled": self.enabled,
            "configured": self.configured,
            "endpoint": self.endpoint,
            "bucket": self.bucket,
            "prefix": self.prefix,
            "public_base": self.public_base,
            "url_expire": self.url_expire,
            "secret_set": bool(self.access_secret),
            "missing": list(self.missing),
        }


def normalize_prefix(value: str) -> str:
    parts = [p for p in (value or "").replace("\\", "/").split("/") if p and p != "."]
    if any(p == ".." for p in parts):
        raise ValueError("前缀不能包含 ..")
    return "/".join(parts) or DEFAULT_PREFIX


def from_settings(config: Config, settings: dict[str, Any]) -> OssConfig:
    """Environment configuration wins over 系统设置, so a deployment can pin credentials."""
    def pick(env: str, key: str) -> str:
        return (env or str(settings.get(key) or "")).strip()

    endpoint = pick(config.oss_endpoint, "oss_endpoint").rstrip("/")
    bucket = pick(config.oss_bucket, "oss_bucket")
    access_key = pick(config.oss_access_key, "oss_access_key_id")
    access_secret = pick(config.oss_access_secret, "oss_access_key_secret")
    prefix = normalize_prefix(config.oss_prefix or str(settings.get("oss_prefix") or DEFAULT_PREFIX))
    public_base = pick(config.oss_public_base, "oss_public_base").rstrip("/")
    try:
        expire = int(config.oss_url_expire if config.oss_url_expire is not None
                     else settings.get("oss_url_expire") or 3600)
    except (TypeError, ValueError):
        expire = 3600
    expire = max(60, min(expire, MAX_URL_EXPIRE))
    missing = tuple(name for name, value in (
        ("接口地址", endpoint),
        ("Bucket", bucket),
        ("AccessKey ID", access_key),
        ("AccessKey Secret", access_secret),
    ) if not value)
    return OssConfig(
        enabled=bool(config.oss_enabled or settings.get("oss_enabled")),
        endpoint=endpoint,
        bucket=bucket,
        access_key=access_key,
        access_secret=access_secret,
        prefix=prefix,
        public_base=public_base,
        url_expire=expire,
        missing=missing,
    )


def bundle_key(cfg: OssConfig, channel: str, version_code: int, digest: str) -> str:
    """Immutable object name: a new version or a changed digest is a new object (safe to cache)."""
    return "%s/%s/%d-%s.zip" % (cfg.prefix, channel, version_code, (digest or "")[:12])


_lock = threading.Lock()
_buckets: dict[tuple[str, str, str, str], Any] = {}


def _bucket(cfg: OssConfig):
    if not cfg.configured:
        raise OssError("OSS 未配置：" + "、".join(cfg.missing))
    try:
        import oss2
    except ImportError as e:  # pragma: no cover - the dependency is part of the server
        raise OssError("未安装 oss2，无法使用 OSS") from e
    key = (cfg.endpoint, cfg.bucket, cfg.access_key, cfg.access_secret)
    with _lock:
        bucket = _buckets.get(key)
        if bucket is None:
            bucket = oss2.Bucket(oss2.Auth(cfg.access_key, cfg.access_secret), cfg.endpoint, cfg.bucket)
            _buckets[key] = bucket
        return bucket


def url(cfg: OssConfig, object_key: str) -> str:
    if cfg.public_base:
        return "%s/%s" % (cfg.public_base, quote(object_key, safe="/"))
    return _bucket(cfg).sign_url("GET", object_key, cfg.url_expire, slash_safe=True)


def publish(cfg: OssConfig, path: Path, object_key: str) -> str:
    """Upload the bundle if it is not there yet; returns the URL the app should download."""
    bucket = _bucket(cfg)
    if not bucket.object_exists(object_key):
        bucket.put_object_from_file(
            object_key, str(path),
            headers={
                "Content-Type": "application/zip",
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        )
    return url(cfg, object_key)


def probe(cfg: OssConfig) -> str:
    """Upload and remove a tiny object so the settings page can verify write access."""
    bucket = _bucket(cfg)
    object_key = "%s/.probe" % cfg.prefix
    bucket.put_object(object_key, b"xscript oss ok")
    try:
        return url(cfg, object_key)
    finally:
        try:
            bucket.delete_object(object_key)
        except Exception as e:  # best effort; the probe is harmless
            log.warning("OSS probe cleanup failed: %s", e)
