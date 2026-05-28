import { useEffect, useRef } from 'react';
import { useAppState } from '../context/AppContext';
import { createParseStream } from './useApi';

export function useParseStream(taskId: string | null) {
  const { dispatch } = useAppState();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!taskId) return;

    const es = createParseStream(taskId);
    esRef.current = es;

    es.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      dispatch({
        type: 'SET_PROGRESS', id: taskId,
        progress: { page: data.page, total: data.total },
        confidence: data.confidence,
      });
      dispatch({ type: 'UPDATE_TASK', id: taskId, updates: { status: 'parsing' } });
    });

    es.addEventListener('chunk', (e) => {
      const data = JSON.parse(e.data);
      dispatch({ type: 'APPEND_MARKDOWN', id: taskId, markdown: data.markdown });
    });

    es.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data);
      if (data.cached) {
        dispatch({ type: 'UPDATE_TASK', id: taskId, updates: { status: 'completed', markdown: data.markdown } });
      } else {
        dispatch({
          type: 'UPDATE_TASK', id: taskId,
          updates: { status: 'completed', confidence: data.overallConfidence, totalPages: data.totalPages },
        });
      }
      es.close();
    });

    es.addEventListener('error', () => {
      dispatch({ type: 'UPDATE_TASK', id: taskId, updates: { status: 'failed', error: 'Connection lost' } });
      es.close();
    });

    return () => { es.close(); };
  }, [taskId]);

  return esRef;
}
