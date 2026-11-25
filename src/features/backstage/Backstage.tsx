import { ArrowLeft, FileDown, FileJson, FilePlus2, FileSpreadsheet, FileText, FileType2, FolderOpen, HardDrive, House, Info, MoreHorizontal, Search, Trash2, Upload, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Field, TextInput } from '@/components/Field';
import { EmptyState } from '@/components/Feedback';
import { MenuList } from '@/components/Menu';
import { Popover } from '@/components/Popover';
import { renameWorkbook } from '@/state/actions';
import { gridApi } from '@/state/gridApi';
import { openStored } from '@/state/persistence';
import { storage, type WorkbookMeta } from '@/state/storage';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import { cx, plural, timeAgo } from '@/utils/cx';
import { Logo } from '../appBar/Logo';
import { ACCEPT, downloadCsv, downloadTessera, downloadXlsx, openFile, openFileDialog, saveCopy, startWorkbook } from '../io/fileActions';
import { TEMPLATES, type Template } from './templates';

type Page = 'home' | 'new' | 'open' | 'export' | 'info';

const NAV: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'new', label: 'New', icon: FilePlus2 },
  { id: 'open', label: 'Open', icon: FolderOpen },
  { id: 'export', label: 'Download', icon: FileDown },
  { id: 'info', label: 'Info', icon: Info },
];

