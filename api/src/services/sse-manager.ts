import { EventEmitter } from 'events';

interface SSEEvent {
  taskId: string;
  event: 'progress' | 'chunk' | 'complete' | 'error';
  data: Record<string, unknown>;
}

class SSEManager extends EventEmitter {
  private static instance: SSEManager;

  static getInstance(): SSEManager {
    if (!SSEManager.instance) {
      SSEManager.instance = new SSEManager();
    }
    return SSEManager.instance;
  }

  emitProgress(taskId: string, data: { page: number; total: number; confidence: number }) {
    this.emit('event', { taskId, event: 'progress', data } as SSEEvent);
  }

  emitChunk(taskId: string, data: { page: number; markdown: string }) {
    this.emit('event', { taskId, event: 'chunk', data } as SSEEvent);
  }

  emitComplete(taskId: string, data: { totalPages: number; overallConfidence: number }) {
    this.emit('event', { taskId, event: 'complete', data } as SSEEvent);
  }

  emitError(taskId: string, data: { code: string; message: string }) {
    this.emit('event', { taskId, event: 'error', data } as SSEEvent);
  }
}

export const sseManager = SSEManager.getInstance();
