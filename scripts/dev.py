#!/usr/bin/env python3
"""Portable local development entry point; Python 3.10+, no bootstrap dependencies.

Run `python scripts/dev.py --help` from any directory. Commands fail on the first
failed check; selected components are never silently skipped. Android/Qt/device
checks remain in scripts/verify.sh and the component-specific guides.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = {"console": "backend/web", "extension": "ide/vscode-extension"}
GENERATORS = ("stubs", "completions", "editor_docs", "nodespecs", "api_catalog", "connect_check")
TARGETS = ("repo", "python", "console", "extension", "webide")
NODE_REQUIREMENT = "Node.js 22.22.2+ (22.x), 24.15.0+ (24.x), or 26+"


class DevError(Exception):
    """An actionable local setup error."""


def child_env(python_paths: tuple[str, ...] = ()) -> dict[str, str]:
    env = dict(os.environ, PYTHONUTF8="1")
    # Existing Node fixtures accept these overrides; Windows often has no python3.
    env.setdefault("PYTHON", sys.executable)
    env.setdefault("XSCRIPT_TEST_PYTHON", sys.executable)
    for key in ("NO_PROXY", "no_proxy"):
        entries = [item for item in env.get(key, "").split(",") if item]
        env[key] = ",".join(dict.fromkeys([*entries, "127.0.0.1", "localhost"]))
    if python_paths:
        paths = [str(ROOT / path) for path in python_paths]
        if env.get("PYTHONPATH"):
            paths.append(env["PYTHONPATH"])
        env["PYTHONPATH"] = os.pathsep.join(paths)
    return env


def run(args: list[str], *, cwd: Path = ROOT, dry_run: bool = False,
        python_paths: tuple[str, ...] = ()) -> None:
    print(f"[{cwd.relative_to(ROOT) if cwd.is_relative_to(ROOT) else cwd}] "
          + subprocess.list2cmdline([str(arg) for arg in args]), flush=True)
    if not dry_run:
        subprocess.run(args, cwd=cwd, env=child_env(python_paths), check=True)


def executable(name: str, dry_run: bool = False) -> str:
    # Resolve npm.cmd explicitly: npm.ps1 is a PowerShell convenience wrapper.
    command = "npm.cmd" if name == "npm" and os.name == "nt" else name
    path = shutil.which(command)
    if path:
        return path
    if dry_run:
        return command
    raise DevError(f"Missing {name}. Install Git / {NODE_REQUIREMENT} as needed, then rerun doctor.")


def supported_node(version: str) -> bool:
    # jsdom 30 in the console lockfile requires these Node release lines.
    value = tuple(int(part) for part in version.lstrip("v").split("."))
    return ((22, 22, 2) <= value < (23, 0, 0)
            or (24, 15, 0) <= value < (25, 0, 0) or value >= (26, 0, 0))


def venv_python() -> Path:
    return ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def require_python(dry_run: bool) -> str:
    path = venv_python()
    if not path.is_file() and not dry_run:
        raise DevError("Missing .venv. Run: python scripts/dev.py setup python")
    return str(path)


def doctor() -> None:
    print(f"Repository: {ROOT}\nPython: {sys.version.split()[0]} ({sys.executable})")
    missing = []
    for name in ("git", "node", "npm"):
        try:
            command = executable(name)
            result = subprocess.run([command, "--version"], cwd=ROOT, env=child_env(),
                                    check=True, capture_output=True, text=True)
            version = result.stdout.strip()
            print(f"{name}: {version} ({command})")
            if name == "node" and not supported_node(version):
                missing.append(f"{NODE_REQUIREMENT} is required by the console test dependencies")
        except (DevError, OSError, subprocess.CalledProcessError, ValueError) as exc:
            missing.append(str(exc))
    print(f"Python test environment: {venv_python()} ({'ready' if venv_python().is_file() else 'run setup python'})")
    for name in ("java", "adb"):
        print(f"Optional {name}: {shutil.which(name) or 'not on PATH (needed for Android/device work only)'}")
    if missing:
        raise DevError("\n".join(missing))


def setup(targets: list[str], dry_run: bool) -> None:
    for target in dict.fromkeys(targets):
        print(f"\n== setup: {target} ==", flush=True)
        if target == "python":
            py = venv_python()
            if not py.is_file():
                if (ROOT / ".venv").exists():
                    raise DevError(".venv exists but has no Python executable. Repair it or use a fresh checkout.")
                run([sys.executable, "-m", "venv", str(ROOT / ".venv")], dry_run=dry_run)
            run([str(py), "-m", "pip", "install", "-e", "backend[test]", "-e", "ide/mcp-server[test]"],
                dry_run=dry_run)
        else:
            run([executable("npm", dry_run), "ci"], cwd=ROOT / PACKAGES[target], dry_run=dry_run)


def check(targets: list[str], dry_run: bool) -> None:
    for target in dict.fromkeys(targets):
        print(f"\n== check: {target} ==", flush=True)
        if target == "repo":
            run([sys.executable, "-m", "unittest", "discover", "-s", "scripts/tests", "-p", "test_dev.py"],
                dry_run=dry_run)
            for name in ("check_repo_files", "check_docs"):
                run([sys.executable, f"scripts/{name}.py"], dry_run=dry_run)
            for name in GENERATORS:
                run([sys.executable, f"scripts/gen_{name}.py", "--check"], dry_run=dry_run)
        elif target == "python":
            py = require_python(dry_run)
            for path in ("backend", "ide/mcp-server"):
                run([py, "-m", "unittest", "discover", "-s", f"{path}/tests"],
                    python_paths=(path,), dry_run=dry_run)
            run([py, "scripts/vertical_slice.py", "--mock"],
                python_paths=("ide/mcp-server",), dry_run=dry_run)
        elif target in PACKAGES:
            path = ROOT / PACKAGES[target]
            if not (path / "node_modules").is_dir() and not dry_run:
                raise DevError(f"Missing {path / 'node_modules'}. Run: python scripts/dev.py setup {target}")
            npm = executable("npm", dry_run)
            if target == "extension":
                run([npm, "run", "compile"], cwd=path, dry_run=dry_run)
                run([npm, "test"], cwd=path, dry_run=dry_run)
                run([executable("node", dry_run), "scripts/export-templates.js", "--check"],
                    cwd=path, dry_run=dry_run)
            else:
                run([npm, "test"], cwd=path, dry_run=dry_run)
                run([npm, "run", "build"], cwd=path, dry_run=dry_run)
        elif target == "webide":
            # Expand globs ourselves: PowerShell/cmd do not do Bash-style expansion.
            files = sorted(str(path.relative_to(ROOT)) for path in (ROOT / "scripts/tests").glob("*.test.cjs"))
            if not files:
                raise DevError("No Web IDE tests found; check the repository checkout.")
            run([executable("node", dry_run), "--test", *files], dry_run=dry_run)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor", help="Report local tools; Android tools are optional")
    for name, choices, defaults in (("setup", ("python", *PACKAGES), ["python", "console"]),
                                    ("check", TARGETS, ["repo"])):
        command = commands.add_parser(name)
        command.add_argument("targets", nargs="*", metavar="TARGET",
                             help=f"Choose from {', '.join(choices)}; default: {', '.join(defaults)}")
        command.add_argument("--dry-run", action="store_true", help="Print commands without installing or running checks")
        command.set_defaults(allowed=choices, default_targets=defaults)
    args = parser.parse_args(argv)
    if sys.version_info < (3, 10):
        print("Python 3.10+ is required.", file=sys.stderr)
        return 1
    if args.command != "doctor":
        args.targets = args.targets or args.default_targets
        invalid = set(args.targets) - set(args.allowed)
        if invalid:
            parser.error("Unknown target(s): " + ", ".join(sorted(invalid)))
    try:
        if args.command == "doctor":
            doctor()
        elif args.command == "setup":
            setup(args.targets, args.dry_run)
        else:
            check(args.targets, args.dry_run)
    except subprocess.CalledProcessError as exc:
        print(f"FAILED (exit {exc.returncode}): {subprocess.list2cmdline(exc.cmd)}", file=sys.stderr)
        return exc.returncode if 0 < exc.returncode < 126 else 1
    except (DevError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    print("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
