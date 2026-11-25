/** Right-hand panels: chart settings, formatting rules, notes and history. */
import { ArrowDown, ArrowUp, ChartArea, ChartBar, ChartColumn, ChartLine, ChartPie, ChartScatter, CircleDot, History, MessageSquareText, PencilLine, Plus, RotateCcw, Trash2, WandSparkles, X, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, IconButton } from '@/components/Button';
import { EmptyState } from '@/components/Feedback';
import { Checkbox, Field, RangeInput, Section, Select, TextInput } from '@/components/Field';
import { cellName, keyCol, keyRow, parseRangeName, prettyRangeName, quoteSheet, splitSheetRef } from '@/engine/address';
import { readChartData } from '@/engine/chartData';
import { describeRule } from '@/engine/conditional';
import { themeById } from '@/engine/themes';
import * as actions from '@/state/actions';
import { gridApi } from '@/state/gridApi';
import { selectCell } from '@/state/selection';
import { useActiveSheet } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import type { ChartModel, ChartType } from '@/types';
import { cx, plural, timeAgo } from '@/utils/cx';
import { seriesColors } from '../charts/chartOptions';
import { ColorButton } from '../dialogs/RuleDialogs';

export function Panels() {
  const panel = useUI((s) => s.panel);
  if (!panel) return null;
  switch (panel.type) {
    case 'chart':
      return <ChartPanel chartId={panel.chartId} />;
    case 'conditional':
      return <RulesPanel />;
    case 'notes':
      return <NotesPanel />;
    case 'history':
      return <HistoryPanel />;
  }
}

function Frame({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <aside aria-label={title} className="flex w-[292px] shrink-0 animate-slide flex-col border-l border-line bg-panel max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:shadow-pop">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line pl-4 pr-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <IconButton
          label="Close panel"
          onClick={() => {
            useUI.getState().set({ panel: null });
            gridApi.focus();
          }}
        >
          <X size={16} />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      {footer && <footer className="border-t border-line p-3">{footer}</footer>}
    </aside>
  );
}

/* ------------------------------------------------------------------- chart */

const TYPES: [ChartType, string, LucideIcon][] = [
  ['column', 'Column', ChartColumn],
  ['bar', 'Bar', ChartBar],
  ['line', 'Line', ChartLine],
  ['area', 'Area', ChartArea],
  ['pie', 'Pie', ChartPie],
  ['doughnut', 'Doughnut', CircleDot],
  ['scatter', 'Scatter', ChartScatter],
];

/** Text field that applies on Enter or blur, so typing makes one history entry. */
function Draft({ id, value, onCommit, placeholder }: { id?: string; value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <TextInput
      id={id}
      value={text}
      onChange={setText}
      placeholder={placeholder}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(text);
        if (e.key === 'Escape') setText(value);
      }}
    />
  );
}

