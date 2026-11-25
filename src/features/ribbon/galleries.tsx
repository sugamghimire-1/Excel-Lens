/** Visual pickers used by the ribbon and menus. */
import { ArrowDownRight, ArrowUpRight, BadgePercent, Ban, Blend, CalendarDays, ChartBarDecreasing, CopyX, Equal, Flag, Grid2x2, ListFilter, MoveRight, Percent, Sigma, TextSearch, TrendingDown, TrendingUp, TriangleAlert, Trash2 } from 'lucide-react';
import type { MenuEntry } from '@/components/Menu';
import type { BorderPreset } from '@/engine/commands/format';
import { tableAt } from '@/engine/commands/data';
import { cellStyles, TABLE_STYLE_IDS, tableStyle, themeById, THEMES } from '@/engine/themes';
import * as actions from '@/state/actions';
import { activeSelection, activeSheet } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import type { BorderEdge, CellStyle, ConditionalKind } from '@/types';
import { cx } from '@/utils/cx';

const edge = (b: BorderEdge | undefined): string | undefined => (b ? `${b.style === 'double' ? '3px double' : b.style === 'medium' ? '2px solid' : '1px solid'} ${b.color}` : undefined);

export function css(s: CellStyle): React.CSSProperties {
  return {
    backgroundColor: s.fill,
    color: s.color,
    fontWeight: s.bold ? 600 : undefined,
    fontStyle: s.italic ? 'italic' : undefined,
    fontSize: s.fontSize ? Math.min(16, s.fontSize * 1.1) : undefined,
    borderTop: edge(s.borderTop),
    borderBottom: edge(s.borderBottom),
    borderLeft: edge(s.borderLeft),
    borderRight: edge(s.borderRight),
  };
}

/* ------------------------------------------------------------- cell styles */

export function CellStyleGallery({ close }: { close: () => void }) {
  const theme = themeById(useWorkbook((s) => s.workbook.themeId));
  const styles = cellStyles(theme);
  const groups = [...new Set(styles.map((s) => s.group))];
  return (
    <div className="w-[420px] p-3">
      {groups.map((g) => (
        <div key={g} className="mb-3 last:mb-0">
          <div className="mb-1.5 text-xs font-medium text-ink-3">{g}</div>
          <div className="grid grid-cols-4 gap-1.5">
            {styles
              .filter((s) => s.group === g)
              .map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    close();
                    actions.applyNamedStyle(s.style);
                  }}
                  className="flex h-8 items-center overflow-hidden rounded border border-line bg-white px-2 text-left text-xs text-[#1b2333] transition-shadow hover:ring-2 hover:ring-accent"
                  style={css(s.style)}
                >
                  <span className="truncate">{s.name}</span>
                </button>
              ))}
          </div>
        </div>
      ))}
      <div className="mt-3 border-t border-line pt-2">
        <button
          type="button"
          className="rounded-md px-2 py-1 text-sm hover:bg-hover"
          onClick={() => {
            close();
            actions.clear('formats');
          }}
        >
          Clear formatting
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ table styles */

