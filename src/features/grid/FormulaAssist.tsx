import { FunctionSquare, Tag } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { getFunction } from '@/formulas';
import { useUI } from '@/state/uiStore';
import { cx } from '@/utils/cx';
import { acceptSuggestion, suggestionsFor, useAssist } from './assistStore';
import { callAt } from './formulaRefs';

/** Autocomplete list and argument hint under the active formula input. */
export function FormulaAssist({ host, origin }: { host: RefObject<HTMLElement | null>; origin: 'cell' | 'bar' }) {
  const edit = useUI((s) => s.edit);
  const index = useAssist((s) => s.index);
  useAssist((s) => s.dismissed);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const active = edit !== null && edit.origin === origin;

  useLayoutEffect(() => {
    if (!active || !host.current) return;
    const r = host.current.getBoundingClientRect();
    setRect((p) => (p && p.left === r.left && p.bottom === r.bottom && p.top === r.top ? p : r));
  });

  const items = active ? suggestionsFor(edit) : [];
  const current = Math.min(index, items.length - 1);

  useEffect(() => {
    list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  if (!active || !rect) return null;
  if (items[0]?.kind === 'value') {
    return createPortal(
      <div style={{ left: rect.left, top: rect.bottom + 4 }} className="pointer-events-none fixed z-[65] flex items-center gap-2 rounded-md bg-raised px-2.5 py-1 text-xs text-ink-2 shadow-pop">
        <span className="text-ink">{items[0].name}</span>
        <span className="kbd">→</span>
      </div>,
      document.body,
    );
  }

  const call = items.length ? null : callAt(edit.text, edit.caretStart);
  const def = call ? getFunction(call.name) : undefined;
  if (!items.length && !def) return null;

  const height = items.length ? Math.min(items.length * 30 + 8, 248) : 60;
  const below = rect.bottom + 4 + height < window.innerHeight - 40;
  const style = {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 380)),
    top: below ? rect.bottom + 4 : undefined,
    bottom: below ? undefined : window.innerHeight - rect.top + 4,
  };

  if (items.length) {
    const picked = items[current];
    return createPortal(
      <div style={style} className="fixed z-[65] flex items-start gap-1.5" onMouseDown={(e) => e.preventDefault()}>
        <div ref={list} role="listbox" aria-label="Formula suggestions" className="max-h-[248px] w-[212px] overflow-auto rounded-[10px] bg-raised p-1 shadow-pop">
          {items.map((s, i) => (
            <div
              key={`${s.kind}-${s.name}`}
              role="option"
              aria-selected={i === current}
              onMouseEnter={() => useAssist.getState().set({ index: i })}
              onClick={() => acceptSuggestion(s)}
              className={cx('flex h-[30px] cursor-pointer items-center gap-2 rounded-md px-2 text-sm', i === current && 'bg-accent-soft')}
            >
              {s.kind === 'name' ? <Tag size={14} className="text-ink-3" /> : <FunctionSquare size={14} className="text-ink-3" />}
              <span className="truncate font-medium">{s.name}</span>
            </div>
          ))}
        </div>
        {picked && (
          <div className="mt-1 hidden w-[236px] rounded-[10px] bg-raised px-3 py-2 text-xs text-ink-2 shadow-pop sm:block">
            {picked.kind === 'function' ? picked.def.summary : picked.kind === 'name' ? `Refers to ${picked.detail}` : ''}
            <div className="mt-1.5 flex items-center gap-1.5 text-ink-3">
              <span className="kbd">Tab</span> inserts it
            </div>
          </div>
        )}
      </div>,
      document.body,
    );
  }

  const repeats = def!.max === 255;
  const params = def!.params;
  const at = Math.min(call!.arg, params.length - 1);
  return createPortal(
    <div style={style} className="pointer-events-none fixed z-[65] max-w-[460px] rounded-lg bg-raised px-3 py-2 shadow-pop">
      <div className="text-sm">
        <span className="font-semibold text-accent">{def!.name}</span>(
        {params.map((p, i) => {
          const isCurrent = i === at || (repeats && call!.arg >= params.length && i === params.length - 1);
          return (
            <span key={p.name}>
              {i > 0 && ', '}
              <span className={cx(isCurrent ? 'rounded bg-accent-soft px-0.5 font-semibold text-ink' : 'text-ink-2')}>{p.optional ? `[${p.name}]` : p.name}</span>
            </span>
          );
        })}
        {repeats && ', ...'})
      </div>
      <div className="mt-0.5 text-xs text-ink-3">{def!.summary}</div>
    </div>,
    document.body,
  );
}
