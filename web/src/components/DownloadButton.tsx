import { useAppState } from '../context/AppContext';
import { downloadMarkdown } from '../hooks/useApi';

export default function DownloadButton() {
  const { state } = useAppState();
  const task = state.tasks.find(t => t.id === state.currentTaskId);
  if (!task || task.status !== 'completed' || !task.markdown) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(task.markdown);
    alert('Markdown 已复制到剪贴板');
  };

  return (
    <div style={{ padding: '8px 24px', display: 'flex', gap: 12, borderBottom: '1px solid #eee' }}>
      <button onClick={handleCopy} style={{
        padding: '6px 16px', border: '1px solid #4a90d9', borderRadius: 6,
        background: '#fff', color: '#4a90d9', cursor: 'pointer', fontSize: 14,
      }}>复制 Markdown</button>
      <button onClick={() => downloadMarkdown(task.id, task.filename)} style={{
        padding: '6px 16px', border: '1px solid #4a90d9', borderRadius: 6,
        background: '#fff', color: '#4a90d9', cursor: 'pointer', fontSize: 14,
      }}>下载 .md</button>
    </div>
  );
}
