import { createContext, useContext, useReducer, ReactNode } from 'react';
import type { AppState, AppAction } from '../types';

const initialState: AppState = { tasks: [], currentTaskId: null };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_TASK':
      return { ...state, tasks: [action.task, ...state.tasks], currentTaskId: action.task.id };
    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map(t => t.id === action.id ? { ...t, ...action.updates } : t),
      };
    case 'APPEND_MARKDOWN':
      return {
        ...state,
        tasks: state.tasks.map(t =>
          t.id === action.id ? { ...t, markdown: t.markdown + action.markdown } : t
        ),
      };
    case 'SET_CURRENT_TASK':
      return { ...state, currentTaskId: action.id };
    case 'SET_PROGRESS':
      return {
        ...state,
        tasks: state.tasks.map(t =>
          t.id === action.id ? { ...t, progress: action.progress, confidence: action.confidence } : t
        ),
      };
    default:
      return state;
  }
}

const AppCtx = createContext<{ state: AppState; dispatch: React.Dispatch<AppAction> } | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <AppCtx.Provider value={{ state, dispatch }}>{children}</AppCtx.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}
