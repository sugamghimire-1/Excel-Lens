import { Minus, Plus } from 'lucide-react';
import { useDeferredValue, useMemo } from 'react';
import { rangeSize } from '@/engine/address';
import { formatValue, isDateFormat } from '@/engine/numberFormat';
import { baseStyle, clipToContent } from '@/engine/sheet';
import { MenuList } from '@/components/Menu';
import { Popover } from '@/components/Popover';
import { setZoom, zoomToSelection } from '@/state/actions';
import { useActiveSheet, useSelection } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import { plural } from '@/utils/cx';

interface Stats {
  sum: number;
  average: number;
  min: number;
  max: number;
  numbers: number;
  filled: number;
  fmt: string | undefined;
}

const LIMIT = 2_000_000;

function useStats(): Stats | null {
  const sheet = useActiveSheet();
  const { ranges } = useSelection();
  const revision = useWorkbook((s) => s.revision);
  const engine = useWorkbook((s) => s.engine);
  const deferred = useDeferredValue(ranges);
  return useMemo(() => {
    void revision;
    const total = deferred.reduce((n, r) => n + rangeSize(r).cells, 0);
    if (total < 2) return null;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    let numbers = 0;
    let filled = 0;
    let fmt: string | undefined;
    let mixed = false;
    let visited = 0;
    for (const full of deferred) {
      const r = clipToContent(sheet, full);
      if (!r) continue;
      for (let i = r.r1; i <= r.r2; i++) {
        if (sheet.filterHidden.has(i)) continue;
        for (let j = r.c1; j <= r.c2; j++) {
          if (++visited > LIMIT) break;
          const v = engine.readCell(sheet.id, i, j);
          if (v === null || v === '') continue;
          filled++;
          if (typeof v !== 'number') continue;
          numbers++;
          sum += v;
          if (v < min) min = v;
          if (v > max) max = v;
          const own = baseStyle(sheet, i, j)?.numFmt;
          if (numbers === 1) fmt = own;
          else if (own !== fmt) mixed = true;
        }
      }
    }
    if (!filled) return null;
    // A shared format is kept; dates only make sense for the extremes.
    return { sum, average: sum / numbers, min, max, numbers, filled, fmt: mixed ? undefined : fmt };
  }, [sheet, deferred, revision, engine]);
}

export function StatusBar() {
  const stats = useStats();
  const sheet = useActiveSheet();
  const edit = useUI((s) => s.edit);
  const painter = useUI((s) => s.painter);
  const marquee = useUI((s) => s.marquee);
  const engine = useWorkbook((s) => s.engine);
  const revision = useWorkbook((s) => s.revision);
  void revision;

  let mode = 'Ready';
  if (edit) mode = edit.point ? 'Point' : edit.mode === 'enter' ? 'Enter' : 'Edit';
  else if (painter) mode = 'Select cells to apply the copied format';
  else if (marquee) mode = 'Select a destination and paste';
  const hidden = sheet.filterHidden.size;
  const filterRows = sheet.filter ? sheet.filter.range.r2 - sheet.filter.range.r1 : 0;

  const isDate = isDateFormat(stats?.fmt);
  const show = (n: number, total = false): string => formatValue(Number(n.toPrecision(12)), total && isDate ? undefined : stats?.fmt).text;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-chrome px-3 text-xs text-ink-2">
      <span className="truncate">{mode}</span>
      {hidden > 0 && (
        <span className="hidden truncate text-accent sm:inline">
          {filterRows - hidden} of {plural(filterRows, 'row')} shown
        </span>
      )}
      {engine.mode === 'manual' && <span className="text-warn">{engine.hasPending ? 'Calculate (F9)' : 'Manual calculation'}</span>}
      <div className="flex-1" />
      {stats && (
        <div className="flex min-w-0 items-center gap-4 overflow-hidden" aria-live="off">
          {stats.numbers > 0 && <Stat label="Average" value={show(stats.average)} className="hidden sm:block" />}
          <Stat label="Count" value={stats.filled.toLocaleString('en-US')} />
          {stats.numbers > 0 && (
            <>
              <Stat label="Min" value={show(stats.min)} className="hidden md:block" />
              <Stat label="Max" value={show(stats.max)} className="hidden md:block" />
              <Stat label="Sum" value={show(stats.sum, true)} />
            </>
          )}
        </div>
      )}
      <ZoomControl zoom={sheet.zoom} />
    </footer>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className={className ?? 'block'}>
      <span className="text-ink-3">{label} </span>
      <span className="font-medium tabular-nums text-ink">{value}</span>
    </span>
  );
}

function ZoomControl({ zoom }: { zoom: number }) {
  const pct = Math.round(zoom * 100);
  const button = 'flex h-6 w-6 items-center justify-center rounded text-ink-2 hover:bg-hover hover:text-ink';
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button type="button" aria-label="Zoom out" data-tip="Zoom out" className={button} onClick={() => setZoom(zoom - 0.1)}>
        <Minus size={14} />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        // Two linear halves so 100% sits in the middle of the track.
        value={zoom <= 1 ? ((zoom - 0.25) / 0.75) * 50 : 50 + ((zoom - 1) / 3) * 50}
        onChange={(e) => {
          const v = Number(e.target.value);
          const z = v <= 50 ? 0.25 + (v / 50) * 0.75 : 1 + ((v - 50) / 50) * 3;
          setZoom(Math.abs(z - 1) < 0.05 ? 1 : z);
        }}
        aria-label="Zoom"
        aria-valuetext={`${pct}%`}
        className="hidden h-1 w-24 cursor-pointer accent-[rgb(var(--accent))] sm:block"
      />
      <button type="button" aria-label="Zoom in" data-tip="Zoom in" className={button} onClick={() => setZoom(zoom + 0.1)}>
        <Plus size={14} />
      </button>
      <Popover
        placement="above"
        align="end"
        trigger={(p) => (
          <button type="button" aria-label={`Zoom level ${pct}%`} className="h-6 w-11 rounded text-right font-medium tabular-nums hover:bg-hover hover:text-ink" {...p}>
            <span className="pr-1.5">{pct}%</span>
          </button>
        )}
      >
        {(close) => (
          <MenuList
            onClose={close}
            items={[...[50, 75, 100, 125, 150, 200].map((z) => ({ label: `${z}%`, checked: z === pct, onSelect: () => setZoom(z / 100) })), 'separator' as const, { label: 'Fit selection', onSelect: zoomToSelection }]}
          />
        )}
      </Popover>
    </div>
  );
}