function ChartPanel({ chartId }: { chartId: string }) {
  const sheet = useActiveSheet();
  const chart = sheet.charts.find((c) => c.id === chartId);
  const workbook = useWorkbook((s) => s.workbook);
  const engine = useWorkbook((s) => s.engine);
  const revision = useWorkbook((s) => s.revision);
  const [rangeText, setRangeText] = useState(chart?.range ?? '');
  useEffect(() => setRangeText(chart?.range ?? ''), [chart?.range]);
  const data = useMemo(() => {
    void revision;
    return chart ? readChartData(workbook, engine, sheet, chart) : null;
  }, [workbook, engine, sheet, chart, revision]);

  if (!chart || !data) {
    return (
      <Frame title="Chart">
        <EmptyState icon={ChartColumn} title="Select a chart">
          Click a chart on this sheet to change how it looks.
        </EmptyState>
      </Frame>
    );
  }
  const set = (patch: Partial<ChartModel>): void => actions.updateChart(chart.id, patch);
  const theme = themeById(workbook.themeId);
  const pie = chart.type === 'pie' || chart.type === 'doughnut';
  const items = pie ? data.categories.slice(0, 12) : data.series.map((s) => s.name).slice(0, 12);
  const colors = seriesColors(chart, theme, false, items.length);
  const ref = splitSheetRef(rangeText);
  const rangeOk = parseRangeName(ref.local) !== null && (ref.sheet === null || workbook.sheets.some((s) => s.name.toLowerCase() === ref.sheet!.toLowerCase()));
  const commitRange = (t: string): void => {
    const r = splitSheetRef(t);
    if (parseRangeName(r.local) && (r.sheet === null || workbook.sheets.some((s) => s.name.toLowerCase() === r.sheet!.toLowerCase()))) set({ range: r.sheet === null ? `${quoteSheet(sheet.name)}!${r.local}` : t, colors: chart.colors });
  };

  return (
    <Frame
      title="Chart"
      footer={
        <Button className="w-full" icon={<Trash2 size={15} />} onClick={() => actions.deleteChart(chart.id)}>
          Delete chart
        </Button>
      }
    >
      <div className="space-y-5 p-4">
        <Section title="Type">
          <div className="grid grid-cols-4 gap-1.5">
            {TYPES.map(([type, label, Icon]) => (
              <button key={type} type="button" aria-pressed={chart.type === type} onClick={() => set({ type })} className={cx('flex h-[52px] flex-col items-center justify-center gap-1 rounded-md border text-2xs', chart.type === type ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line text-ink-2 hover:border-line-strong hover:text-ink')}>
                <Icon size={18} strokeWidth={1.7} />
                {label}
              </button>
            ))}
          </div>
          {!pie && chart.type !== 'scatter' && (
            <div className="mt-2">
              {chart.type === 'line' || chart.type === 'area' ? <Checkbox label="Smooth lines" checked={chart.smooth} onChange={(smooth) => set({ smooth })} /> : null}
              <Checkbox label="Stacked" checked={chart.stacked} onChange={(stacked) => set({ stacked })} />
            </div>
          )}
        </Section>
        <Section title="Data">
          <Field label="Range" error={rangeOk ? null : 'Enter a range such as Sheet1!A1:C10.'}>
            {(id) => (
              <span
                className="block"
                onBlur={() => rangeText !== chart.range && commitRange(rangeText)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRange(rangeText);
                }}
              >
                <RangeInput id={id} value={rangeText} onChange={setRangeText} invalid={!rangeOk} withSheet sheetName={quoteSheet(sheet.name)} />
              </span>
            )}
          </Field>
          <div className="mt-2.5">
            <Field label="Series in">{(id) => <Select id={id} value={chart.seriesInRows ? 'r' : 'c'} onChange={(v) => set({ seriesInRows: v === 'r' })} options={[{ value: 'c', label: 'Columns' }, { value: 'r', label: 'Rows' }]} />}</Field>
          </div>
          <div className="mt-2">
            <Checkbox label="First row has labels" checked={chart.firstRowHeaders} onChange={(firstRowHeaders) => set({ firstRowHeaders })} />
            <Checkbox label="First column has labels" checked={chart.firstColLabels} onChange={(firstColLabels) => set({ firstColLabels })} />
          </div>
          {data.error && <p className="mt-1.5 text-xs text-bad">{data.error}</p>}
        </Section>
        <Section title="Labels">
          <div className="space-y-2.5">
            <Field label="Title">{(id) => <Draft id={id} value={chart.title} onCommit={(title) => set({ title })} placeholder="No title" />}</Field>
            {!pie && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Horizontal axis">{(id) => <Draft id={id} value={chart.xTitle} onCommit={(xTitle) => set({ xTitle })} />}</Field>
                <Field label="Vertical axis">{(id) => <Draft id={id} value={chart.yTitle} onCommit={(yTitle) => set({ yTitle })} />}</Field>
              </div>
            )}
            <div>
              <Checkbox label={pie ? 'Show percentages' : 'Show values'} checked={chart.showLabels} onChange={(showLabels) => set({ showLabels })} />
              {!pie && <Checkbox label="Gridlines" checked={chart.showGridlines} onChange={(showGridlines) => set({ showGridlines })} />}
              <Checkbox label="Legend" checked={chart.showLegend} onChange={(showLegend) => set({ showLegend })} hint={!pie && data.series.length === 1 ? 'Shown when there is more than one series' : undefined} />
            </div>
            {chart.showLegend && (
              <Field label="Legend position">
                {(id) => (
                  <Select
                    id={id}
                    value={chart.legendPosition}
                    onChange={(v) => set({ legendPosition: v as ChartModel['legendPosition'] })}
                    options={[
                      { value: 'top', label: 'Top' },
                      { value: 'bottom', label: 'Bottom' },
                      { value: 'left', label: 'Left' },
                      { value: 'right', label: 'Right' },
                    ]}
                  />
                )}
              </Field>
            )}
          </div>
        </Section>
        <Section title="Colors">
          <div className="space-y-1.5">
            {items.map((name, i) => (
              <div key={`${name}-${i}`} className="flex items-center justify-between gap-3">
                <span className="truncate">{name}</span>
                <ColorButton
                  label="Change"
                  value={colors[i]}
                  none="Theme color"
                  onChange={(c) => {
                    const next = colors.slice();
                    next[i] = c ?? theme.accents[i % theme.accents.length];
                    set({ colors: next });
                  }}
                />
              </div>
            ))}
          </div>
          {chart.colors.length > 0 && (
            <Button variant="ghost" className="mt-2" icon={<RotateCcw size={14} />} onClick={() => set({ colors: [] })}>
              Use theme colors
            </Button>
          )}
        </Section>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------- rules */

function RulesPanel() {
  const sheet = useActiveSheet();
  const rules = sheet.conditional;
  const move = (i: number, d: number): void => {
    const next = [...rules];
    const [r] = next.splice(i, 1);
    next.splice(i + d, 0, r);
    actions.setConditional(next, 'Reorder rules');
  };
  return (
    <Frame
      title="Formatting rules"
      footer={
        <Button className="w-full" variant="primary" icon={<Plus size={15} />} onClick={() => useUI.getState().set({ dialog: { type: 'conditional', preset: 'gt' } })}>
          New rule
        </Button>
      }
    >
      {rules.length === 0 ? (
        <EmptyState icon={WandSparkles} title="No rules on this sheet">
          Rules highlight cells based on their values.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {rules.map((r, i) => {
            const editable = r.kind.type !== 'scale' && r.kind.type !== 'bar' && r.kind.type !== 'icons';
            return (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex h-7 w-12 shrink-0 items-center justify-center rounded border border-line bg-white text-xs text-[#1b2333]"
                    style={
                      r.kind.type === 'scale'
                        ? { background: `linear-gradient(90deg, ${r.kind.colors.join(',')})` }
                        : r.kind.type === 'bar'
                          ? { background: `linear-gradient(90deg, ${r.kind.color}66 70%, #fff 70%)` }
                          : { backgroundColor: r.style?.fill, color: r.style?.color, fontWeight: r.style?.bold ? 600 : 400, textDecoration: r.style?.strike ? 'line-through' : undefined }
                    }
                  >
                    {editable ? '123' : ''}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{describeRule(r)}</span>
                    <span className="block truncate text-xs text-ink-3">{r.ranges.map(prettyRangeName).join(', ')}</span>
                  </span>
                </div>
                <div className="mt-1.5 flex justify-end">
                  <IconButton size="sm" label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={14} />
                  </IconButton>
                  <IconButton size="sm" label="Move down" disabled={i === rules.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown size={14} />
                  </IconButton>
                  {editable && (
                    <IconButton size="sm" label="Edit rule" onClick={() => useUI.getState().set({ dialog: { type: 'conditional', ruleId: r.id } })}>
                      <PencilLine size={14} />
                    </IconButton>
                  )}
                  <IconButton size="sm" label="Delete rule" onClick={() => actions.setConditional(rules.filter((x) => x.id !== r.id), 'Delete rule')}>
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Frame>
  );
}

/* ------------------------------------------------------------------- notes */

function NotesPanel() {
  const sheet = useActiveSheet();
  const notes = useMemo(() => [...sheet.cells].filter(([, c]) => c.note).sort((a, b) => a[0] - b[0]), [sheet]);
  return (
    <Frame
      title={`Notes on ${sheet.name}`}
      footer={
        <Button className="w-full" variant="primary" icon={<Plus size={15} />} onClick={actions.editNote}>
          New note
        </Button>
      }
    >
      {notes.length === 0 ? (
        <EmptyState icon={MessageSquareText} title="No notes yet">
          Select a cell and add a note to explain a number or leave a reminder.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {notes.map(([k, c]) => (
            <li key={k}>
              <button
                type="button"
                className="block w-full px-4 py-3 text-left hover:bg-hover"
                onClick={() => {
                  selectCell(keyRow(k), keyCol(k));
                  gridApi.focus();
                }}
              >
                <span className="mb-1 flex items-center justify-between text-xs">
                  <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">{cellName(keyRow(k), keyCol(k))}</span>
                  <span className="text-ink-3">
                    {c.note!.author}, {timeAgo(c.note!.updated)}
                  </span>
                </span>
                <span className="block whitespace-pre-wrap break-words text-sm">{c.note!.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

/* ----------------------------------------------------------------- history */

function HistoryPanel() {
  const undoStack = useWorkbook((s) => s.undoStack);
  const redoStack = useWorkbook((s) => s.redoStack);
  const sheets = useWorkbook((s) => s.workbook.sheets);
  const entries = [...undoStack.map((tx) => ({ tx, done: true })), ...[...redoStack].reverse().map((tx) => ({ tx, done: false }))].reverse();
  const jump = (target: string, done: boolean): void => {
    // Step one change at a time so selection and panels stay in sync.
    if (done) while (useWorkbook.getState().undoStack.length && useWorkbook.getState().undoStack[useWorkbook.getState().undoStack.length - 1].id !== target) actions.undo();
    else while (useWorkbook.getState().redoStack.length) {
      const next = useWorkbook.getState().redoStack[useWorkbook.getState().redoStack.length - 1].id;
      actions.redo();
      if (next === target) break;
    }
  };
  return (
    <Frame title="History">
      {entries.length === 0 ? (
        <EmptyState icon={History} title="No changes yet">
          Changes in this session appear here. Choose one to go back to it.
        </EmptyState>
      ) : (
        <>
          <p className="px-4 pb-1 pt-3 text-xs text-ink-3">{plural(undoStack.length, 'change')} this session. Choose one to return to that point.</p>
          <ul className="p-2">
            {entries.map(({ tx, done }) => {
              const current = done && tx === undoStack[undoStack.length - 1];
              return (
                <li key={tx.id}>
                  <button type="button" aria-current={current || undefined} onClick={() => jump(tx.id, done)} className={cx('flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left hover:bg-hover', current && 'bg-accent-soft', !done && 'opacity-50')}>
                    <span className={cx('h-2 w-2 shrink-0 rounded-full', current ? 'bg-accent' : 'bg-line-strong')} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{tx.label}</span>
                      <span className="block truncate text-xs text-ink-3">{sheets.find((s) => s.id === tx.sheetId)?.name ?? 'Workbook'}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-3">{timeAgo(tx.at)}</span>
                  </button>
                </li>
              );
            })}
            {undoStack.length > 0 && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    while (useWorkbook.getState().undoStack.length) actions.undo();
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-ink-2 hover:bg-hover"
                >
                  <RotateCcw size={13} /> Opened
                </button>
              </li>
            )}
          </ul>
        </>
      )}
    </Frame>
  );
}
