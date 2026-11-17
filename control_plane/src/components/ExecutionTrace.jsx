import React, { useEffect, useRef } from 'react';

const STAGES = [
  { key: 'ast', label: '1. AST Scan' },
  { key: 'baseline', label: '2. Reproduce' },
  { key: 'patch', label: '3. Patch & Test' },
  { key: 'pr', label: '4. PR Ready' }
];

export default function ExecutionTrace({
  selectedTaskId,
  pipelineStage,
  isFailed,
  traces,
  busyAction,
  onJumpTab,
  onRunBenchmark,
  onRunSwarm,
  onOpenDispatch
}) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [traces.length]);

  const activeIdx = STAGES.findIndex((s) => s.key === pipelineStage);

  return (
    <div className="panel">
      <div className="panel-header">
        <span>Live Agent Reasoning &amp; Tool Execution</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {selectedTaskId || 'Quick Start Guide'}
        </span>
      </div>

      <div className="pipeline-stepper">
        {STAGES.map((stage, idx) => {
          let cls = 'step-node';
          if (activeIdx !== -1) {
            if (isFailed && idx === activeIdx) cls += ' error';
            else if (idx < activeIdx || pipelineStage === 'pr') cls += ' done';
            else if (idx === activeIdx) cls += ' active';
          }
          return (
            <div key={stage.key} className={cls}>
              {stage.label}
            </div>
          );
        })}
      </div>

      <div className="panel-body" ref={scrollRef}>
        {traces.length === 0 ? (
          <div className="onboarding-card">
            <div className="onboarding-hero">
              <div className="onboarding-title">🤖 What Is This App?</div>
              <div className="onboarding-desc">
                An <strong>Autonomous AI Bug-Fixing Harness</strong> (similar to Devin / SWE-bench). Hand it a
                buggy Python repository and a task — it spins up an isolated cloud sandbox, reproduces the
                failing tests, uses <strong>Groq 120B</strong> to write surgical code fixes, verifies every test
                passes, and delivers a ready-to-apply <strong>Git <code>.patch</code></strong>.
              </div>
            </div>

            <div className="flow-grid">
              <div className="flow-step">
                <div className="flow-step-title">1. AST Repo Scan</div>
                <div className="flow-step-text">
                  Acquires a pre-warmed sandbox (&lt;5s) and parses Python functions &amp; docstrings to locate buggy files.
                </div>
              </div>
              <div className="flow-step">
                <div className="flow-step-title">2. Reproduce Bug (Before)</div>
                <div className="flow-step-text">
                  Runs <code>pytest</code> first so failing tests prove the bug exists and feed exact tracebacks to the AI.
                </div>
              </div>
              <div className="flow-step">
                <div className="flow-step-title">3. AI Patch &amp; Verify (After)</div>
                <div className="flow-step-text">
                  Groq 120B edits the source code and re-runs <code>pytest</code> until all tests turn green.
                </div>
              </div>
              <div className="flow-step">
                <div className="flow-step-title">4. Diff &amp; Patch Delivery</div>
                <div className="flow-step-text">
                  Generates a color-coded unified diff, PR summary, and downloadable <code>.patch</code> file.
                </div>
              </div>
            </div>

            <div className="quickstart-list">
              <button
                className="quickstart-btn"
                disabled={busyAction !== null}
                onClick={onRunBenchmark}
              >
                <span className="quickstart-btn-title" style={{ color: '#34d399' }}>
                  ▶ 1. Try 1-Click Demo Fix (calculator.py)
                </span>
                <span className="quickstart-btn-sub">
                  Watch the AI diagnose &amp; fix 3 broken freight/temperature bugs and generate a verified Git diff (~10s).
                </span>
              </button>

              <button
                className="quickstart-btn"
                disabled={busyAction !== null}
                onClick={onRunSwarm}
              >
                <span className="quickstart-btn-title" style={{ color: '#a5b4fc' }}>
                  ⚡ 2. Launch 3x Parallel Agent Swarm
                </span>
                <span className="quickstart-btn-sub">
                  Spawn 3 isolated sandboxes simultaneously (calculator, telemetry pipeline &amp; full multi-file repair).
                </span>
              </button>

              <button
                className="quickstart-btn"
                disabled={busyAction !== null}
                onClick={onOpenDispatch}
              >
                <span className="quickstart-btn-title" style={{ color: '#38bdf8' }}>
                  🔗 3. Fix Your Own Public GitHub Python Repo
                </span>
                <span className="quickstart-btn-sub">
                  Paste any public GitHub URL + bug description — the sandbox clones, tests, patches, and exports a <code>.patch</code>.
                </span>
              </button>
            </div>
          </div>
        ) : (
          traces.map((evt, idx) => {
            const isTerminalError =
              evt.event_type === 'status' && (evt.message === 'FAILED' || evt.message === 'ERROR');
            const cardClass = isTerminalError
              ? 'trace-card error-trace'
              : `trace-card ${evt.event_type}-trace`;
            const timeStr = new Date((evt.timestamp || Date.now() / 1000) * 1000).toLocaleTimeString();

            return (
              <div key={evt.seq ?? idx} className={cardClass}>
                <div className="trace-time">
                  {timeStr} • [{(evt.event_type || 'event').toUpperCase()}]
                </div>
                <div>{evt.message}</div>
                {evt.data?.error && (
                  <div style={{ color: '#f87171', marginTop: 4, fontSize: 11.5 }}>{evt.data.error}</div>
                )}
                {evt.event_type === 'status' && evt.message === 'RESOLVED' && (
                  <div className="inline-actions">
                    <button className="inline-diff-btn" onClick={() => onJumpTab('diff')}>
                      View Generated Diff →
                    </button>
                    <button className="inline-diff-btn" onClick={() => onJumpTab('terminal')}>
                      Inspect Before/After Tests →
                    </button>
                    <button className="inline-diff-btn" onClick={() => onJumpTab('pr')}>
                      View PR Payload →
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
