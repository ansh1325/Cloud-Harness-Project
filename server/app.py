"""
FastAPI Server & Real-time Event Streaming Engine
Supports 100+ concurrent agents and streams SSE execution traces, terminal stdout, and diffs.
"""
import os
import uuid
import time
import json
import asyncio
from pathlib import Path
from typing import Dict, List, Optional, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, StreamingResponse, PlainTextResponse
from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()

from sandbox.manager import PrewarmedSandboxPool
from agent.loop import AutonomousExecutionLoop, LoopEvent, AgentLoopResult
from .models import CreateTaskRequest, AgentTaskResponse, EventMessage
from .telemetry import telemetry

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BENCHMARK_SAMPLE_DIR = PROJECT_ROOT / "benchmarks" / "sample_repo"

# In-memory storage for active tasks and their live event queues
sandbox_pool: Optional[PrewarmedSandboxPool] = None
task_store: Dict[str, Dict[str, Any]] = {}
event_queues: Dict[str, List[asyncio.Queue]] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global sandbox_pool
    sandbox_pool = PrewarmedSandboxPool(warm_target=5, max_concurrent=120)
    await sandbox_pool.start()
    yield
    await sandbox_pool.stop()


app = FastAPI(
    title="Cloud-Native AI Coding Harness",
    description="High-concurrency cloud coding-agent harness with pre-warmed sandboxes and streaming control plane",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def broadcast_event(task_id: str, event: LoopEvent):
    """Stores event in task history with monotonic seq and fans out to all active SSE subscribers."""
    payload = event.model_dump()
    if task_id in task_store:
        payload["seq"] = len(task_store[task_id]["events"])
        task_store[task_id]["events"].append(payload)

    queues = event_queues.get(task_id, [])
    for q in list(queues):
        await q.put(payload)


async def run_agent_task_worker(task_id: str, req: CreateTaskRequest):
    """Background worker executing the autonomous SWE cycle inside an isolated sandbox."""
    global sandbox_pool
    telemetry.record_agent_started()
    task_data = task_store[task_id]
    sandbox = None

    try:
        # Acquire warm sandbox (<5s startup SLA)
        acquire_start = time.perf_counter()
        if req.repo_url and req.repo_url.strip():
            sandbox = await sandbox_pool.acquire_sandbox(
                repo_name=req.repo_name,
                repo_url=req.repo_url.strip()
            )
        else:
            sandbox = await sandbox_pool.acquire_sandbox(
                repo_name=req.repo_name,
                source_repo_path=BENCHMARK_SAMPLE_DIR
            )
        startup_ms = (time.perf_counter() - acquire_start) * 1000.0
        telemetry.record_startup_latency(startup_ms)

        task_data["sandbox_id"] = sandbox.sandbox_id
        task_data["status"] = "RUNNING"

        # Emit warm sandbox acquired event
        await broadcast_event(task_id, LoopEvent(
            task_id=task_id,
            event_type="status",
            message=f"Acquired warm sandbox [{sandbox.sandbox_id}] in {round(startup_ms, 1)}ms",
            data={"sandbox_id": sandbox.sandbox_id, "startup_latency_ms": startup_ms}
        ))

        # Launch Autonomous SWE Loop
        loop = AutonomousExecutionLoop(
            sandbox=sandbox,
            task_id=task_id,
            task_description=req.task_description,
            max_iterations=req.max_iterations,
            event_callback=lambda evt: broadcast_event(task_id, evt)
        )

        res: AgentLoopResult = await loop.run()

        # Update task status
        task_data["status"] = res.status
        task_data["duration_seconds"] = res.duration_seconds
        task_data["iterations_used"] = res.iterations_used
        task_data["tests_passed"] = res.tests_passed
        if res.patch_summary:
            task_data["unified_diff"] = res.patch_summary.unified_diff
            task_data["pr_title"] = res.patch_summary.pr_title
            task_data["pr_body"] = res.patch_summary.pr_body

        telemetry.record_agent_finished(res.tests_passed)

    except Exception as e:
        task_data["status"] = "ERROR"
        telemetry.record_agent_finished(False)
        await broadcast_event(task_id, LoopEvent(
            task_id=task_id,
            event_type="status",
            message="ERROR",
            data={"error": str(e)}
        ))
    finally:
        # Always release sandbox & semaphore slot even on exception
        if sandbox is not None:
            await sandbox_pool.release_sandbox(sandbox)


@app.post("/api/tasks", response_model=AgentTaskResponse)
async def create_task(req: CreateTaskRequest, background_tasks: BackgroundTasks):
    """Submits a new coding task to the harness."""
    task_id = f"task-{uuid.uuid4().hex[:8]}"
    created_at = time.time()

    task_record = {
        "task_id": task_id,
        "session_id": req.session_id,
        "repo_name": req.repo_name,
        "task_description": req.task_description,
        "status": "QUEUED",
        "sandbox_id": None,
        "created_at": created_at,
        "duration_seconds": 0.0,
        "iterations_used": 0,
        "tests_passed": False,
        "unified_diff": None,
        "pr_title": None,
        "pr_body": None,
        "events": []
    }
    task_store[task_id] = task_record
    event_queues[task_id] = []

    background_tasks.add_task(run_agent_task_worker, task_id, req)
    return AgentTaskResponse(**{k: v for k, v in task_record.items() if k not in ("events", "session_id")})


@app.get("/api/tasks", response_model=List[AgentTaskResponse])
async def list_tasks(session_id: Optional[str] = None):
    """Returns active and completed tasks, optionally isolated to a browser session."""
    tasks = list(task_store.values())
    if session_id is not None:
        tasks = [t for t in tasks if t.get("session_id") == session_id]
    return [
        AgentTaskResponse(**{k: v for k, v in t.items() if k not in ("events", "session_id")})
        for t in reversed(tasks)
    ]


@app.delete("/api/tasks")
async def clear_tasks(session_id: Optional[str] = None):
    """Clears tasks for a specific browser session (or all if no session_id)."""
    to_remove = [
        tid for tid, t in task_store.items()
        if session_id is None or t.get("session_id") == session_id
    ]
    for tid in to_remove:
        task_store.pop(tid, None)
        event_queues.pop(tid, None)
    return {"cleared": len(to_remove)}


@app.get("/api/tasks/{task_id}", response_model=AgentTaskResponse)
async def get_task(task_id: str):
    """Returns details and patch for a single task."""
    if task_id not in task_store:
        raise HTTPException(status_code=404, detail="Task not found")
    t = task_store[task_id]
    return AgentTaskResponse(**{k: v for k, v in t.items() if k not in ("events", "session_id")})


@app.get("/api/tasks/{task_id}/patch")
async def download_task_patch(task_id: str):
    """Downloads the verified unified git patch (.patch) generated by the agent."""
    if task_id not in task_store:
        raise HTTPException(status_code=404, detail="Task not found")
    diff = task_store[task_id].get("unified_diff") or ""
    if not diff.strip():
        raise HTTPException(status_code=404, detail="No patch generated yet")
    return PlainTextResponse(
        content=diff,
        headers={"Content-Disposition": f'attachment; filename="{task_id}.patch"'}
    )


@app.get("/api/tasks/{task_id}/events")
async def stream_task_events(task_id: str):
    """
    Server-Sent Events (SSE) streaming endpoint.
    Replays history without duplicates, streams live updates, and cleanly closes
    with an explicit `event: done` sentinel once the task reaches terminal state.
    """
    if task_id not in task_store:
        raise HTTPException(status_code=404, detail="Task not found")

    queue: asyncio.Queue = asyncio.Queue()
    event_queues.setdefault(task_id, []).append(queue)

    async def event_generator():
        last_seq = -1
        terminal_seen = False
        try:
            # 1. Replay past history snapshot without duplicating queued live events
            history = list(task_store[task_id]["events"])
            for past_evt in history:
                seq = past_evt.get("seq", -1)
                if seq > last_seq:
                    last_seq = seq
                yield f"data: {json.dumps(past_evt)}\n\n"
                if past_evt.get("event_type") == "status" and past_evt.get("message") in ("RESOLVED", "FAILED", "ERROR"):
                    terminal_seen = True

            # If task already completed before SSE connected, close cleanly immediately
            if terminal_seen or task_store[task_id]["status"] in ("RESOLVED", "FAILED", "ERROR"):
                yield "event: done\ndata: {}\n\n"
                return

            # 2. Stream live events with periodic heartbeat to prevent proxy timeouts
            while True:
                try:
                    evt = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
                    if task_store.get(task_id, {}).get("status") in ("RESOLVED", "FAILED", "ERROR"):
                        yield "event: done\ndata: {}\n\n"
                        break
                    continue

                seq = evt.get("seq", -1)
                if seq != -1 and seq <= last_seq:
                    continue
                if seq > last_seq:
                    last_seq = seq

                yield f"data: {json.dumps(evt)}\n\n"
                if evt.get("event_type") == "status" and evt.get("message") in ("RESOLVED", "FAILED", "ERROR"):
                    yield "event: done\ndata: {}\n\n"
                    break
        except asyncio.CancelledError:
            pass
        finally:
            if task_id in event_queues and queue in event_queues[task_id]:
                event_queues[task_id].remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


def _active_llm_engine() -> str:
    if os.getenv("GROQ_API_KEY"):
        model = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").split("/")[-1]
        return f"Groq ({model})"
    if os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"):
        return "Gemini Flash"
    return "AST Solver"


@app.get("/api/pool/metrics")
async def get_pool_metrics():
    """Returns real-time telemetry: warm sandboxes, P99 startup latency, active workers, LLM engine."""
    global sandbox_pool
    pool_metrics = sandbox_pool.get_metrics() if sandbox_pool else {}
    telemetry_data = telemetry.get_summary()
    return {
        "pool": pool_metrics.model_dump() if hasattr(pool_metrics, "model_dump") else pool_metrics,
        "telemetry": telemetry_data,
        "llm_engine": _active_llm_engine()
    }


@app.post("/api/benchmark/run-sample")
async def trigger_sample_benchmark(background_tasks: BackgroundTasks, session_id: Optional[str] = None):
    """1-Click launch of the Freight Surcharge & Temperature Decay repair benchmark."""
    req = CreateTaskRequest(
        task_description="Fix freight surcharge weight threshold in calculator.py and add insulation_r_value validation for temperature decay",
        repo_name="sample_repo",
        max_iterations=3,
        session_id=session_id
    )
    return await create_task(req, background_tasks)


@app.post("/api/benchmark/run-swarm")
async def trigger_parallel_swarm(background_tasks: BackgroundTasks, session_id: Optional[str] = None):
    """Launches 3 isolated concurrent SWE agents simultaneously to showcase pre-warmed sandbox parallelism."""
    swarm_specs = [
        "Fix freight surcharge weight threshold in calculator.py and add insulation_r_value validation",
        "Fix missing device_id guard and latitude boundary validation in data_pipeline.py",
        "Fix all bugs across full repo multi-file suites (calculator.py & data_pipeline.py)"
    ]
    created = []
    for desc in swarm_specs:
        req = CreateTaskRequest(
            task_description=desc,
            repo_name="sample_repo",
            max_iterations=3,
            session_id=session_id
        )
        created.append(await create_task(req, background_tasks))
    return created


# Mount built React control plane (dist/) with fallback to raw control_plane/
control_plane_dist = PROJECT_ROOT / "control_plane" / "dist"
control_plane_dir = PROJECT_ROOT / "control_plane"
if control_plane_dist.exists():
    app.mount("/", StaticFiles(directory=str(control_plane_dist), html=True), name="control_plane")
elif control_plane_dir.exists():
    app.mount("/", StaticFiles(directory=str(control_plane_dir), html=True), name="control_plane")