export function TableStyleGallery({ close }: { close: () => void }) {
  const theme = themeById(useWorkbook((s) => s.workbook.themeId));
  useWorkbook((s) => s.revision);
  const sel = activeSelection();
  const current = tableAt(activeSheet(), sel.active.r, sel.active.c);
  const kinds: [string, string][] = [
    ['solid', 'Solid header'],
    ['light', 'Light'],
    ['lined', 'Lined'],
    ['deep', 'Filled'],
  ];
  return (
    <div className="w-[392px] p-3">
      {kinds.map(([kind, label]) => (
        <div key={kind} className="mb-2.5">
          <div className="mb-1.5 text-xs font-medium text-ink-3">{label}</div>
          <div className="grid grid-cols-7 gap-1.5">
            {TABLE_STYLE_IDS.filter((id) => id.startsWith(kind)).map((id) => {
              const s = tableStyle(id, theme);
              return (
                <button
                  key={id}
                  type="button"
                  aria-label={`${label} table style ${id.split('-')[1]}`}
                  aria-pressed={current?.styleId === id}
                  onClick={() => {
                    close();
                    actions.makeTable(id);
                  }}
                  className={cx('overflow-hidden rounded border bg-white p-[3px] transition-shadow hover:ring-2 hover:ring-accent', current?.styleId === id ? 'border-accent ring-1 ring-accent' : 'border-line')}
                >
                  {[s.header, s.body, s.band, s.body, s.band].map((row, i) => (
                    <div key={i} className="flex h-[8px] items-center gap-[4px] px-[3px]" style={css({ ...row, bold: undefined })}>
                      {[0, 1, 2].map((k) => (
                        <span key={k} className="h-[1.5px] flex-1 rounded" style={{ backgroundColor: row.color ?? '#8a94a6', opacity: i === 0 ? 0.9 : 0.5 }} />
                      ))}
                    </div>
                  ))}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {current && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2.5 text-sm">
          {(
            [
              ['headerRow', 'Header row'],
              ['bandedRows', 'Banded rows'],
              ['firstColumn', 'First column'],
              ['totalRow', 'Total row'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" className="accent-[rgb(var(--accent))]" checked={current[key]} onChange={(e) => actions.updateTable(current.id, { [key]: e.target.checked })} />
              {label}
            </label>
          ))}
          <button
            type="button"
            className="ml-auto rounded-md px-2 py-1 text-sm text-ink-2 hover:bg-hover hover:text-ink"
            onClick={() => {
              close();
              actions.removeTable(current.id);
            }}
          >
            Convert to range
          </button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- themes */

export function ThemeGallery({ close }: { close: () => void }) {
  const themeId = useWorkbook((s) => s.workbook.themeId);
  return (
    <div className="w-[232px] p-1.5">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={t.id === themeId}
          onClick={() => {
            close();
            actions.setWorkbookTheme(t.id);
          }}
          className={cx('flex w-full items-center gap-3 rounded-md px-2 py-2 hover:bg-hover', t.id === themeId && 'bg-accent-soft')}
        >
          <span className="flex overflow-hidden rounded">
            {[t.ink, ...t.accents.slice(0, 6)].map((c) => (
              <span key={c} className="h-5 w-[13px]" style={{ backgroundColor: c }} />
            ))}
          </span>
          <span className="text-sm">{t.name}</span>
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- borders */

function BorderGlyph({ preset }: { preset: BorderPreset }) {
  const on = { stroke: 'currentColor', strokeWidth: 1.6 };
  const off = { stroke: 'currentColor', strokeWidth: 1, strokeDasharray: '1 1.6', opacity: 0.4 };
  const all = preset === 'all';
  const out = preset === 'outside' || preset === 'thickOutside';
  const thick = preset === 'thickOutside' || preset === 'thickBottom' ? { ...on, strokeWidth: 2.6 } : on;
  const line = (hit: boolean, x1: number, y1: number, x2: number, y2: number, heavy = false) => <line x1={x1} y1={y1} x2={x2} y2={y2} {...(hit ? (heavy ? thick : on) : off)} />;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {line(all || out || preset === 'top' || preset === 'topBottom', 2, 2, 14, 2, out)}
      {line(all || out || ['bottom', 'topBottom', 'doubleBottom', 'thickBottom'].includes(preset), 2, 14, 14, 14, out || preset === 'thickBottom')}
      {preset === 'doubleBottom' && line(true, 2, 11.4, 14, 11.4)}
      {line(all || out || preset === 'left', 2, 2, 2, 14, out)}
      {line(all || out || preset === 'right', 14, 2, 14, 14, out)}
      {line(all || preset === 'inside', 8, 2, 8, 14)}
      {line(all || preset === 'inside', 2, 8, 14, 8)}
    </svg>
  );
}

const BORDER_ITEMS: [BorderPreset, string][] = [
  ['bottom', 'Bottom border'],
  ['top', 'Top border'],
  ['left', 'Left border'],
  ['right', 'Right border'],
  ['none', 'No border'],
  ['all', 'All borders'],
  ['outside', 'Outside borders'],
  ['inside', 'Inside borders'],
  ['thickOutside', 'Thick outside borders'],
  ['topBottom', 'Top and bottom borders'],
  ['doubleBottom', 'Double bottom border'],
  ['thickBottom', 'Thick bottom border'],
];

export function borderMenu(): MenuEntry[] {
  return [
    ...BORDER_ITEMS.map(([preset, label]): MenuEntry => ({ label, lead: <BorderGlyph preset={preset} />, onSelect: () => actions.borders(preset) })),
    'separator',
    { label: 'More borders', icon: Grid2x2, onSelect: () => useUI.getState().set({ dialog: { type: 'format', tab: 'border' } }) },
  ];
}

/* -------------------------------------------------- conditional formatting */

const addKind = (kind: ConditionalKind): void => actions.addConditional({ kind });
const openRule = (preset: string): void => useUI.getState().set({ dialog: { type: 'conditional', preset } });

const SCALES: [string, string[]][] = [
  ['Green, yellow, red', ['#f4a6a0', '#fbe7a1', '#9bd4a8']],
  ['Red, yellow, green', ['#9bd4a8', '#fbe7a1', '#f4a6a0']],
  ['White to blue', ['#ffffff', '#7fa5ee']],
  ['White to green', ['#ffffff', '#86cf9a']],
  ['White to red', ['#ffffff', '#f09a93']],
  ['Yellow to teal', ['#fdf3c7', '#3fb2a4']],
];

export function conditionalMenu(): MenuEntry[] {
  const theme = themeById(useWorkbook.getState().workbook.themeId);
  return [
    {
      label: 'Highlight cells',
      icon: ListFilter,
      submenu: [
        { label: 'Greater than', icon: TrendingUp, onSelect: () => openRule('gt') },
        { label: 'Less than', icon: TrendingDown, onSelect: () => openRule('lt') },
        { label: 'Between', icon: MoveRight, onSelect: () => openRule('between') },
        { label: 'Equal to', icon: Equal, onSelect: () => openRule('eq') },
        { label: 'Text that contains', icon: TextSearch, onSelect: () => openRule('contains') },
        { label: 'Duplicate values', icon: CopyX, onSelect: () => openRule('duplicate') },
        { label: 'Blank cells', icon: CalendarDays, onSelect: () => openRule('blank') },
        { label: 'Errors', icon: TriangleAlert, onSelect: () => openRule('error') },
      ],
    },
    {
      label: 'Top and bottom',
      icon: BadgePercent,
      submenu: [
        { label: 'Top 10 items', icon: ArrowUpRight, onSelect: () => openRule('top') },
        { label: 'Top 10%', icon: Percent, onSelect: () => openRule('topPct') },
        { label: 'Bottom 10 items', icon: ArrowDownRight, onSelect: () => openRule('bottom') },
        { label: 'Bottom 10%', icon: Percent, onSelect: () => openRule('bottomPct') },
        { label: 'Above average', icon: TrendingUp, onSelect: () => openRule('above') },
        { label: 'Below average', icon: TrendingDown, onSelect: () => openRule('below') },
      ],
    },
    'separator',
    {
      label: 'Data bars',
      icon: ChartBarDecreasing,
      submenu: theme.accents.slice(0, 6).map((c, i) => ({ label: `Accent ${i + 1}`, lead: <span className="h-3 w-4 rounded-sm" style={{ backgroundColor: c }} />, onSelect: () => addKind({ type: 'bar', color: c }) })),
    },
    {
      label: 'Color scales',
      icon: Blend,
      submenu: SCALES.map(([label, colors]) => ({
        label,
        lead: <span className="h-3 w-5 rounded-sm ring-1 ring-inset ring-black/10" style={{ background: `linear-gradient(90deg, ${colors.join(',')})` }} />,
        onSelect: () => addKind({ type: 'scale', colors }),
      })),
    },
    {
      label: 'Icon sets',
      icon: Flag,
      submenu: [
        { label: 'Arrows', icon: ArrowUpRight, onSelect: () => addKind({ type: 'icons', set: 'arrows' }) },
        { label: 'Traffic lights', lead: <span className="h-3 w-3 rounded-full bg-good" />, onSelect: () => addKind({ type: 'icons', set: 'lights' }) },
        { label: 'Flags', icon: Flag, onSelect: () => addKind({ type: 'icons', set: 'flags' }) },
      ],
    },
    'separator',
    { label: 'New rule', icon: Sigma, onSelect: () => openRule('formula') },
    {
      label: 'Clear rules',
      icon: Trash2,
      submenu: [
        { label: 'From selected cells', onSelect: clearSelectedRules },
        { label: 'From the whole sheet', onSelect: () => actions.setConditional([], 'Clear rules') },
      ],
    },
    { label: 'Manage rules', icon: Ban, onSelect: () => useUI.getState().set({ panel: { type: 'conditional' } }) },
  ];
}

function clearSelectedRules(): void {
  const sheet = activeSheet();
  const { ranges } = activeSelection();
  const hit = (r: (typeof ranges)[number]): boolean => ranges.some((s) => s.r1 <= r.r2 && s.r2 >= r.r1 && s.c1 <= r.c2 && s.c2 >= r.c1);
  actions.setConditional(
    sheet.conditional.flatMap((rule) => {
      const kept = rule.ranges.filter((r) => !hit(r));
      return kept.length ? [{ ...rule, ranges: kept }] : [];
    }),
    'Clear rules',
  );
}
