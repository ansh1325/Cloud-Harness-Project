import asyncio
import json
import pytest
from httpx import AsyncClient, ASGITransport
from server.app import app


@pytest.mark.asyncio
async def test_sse_live_patch_delivery_and_clean_close():
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.post("/api/benchmark/run-sample?session_id=ci-sse-test")
            assert res.status_code == 200
            task_id = res.json()["task_id"]

            # 1. Stream live SSE to completion: must receive patch AND event: done
            received_types = []
            saw_done = False
            async with asyncio.timeout(25):
                async with client.stream("GET", f"/api/tasks/{task_id}/events") as resp:
                    assert resp.status_code == 200
                    assert resp.headers.get("x-accel-buffering") == "no"
                    async for line in resp.aiter_lines():
                        if line == "event: done":
                            saw_done = True
                        elif line.startswith("data: "):
                            payload = json.loads(line[6:])
                            if "event_type" in payload:
                                received_types.append(payload["event_type"])

            assert "patch" in received_types, f"Missing patch event in live SSE: {received_types}"
            assert saw_done, "SSE stream did not emit terminal `event: done` sentinel"

            # 2. Re-open SSE on ALREADY COMPLETED task: must NOT hang!
            saw_done_replay = False
            async with asyncio.timeout(3):
                async with client.stream("GET", f"/api/tasks/{task_id}/events") as resp2:
                    assert resp2.status_code == 200
                    async for line in resp2.aiter_lines():
                        if line == "event: done":
                            saw_done_replay = True
            assert saw_done_replay

            # 3. Verify downloadable .patch endpoint
            patch_resp = await client.get(f"/api/tasks/{task_id}/patch")
            assert patch_resp.status_code == 200
            assert "--- a/app/calculator.py" in patch_resp.text
            assert "+++ b/app/calculator.py" in patch_resp.text

            # 4. Verify session isolation
            empty_res = await client.get("/api/tasks?session_id=brand-new-session")
            assert empty_res.status_code == 200
            assert empty_res.json() == []
