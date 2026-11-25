import '@fontsource-variable/ibm-plex-sans/wght.css';
import '@fontsource-variable/ibm-plex-sans/wght-italic.css';
import './styles/index.css';
import '@/formulas';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from '@/components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

if (import.meta.env.DEV) {
  // Console handle for debugging in development builds.
  void Promise.all([import('@/state/workbookStore'), import('@/state/uiStore'), import('@/state/actions'), import('@/state/selection'), import('@/state/editing'), import('@/engine/address')]).then(([doc, ui, actions, selection, editing, address]) => {
    Object.assign(window, { excelLens: { doc: doc.useWorkbook, ui: ui.useUI, actions, selection, editing, address } });
  });
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Offline support is an enhancement; the app runs without it.
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
