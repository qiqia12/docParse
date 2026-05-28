const API_BASE = '/api/v1';

export async function uploadDocument(file: File): Promise<{ task_id: string; status: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/documents`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

export async function getTask(id: string) {
  const res = await fetch(`${API_BASE}/documents/${id}`);
  if (!res.ok) throw new Error('Task not found');
  return res.json();
}

export function createParseStream(taskId: string): EventSource {
  return new EventSource(`${API_BASE}/documents/${taskId}/stream`);
}

export async function downloadMarkdown(taskId: string, filename: string) {
  const res = await fetch(`${API_BASE}/documents/${taskId}/download`);
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/\.[^.]+$/, '.md');
  a.click();
  URL.revokeObjectURL(url);
}
