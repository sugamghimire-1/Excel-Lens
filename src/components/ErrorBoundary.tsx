import { Component, type ErrorInfo, type ReactNode } from 'react';
import { serializeWorkbook } from '@/engine/serialize';
import { useWorkbook } from '@/state/workbookStore';
import { APP_NAME, FILE_EXT } from '@/utils/brand';
import { download, safeFileName } from '@/utils/cx';
import { Button } from './Button';

interface State {
  error: Error | null;
}

/** Last-resort screen that lets people rescue their data. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="flex h-full items-center justify-center bg-frame p-6">
        <div className="w-[460px] rounded-xl bg-raised p-6 shadow-pop">
          <h1 className="text-lg font-semibold">{APP_NAME} stopped working</h1>
          <p className="mt-2 text-ink-2">Your last saved version is still in this browser. Download a copy of the current workbook, then reload the page.</p>
          <pre className="mt-3 max-h-28 overflow-auto rounded-md bg-hover p-2.5 text-xs text-ink-2">{error.message}</pre>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={() => location.reload()}>
              Reload
            </Button>
            <Button
              onClick={() => {
                const { workbook } = useWorkbook.getState();
                download(JSON.stringify(serializeWorkbook(workbook)), `${safeFileName(workbook.name)}.${FILE_EXT}`, 'application/json');
              }}
            >
              Download a copy
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
