import { useAppState } from '../context/AppContext';

export default function HistorySidebar() {
  const { state, dispatch } = useAppState();

  const statusIcon = (status: string) => {
    switch (status) { case 'completed': return '✓'; case 'parsing': return '⏳'; case 'failed': return '✗'; default: return '○'; }
  };

  const statusColor = (status: string) => {
    switch (status) { case 'completed': return '#2e7d32'; case 'parsing': return '#e65100'; case 'failed': return '#c62828'; default: return '#999'; }
  };

  return (
    <aside style={{ width: 280, borderRight: '1px solid #e0e0e0', overflow: 'auto', background: '#fff' }}>
      <h3 style={{ padding: '16px', borderBottom: '1px solid #eee', fontSize: 16 }}>上传历史</h3>
      {state.tasks.length === 0 ? (
        <p style={{ padding: 16, color: '#999', fontSize: 14 }}>暂无记录</p>
      ) : (
        state.tasks.map(task => (
          <div key={task.id} onClick={() => dispatch({ type: 'SET_CURRENT_TASK', id: task.id })}
            style={{
              padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0',
              background: state.currentTaskId === task.id ? '#f0f7ff' : undefined,
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                {task.filename}
              </span>
              <span style={{ color: statusColor(task.status), fontSize: 16 }}>{statusIcon(task.status)}</span>
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
              {new Date(task.createdAt).toLocaleString()}
            </div>
          </div>
        ))
      )}
    </aside>
  );
}
