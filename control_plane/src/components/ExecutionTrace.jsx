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
  onJumpTab
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
          {selectedTaskId || 'No task selected'}
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
          <div className="empty-state">
            Click <strong style={{ color: 'var(--success)' }}>▶ Benchmark</strong> for a single autonomous repair,
            <br />
            <strong style={{ color: '#818cf8' }}>⚡ 3x Swarm</strong> to run 3 isolated sandboxes in parallel,
            <br />
            or <strong style={{ color: 'var(--accent)' }}>+ Dispatch</strong> for a custom repo / task.
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
