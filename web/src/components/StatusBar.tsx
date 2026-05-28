import { useAppState } from '../context/AppContext';

export default function StatusBar() {
  const { state } = useAppState();
  const task = state.tasks.find(t => t.id === state.currentTaskId);
  if (!task) return null;

  const { status, progress, confidence } = task;

  if (status === 'completed') {
    const confColor = confidence >= 0.8 ? '#2e7d32' : confidence >= 0.6 ? '#e65100' : '#c62828';
    return (
      <div style={{ padding: '8px 24px', background: '#e8f5e9', fontSize: 14, display: 'flex', gap: 16, alignItems: 'center' }}>
        <span>解析完成</span>
        {confidence > 0 && (
          <span style={{ color: confColor }}>
            置信度: {(confidence * 100).toFixed(0)}%
            {confidence < 0.7 && ' (结果可能不准确，请人工核对)'}
          </span>
        )}
      </div>
    );
  }

  if (status === 'parsing') {
    const pct = progress.total > 0 ? Math.round((progress.page / progress.total) * 100) : 0;
    return (
      <div style={{ padding: '8px 24px', background: '#fff3e0', fontSize: 14 }}>
        <span>解析中: {progress.page}/{progress.total} 页 ({pct}%)</span>
        <div style={{ background: '#eee', borderRadius: 4, height: 4, marginTop: 6 }}>
          <div style={{ width: `${pct}%`, background: '#4a90d9', height: '100%', borderRadius: 4, transition: 'width 0.3s' }} />
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div style={{ padding: '8px 24px', background: '#ffebee', fontSize: 14, color: '#c62828' }}>
        解析失败: {task.error || '未知错误'}
      </div>
    );
  }

  if (status === 'queued') {
    return (
      <div style={{ padding: '8px 24px', background: '#e3f2fd', fontSize: 14 }}>
        排队中...
      </div>
    );
  }

  return null;
}
