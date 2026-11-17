"""
Repository & Dependency Cache Layer
Provides near-instant repository clones (local benchmarks & remote GitHub URLs)
and copy-on-write workspace provisioning to meet the <5s sandbox startup SLA.
"""
import hashlib
import shutil
import subprocess
import time
from pathlib import Path
from typing import Optional


class RepositoryCache:
    """
    Manages cached repository checkouts and prebuilt virtual environments.
    Eliminates cold git-clone latency by caching baselines on disk and
    provisioning isolated sandbox copies in milliseconds.
    """

    def __init__(self, cache_root: Optional[Path] = None):
        if cache_root is None:
            cache_root = Path.home() / ".cache" / "ai_coding_harness"
        self.cache_root = Path(cache_root)
        self.repo_cache_dir = self.cache_root / "repos"
        self.venv_cache_dir = self.cache_root / "venvs"

        self.repo_cache_dir.mkdir(parents=True, exist_ok=True)
        self.venv_cache_dir.mkdir(parents=True, exist_ok=True)

    def _get_repo_hash(self, repo_url_or_path: str, branch: str = "main") -> str:
        key = f"{repo_url_or_path}@{branch}".encode("utf-8")
        return hashlib.sha256(key).hexdigest()[:16]

    def cache_local_repo(self, source_path: Path, repo_name: str) -> Path:
        """Caches a local repository baseline atomically for rapid copying."""
        dest = self.repo_cache_dir / repo_name
        if dest.exists():
            return dest

        tmp_dest = self.repo_cache_dir / f".tmp-{repo_name}-{int(time.time() * 1000)}"
        try:
            shutil.copytree(
                source_path,
                tmp_dest,
                ignore=shutil.ignore_patterns(".git", "__pycache__", ".venv", "venv", ".pytest_cache")
            )
            try:
                tmp_dest.rename(dest)
            except OSError:
                # Another worker populated dest first
                shutil.rmtree(tmp_dest, ignore_errors=True)
        except Exception:
            shutil.rmtree(tmp_dest, ignore_errors=True)
            raise
        return dest

    def cache_git_repo(self, repo_url: str, branch: Optional[str] = None) -> str:
        """
        Clones a remote public Git repository shallowly (--depth 1) into cache.
        Subsequent sandbox acquisitions reuse the cached checkout in milliseconds.
        Returns the cache key (repo_name).
        """
        safe_url = repo_url.strip()
        if not (safe_url.startswith("https://") or safe_url.startswith("http://")):
            raise ValueError("Only https:// or http:// Git repository URLs are permitted.")

        repo_key = f"git-{self._get_repo_hash(safe_url, branch or 'default')}"
        dest = self.repo_cache_dir / repo_key
        if dest.exists():
            return repo_key

        tmp_dest = self.repo_cache_dir / f".tmp-{repo_key}-{int(time.time() * 1000)}"
        cmd = ["git", "clone", "--depth", "1"]
        if branch:
            cmd.extend(["--branch", branch])
        cmd.extend([safe_url, str(tmp_dest)])

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=45,
                check=False
            )
            if proc.returncode != 0:
                shutil.rmtree(tmp_dest, ignore_errors=True)
                raise RuntimeError(f"git clone failed: {proc.stderr.strip()[:200]}")

            # Strip .git metadata so sandbox copies are fast and lightweight
            git_dir = tmp_dest / ".git"
            if git_dir.exists():
                shutil.rmtree(git_dir, ignore_errors=True)

            try:
                tmp_dest.rename(dest)
            except OSError:
                shutil.rmtree(tmp_dest, ignore_errors=True)
        except Exception:
            shutil.rmtree(tmp_dest, ignore_errors=True)
            raise

        return repo_key

    def provision_workspace_from_cache(self, repo_name: str, target_workspace: Path) -> float:
        """
        Provisions a pristine isolated workspace for an agent sandbox from cache.
        Returns the duration taken in seconds.
        """
        start_time = time.perf_counter()

        cached_source = self.repo_cache_dir / repo_name
        if not cached_source.exists():
            raise FileNotFoundError(f"Cache miss for repository [{repo_name}]. Run cache_local_repo first.")

        if target_workspace.exists():
            shutil.rmtree(target_workspace, ignore_errors=True)

        shutil.copytree(cached_source, target_workspace)
        return time.perf_counter() - start_time
