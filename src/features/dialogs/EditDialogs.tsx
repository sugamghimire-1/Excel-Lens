/** Find and replace, go to, links, sizes, cell shifting, sorting and data tools. */
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, IconButton } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Checkbox, Field, Radio, RangeInput, Segmented, Select, TextInput } from '@/components/Field';
import { cellName, colName, parseRangeName, prettyRangeName, rangeName } from '@/engine/address';
import { colAxis, rowAxis } from '@/engine/axis';
import { looksLikeHeader, removeDuplicates, textToColumns, type SortKey } from '@/engine/commands/data';
import { findAll, findPattern, replaceHits, type FindOptions } from '@/engine/commands/find';
import { editText } from '@/engine/input';
import { contentRange } from '@/engine/sheet';
import { displayText } from '@/engine/validation';
import { themeById } from '@/engine/themes';
import * as actions from '@/state/actions';
import { gridApi } from '@/state/gridApi';
import { activateSheet, dataRange, selectCell } from '@/state/selection';
import { activeSelection, activeSheet, primaryRange, useActiveCell, useActiveSheet, useSelection } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import type { Sparkline } from '@/types';
import { plural } from '@/utils/cx';

const close = (): void => useUI.getState().set({ dialog: null });

/* -------------------------------------------------------- find and replace */

let lastFind: FindOptions = { query: '', matchCase: false, wholeCell: false, regex: false, formulas: false, scope: 'sheet' };
let lastReplace = '';

