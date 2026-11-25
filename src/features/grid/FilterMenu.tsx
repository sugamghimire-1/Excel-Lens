import { ArrowDownAZ, ArrowUpZA, FilterX, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Checkbox, Select, TextInput } from '@/components/Field';
import { Floating } from '@/components/Popover';
import { filterChoices } from '@/engine/commands/data';
import { filterColumn, sortFilterColumn } from '@/state/actions';
import { gridApi } from '@/state/gridApi';
import { useActiveSheet } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import type { FilterCriterion } from '@/types';

type ConditionOp = Extract<FilterCriterion, { type: 'condition' }>['op'];

const CONDITIONS: { value: ConditionOp | 'none' | 'top'; label: string }[] = [
  { value: 'none', label: 'No condition' },
  { value: 'eq', label: 'Equals' },
  { value: 'neq', label: 'Does not equal' },
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'Greater than or equal to' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'Less than or equal to' },
  { value: 'between', label: 'Between' },
  { value: 'top', label: 'Top items' },
  { value: 'contains', label: 'Contains' },
  { value: 'notContains', label: 'Does not contain' },
  { value: 'begins', label: 'Begins with' },
  { value: 'ends', label: 'Ends with' },
  { value: 'blank', label: 'Is blank' },
  { value: 'notBlank', label: 'Is not blank' },
];

export function FilterMenu() {
  const menu = useUI((s) => s.filterMenu);
  if (!menu) return null;
  return <FilterPanel key={menu.col} col={menu.col} x={menu.x} y={menu.y} />;
}

function FilterPanel({ col, x, y }: { col: number; x: number; y: number }) {
  const sheet = useActiveSheet();
  const engine = useWorkbook((s) => s.engine);
  const choices = useMemo(() => filterChoices(sheet, engine, col), [sheet, engine, col]);
  const existing = sheet.filter?.criteria[col];
  const [hidden, setHidden] = useState(() => new Set(existing?.type === 'values' ? existing.hidden : []));
  const [query, setQuery] = useState('');
  const [op, setOp] = useState<ConditionOp | 'none' | 'top'>(existing?.type === 'condition' ? existing.op : existing?.type === 'top' ? 'top' : 'none');
  const [a, setA] = useState(existing?.type === 'condition' ? existing.a : existing?.type === 'top' ? String(existing.count) : '');
  const [b, setB] = useState(existing?.type === 'condition' ? (existing.b ?? '') : '');
  if (!sheet.filter) return null;

  const close = (): void => {
    useUI.getState().set({ filterMenu: null });
    gridApi.focus();
  };
  const shown = choices.filter((c) => c.text.toLowerCase().includes(query.trim().toLowerCase()));
  const allOn = shown.every((c) => !hidden.has(c.text));

  const apply = (): void => {
    close();
    if (op === 'top') {
      filterColumn(col, { type: 'top', count: Math.max(1, Number.parseInt(a, 10) || 10) });
      return;
    }
    if (op !== 'none') {
      filterColumn(col, { type: 'condition', op, a, b: op === 'between' ? b : undefined });
      return;
    }
    // While searching, only the matches stay visible.
    const next = query.trim() ? choices.filter((c) => !shown.includes(c) || hidden.has(c.text)).map((c) => c.text) : [...hidden];
    filterColumn(col, next.length ? { type: 'values', hidden: next } : null);
  };
  const toggle = (text: string, on: boolean): void => {
    const next = new Set(hidden);
    if (on) next.delete(text);
    else next.add(text);
    setHidden(next);
  };
  const needsA = op !== 'none' && op !== 'blank' && op !== 'notBlank';
  const nothing = op === 'none' && choices.every((c) => hidden.has(c.text));

  return (
    <Floating anchor={{ left: x - 20, right: x, top: y - 22, bottom: y }} align="end" onClose={close} role="dialog" label="Filter">
      <form
        className="w-[264px] p-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        {[
          { label: 'Sort A to Z', icon: ArrowDownAZ, run: () => sortFilterColumn(col, false) },
          { label: 'Sort Z to A', icon: ArrowUpZA, run: () => sortFilterColumn(col, true) },
          { label: 'Clear this filter', icon: FilterX, run: () => filterColumn(col, null), off: !existing },
        ].map(({ label, icon: Icon, run, off }) => (
          <button
            key={label}
            type="button"
            disabled={off}
            onClick={() => {
              close();
              run();
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-[5px] text-left text-sm hover:bg-hover disabled:pointer-events-none disabled:opacity-40"
          >
            <Icon size={15} className="text-ink-2" />
            {label}
          </button>
        ))}
        <div className="my-2 h-px bg-line" />
        <div className="space-y-1.5 px-1">
          <Select aria-label="Condition" value={op} onChange={(v) => setOp(v as typeof op)} options={CONDITIONS} />
          {needsA && (
            <div className="flex items-center gap-1.5">
              <TextInput aria-label="Value" value={a} onChange={setA} placeholder={op === 'top' ? '10' : 'Value'} data-autofocus="" />
              {op === 'between' && (
                <>
                  <span className="text-xs text-ink-3">and</span>
                  <TextInput aria-label="Second value" value={b} onChange={setB} placeholder="Value" />
                </>
              )}
            </div>
          )}
        </div>
        {op === 'none' && (
          <>
            <div className="relative mt-2 px-1">
              <Search size={14} className="absolute left-3 top-[9px] text-ink-3" />
              <TextInput aria-label="Search values" value={query} onChange={setQuery} placeholder="Search" className="pl-8" />
            </div>
            <div className="mx-1 mt-2 max-h-[196px] overflow-auto rounded-md border border-line px-2 py-1">
              <Checkbox
                label={query.trim() ? 'Select all results' : 'Select all'}
                checked={allOn}
                onChange={(on) => {
                  const next = new Set(hidden);
                  for (const c of shown) if (on) next.delete(c.text);
                  else next.add(c.text);
                  setHidden(next);
                }}
              />
              {shown.slice(0, 500).map((c) => (
                <div key={c.text} className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate">
                    <Checkbox label={c.text || '(Blanks)'} checked={!hidden.has(c.text)} onChange={(on) => toggle(c.text, on)} />
                  </div>
                  <span className="text-xs text-ink-3">{c.count}</span>
                </div>
              ))}
              {shown.length === 0 && <div className="py-2 text-center text-ink-3">No matching values</div>}
              {shown.length > 500 && <div className="py-1 text-xs text-ink-3">Showing the first 500. Search to find others.</div>}
            </div>
          </>
        )}
        <div className="mt-2.5 flex justify-end gap-2 px-1 pb-0.5">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={nothing}>
            Apply filter
          </Button>
        </div>
      </form>
    </Floating>
  );
}
