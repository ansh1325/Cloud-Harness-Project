import React, { useState } from 'react';

const PRESETS = [
  {
    label: '🧊 Cold-Chain Freight & Temp Decay',
    sub: 'Fix surcharge threshold & zero-division guard in calculator.py',
    desc: 'Fix freight surcharge weight threshold in calculator.py and add insulation_r_value validation for temperature decay'
  },
  {
    label: '📡 IoT Telemetry Pipeline',
    sub: 'Fix KeyError & GPS latitude bounds in data_pipeline.py',
    desc: 'Fix missing device_id validation and latitude boundary check in data_pipeline.py'
  },
  {
    label: '🔥 Full Repository Multi-File Repair',
    sub: 'Diagnose & resolve all failing suites simultaneously',
    desc: 'Fix all bugs across full repo multi-file suites (calculator.py and data_pipeline.py)'
  }
];

export default function DispatchModal({ open, onClose, onSubmit }) {
  const [taskDesc, setTaskDesc] = useState(PRESETS[1].desc);
  const [repoUrl, setRepoUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!taskDesc.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        task_description: taskDesc.trim(),
        repo_url: repoUrl.trim() || null
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form className="modal-card" onSubmit={handleSubmit}>
        <div className="modal-title">🚀 Dispatch Autonomous SWE Agent</div>
        <div className="modal-sub">
          Select a verified benchmark scenario or point the sandbox at any public Python GitHub repo:
        </div>

        <div className="preset-grid">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="preset-chip"
              onClick={() => {
                setTaskDesc(p.desc);
                setRepoUrl('');
              }}
            >
              <strong>{p.label}</strong> — <span style={{ color: 'var(--text-muted)' }}>{p.sub}</span>
            </button>
          ))}
        </div>

        <label className="field-label">Public GitHub Repo URL (Optional — defaults to built-in sample_repo)</label>
        <input
          className="modal-input"
          type="url"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/python-repo (leave blank for sample_repo)"
        />

        <label className="field-label">Engineering Task / Bug Report</label>
        <textarea
          className="modal-textarea"
          value={taskDesc}
          onChange={(e) => setTaskDesc(e.target.value)}
          placeholder="Describe the bug or engineering task..."
          required
        />

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ padding: '7px 14px' }}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Launching...' : 'Launch Isolated Sandbox'}
          </button>
        </div>
      </form>
    </div>
  );
}