export function FindDialog({ replace }: { replace: boolean }) {
  const [o, setO] = useState<FindOptions>(lastFind);
  const [withReplace, setWithReplace] = useState(replace);
  const [replacement, setReplacement] = useState(lastReplace);
  const found = useUI((s) => s.found);
  const revision = useWorkbook((s) => s.revision);
  const sheet = useActiveSheet();
  useEffect(() => setWithReplace(replace), [replace]);

  const patch = (p: Partial<FindOptions>): void => setO((x) => ({ ...x, ...p }));

  // Live search with a short pause while typing.
  useEffect(() => {
    lastFind = o;
    const t = setTimeout(() => {
      const { workbook, engine } = useWorkbook.getState();
      const hits = findAll(workbook, engine, sheet.id, activeSelection().ranges, o);
      const prev = useUI.getState().found;
      const { active } = activeSelection();
      let index = hits.findIndex((h) => h.sheetId === sheet.id && (h.r > active.r || (h.r === active.r && h.c >= active.c)));
      if (index < 0) index = 0;
      if (prev && prev.hits.length === hits.length && prev.index < hits.length) index = prev.index;
      useUI.getState().set({ found: o.query ? { hits, index } : null });
    }, 140);
    return () => clearTimeout(t);
  }, [o, revision, sheet.id]);

  const done = (): void => {
    useUI.getState().set({ found: null });
    close();
  };

  const go = (delta: number): void => {
    const f = useUI.getState().found;
    if (!f?.hits.length) return;
    const index = (f.index + delta + f.hits.length) % f.hits.length;
    const h = f.hits[index];
    if (h.sheetId !== activeSheet().id) activateSheet(h.sheetId);
    selectCell(h.r, h.c);
    useUI.getState().set({ found: { ...f, index } });
  };

  const replaceOne = (): void => {
    const f = useUI.getState().found;
    if (!f?.hits.length) return;
    lastReplace = replacement;
    const hit = f.hits[f.index];
    const { workbook, dispatch } = useWorkbook.getState();
    const { ops, count } = replaceHits(workbook, [hit], o, replacement);
    if (count) dispatch('Replace', ops, { sheetId: hit.sheetId });
    else useUI.getState().toast('info', 'This match is inside a formula. Turn on "Search in formulas" to replace it.');
    go(1);
  };

  const replaceEvery = (): void => {
    const f = useUI.getState().found;
    if (!f?.hits.length) return;
    lastReplace = replacement;
    const { workbook, dispatch } = useWorkbook.getState();
    const { ops, count } = replaceHits(workbook, f.hits, o, replacement);
    if (count) dispatch('Replace all', ops, { sheetId: sheet.id });
    const skipped = f.hits.length - count;
    useUI.getState().toast(count ? 'success' : 'info', count ? `Replaced ${plural(count, 'match', 'matches')}${skipped ? `. ${skipped} inside formulas were left alone.` : '.'}` : 'Nothing was replaced.');
  };

  const bad = o.query !== '' && findPattern(o) === null;
  const n = found?.hits.length ?? 0;
  const status = bad ? 'This regular expression is not valid.' : !o.query ? '' : n === 0 ? 'No matches' : `${(found?.index ?? 0) + 1} of ${n.toLocaleString('en-US')}${n === 5000 ? '+' : ''}`;

  return (
    <Dialog title={withReplace ? 'Find and replace' : 'Find'} onClose={done} modeless width={400} onSubmit={() => go(1)}>
      <div className="space-y-3">
        <div className="flex gap-1.5">
          <TextInput aria-label="Find" value={o.query} onChange={(query) => patch({ query })} placeholder="Find" data-autofocus="" invalid={bad} />
          <IconButton label="Previous match" onClick={() => go(-1)} disabled={!n}>
            <ArrowUp size={16} />
          </IconButton>
          <IconButton label="Next match" onClick={() => go(1)} disabled={!n}>
            <ArrowDown size={16} />
          </IconButton>
        </div>
        {withReplace && <TextInput aria-label="Replace with" value={replacement} onChange={setReplacement} placeholder="Replace with" />}
        <div className="flex items-center justify-between">
          <span className={bad ? 'text-xs text-bad' : 'text-xs text-ink-3'} role="status">
            {status}
          </span>
          <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setWithReplace(!withReplace)}>
            {withReplace ? 'Hide replace' : 'Show replace'}
          </button>
        </div>
        <Segmented
          label="Where to search"
          value={o.scope}
          onChange={(scope) => patch({ scope })}
          options={[
            { value: 'sheet', label: 'Sheet' },
            { value: 'workbook', label: 'Workbook' },
            { value: 'selection', label: 'Selection' },
          ]}
        />
        <div className="grid grid-cols-2 gap-x-4">
          <Checkbox label="Match case" checked={o.matchCase} onChange={(matchCase) => patch({ matchCase })} />
          <Checkbox label="Entire cell" checked={o.wholeCell} onChange={(wholeCell) => patch({ wholeCell })} />
          <Checkbox label="Search in formulas" checked={o.formulas} onChange={(formulas) => patch({ formulas })} />
          <Checkbox label="Regular expression" checked={o.regex} onChange={(regex) => patch({ regex })} />
        </div>
        {withReplace && (
          <div className="flex gap-2 pt-1">
            <Button onClick={replaceOne} disabled={!n}>
              Replace
            </Button>
            <Button onClick={replaceEvery} disabled={!n}>
              Replace all
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function GoToDialog() {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const names = useWorkbook((s) => s.workbook.names);
  const go = (t: string): void => {
    if (actions.goTo(t)) close();
    else setError('Enter a cell such as B12, a range, or a defined name.');
  };
  return (
    <Dialog title="Go to" onClose={close} width={340} onSubmit={() => go(text)} footer={<Button type="submit" variant="primary">Go to</Button>}>
      <Field label="Reference" error={error}>
        {(id) => <TextInput id={id} value={text} onChange={setText} placeholder="B12 or Sheet2!A1:C9" invalid={error !== null} />}
      </Field>
      {names.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-ink-2">Defined names</div>
          <div className="max-h-40 overflow-auto rounded-md border border-line p-1">
            {names.map((n) => (
              <button key={n.name} type="button" onClick={() => go(n.name)} className="flex w-full justify-between gap-3 rounded px-2 py-1 text-left hover:bg-hover">
                <span className="font-medium">{n.name}</span>
                <span className="truncate text-xs text-ink-3">{n.ref}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------- links */

export function LinkDialog() {
  const { cell, style, sheet, pos } = useActiveCell();
  const engine = useWorkbook((s) => s.engine);
  const sheets = useWorkbook((s) => s.workbook.sheets);
  const isFormula = cell?.f !== undefined;
  const [kind, setKind] = useState<'web' | 'place'>(cell?.link?.startsWith('#') ? 'place' : 'web');
  const [url, setUrl] = useState(cell?.link && !cell.link.startsWith('#') ? cell.link : '');
  const [place, setPlace] = useState(cell?.link?.startsWith('#') ? cell.link.slice(1) : `${sheet.name}!A1`);
  const initial = isFormula ? displayText(sheet, engine, pos.r, pos.c) : editText(cell, style?.numFmt);
  const [label, setLabel] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    let link: string;
    if (kind === 'web') {
      const t = url.trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) link = `mailto:${t}`;
      else if (/^(https?:\/\/|mailto:)\S+$/i.test(t)) link = t;
      else if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t)) link = `https://${t}`;
      else {
        setError('Enter a web address or an email address.');
        return;
      }
    } else link = `#${place.trim()}`;
    actions.saveLink(link, isFormula ? null : label.trim() || (kind === 'web' ? url.trim() : place.trim()));
    close();
  };
  return (
    <Dialog
      title={cell?.link ? 'Edit link' : 'Add link'}
      onClose={close}
      onSubmit={submit}
      footer={
        <>
          {cell?.link && (
            <Button
              className="mr-auto"
              onClick={() => {
                actions.saveLink(null, null);
                close();
              }}
            >
              Remove link
            </Button>
          )}
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary">
            Save link
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Segmented label="Link to" value={kind} onChange={setKind} options={[{ value: 'web', label: 'Web or email' }, { value: 'place', label: 'This workbook' }]} />
        {kind === 'web' ? (
          <Field label="Address" error={error}>
            {(id) => <TextInput id={id} value={url} onChange={setUrl} placeholder="https://example.com" data-autofocus="" invalid={error !== null} />}
          </Field>
        ) : (
          <Field label="Cell" hint={`Sheets: ${sheets.map((s) => s.name).join(', ')}`}>
            {(id) => <TextInput id={id} value={place} onChange={setPlace} placeholder="Sheet1!A1" />}
          </Field>
        )}
        {!isFormula && <Field label="Text to show">{(id) => <TextInput id={id} value={label} onChange={setLabel} />}</Field>}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------- size, shift */

export function SizeDialog({ axis }: { axis: 'row' | 'col' }) {
  const sheet = useActiveSheet();
  const range = primaryRange(useSelection());
  const current = axis === 'row' ? rowAxis(sheet).size(range.r1) : colAxis(sheet).size(range.c1);
  const [value, setValue] = useState(String(current));
  const n = Number(value);
  const bad = !Number.isFinite(n) || n < 0 || n > 1200;
  return (
    <Dialog
      title={axis === 'row' ? 'Row height' : 'Column width'}
      onClose={close}
      width={300}
      onSubmit={() => {
        if (bad) return;
        actions.setSelectedSize(axis, n);
        close();
      }}
      footer={
        <Button type="submit" variant="primary" disabled={bad}>
          Apply
        </Button>
      }
    >
      <Field label="Size in pixels" error={bad ? 'Enter a number from 0 to 1200.' : null}>
        {(id) => <TextInput id={id} value={value} onChange={setValue} inputMode="numeric" invalid={bad} />}
      </Field>
    </Dialog>
  );
}

export function ShiftDialog({ mode }: { mode: 'insert' | 'delete' }) {
  type Choice = 'horizontal' | 'vertical' | 'row' | 'col';
  const [choice, setChoice] = useState<Choice>('vertical');
  const ins = mode === 'insert';
  const submit = (): void => {
    close();
    if (choice === 'row') (ins ? actions.insertRows : actions.deleteRows)();
    else if (choice === 'col') (ins ? actions.insertCols : actions.deleteCols)();
    else actions.shiftCells(mode, choice);
  };
  return (
    <Dialog
      title={ins ? 'Insert cells' : 'Delete cells'}
      onClose={close}
      width={300}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary">
            {ins ? 'Insert' : 'Delete'}
          </Button>
        </>
      }
    >
      <Radio name="shift" value="horizontal" current={choice} onChange={setChoice} label={ins ? 'Shift cells right' : 'Shift cells left'} />
      <Radio name="shift" value="vertical" current={choice} onChange={setChoice} label={ins ? 'Shift cells down' : 'Shift cells up'} />
      <Radio name="shift" value="row" current={choice} onChange={setChoice} label="Entire row" />
      <Radio name="shift" value="col" current={choice} onChange={setChoice} label="Entire column" />
    </Dialog>
  );
}

/* -------------------------------------------------------------------- sort */

export function SortDialog() {
  const sheet = useActiveSheet();
  const engine = useWorkbook((s) => s.engine);
  const [range] = useState(() => dataRange());
  const [header, setHeader] = useState(() => sheet.filter?.range.r1 === range.r1 || looksLikeHeader(sheet, engine, range));
  const first = Math.max(range.c1, Math.min(range.c2, activeSelection().active.c));
  const [keys, setKeys] = useState<SortKey[]>([{ col: first, descending: false, by: 'value' }]);
  const cols = Array.from({ length: Math.min(200, range.c2 - range.c1 + 1) }, (_, i) => range.c1 + i);
  const label = (c: number): string => (header ? displayText(sheet, engine, range.r1, c) || `Column ${colName(c)}` : `Column ${colName(c)}`);
  const update = (i: number, p: Partial<SortKey>): void => setKeys((k) => k.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Dialog
      title="Sort"
      onClose={close}
      width={540}
      onSubmit={() => {
        actions.sortBy(range, keys, header);
        close();
      }}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!keys.length}>
            Sort
          </Button>
        </>
      }
    >
      <p className="mb-3 text-ink-2">Sorting {prettyRangeName(range)}</p>
      <div className="space-y-2">
        {keys.map((k, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-ink-3">{i === 0 ? 'Sort by' : 'Then by'}</span>
            <Select className="min-w-0 flex-1" aria-label="Column" value={String(k.col)} onChange={(v) => update(i, { col: Number(v) })} options={cols.map((c) => ({ value: String(c), label: label(c) }))} />
            <Select className="w-32" aria-label="Sort on" value={k.by} onChange={(v) => update(i, { by: v as SortKey['by'] })} options={[{ value: 'value', label: 'Values' }, { value: 'fill', label: 'Fill color' }, { value: 'color', label: 'Font color' }]} />
            <Select className="w-28" aria-label="Order" value={k.descending ? 'd' : 'a'} onChange={(v) => update(i, { descending: v === 'd' })} options={[{ value: 'a', label: 'Ascending' }, { value: 'd', label: 'Descending' }]} />
            <IconButton label="Remove level" onClick={() => setKeys((x) => x.filter((_, j) => j !== i))} disabled={keys.length === 1}>
              <Trash2 size={15} />
            </IconButton>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Button icon={<Plus size={15} />} disabled={keys.length >= 6} onClick={() => setKeys((k) => [...k, { col: cols.find((c) => !k.some((x) => x.col === c)) ?? cols[0], descending: false, by: 'value' }])}>
          Add level
        </Button>
        <Checkbox label="First row is a header" checked={header} onChange={setHeader} />
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------- data tools */

export function DuplicatesDialog() {
  const sheet = useActiveSheet();
  const engine = useWorkbook((s) => s.engine);
  const [range] = useState(() => dataRange());
  const [header, setHeader] = useState(() => looksLikeHeader(sheet, engine, range));
  const cols = Array.from({ length: Math.min(100, range.c2 - range.c1 + 1) }, (_, i) => range.c1 + i);
  const [picked, setPicked] = useState(() => new Set(cols));
  const result = useMemo(() => (picked.size ? removeDuplicates(sheet, engine, range, [...picked], header) : null), [sheet, engine, range, picked, header]);
  return (
    <Dialog
      title="Remove duplicates"
      onClose={close}
      onSubmit={() => {
        if (!result) return;
        actions.run('Remove duplicates', () => result.ops);
        useUI.getState().toast('success', `Removed ${plural(result.removed, 'duplicate row')}. ${plural(result.kept, 'row')} kept.`);
        close();
      }}
      footer={
        <>
          <span className="mr-auto text-xs text-ink-2" role="status">
            {!result ? 'Choose at least one column.' : result.removed ? `${plural(result.removed, 'duplicate row')} found` : 'No duplicates found'}
          </span>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!result?.removed}>
            Remove
          </Button>
        </>
      }
    >
      <p className="mb-2 text-ink-2">Rows in {prettyRangeName(range)} are duplicates when these columns match:</p>
      <div className="max-h-52 overflow-auto rounded-md border border-line px-3 py-2">
        {cols.map((c) => (
          <Checkbox
            key={c}
            label={header ? displayText(sheet, engine, range.r1, c) || `Column ${colName(c)}` : `Column ${colName(c)}`}
            checked={picked.has(c)}
            onChange={(on) => {
              const next = new Set(picked);
              if (on) next.add(c);
              else next.delete(c);
              setPicked(next);
            }}
          />
        ))}
      </div>
      <div className="mt-3">
        <Checkbox label="First row is a header" checked={header} onChange={setHeader} />
      </div>
    </Dialog>
  );
}

const SPLITS = [
  ['Comma', ','],
  ['Semicolon', ';'],
  ['Space', ' '],
  ['Tab', '\t'],
] as const;

export function SplitDialog() {
  const sheet = useActiveSheet();
  const engine = useWorkbook((s) => s.engine);
  const range = primaryRange(useSelection());
  const single = range.c1 === range.c2;
  const [on, setOn] = useState<Set<string>>(new Set([',']));
  const [custom, setCustom] = useState('');
  const [merge, setMerge] = useState(false);
  const delims = [...on, ...(custom ? [custom] : [])];
  const preview = useMemo(() => {
    const used = contentRange(sheet);
    const rows: string[][] = [];
    if (!delims.length || !single || !used) return rows;
    const re = new RegExp(`(?:${delims.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})${merge ? '+' : ''}`);
    for (let r = range.r1; r <= Math.min(range.r2, used.r2) && rows.length < 4; r++) {
      const t = displayText(sheet, engine, r, range.c1);
      if (t) rows.push(t.split(re).map((x) => x.trim()));
    }
    return rows;
  }, [sheet, engine, range, delims.join('\u0000'), merge, single]);
  return (
    <Dialog
      title="Text to columns"
      onClose={close}
      width={480}
      onSubmit={() => {
        if (actions.run('Text to columns', (s) => textToColumns(s, engine, range, delims, merge))) close();
      }}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!delims.length || !single}>
            Split
          </Button>
        </>
      }
    >
      {!single && (
        <p role="alert" className="mb-3 text-bad">
          Select cells in a single column, then try again.
        </p>
      )}
      <div className="mb-1 text-xs font-medium text-ink-2">Split at each</div>
      <div className="flex flex-wrap gap-x-5">
        {SPLITS.map(([label, d]) => (
          <Checkbox
            key={label}
            label={label}
            checked={on.has(d)}
            onChange={(v) => {
              const next = new Set(on);
              if (v) next.add(d);
              else next.delete(d);
              setOn(next);
            }}
          />
        ))}
        <label className="flex items-center gap-2">
          Other <TextInput value={custom} onChange={setCustom} className="w-14" maxLength={4} />
        </label>
      </div>
      <Checkbox label="Treat repeated separators as one" checked={merge} onChange={setMerge} />
      <div className="mb-1 mt-3 text-xs font-medium text-ink-2">Preview</div>
      <div className="min-h-[60px] overflow-auto rounded-md border border-line">
        {preview.length === 0 ? (
          <p className="p-3 text-ink-3">Nothing to preview.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {row.map((t, j) => (
                    <td key={j} className="border-r border-line px-2 py-1 last:border-0">
                      {t}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-3">Cells to the right are replaced.</p>
    </Dialog>
  );
}

export function TableDialog({ styleId }: { styleId: string }) {
  const sheet = useActiveSheet();
  const engine = useWorkbook((s) => s.engine);
  const [start] = useState(() => dataRange());
  const [text, setText] = useState(rangeName(start));
  const [header, setHeader] = useState(() => looksLikeHeader(sheet, engine, start) || start.r2 > start.r1);
  const range = parseRangeName(text);
  return (
    <Dialog
      title="Create table"
      onClose={close}
      width={340}
      onSubmit={() => {
        if (!range) return;
        actions.createTableFrom(range, styleId, header);
        close();
      }}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!range}>
            Create table
          </Button>
        </>
      }
    >
      <Field label="Data range" error={range ? null : 'Enter a range such as A1:D20.'}>
        {(id) => <RangeInput id={id} value={text} onChange={setText} invalid={!range} />}
      </Field>
      <div className="mt-3">
        <Checkbox label="First row is a header" checked={header} onChange={setHeader} />
      </div>
    </Dialog>
  );
}

export function SparklineDialog({ kind }: { kind: Sparkline['type'] }) {
  const theme = themeById(useWorkbook((s) => s.workbook.themeId));
  const sel = useSelection();
  const [source, setSource] = useState(() => {
    const r = primaryRange();
    return r.r1 === r.r2 && r.c1 === r.c2 ? '' : rangeName(r);
  });
  const [target, setTarget] = useState(() => {
    const r = primaryRange();
    if (r.r1 === r.r2 && r.c1 === r.c2) return cellName(r.r1, r.c1);
    return rangeName({ r1: r.r1, r2: r.r2, c1: r.c2 + 1, c2: r.c2 + 1 });
  });
  const src = parseRangeName(source);
  const dst = parseRangeName(target);
  void sel;
  return (
    <Dialog
      title="Insert sparklines"
      onClose={close}
      width={360}
      modeless
      onSubmit={() => {
        if (!src || !dst) return;
        actions.addSparklines(kind, src, dst, theme.accents[0]);
        close();
        gridApi.focus();
      }}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!src || !dst}>
            Insert
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Data range">{(id) => <RangeInput id={id} value={source} onChange={setSource} placeholder="B2:M5" invalid={source !== '' && !src} />}</Field>
        <Field label="Location" hint="One cell for each row or column of data.">
          {(id) => <RangeInput id={id} value={target} onChange={setTarget} placeholder="N2:N5" invalid={target !== '' && !dst} />}
        </Field>
      </div>
    </Dialog>
  );
}
