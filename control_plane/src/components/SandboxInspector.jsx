import React, { useEffect, useRef, useState } from 'react';

function classifyTerminalLine(line) {
  const trimmed = line.trim();
  if (!trimmed || /^[=\-_]{10,}$/.test(trimmed)) return null;
  if (trimmed.startsWith('[PHASE 2') && trimmed.includes('PASSED')) return 'term-line term-phase-pass';
  if (trimmed.startsWith('[PHASE ')) return 'term-line term-phase';
  if (/\bPASSED\b/.test(line) || (/\d+ passed/.test(line) && !/failed/.test(line))) return 'term-line term-pass';
  if (/\bFAILED\b|Error:|AssertionError|KeyError|ZeroDivisionError/.test(line)) return 'term-line term-fail';
  if (trimmed.startsWith('collecting') || trimmed.startsWith('collected') || trimmed.startsWith('[STREAM')) {
    return 'term-line term-meta';
  }
  return 'term-line';
}

export default function SandboxInspector({
  activeTab,
  onTabChange,
  selectedTaskId,
  terminalLines,
  diffText,
  diffStats,
  prPayload
}) {
  const termRef = useRef(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (activeTab === 'terminal' && termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [terminalLines.length, activeTab]);

  const handleCopyDiff = async () => {
    if (!diffText) return;
    try {
      await navigator.clipboard.writeText(diffText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked in non-HTTPS contexts
    }
  };

  return (
    <div className="panel">
      <div className="tabs">
        <div className="tab-group">
          <div
            className={`tab ${activeTab === 'terminal' ? 'active' : ''}`}
            onClick={() => onTabChange('terminal')}
          >
            Sandbox Terminal
          </div>
          <div
            className={`tab ${activeTab === 'diff' ? 'active' : ''}`}
            onClick={() => onTabChange('diff')}
          >
            Generated Changes
            {diffStats && (diffStats.insertions > 0 || diffStats.deletions > 0) && (
              <span className="tab-badge">
                +{diffStats.insertions}/-{diffStats.deletions}
              </span>
            )}
          </div>
          <div
            className={`tab ${activeTab === 'pr' ? 'active' : ''}`}
            onClick={() => onTabChange('pr')}
          >
            PR Payload
          </div>
        </div>

        {diffText && selectedTaskId && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-ghost" onClick={handleCopyDiff}>
              {copied ? '✓ Copied' : 'Copy Diff'}
            </button>
            <a
              className="btn-ghost"
              href={`/api/tasks/${encodeURIComponent(selectedTaskId)}/patch`}
              download={`${selectedTaskId}.patch`}
              style={{ textDecoration: 'none' }}
            >
              ⬇ .patch
            </a>
          </div>
        )}
      </div>

      {activeTab === 'terminal' && (
        <div className="tab-content">
          <div className="terminal-window" ref={termRef}>
            {terminalLines.length === 0 ? (
              <span className="term-line term-meta">
                [HARNESS DAEMON ONLINE]
                {'\n'}Waiting for agent sandbox execution stream...
              </span>
            ) : (
              terminalLines.map((entry, idx) => {
                const cls = classifyTerminalLine(entry.text);
                if (!cls) return null;
                return (
                  <span key={idx} className={cls}>
                    {entry.prefix ? `${entry.prefix}  ${entry.text}` : entry.text}
                  </span>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'diff' && (
        <div className="tab-content">
          <div className="diff-window">
            {!diffText ? (
              <span className="term-meta">No diff generated yet.</span>
            ) : (
              diffText.split('\n').map((line, idx) => {
                let cls = '';
                if (line.startsWith('+') && !line.startsWith('+++')) cls = 'diff-line-add';
                else if (line.startsWith('-') && !line.startsWith('---')) cls = 'diff-line-del';
                else if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) {
                  cls = 'diff-line-info';
                }
                return (
                  <span key={idx} className={cls}>
                    {line}
                    {'\n'}
                  </span>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'pr' && (
        <div className="tab-content">
          <div className="pr-card">
            <h3 className="pr-title">{prPayload?.title || 'PR Not Ready'}</h3>
            <div className="pr-body">
              {prPayload?.body || 'Pending sandbox test verification...'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
