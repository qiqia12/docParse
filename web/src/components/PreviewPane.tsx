import { useAppState } from '../context/AppContext';
import StatusBar from './StatusBar';
import MarkdownRenderer from './MarkdownRenderer';
import DownloadButton from './DownloadButton';
import ImageViewer from './ImageViewer';

export default function PreviewPane() {
  const { state } = useAppState();
  const task = state.tasks.find(t => t.id === state.currentTaskId);

  if (!task) {
    return <main style={{ flex: 1, padding: 48, textAlign: 'center', color: '#999' }}>上传一个文件开始解析</main>;
  }

  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <StatusBar />
      {task.images && task.images.length > 0 && <ImageViewer images={task.images} />}
      <DownloadButton />
      <div style={{ flex: 1, overflow: 'auto' }}>
        <MarkdownRenderer content={task.markdown} />
      </div>
    </main>
  );
}
