import { Ban, Pipette } from 'lucide-react';
import { useRef } from 'react';
import { NEUTRALS, STANDARD_COLORS, themeById, tintColumn } from '@/engine/themes';
import { useWorkbook } from '@/state/workbookStore';
import { cx } from '@/utils/cx';

interface ColorPickerProps {
  value?: string | null;
  onPick: (color: string | null) => void;
  /** Label for the "no colour" choice; omit to hide it. */
  none?: string;
}

const recent: string[] = [];

function remember(color: string): void {
  const i = recent.indexOf(color);
  if (i >= 0) recent.splice(i, 1);
  recent.unshift(color);
  recent.length = Math.min(recent.length, 10);
}

/** Theme colours with tints, standard colours, recent colours and a custom picker. */
export function ColorPicker({ value, onPick, none }: ColorPickerProps) {
  const theme = themeById(useWorkbook((s) => s.workbook.themeId));
  const input = useRef<HTMLInputElement>(null);
  const columns = [NEUTRALS, tintColumn(theme.ink), ...theme.accents.map(tintColumn)];
  const pick = (c: string): void => {
    remember(c);
    onPick(c);
  };
  const swatch = (c: string, key: string | number) => (
    <button
      key={key}
      type="button"
      aria-label={`Color ${c}`}
      aria-pressed={value?.toLowerCase() === c}
      onClick={() => pick(c)}
      style={{ backgroundColor: c }}
      className={cx('h-[18px] w-[18px] rounded-[4px] ring-1 ring-inset ring-black/10 transition-transform hover:scale-125 hover:ring-black/30 dark:ring-white/15', value?.toLowerCase() === c && 'outline outline-2 outline-offset-1 outline-accent')}
    />
  );
  return (
    <div className="w-[236px] p-3" role="group" aria-label="Colors">
      {none && (
        <button type="button" onClick={() => onPick(null)} className="mb-2 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-hover">
          <Ban size={15} className="text-ink-2" />
          {none}
        </button>
      )}
      <div className="mb-1.5 text-xs font-medium text-ink-3">Theme colors</div>
      <div className="flex justify-between">
        {columns.map((col, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {[0, 1, 2, 3, 4, 5].map((row) => swatch(col[row], row))}
          </div>
        ))}
      </div>
      <div className="mb-1.5 mt-3 text-xs font-medium text-ink-3">Standard colors</div>
      <div className="flex justify-between">{STANDARD_COLORS.map(swatch)}</div>
      {recent.length > 0 && (
        <>
          <div className="mb-1.5 mt-3 text-xs font-medium text-ink-3">Recent</div>
          <div className="flex gap-[3px]">{recent.map(swatch)}</div>
        </>
      )}
      <button type="button" onClick={() => input.current?.click()} className="mt-2.5 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-hover">
        <Pipette size={15} className="text-ink-2" />
        More colors
        <input ref={input} type="color" tabIndex={-1} aria-hidden="true" defaultValue={value ?? '#2457d6'} onChange={(e) => pick(e.target.value)} className="pointer-events-none h-0 w-0 opacity-0" />
      </button>
    </div>
  );
}
