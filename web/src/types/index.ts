export type TaskStatus = 'queued' | 'parsing' | 'completed' | 'failed';

export interface Task {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  status: TaskStatus;
  progress: { page: number; total: number };
  totalPages?: number;
  confidence: number;
  markdown: string;
  images: ImageMeta[];
  error?: string;
  createdAt: string;
  cached?: boolean;
}

export interface ImageMeta {
  index: number;
  imageId: string;
  altText: string;
  width: number;
  height: number;
}

export type AppAction =
  | { type: 'ADD_TASK'; task: Task }
  | { type: 'UPDATE_TASK'; id: string; updates: Partial<Task> }
  | { type: 'APPEND_MARKDOWN'; id: string; markdown: string }
  | { type: 'SET_CURRENT_TASK'; id: string }
  | { type: 'SET_PROGRESS'; id: string; progress: { page: number; total: number }; confidence: number };

export interface AppState {
  tasks: Task[];
  currentTaskId: string | null;
}
