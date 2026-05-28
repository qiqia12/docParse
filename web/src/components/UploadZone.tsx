import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useAppState } from '../context/AppContext';
import { uploadDocument } from '../hooks/useApi';
import { useParseStream } from '../hooks/useParseStream';
import ParseOptions from './ParseOptions';

export default function UploadZone() {
  const { dispatch } = useAppState();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);

  useParseStream(activeTaskId);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    const file = acceptedFiles[0];
    setUploading(true);
    setError(null);

    try {
      const result = await uploadDocument(file);
      const task = {
        id: result.task_id,
        filename: file.name,
        fileSize: file.size,
        mimeType: '',
        status: result.status as any,
        progress: { page: 0, total: 0 },
        confidence: 0,
        markdown: '',
        images: [],
        createdAt: new Date().toISOString(),
        cached: (result as any).cached,
      };
      dispatch({ type: 'ADD_TASK', task });
      setActiveTaskId(result.task_id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }, [dispatch]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxSize: 104857600,
    accept: {
      'text/plain': ['.txt'],
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
    },
  });

  return (
    <div>
      <div {...getRootProps()} style={{
        border: `2px dashed ${isDragActive ? '#4a90d9' : '#ccc'}`,
        borderRadius: 12, padding: '40px 24px', textAlign: 'center',
        background: isDragActive ? '#f0f7ff' : '#fff',
        cursor: 'pointer', transition: 'all 0.2s', margin: '24px',
      }}>
        <input {...getInputProps()} />
        {uploading ? (
          <p>正在上传...</p>
        ) : isDragActive ? (
          <p>放开以上传文件</p>
        ) : (
          <div>
            <p style={{ fontSize: 18, fontWeight: 600 }}>拖拽文件到此处，或点击选择</p>
            <p style={{ color: '#888', marginTop: 8 }}>支持 TXT / DOCX / PDF / PPTX，最大 100MB</p>
          </div>
        )}
      </div>

      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <button onClick={() => setShowOptions(!showOptions)} style={{
          border: 'none', background: 'none', color: '#4a90d9', cursor: 'pointer', fontSize: 14,
        }}>
          {showOptions ? '收起' : '展开'}解析选项 ▾
        </button>
      </div>
      {showOptions && <ParseOptions />}
      {error && <p style={{ color: 'red', textAlign: 'center' }}>{error}</p>}
    </div>
  );
}
