import React from 'react';

export default function Header({
  metrics,
  busyAction,
  onRunBenchmark,
  onRunSwarm,
  onOpenDispatch
}) {
  const p99Ms = metrics?.pool?.p99_startup_latency_ms || 0;
  const p99Label = p99Ms > 0 ? `${(p99Ms / 1000).toFixed(2)}s` : '<0.1s';

  return (
    <header>
      <div className="logo-area">
        <div className="logo-badge">⚡ HARNESS</div>
        <div>
          <div className="logo-title">Cloud-Native AI Coding Harness</div>
          <div className="logo-sub">React Control Plane • Isolated Sandbox Orchestrator</div>
        </div>
      </div>

      <div className="metrics-bar">
        <div className="metric-pill">
          <span>Engine:</span>
          <strong>{metrics?.llm_engine || 'Groq 120B'}</strong>
        </div>
        <div className="metric-pill">
          <span>Agents:</span>
          <strong>{metrics?.telemetry?.active_agents ?? 0}</strong>/120
        </div>
        <div className="metric-pill">
          <span>Warm Pool:</span>
          <strong>{metrics?.pool?.warm_pool_size ?? 5}</strong>
        </div>
        <div className="metric-pill">
          <span>P99:</span>
          <strong>{p99Label}</strong>
        </div>
        <div className="metric-pill">
          <span>Success:</span>
          <strong>{metrics?.telemetry?.success_rate_percent ?? 100}%</strong>
        </div>
      </div>

      <div className="action-buttons">
        <button
          className="btn btn-benchmark"
          disabled={busyAction !== null}
          onClick={onRunBenchmark}
        >
          {busyAction === 'benchmark' ? '⏳ Launching...' : '▶ Benchmark'}
        </button>
        <button
          className="btn btn-swarm"
          disabled={busyAction !== null}
          onClick={onRunSwarm}
          title="Launch 3 isolated parallel agents simultaneously"
        >
          {busyAction === 'swarm' ? '⏳ Spawning 3...' : '⚡ 3x Swarm'}
        </button>
        <button
          className="btn btn-primary"
          disabled={busyAction !== null}
          onClick={onOpenDispatch}
        >
          + Dispatch
        </button>
      </div>
    </header>
  );
}
