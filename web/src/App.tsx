import Header from './components/Header';
import UploadZone from './components/UploadZone';
import MainPanel from './components/MainPanel';

export default function App() {
  return (
    <div className="app">
      <Header />
      <UploadZone />
      <MainPanel />
    </div>
  );
}