/** Full-window file screen. */
export function Backstage() {
  const page = useUI((s) => s.backstage);
  const set = useUI((s) => s.set);
  const close = (): void => {
    set({ backstage: null });
    gridApi.focus();
  };

  useEffect(() => {
    if (!page) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[data-floating],[role=dialog][aria-modal=true]')) close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [page]);

  if (!page) return null;
  return (
    <div role="dialog" aria-label="File" className="fixed inset-0 z-50 flex animate-fade bg-panel">
      <nav className="flex w-[204px] shrink-0 flex-col gap-0.5 border-r border-line bg-frame p-3" aria-label="File">
        <button type="button" autoFocus onClick={close} className="mb-3 flex h-9 items-center gap-2 rounded-md px-2 text-sm text-ink-2 hover:bg-pressed/60 hover:text-ink">
          <ArrowLeft size={17} /> Back to sheet
        </button>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={page === id ? 'page' : undefined}
            onClick={() => set({ backstage: id })}
            className={cx('flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors', page === id ? 'bg-panel font-semibold text-accent shadow-card' : 'text-ink-2 hover:bg-pressed/60 hover:text-ink')}
          >
            <Icon size={16} strokeWidth={1.8} />
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <div className="flex items-center gap-2 px-2 pb-1 text-xs text-ink-3">
          <Logo size={18} /> Tessera
        </div>
      </nav>
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-[940px] px-8 py-9">
          {page === 'home' && (
            <>
              <TemplateGrid title="New" />
              <Recents title="Recent" limit={6} />
            </>
          )}
          {page === 'new' && <TemplateGrid title="New workbook" />}
          {page === 'open' && (
            <>
              <OpenPanel />
              <Recents title="Saved in this browser" />
            </>
          )}
          {page === 'export' && <ExportPage close={close} />}
          {page === 'info' && <InfoPage />}
        </div>
      </main>
    </div>
  );
}

/* --------------------------------------------------------------- templates */

function TemplateGrid({ title }: { title: string }) {
  return (
    <section className="mb-10">
      <h1 className="mb-4 text-xl font-semibold">{title}</h1>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(164px,1fr))] gap-4">
        {TEMPLATES.map((t) => (
          <button key={t.id} type="button" onClick={() => void startWorkbook(t.build(), t.cell)} className="group text-left">
            <span className="block overflow-hidden rounded-lg border border-line bg-white transition-shadow group-hover:shadow-pop group-focus-visible:shadow-pop dark:bg-[#f7f9fb]">
              <Thumbnail kind={t.preview} />
            </span>
            <span className="mt-2 block text-sm font-medium">{t.name}</span>
            <span className="block text-xs text-ink-3">{t.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Small drawing of what the template contains. */
function Thumbnail({ kind }: { kind: Template['preview'] }) {
  const grid = (
    <g stroke="#e4e8ee">
      {[18, 36, 54, 72, 90].map((y) => (
        <line key={y} x1="0" x2="164" y1={y} y2={y} />
      ))}
      {[33, 66, 99, 132].map((x) => (
        <line key={x} x1={x} x2={x} y1="0" y2="108" />
      ))}
    </g>
  );
  const bars = (x: number, y: number, hs: number[], color: string, w = 6, gap = 4) => hs.map((h, i) => <rect key={i} x={x + i * (w + gap)} y={y - h} width={w} height={h} rx="1.5" fill={color} />);
  const lines = (x: number, y: number, w: number, n: number, gap = 9) =>
    Array.from({ length: n }, (_, i) => (
      <g key={i}>
        <rect x={x} y={y + i * gap} width={w * 0.45} height="2.5" rx="1" fill="#b3bdcb" />
        <rect x={x + w * 0.7} y={y + i * gap} width={w * 0.3} height="2.5" rx="1" fill="#d3dae4" />
      </g>
    ));
  let art: ReactNode = (
    <>
      {grid}
      <rect x="33.5" y="18.5" width="33" height="18" fill="none" stroke="#2457d6" strokeWidth="2" />
    </>
  );
  if (kind === 'dashboard') {
    art = (
      <>
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x={10 + i * 49} y="10" width="45" height="22" fill="#eaf0fc" />
            <rect x={10 + i * 49} y="10" width="2.5" height="22" fill={['#2457d6', '#2457d6', '#ee7b3c'][i]} />
            <rect x={17 + i * 49} y="15" width="16" height="2.5" rx="1" fill="#a4adbb" />
            <rect x={17 + i * 49} y="21" width="24" height="5" rx="1" fill="#1d2f5c" />
          </g>
        ))}
        <rect x="10" y="40" width="64" height="7" fill="#1d2f5c" />
        {lines(13, 52, 58, 5)}
        <rect x="82" y="40" width="72" height="57" rx="3" fill="#fff" stroke="#dde2ea" />
        {bars(89, 91, [22, 18, 26, 34, 40, 36], '#2457d6')}
        <path d="M89 66 L99 70 L109 60 L119 52 L129 48 L139 52" fill="none" stroke="#12a594" strokeWidth="2" strokeLinejoin="round" />
      </>
    );
  } else if (kind === 'budget') {
    art = (
      <>
        <rect x="10" y="12" width="84" height="8" fill="#12a594" />
        {lines(14, 26, 76, 2)}
        <rect x="10" y="47" width="84" height="8" fill="#2457d6" />
        {lines(14, 61, 76, 4)}
        <g fill="none" strokeWidth="11">
          <circle cx="128" cy="54" r="19" stroke="#2457d6" />
          <circle cx="128" cy="54" r="19" stroke="#ee7b3c" strokeDasharray="38 120" />
          <circle cx="128" cy="54" r="19" stroke="#12a594" strokeDasharray="22 120" strokeDashoffset="-40" />
        </g>
      </>
    );
  } else if (kind === 'tracker') {
    art = (
      <>
        <rect x="10" y="12" width="144" height="9" fill="#2457d6" />
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i} transform={`translate(0 ${30 + i * 14})`}>
            <rect x="14" y="-4" width="8" height="8" rx="2" fill={i < 2 ? '#2457d6' : 'none'} stroke={i < 2 ? '#2457d6' : '#a4adbb'} />
            <rect x="28" y="-1.5" width={[52, 44, 58, 38, 50][i]} height="3" rx="1" fill="#b3bdcb" />
            <rect x="94" y="-4" width="26" height="8" rx="2" fill={['#dcf3e2', '#dcf3e2', '#e2ebfc', '#fbdcda', '#eef1f5'][i]} />
            <rect x="126" y="-3" width={[28, 28, 17, 8, 3][i]} height="6" rx="2" fill="#a9c0f3" />
          </g>
        ))}
      </>
    );
  } else if (kind === 'loan') {
    art = (
      <>
        {lines(12, 16, 54, 4)}
        <rect x="10" y="54" width="60" height="12" fill="#eaf0fc" />
        <rect x="42" y="58" width="24" height="4" rx="1" fill="#1d2f5c" />
        <rect x="80" y="12" width="74" height="84" rx="3" fill="#fff" stroke="#dde2ea" />
        <path d="M88 26 C108 30 128 48 146 88 L88 88 Z" fill="#2457d6" opacity=".16" />
        <path d="M88 26 C108 30 128 48 146 88" fill="none" stroke="#2457d6" strokeWidth="2" />
        <path d="M88 82 C110 80 130 72 146 56" fill="none" stroke="#ee7b3c" strokeWidth="2" />
      </>
    );
  }
  return (
    <svg viewBox="0 0 164 108" className="block w-full" aria-hidden="true">
      <rect width="164" height="108" fill="#ffffff" />
      {art}
    </svg>
  );
}

