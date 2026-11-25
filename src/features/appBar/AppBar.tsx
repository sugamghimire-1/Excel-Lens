import { CircleAlert, CloudCheck, CloudUpload, Keyboard, LoaderCircle, Monitor, Moon, Redo2, Search, Settings, Share2, Sun, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, IconButton } from '@/components/Button';
import { MenuList } from '@/components/Menu';
import { Popover } from '@/components/Popover';
import { redo, renameWorkbook, undo } from '@/state/actions';
import { gridApi } from '@/state/gridApi';
import { saveNow } from '@/state/persistence';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import { cx, shortcut, timeAgo } from '@/utils/cx';
import { keepFocus } from '../ribbon/parts';
import { Logo } from './Logo';

export function AppBar() {
  const undoTop = useWorkbook((s) => s.undoStack[s.undoStack.length - 1]?.label);
  const redoTop = useWorkbook((s) => s.redoStack[s.redoStack.length - 1]?.label);
  const set = useUI((s) => s.set);
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-3">
      <button type="button" aria-label="Tessera, open file menu" data-tip="File menu" onClick={() => set({ backstage: 'home' })} className="flex h-9 items-center gap-2 rounded-md px-1.5 hover:bg-pressed/60">
        <Logo />
        <span className="hidden text-base font-semibold tracking-[-0.01em] lg:inline">Tessera</span>
      </button>
      <span className="mx-1 h-5 w-px bg-line-strong/60" />
      <WorkbookName />
      <SaveState />
      <div className="ml-1 flex items-center" {...keepFocus}>
        <IconButton label={undoTop ? `Undo ${undoTop.toLowerCase()}` : 'Undo'} keys="Ctrl+Z" disabled={!undoTop} onClick={undo}>
          <Undo2 size={17} />
        </IconButton>
        <IconButton label={redoTop ? `Redo ${redoTop.toLowerCase()}` : 'Redo'} keys="Ctrl+Y" disabled={!redoTop} onClick={redo}>
          <Redo2 size={17} />
        </IconButton>
      </div>
      <div className="flex min-w-0 flex-1 justify-center px-2">
        <button
          type="button"
          onClick={() => set({ palette: true })}
          className="hidden h-8 w-full max-w-[380px] items-center gap-2 rounded-md border border-line bg-panel/80 px-3 text-sm text-ink-3 transition-colors hover:border-line-strong hover:bg-panel md:flex"
        >
          <Search size={15} />
          <span className="flex-1 truncate text-left">Search commands, functions and sheets</span>
          <span className="kbd">{shortcut('Alt+Q')}</span>
        </button>
      </div>
      <Popover
        align="end"
        trigger={(p) => (
          <IconButton label="Preferences" {...p}>
            <Settings size={17} />
          </IconButton>
        )}
      >
        {(close) => (
          <MenuList
            onClose={close}
            items={[
              { heading: 'Appearance' },
              { label: 'Light', icon: Sun, checked: theme === 'light', onSelect: () => setTheme('light') },
              { label: 'Dark', icon: Moon, checked: theme === 'dark', onSelect: () => setTheme('dark') },
              { label: 'Match system', icon: Monitor, checked: theme === 'system', onSelect: () => setTheme('system') },
              'separator',
              { label: 'Keyboard shortcuts', icon: Keyboard, keys: 'F1', onSelect: () => set({ dialog: { type: 'shortcuts' } }) },
            ]}
          />
        )}
      </Popover>
      <Button variant="primary" icon={<Share2 size={15} />} onClick={() => set({ dialog: { type: 'share' } })}>
        Share
      </Button>
      <span role="img" aria-label="You, working locally" data-tip="You" data-tip-desc="Working locally. No account needed." className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1d2f5c] text-xs font-semibold text-white ring-2 ring-panel dark:bg-[#33508f]">
        Y
      </span>
    </header>
  );
}

function WorkbookName() {
  const name = useWorkbook((s) => s.workbook.name);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? name;
  const finish = (save: boolean): void => {
    if (save && draft !== null) renameWorkbook(draft);
    setDraft(null);
  };
  return (
    <span className="relative inline-grid max-w-[300px] shrink-0 items-center max-lg:max-w-[170px]">
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 overflow-hidden whitespace-pre px-2.5 text-sm font-semibold">
        {value || ' '}
      </span>
      <input
        aria-label="Workbook name"
        data-tip={draft === null ? 'Rename' : undefined}
        value={value}
        maxLength={80}
        spellCheck={false}
        onFocus={(e) => {
          setDraft(name);
          e.target.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            finish(true);
            gridApi.focus();
          } else if (e.key === 'Escape') {
            setDraft(null);
            gridApi.focus();
          }
        }}
        className="col-start-1 row-start-1 h-8 w-full min-w-0 truncate rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold outline-none transition-colors hover:border-line-strong focus:border-accent focus:bg-panel"
      />
    </span>
  );
}

function SaveState() {
  const state = useWorkbook((s) => s.saveState);
  const savedAt = useWorkbook((s) => s.savedAt);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const view = {
    saved: { icon: <CloudCheck size={16} />, text: 'Saved', tip: savedAt ? `Saved to this browser ${timeAgo(savedAt)}` : 'Saved to this browser', color: 'text-ink-3' },
    saving: { icon: <LoaderCircle size={15} className="animate-spin" />, text: 'Saving', tip: 'Saving to this browser', color: 'text-ink-3' },
    unsaved: { icon: <CloudUpload size={16} />, text: 'Unsaved', tip: 'Changes are saved automatically in a moment', color: 'text-ink-3' },
    error: { icon: <CircleAlert size={16} />, text: 'Not saved', tip: 'Saving failed. Click to try again.', color: 'text-bad' },
  }[state];
  return (
    <button type="button" {...keepFocus} onClick={() => void saveNow()} data-tip={view.tip} data-tip-keys="Ctrl+S" className={cx('flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors hover:bg-pressed/60', view.color)}>
      {view.icon}
      <span className="hidden w-[52px] text-left sm:inline" aria-live="polite">
        {view.text}
      </span>
    </button>
  );
}
