"""
Cloud Sandbox Pre-Warming Pool & Orchestrator Manager
Guarantees <5-second sandbox startup SLA and orchestrates 100+ concurrent agent workers.
"""
import shutil
import uuid
import asyncio
import time
from pathlib import Path
from typing import Dict, Optional
from pydantic import BaseModel

from .container_runner import SandboxEnvironment
from .cache import RepositoryCache


class SandboxMetrics(BaseModel):
    warm_pool_size: int
    active_sandboxes: int
    total_acquired: int
    avg_startup_latency_ms: float
    p99_startup_latency_ms: float
    max_concurrency_capacity: int


class PrewarmedSandboxPool:
    """
    Maintains a pool of pre-warmed execution sandboxes to eliminate container cold-start delay.
    Uses non-blocking worker threads and per-repo locks for thread-safe 100+ concurrency.
    """

    def __init__(
        self,
        base_dir: Optional[Path] = None,
        warm_target: int = 5,
        max_concurrent: int = 120
    ):
        if base_dir is None:
            base_dir = Path.home() / ".cache" / "ai_coding_harness" / "sandboxes"
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

        self.warm_target = warm_target
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)

        self.cache = RepositoryCache()
        self.warm_pool: asyncio.Queue[SandboxEnvironment] = asyncio.Queue()
        self.active_sandboxes: Dict[str, SandboxEnvironment] = {}
        self.startup_latencies: list[float] = []
        self.total_acquired = 0
        self._repo_locks: Dict[str, asyncio.Lock] = {}

        self._replenish_task: Optional[asyncio.Task] = None
        self._running = False

    def _get_repo_lock(self, key: str) -> asyncio.Lock:
        lock = self._repo_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._repo_locks[key] = lock
        return lock

    async def start(self):
        """Starts the background pre-warming engine."""
        self._running = True
        for _ in range(self.warm_target):
            sandbox = self._create_pristine_sandbox()
            await self.warm_pool.put(sandbox)

        self._replenish_task = asyncio.create_task(self._pool_replenish_loop())

    async def stop(self):
        """Cleans up all warm and active sandboxes."""
        self._running = False
        if self._replenish_task:
            self._replenish_task.cancel()

        while not self.warm_pool.empty():
            sb = await self.warm_pool.get()
            self._destroy_sandbox(sb)

        for sb in list(self.active_sandboxes.values()):
            self._destroy_sandbox(sb)
        self.active_sandboxes.clear()

    def _create_pristine_sandbox(self) -> SandboxEnvironment:
        sb_id = f"sbx-{uuid.uuid4().hex[:8]}"
        workspace = self.base_dir / "pool" / sb_id
        return SandboxEnvironment(sandbox_id=sb_id, workspace_path=workspace)

    def _destroy_sandbox(self, sandbox: SandboxEnvironment):
        try:
            if sandbox.workspace_path.exists():
                shutil.rmtree(sandbox.workspace_path, ignore_errors=True)
        except Exception:
            pass

    async def _pool_replenish_loop(self):
        """Continuously replenishes the warm pool in the background."""
        while self._running:
            try:
                if self.warm_pool.qsize() < self.warm_target:
                    sandbox = await asyncio.to_thread(self._create_pristine_sandbox)
                    await self.warm_pool.put(sandbox)
                await asyncio.sleep(0.35)
            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(1.0)

    async def acquire_sandbox(
        self,
        repo_name: Optional[str] = None,
        source_repo_path: Optional[Path] = None,
        repo_url: Optional[str] = None
    ) -> SandboxEnvironment:
        """
        Acquires an isolated sandbox for an agent without blocking the event loop.
        Supports both local benchmark repos and public GitHub URLs with on-disk caching.
        """
        start_time = time.perf_counter()
        await self.semaphore.acquire()

        try:
            try:
                sandbox = self.warm_pool.get_nowait()
            except asyncio.QueueEmpty:
                sandbox = await asyncio.to_thread(self._create_pristine_sandbox)

            cache_key = repo_name
            if repo_url:
                lock = self._get_repo_lock(repo_url)
                async with lock:
                    cache_key = await asyncio.to_thread(self.cache.cache_git_repo, repo_url)
                await asyncio.to_thread(
                    self.cache.provision_workspace_from_cache,
                    cache_key,
                    sandbox.workspace_path
                )
            elif repo_name and source_repo_path:
                lock = self._get_repo_lock(repo_name)
                async with lock:
                    await asyncio.to_thread(self.cache.cache_local_repo, source_repo_path, repo_name)
                await asyncio.to_thread(
                    self.cache.provision_workspace_from_cache,
                    repo_name,
                    sandbox.workspace_path
                )

            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            self.startup_latencies.append(elapsed_ms)
            self.active_sandboxes[sandbox.sandbox_id] = sandbox
            self.total_acquired += 1
            return sandbox
        except Exception:
            self.semaphore.release()
            raise

    async def release_sandbox(self, sandbox: SandboxEnvironment):
        """Releases the sandbox and recycles workspace asynchronously."""
        if sandbox.sandbox_id in self.active_sandboxes:
            del self.active_sandboxes[sandbox.sandbox_id]

        self.semaphore.release()
        asyncio.create_task(asyncio.to_thread(self._destroy_sandbox, sandbox))

    def get_metrics(self) -> SandboxMetrics:
        """Returns telemetry metrics for the control plane UI."""
        latencies = self.startup_latencies[-100:] if self.startup_latencies else [0.0]
        sorted_latencies = sorted(latencies)
        p99_index = min(int(len(sorted_latencies) * 0.99), len(sorted_latencies) - 1)
        p99_val = sorted_latencies[p99_index]
        avg_val = sum(latencies) / len(latencies)

        return SandboxMetrics(
            warm_pool_size=self.warm_pool.qsize(),
            active_sandboxes=len(self.active_sandboxes),
            total_acquired=self.total_acquired,
            avg_startup_latency_ms=round(avg_val, 2),
            p99_startup_latency_ms=round(p99_val, 2),
            max_concurrency_capacity=self.max_concurrent
        )