/* ------------------------------------------------------------------ recents */

function Recents({ title, limit }: { title: string; limit?: number }) {
  const [list, setList] = useState<WorkbookMeta[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const currentId = useWorkbook((s) => s.workbook.id);
  const savedAt = useWorkbook((s) => s.savedAt);

  useEffect(() => {
    let alive = true;
    storage
      .list()
      .then((l) => alive && setList(l))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [savedAt]);

  const remove = (meta: WorkbookMeta): void => {
    useUI.getState().set({
      dialog: {
        type: 'confirm',
        title: `Delete ${meta.name}?`,
        message: 'The workbook will be removed from this browser. This cannot be undone.',
        confirmLabel: 'Delete workbook',
        danger: true,
        onConfirm: () => void storage.remove(meta.id).then(() => setList((l) => l?.filter((x) => x.id !== meta.id) ?? null)),
      },
    });
  };

  const shown = (list ?? []).filter((m) => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, limit);
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {!limit && (list?.length ?? 0) > 5 && (
          <span className="relative w-56">
            <Search size={14} className="absolute left-2.5 top-[9px] text-ink-3" />
            <TextInput aria-label="Search workbooks" value={query} onChange={setQuery} placeholder="Search" className="pl-8" />
          </span>
        )}
      </div>
      {failed && <EmptyState icon={HardDrive} title="Browser storage is unavailable">Tessera cannot list saved workbooks here. You can still open and download files.</EmptyState>}
      {!failed && list === null && (
        <div className="space-y-2" role="status" aria-label="Loading workbooks">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-hover" />
          ))}
        </div>
      )}
      {list && shown.length === 0 && (
        <EmptyState icon={FileSpreadsheet} title={query ? 'No workbooks match' : 'No saved workbooks yet'}>
          {query ? 'Try a different name.' : 'Workbooks you create are saved here automatically.'}
        </EmptyState>
      )}
      {shown.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {shown.map((m) => (
            <li key={m.id} className="group flex items-center gap-3 bg-panel pr-2 hover:bg-hover">
              <button type="button" onClick={() => (m.id === currentId ? useUI.getState().set({ backstage: null }) : void openStored(m))} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3.5 text-left">
                <FileSpreadsheet size={19} strokeWidth={1.6} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.name}</span>
                  <span className="block text-xs text-ink-3">
                    {plural(m.sheetCount, 'sheet')}, {plural(m.cellCount, 'cell')}
                  </span>
                </span>
                {m.id === currentId && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">Open now</span>}
                <span className="w-24 shrink-0 text-right text-xs text-ink-3">{timeAgo(m.updated)}</span>
              </button>
              <Popover
                align="end"
                trigger={(p) => (
                  <button type="button" aria-label={`More actions for ${m.name}`} {...p} className="flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-pressed hover:text-ink">
                    <MoreHorizontal size={16} />
                  </button>
                )}
              >
                {(close) => (
                  <MenuList
                    onClose={close}
                    items={[
                      { label: 'Open', icon: FolderOpen, disabled: m.id === currentId, onSelect: () => void openStored(m) },
                      { label: 'Delete', icon: Trash2, danger: true, disabled: m.id === currentId, hint: m.id === currentId ? 'Open another workbook first' : undefined, onSelect: () => remove(m) },
                    ]}
                  />
                )}
              </Popover>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OpenPanel() {
  const [over, setOver] = useState(false);
  return (
    <section className="mb-10">
      <h1 className="mb-4 text-xl font-semibold">Open</h1>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void openFile(file);
        }}
        className={cx('flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-9 text-center transition-colors', over ? 'border-accent bg-accent-soft' : 'border-line-strong')}
      >
        <Upload size={24} strokeWidth={1.6} className="mb-2.5 text-accent" />
        <p className="font-medium">Drop a file here</p>
        <p className="mt-0.5 text-xs text-ink-3">Excel (.xlsx), CSV or a Tessera workbook. Files stay on this device.</p>
        <Button variant="primary" className="mt-4" onClick={() => openFileDialog('workbook')}>
          Choose file
        </Button>
        <span className="sr-only">{ACCEPT}</span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ export */

function ExportPage({ close }: { close: () => void }) {
  const items: { label: string; hint: string; icon: LucideIcon; run: () => void }[] = [
    { label: 'Excel workbook (.xlsx)', hint: 'All sheets with formulas, formatting and charts', icon: FileSpreadsheet, run: () => void downloadXlsx() },
    {
      label: 'PDF (.pdf)',
      hint: 'A printable copy of a sheet or the whole workbook',
      icon: FileType2,
      run: () => {
        close();
        useUI.getState().set({ dialog: { type: 'pdf' } });
      },
    },
    { label: 'CSV (.csv)', hint: 'Displayed values of the current sheet', icon: FileText, run: () => void downloadCsv() },
    { label: 'Tessera workbook (.tessera)', hint: 'An exact copy, for backup or another device', icon: FileJson, run: downloadTessera },
  ];
  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold">Download</h1>
      <ul className="max-w-[560px] space-y-2">
        {items.map(({ label, hint, icon: Icon, run }) => (
          <li key={label}>
            <button type="button" onClick={run} className="flex w-full items-center gap-4 rounded-lg border border-line px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-hover">
              <Icon size={22} strokeWidth={1.6} className="shrink-0 text-accent" />
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-ink-3">{hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InfoPage() {
  const wb = useWorkbook((s) => s.workbook);
  const savedAt = useWorkbook((s) => s.savedAt);
  const [name, setName] = useState(wb.name);
  const [copyName, setCopyName] = useState(`${wb.name} copy`);
  const formulas = wb.sheets.reduce((n, s) => n + [...s.cells.values()].filter((c) => c.f).length, 0);
  const cells = wb.sheets.reduce((n, s) => n + s.cells.size, 0);
  const charts = wb.sheets.reduce((n, s) => n + s.charts.length, 0);
  return (
    <section className="max-w-[560px]">
      <h1 className="mb-4 text-xl font-semibold">Info</h1>
      <form
        className="mb-6 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          renameWorkbook(name);
        }}
      >
        <Field label="Workbook name" className="flex-1">
          {(id) => <TextInput id={id} value={name} onChange={setName} />}
        </Field>
        <Button type="submit" disabled={!name.trim() || name.trim() === wb.name}>
          Rename
        </Button>
      </form>
      <form
        className="mb-8 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (copyName.trim()) void saveCopy(copyName.trim());
        }}
      >
        <Field label="Save a copy as" className="flex-1">
          {(id) => <TextInput id={id} value={copyName} onChange={setCopyName} />}
        </Field>
        <Button type="submit" disabled={!copyName.trim()}>
          Save copy
        </Button>
      </form>
      <dl className="grid grid-cols-[130px_1fr] gap-y-2 text-sm">
        {[
          ['Location', 'This browser'],
          ['Last saved', savedAt ? timeAgo(savedAt) : 'Not saved in this session'],
          ['Sheets', String(wb.sheets.length)],
          ['Cells', cells.toLocaleString('en-US')],
          ['Formulas', formulas.toLocaleString('en-US')],
          ['Charts', String(charts)],
        ].map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-3">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
