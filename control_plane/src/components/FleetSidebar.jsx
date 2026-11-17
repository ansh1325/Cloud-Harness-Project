import React from 'react';

export default function FleetSidebar({
  tasks,
  selectedTaskId,
  onSelectTask,
  onClearSession
}) {
  return (
    <div className="panel">
      <div className="panel-header">
        <span>Fleet Orchestrator</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--accent)' }}>
            {tasks.length} {tasks.length === 1 ? 'Task' : 'Tasks'}
          </span>
          <button className="btn-ghost" onClick={onClearSession} title="Clear session tasks">
            Clear
          </button>
        </div>
      </div>

      <div className="panel-body">
        {tasks.length === 0 ? (
          <div className="empty-state">
            No active agents in this session.
            <br />
            Click <strong style={{ color: 'var(--success)' }}>▶ Benchmark</strong> or{' '}
            <strong style={{ color: '#818cf8' }}>⚡ 3x Swarm</strong> to dispatch agents.
          </div>
        ) : (
          tasks.map((task) => (
            <div
              key={task.task_id}
              className={`task-item ${task.task_id === selectedTaskId ? 'active' : ''}`}
              onClick={() => onSelectTask(task.task_id)}
            >
              <div className="task-meta">
                <span className="task-id-label">{task.task_id}</span>
                <span className={`status-tag status-${task.status}`}>{task.status}</span>
              </div>
              <div className="task-desc" title={task.task_description}>
                {task.task_description}
              </div>
              <div className="task-footer">
                <span>Repo: {task.repo_name}</span>
                <span>{task.duration_seconds > 0 ? `${task.duration_seconds}s` : ''}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
