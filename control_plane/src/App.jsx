import React, { useCallback, useEffect, useRef, useState } from 'react';
import Header from './components/Header.jsx';
import FleetSidebar from './components/FleetSidebar.jsx';
import ExecutionTrace from './components/ExecutionTrace.jsx';
import SandboxInspector from './components/SandboxInspector.jsx';
import DispatchModal from './components/DispatchModal.jsx';

function getOrCreateSessionId() {
  let sid = sessionStorage.getItem('harness_session_id');
  if (!sid) {
    sid = 'sess-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    sessionStorage.setItem('harness_session_id', sid);
  }
  return sid;
}

export default function App() {
  const sessionIdRef = useRef(getOrCreateSessionId());
  const eventSourceRef = useRef(null);

  const [metrics, setMetrics] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [activeTab, setActiveTab] = useState('terminal');
  const [busyAction, setBusyAction] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Live stream state for selected task
  const [traces, setTraces] = useState([]);
  const [terminalLines, setTerminalLines] = useState([]);
  const [diffText, setDiffText] = useState('');
  const [diffStats, setDiffStats] = useState(null);
  const [prPayload, setPrPayload] = useState(null);
  const [pipelineStage, setPipelineStage] = useState(null);
  const [isFailed, setIsFailed] = useState(false);

  const refreshMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/pool/metrics');
      if (res.ok) setMetrics(await res.json());
    } catch {
      // Ignore transient network poll errors
    }
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks?session_id=${encodeURIComponent(sessionIdRef.current)}`);
      if (!res.ok) return [];
      const list = await res.json();
      setTasks(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const connectStream = useCallback(
    (taskId) => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      setSelectedTaskId(taskId);
      setTraces([]);
      setTerminalLines([{ text: `[STREAM CONNECTED: ${taskId}]` }]);
      setDiffText('');
      setDiffStats(null);
      setPrPayload(null);
      setPipelineStage('ast');
      setIsFailed(false);

      const es = new EventSource(`/api/tasks/${encodeURIComponent(taskId)}/events`);
      eventSourceRef.current = es;

      es.onmessage = (e) => {
        const evt = JSON.parse(e.data);
        const timeStr = new Date((evt.timestamp || Date.now() / 1000) * 1000).toLocaleTimeString();

        if (evt.event_type === 'thought' || evt.event_type === 'tool_call' || evt.event_type === 'status') {
          setTraces((prev) => [...prev, evt]);

          const msg = evt.message || '';
          if (evt.event_type === 'tool_call' || msg.includes('Scanning repository AST')) {
            setPipelineStage('ast');
          } else if (msg.includes('baseline test')) {
            setPipelineStage('baseline');
          } else if (msg === 'ACTIVE_REPAIR' || msg.includes('Querying Groq') || msg.includes('Applied')) {
            setPipelineStage('patch');
          } else if (msg === 'RESOLVED') {
            setPipelineStage('pr');
            setIsFailed(false);
            loadTasks();
            refreshMetrics();
          } else if (msg === 'FAILED' || msg === 'ERROR') {
            setIsFailed(true);
            loadTasks();
            refreshMetrics();
          }
        }

        if (evt.event_type === 'terminal') {
          if (evt.data?.phase === 'baseline') setPipelineStage('baseline');
          if (evt.data?.phase === 'verify') setPipelineStage('patch');
          const lines = (evt.message || '').split('\n').map((line) => ({
            text: line,
            prefix: line.trim().startsWith('[PHASE ') ? timeStr : ''
          }));
          setTerminalLines((prev) => [...prev, ...lines]);
        }

        if (evt.event_type === 'diff' && evt.message) {
          setDiffText(evt.message);
        }

        if (evt.event_type === 'patch' && evt.data) {
          setPrPayload({
            title: evt.data.pr_title || 'Autonomous Fix PR',
            body: evt.data.pr_body || ''
          });
          setDiffStats({
            insertions: evt.data.insertions || 0,
            deletions: evt.data.deletions || 0
          });
          if (evt.data.unified_diff) {
            setDiffText(evt.data.unified_diff);
          }
        }
      };

      // Clean close when server sends explicit terminal sentinel (prevents browser EventSource errors)
      es.addEventListener('done', () => {
        es.close();
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
        loadTasks();
        refreshMetrics();
      });

      es.onerror = () => {
        es.close();
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
      };
    },
    [loadTasks, refreshMetrics]
  );

  useEffect(() => {
    loadTasks();
    refreshMetrics();
    const metricsTimer = setInterval(refreshMetrics, 2500);
    const tasksTimer = setInterval(loadTasks, 4000);
    return () => {
      clearInterval(metricsTimer);
      clearInterval(tasksTimer);
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, [loadTasks, refreshMetrics]);

  const handleRunBenchmark = async () => {
    setBusyAction('benchmark');
    try {
      const res = await fetch(
        `/api/benchmark/run-sample?session_id=${encodeURIComponent(sessionIdRef.current)}`,
        { method: 'POST' }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = await res.json();
      await loadTasks();
      setActiveTab('terminal');
      connectStream(created.task_id);
    } catch (err) {
      alert(`Failed to launch benchmark: ${err.message}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunSwarm = async () => {
    setBusyAction('swarm');
    try {
      const res = await fetch(
        `/api/benchmark/run-swarm?session_id=${encodeURIComponent(sessionIdRef.current)}`,
        { method: 'POST' }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const createdList = await res.json();
      await loadTasks();
      if (Array.isArray(createdList) && createdList.length > 0) {
        setActiveTab('terminal');
        connectStream(createdList[0].task_id);
      }
      refreshMetrics();
    } catch (err) {
      alert(`Failed to launch 3x swarm: ${err.message}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleCustomDispatch = async ({ task_description, repo_url }) => {
    const repoLabel = repo_url
      ? repo_url.replace(/\/+$/, '').split('/').slice(-1)[0] || 'remote_repo'
      : 'sample_repo';
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_description,
        repo_name: repoLabel,
        repo_url,
        max_iterations: 3,
        session_id: sessionIdRef.current
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const created = await res.json();
    await loadTasks();
    setActiveTab('terminal');
    connectStream(created.task_id);
  };

  const handleClearSession = async () => {
    await fetch(`/api/tasks?session_id=${encodeURIComponent(sessionIdRef.current)}`, {
      method: 'DELETE'
    });
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setSelectedTaskId(null);
    setTraces([]);
    setTerminalLines([]);
    setDiffText('');
    setDiffStats(null);
    setPrPayload(null);
    setPipelineStage(null);
    setIsFailed(false);
    await loadTasks();
  };

  return (
    <div className="app-shell">
      <Header
        metrics={metrics}
        busyAction={busyAction}
        onRunBenchmark={handleRunBenchmark}
        onRunSwarm={handleRunSwarm}
        onOpenDispatch={() => setModalOpen(true)}
      />

      <div className="dashboard-grid">
        <FleetSidebar
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={connectStream}
          onClearSession={handleClearSession}
        />

        <ExecutionTrace
          selectedTaskId={selectedTaskId}
          pipelineStage={pipelineStage}
          isFailed={isFailed}
          traces={traces}
          onJumpTab={setActiveTab}
        />

        <SandboxInspector
          activeTab={activeTab}
          onTabChange={setActiveTab}
          selectedTaskId={selectedTaskId}
          terminalLines={terminalLines}
          diffText={diffText}
          diffStats={diffStats}
          prPayload={prPayload}
        />
      </div>

      <DispatchModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleCustomDispatch}
      />
    </div>
  );
}
