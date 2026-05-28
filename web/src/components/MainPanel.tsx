import HistorySidebar from './HistorySidebar';
import PreviewPane from './PreviewPane';

export default function MainPanel() {
  return (
    <div style={{ display: 'flex', flex: 1 }}>
      <HistorySidebar />
      <PreviewPane />
    </div>
  );
}
