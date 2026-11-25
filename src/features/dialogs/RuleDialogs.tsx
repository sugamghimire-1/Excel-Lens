/** Conditional formatting, data validation, defined names and the function browser. */
import { FunctionSquare, PencilLine, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, IconButton } from '@/components/Button';
import { ColorPicker } from '@/components/ColorPicker';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/Feedback';
import { Checkbox, Field, RangeInput, Select, TextInput } from '@/components/Field';
import { Popover } from '@/components/Popover';
import { parseRangeName, prettyRangeName, quoteSheet, rangeName, splitSheetRef } from '@/engine/address';
import { setNames, validateName } from '@/engine/commands/sheets';
import { internStyle } from '@/engine/sheet';
import { validationAt, validationMessage } from '@/engine/validation';
import { allFunctions, parseFormula, signatureText, type FunctionCategory } from '@/formulas';
import * as actions from '@/state/actions';
import { activeSelection, primaryRange, useActiveSheet, useSelection } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import type { CellStyle, CompareOp, ConditionalKind, ConditionalRule, DefinedName, ValidationKind, ValidationRule } from '@/types';
import { cx } from '@/utils/cx';

const close = (): void => useUI.getState().set({ dialog: null });

const OPS: { value: CompareOp; label: string }[] = [
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater than or equal to' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less than or equal to' },
  { value: 'eq', label: 'equal to' },
  { value: 'neq', label: 'not equal to' },
  { value: 'between', label: 'between' },
  { value: 'notBetween', label: 'not between' },
];

/* -------------------------------------------------- conditional formatting */

const PRESET_STYLES: { label: string; style: CellStyle }[] = [
  { label: 'Red fill', style: { fill: '#fbdcda', color: '#8f1d18' } },
  { label: 'Amber fill', style: { fill: '#fdeec4', color: '#7a4d05' } },
  { label: 'Green fill', style: { fill: '#dcf3e2', color: '#14532d' } },
  { label: 'Blue fill', style: { fill: '#e2ebfc', color: '#1c49b8' } },
  { label: 'Red text', style: { color: '#c12d28', bold: true } },
  { label: 'Green text', style: { color: '#1c7c43', bold: true } },
];

type RuleForm = 'compare' | 'text' | 'duplicate' | 'rank' | 'average' | 'blank' | 'error' | 'formula';

const FORMS: { value: RuleForm; label: string }[] = [
  { value: 'compare', label: 'Cell value' },
  { value: 'text', label: 'Text' },
  { value: 'duplicate', label: 'Duplicate or unique' },
  { value: 'rank', label: 'Top or bottom' },
  { value: 'average', label: 'Above or below average' },
  { value: 'blank', label: 'Blank cells' },
  { value: 'error', label: 'Errors' },
  { value: 'formula', label: 'Formula' },
];

function initialKind(preset: string | undefined): ConditionalKind {
  switch (preset) {
    case 'lt':
    case 'between':
    case 'eq':
      return { type: 'compare', op: preset, a: '' };
    case 'contains':
      return { type: 'text', op: 'contains', text: '' };
    case 'duplicate':
      return { type: 'duplicate' };
    case 'blank':
      return { type: 'blank' };
    case 'error':
      return { type: 'error' };
    case 'top':
      return { type: 'rank', count: 10 };
    case 'topPct':
      return { type: 'rank', count: 10, percent: true };
    case 'bottom':
      return { type: 'rank', count: 10, bottom: true };
    case 'bottomPct':
      return { type: 'rank', count: 10, bottom: true, percent: true };
    case 'above':
      return { type: 'average' };
    case 'below':
      return { type: 'average', below: true };
    case 'formula':
      return { type: 'formula', formula: '=' };
    default:
      return { type: 'compare', op: 'gt', a: '' };
  }
}

function kindFor(form: RuleForm): ConditionalKind {
  return initialKind({ compare: 'gt', text: 'contains', duplicate: 'duplicate', rank: 'top', average: 'above', blank: 'blank', error: 'error', formula: 'formula' }[form]);
}

function problemWith(kind: ConditionalKind): string | null {
  switch (kind.type) {
    case 'compare':
      if (kind.a.trim() === '') return 'Enter a value to compare with.';
      if (/etween/.test(kind.op) && !kind.b?.trim()) return 'Enter both values.';
      return null;
    case 'text':
      return kind.text ? null : 'Enter the text to look for.';
    case 'rank':
      return kind.count >= 1 ? null : 'Enter a number of at least 1.';
    case 'formula':
      try {
        parseFormula(kind.formula.startsWith('=') ? kind.formula : `=${kind.formula}`);
        return null;
      } catch {
        return 'Enter a formula that gives TRUE or FALSE, such as =A1>100.';
      }
    default:
      return null;
  }
}

export function ConditionalDialog({ preset, ruleId }: { preset?: string; ruleId?: string }) {
  const sheet = useActiveSheet();
  const selection = useSelection();
  const existing = sheet.conditional.find((r) => r.id === ruleId);
  const [kind, setKind] = useState<ConditionalKind>(() => (existing && existing.kind.type !== 'scale' && existing.kind.type !== 'bar' && existing.kind.type !== 'icons' ? existing.kind : initialKind(preset)));
  const [style, setStyle] = useState<CellStyle>(existing?.style ?? PRESET_STYLES[preset === 'above' || preset === 'top' || preset === 'topPct' ? 2 : 0].style);
  const [ranges, setRanges] = useState(() => (existing ? existing.ranges : selection.ranges).map(prettyRangeName).join(', '));
  const [stop, setStop] = useState(existing?.stopIfTrue ?? false);
  const [tried, setTried] = useState(false);
  const parsed = ranges.split(',').map((r) => parseRangeName(r));
  const rangeError = parsed.some((r) => !r) ? 'Enter a range such as A1:A20.' : null;
  const problem = problemWith(kind);
  const form = (FORMS.some((f) => f.value === kind.type) ? kind.type : 'compare') as RuleForm;

  const submit = (): void => {
    setTried(true);
    if (problem || rangeError) return;
    const rule: Omit<ConditionalRule, 'id'> = { ranges: parsed.flatMap((r) => r ?? []), kind, style: internStyle(style), stopIfTrue: stop || undefined };
    if (existing) actions.setConditional(sheet.conditional.map((r) => (r.id === existing.id ? { ...rule, id: existing.id } : r)), 'Edit rule');
    else actions.setConditional([{ ...rule, id: `cf_${Date.now().toString(36)}` }, ...sheet.conditional], 'Conditional formatting');
    close();
  };

  return (
    <Dialog
      title={existing ? 'Edit rule' : 'New formatting rule'}
      onClose={close}
      width={460}
      modeless
      onSubmit={submit}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary">
            {existing ? 'Save rule' : 'Add rule'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Apply to" error={rangeError}>
          {(id) => <RangeInput id={id} value={ranges} onChange={setRanges} invalid={rangeError !== null} />}
        </Field>
        <Field label="Format cells by">{(id) => <Select id={id} value={form} onChange={(v) => setKind(kindFor(v as RuleForm))} options={FORMS} />}</Field>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {kind.type === 'compare' && (
              <>
                <Select className="w-44" aria-label="Comparison" value={kind.op} onChange={(op) => setKind({ ...kind, op: op as CompareOp })} options={OPS} />
                <TextInput className="!w-28" aria-label="Value" value={kind.a} onChange={(a) => setKind({ ...kind, a })} placeholder="100 or =B1" data-autofocus="" />
                {/etween/.test(kind.op) && (
                  <>
                    and <TextInput className="!w-28" aria-label="Second value" value={kind.b ?? ''} onChange={(b) => setKind({ ...kind, b })} placeholder="200" />
                  </>
                )}
              </>
            )}
            {kind.type === 'text' && (
              <>
                <Select
                  className="w-44"
                  aria-label="Text rule"
                  value={kind.op}
                  onChange={(op) => setKind({ ...kind, op: op as typeof kind.op })}
                  options={[
                    { value: 'contains', label: 'contains' },
                    { value: 'notContains', label: 'does not contain' },
                    { value: 'begins', label: 'begins with' },
                    { value: 'ends', label: 'ends with' },
                  ]}
                />
                <TextInput className="!w-52" aria-label="Text" value={kind.text} onChange={(text) => setKind({ ...kind, text })} data-autofocus="" />
              </>
            )}
            {kind.type === 'duplicate' && <Select className="w-44" aria-label="Which values" value={kind.unique ? 'u' : 'd'} onChange={(v) => setKind({ type: 'duplicate', unique: v === 'u' })} options={[{ value: 'd', label: 'Duplicate values' }, { value: 'u', label: 'Unique values' }]} />}
            {kind.type === 'rank' && (
              <>
                <Select className="w-28" aria-label="End" value={kind.bottom ? 'b' : 't'} onChange={(v) => setKind({ ...kind, bottom: v === 'b' })} options={[{ value: 't', label: 'Top' }, { value: 'b', label: 'Bottom' }]} />
                <TextInput className="!w-20" aria-label="Count" inputMode="numeric" value={String(kind.count || '')} onChange={(v) => setKind({ ...kind, count: Number.parseInt(v, 10) || 0 })} />
                <Select className="w-28" aria-label="Unit" value={kind.percent ? 'p' : 'n'} onChange={(v) => setKind({ ...kind, percent: v === 'p' })} options={[{ value: 'n', label: 'items' }, { value: 'p', label: 'percent' }]} />
              </>
            )}
            {kind.type === 'average' && <Select className="w-44" aria-label="Side" value={kind.below ? 'b' : 'a'} onChange={(v) => setKind({ type: 'average', below: v === 'b' })} options={[{ value: 'a', label: 'Above average' }, { value: 'b', label: 'Below average' }]} />}
            {kind.type === 'blank' && <Select className="w-44" aria-label="Which cells" value={kind.not ? 'n' : 'b'} onChange={(v) => setKind({ type: 'blank', not: v === 'n' })} options={[{ value: 'b', label: 'Blank' }, { value: 'n', label: 'Not blank' }]} />}
            {kind.type === 'error' && <Select className="w-44" aria-label="Which cells" value={kind.not ? 'n' : 'e'} onChange={(v) => setKind({ type: 'error', not: v === 'n' })} options={[{ value: 'e', label: 'Has an error' }, { value: 'n', label: 'Has no error' }]} />}
            {kind.type === 'formula' && <TextInput aria-label="Formula" value={kind.formula} onChange={(formula) => setKind({ type: 'formula', formula })} placeholder="=A1>AVERAGE($A$1:$A$20)" data-autofocus="" />}
          </div>
          {tried && problem && (
            <p role="alert" className="mt-1.5 text-xs text-bad">
              {problem}
            </p>
          )}
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-2">Format</div>
          <div className="grid grid-cols-3 gap-1.5">
            {PRESET_STYLES.map((p) => {
              const on = JSON.stringify(internStyle(p.style)) === JSON.stringify(internStyle(style));
              return (
                <button key={p.label} type="button" aria-pressed={on} onClick={() => setStyle(p.style)} className={cx('h-8 rounded-md border bg-white text-sm', on ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:border-line-strong')} style={{ backgroundColor: p.style.fill ?? '#ffffff', color: p.style.color, fontWeight: p.style.bold ? 600 : 400 }}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ColorButton label="Fill" value={style.fill} onChange={(fill) => setStyle({ ...style, fill: fill ?? undefined })} />
            <ColorButton label="Text" value={style.color} onChange={(color) => setStyle({ ...style, color: color ?? undefined })} />
            <Checkbox label="Bold" checked={style.bold ?? false} onChange={(bold) => setStyle({ ...style, bold: bold || undefined })} />
            <Checkbox label="Strikethrough" checked={style.strike ?? false} onChange={(strike) => setStyle({ ...style, strike: strike || undefined })} />
          </div>
        </div>
        <Checkbox label="Skip later rules when this one matches" checked={stop} onChange={setStop} />
      </div>
    </Dialog>
  );
}

export function ColorButton({ label, value, onChange, none = 'None' }: { label: string; value: string | undefined; onChange: (c: string | null) => void; none?: string }) {
  return (
    <Popover
      trigger={(p) => (
        <button type="button" {...p} className="flex h-8 items-center gap-2 rounded-md border border-line px-2.5 text-sm hover:border-line-strong">
          <span className={cx('h-4 w-4 rounded ring-1 ring-inset ring-black/15', !value && 'checker')} style={{ backgroundColor: value }} />
          {label}
        </button>
      )}
    >
      {(done) => (
        <ColorPicker
          value={value}
          none={none}
          onPick={(c) => {
            done();
            onChange(c);
          }}
        />
      )}
    </Popover>
  );
}

/* --------------------------------------------------------- data validation */

type Allow = ValidationKind['type'];

const ALLOW: { value: Allow; label: string }[] = [
  { value: 'any', label: 'Any value' },
  { value: 'list', label: 'Dropdown list' },
  { value: 'whole', label: 'Whole number' },
  { value: 'decimal', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'textLength', label: 'Text length' },
  { value: 'custom', label: 'Custom formula' },
];

export function ValidationDialog() {
  const sheet = useActiveSheet();
  const selection = useSelection();
  const current = validationAt(sheet, activeSelection().active.r, activeSelection().active.c);
  const [allow, setAllow] = useState<Allow>(current?.kind.type ?? 'list');
  const [source, setSource] = useState(current?.kind.type === 'list' ? current.kind.source : '');
  const numeric = current && 'op' in current.kind ? current.kind : null;
  const [op, setOp] = useState<CompareOp>(numeric?.op ?? 'between');
  const [a, setA] = useState(numeric?.a ?? '');
  const [b, setB] = useState(numeric?.b ?? '');
  const [formula, setFormula] = useState(current?.kind.type === 'custom' ? current.kind.formula : '=');
  const [required, setRequired] = useState(current?.required ?? false);
  const [inputTitle, setInputTitle] = useState(current?.inputTitle ?? '');
  const [inputMessage, setInputMessage] = useState(current?.inputMessage ?? '');
  const [errorStyle, setErrorStyle] = useState<ValidationRule['errorStyle']>(current?.errorStyle ?? 'stop');
  const [errorTitle, setErrorTitle] = useState(current?.errorTitle ?? '');
  const [errorMessage, setErrorMessage] = useState(current?.errorMessage ?? '');
  const [error, setError] = useState<string | null>(null);
  const isNumeric = allow === 'whole' || allow === 'decimal' || allow === 'date' || allow === 'textLength';
  const two = op === 'between' || op === 'notBetween';

  const build = (): Omit<ValidationRule, 'id' | 'range'> | null => {
    let kind: ValidationKind;
    if (allow === 'list') {
      const src = source.trim();
      if (!src) {
        setError('Enter the items separated by commas, or a range such as =A1:A5.');
        return null;
      }
      const asRange = !src.startsWith('=') && !src.includes(',') && /[:!]/.test(src) && parseRangeName(splitSheetRef(src).local) ? `=${src}` : src;
      kind = { type: 'list', source: asRange };
    } else if (isNumeric) {
      if (!a.trim() || (two && !b.trim())) {
        setError(two ? 'Enter both limits.' : 'Enter a value.');
        return null;
      }
      kind = { type: allow as 'whole', op, a: a.trim(), b: two ? b.trim() : undefined };
    } else if (allow === 'custom') {
      try {
        parseFormula(formula);
      } catch {
        setError('Enter a formula that gives TRUE or FALSE, such as =LEN(A1)=5.');
        return null;
      }
      kind = { type: 'custom', formula };
    } else kind = { type: 'any' };
    return { kind, required, errorStyle, inputTitle: inputTitle.trim() || undefined, inputMessage: inputMessage.trim() || undefined, errorTitle: errorTitle.trim() || undefined, errorMessage: errorMessage.trim() || undefined };
  };

  const placeholder = defaultMessage(allow, op, a, b, source);
  return (
    <Dialog
      title="Data validation"
      onClose={close}
      width={460}
      modeless
      onSubmit={() => {
        const rule = build();
        if (!rule) return;
        const empty = rule.kind.type === 'any' && !rule.required && !rule.inputMessage;
        actions.setValidation(empty ? null : rule);
        close();
      }}
      footer={
        <>
          <Button
            className="mr-auto"
            disabled={!current}
            onClick={() => {
              actions.setValidation(null);
              close();
            }}
          >
            Clear rule
          </Button>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary">
            Apply
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <p className="text-ink-2">For {selection.ranges.map(prettyRangeName).join(', ')}</p>
        <Field label="Allow">
          {(id) => (
            <Select
              id={id}
              value={allow}
              onChange={(v) => {
                setAllow(v as Allow);
                setError(null);
              }}
              options={ALLOW}
            />
          )}
        </Field>
        {allow === 'list' && (
          <Field label="Items" error={error} hint="Separate items with commas, or use a range such as =Products!A2:A11.">
            {(id) => <TextInput id={id} value={source} onChange={setSource} placeholder="Yes, No, Maybe" data-autofocus="" invalid={error !== null} />}
          </Field>
        )}
        {isNumeric && (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Select className="w-44" aria-label="Comparison" value={op} onChange={(v) => setOp(v as CompareOp)} options={OPS} />
              <TextInput className="!w-28" aria-label="Value" value={a} onChange={setA} placeholder={allow === 'date' ? '2026-01-01' : '0'} />
              {two && (
                <>
                  and <TextInput className="!w-28" aria-label="Second value" value={b} onChange={setB} placeholder={allow === 'date' ? '2026-12-31' : '100'} />
                </>
              )}
            </div>
            {error && (
              <p role="alert" className="mt-1 text-xs text-bad">
                {error}
              </p>
            )}
          </div>
        )}
        {allow === 'custom' && (
          <Field label="Formula" error={error}>
            {(id) => <TextInput id={id} value={formula} onChange={setFormula} invalid={error !== null} />}
          </Field>
        )}
        <Checkbox label="Required" hint="Blank entries are rejected." checked={required} onChange={setRequired} />
        <div className="grid grid-cols-2 gap-3 border-t border-line pt-3.5">
          <Field label="Hint title">{(id) => <TextInput id={id} value={inputTitle} onChange={setInputTitle} />}</Field>
          <Field label="Hint">{(id) => <TextInput id={id} value={inputMessage} onChange={setInputMessage} placeholder="Shown when selected" />}</Field>
          <Field label="When the value is not allowed">
            {(id) => (
              <Select
                id={id}
                value={errorStyle}
                onChange={(v) => setErrorStyle(v as ValidationRule['errorStyle'])}
                options={[
                  { value: 'stop', label: 'Reject it' },
                  { value: 'warning', label: 'Ask before keeping it' },
                  { value: 'info', label: 'Show a message' },
                ]}
              />
            )}
          </Field>
          <Field label="Error title">{(id) => <TextInput id={id} value={errorTitle} onChange={setErrorTitle} placeholder="This value is not allowed" />}</Field>
        </div>
        <Field label="Error message">{(id) => <TextInput id={id} value={errorMessage} onChange={setErrorMessage} placeholder={placeholder} />}</Field>
      </div>
    </Dialog>
  );
}

/** Default message for the settings so far, shown as a placeholder. */
function defaultMessage(allow: Allow, op: CompareOp, a: string, b: string, source: string): string {
  const kind: ValidationKind = allow === 'list' ? { type: 'list', source } : allow === 'custom' ? { type: 'custom', formula: '' } : allow === 'any' ? { type: 'any' } : { type: allow, op, a, b };
  return validationMessage({ id: '', range: { r1: 0, c1: 0, r2: 0, c2: 0 }, kind, required: false, errorStyle: 'stop' });
}

/* ----------------------------------------------------------- name manager */

export function NamesDialog({ create }: { create?: boolean }) {
  const names = useWorkbook((s) => s.workbook.names);
  const sheet = useActiveSheet();
  const selected = `${quoteSheet(sheet.name)}!${rangeName(primaryRange(useSelection()), true)}`;
  const [editing, setEditing] = useState<{ original: string | null; name: string; ref: string } | null>(create ? { original: null, name: '', ref: selected } : null);
  const [error, setError] = useState<string | null>(null);

  const save = (): void => {
    if (!editing) return;
    const { workbook, dispatch } = useWorkbook.getState();
    const name = editing.name.trim();
    const ref = editing.ref.trim().replace(/^=/, '');
    const problem = validateName(workbook, name, editing.original ?? undefined);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      parseFormula(`=${ref}`);
    } catch {
      setError('Enter a range such as Sheet1!$A$1:$B$5, a value or a formula.');
      return;
    }
    const next: DefinedName = { name, ref };
    const list = editing.original ? workbook.names.map((n) => (n.name === editing.original ? next : n)) : [...workbook.names, next];
    dispatch(editing.original ? 'Edit name' : 'Define name', setNames(list));
    setEditing(null);
    setError(null);
  };

  return (
    <Dialog
      title="Defined names"
      onClose={close}
      width={500}
      modeless
      onSubmit={save}
      footer={
        editing ? (
          <>
            <Button
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save name
            </Button>
          </>
        ) : (
          <>
            <Button className="mr-auto" icon={<Plus size={15} />} onClick={() => setEditing({ original: null, name: '', ref: selected })}>
              New name
            </Button>
            <Button onClick={close}>Close</Button>
          </>
        )
      }
    >
      {editing ? (
        <div className="space-y-3">
          <Field label="Name" error={error}>
            {(id) => <TextInput id={id} value={editing.name} onChange={(name) => setEditing({ ...editing, name })} placeholder="Tax_rate" data-autofocus="" invalid={error !== null} />}
          </Field>
          <Field label="Refers to">{(id) => <RangeInput id={id} value={editing.ref} onChange={(ref) => setEditing({ ...editing, ref })} withSheet sheetName={quoteSheet(sheet.name)} />}</Field>
        </div>
      ) : names.length === 0 ? (
        <EmptyState icon={PencilLine} title="No names yet">
          Give a cell or range a name, then use the name in formulas.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {names.map((n) => (
            <li key={n.name} className="flex items-center gap-2 py-1.5 pl-3 pr-1.5">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => actions.goTo(n.name)}>
                <span className="block text-sm font-medium">{n.name}</span>
                <span className="block truncate text-xs text-ink-3">{n.ref}</span>
              </button>
              <IconButton label={`Edit ${n.name}`} onClick={() => setEditing({ original: n.name, name: n.name, ref: n.ref })}>
                <PencilLine size={15} />
              </IconButton>
              <IconButton label={`Delete ${n.name}`} onClick={() => useWorkbook.getState().dispatch('Delete name', setNames(names.filter((x) => x !== n)))}>
                <Trash2 size={15} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/* --------------------------------------------------------- function browser */

const CATEGORIES: (FunctionCategory | 'All')[] = ['All', 'Math', 'Statistical', 'Logical', 'Lookup', 'Text', 'Date', 'Financial', 'Array', 'Information'];

export function FunctionDialog({ category }: { category?: string }) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string>(category ?? 'All');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allFunctions()
      .filter((f) => (cat === 'All' || f.category === cat) && (!q || f.name.toLowerCase().includes(q) || f.summary.toLowerCase().includes(q)))
      .sort((x, y) => (q ? Number(y.name.toLowerCase().startsWith(q)) - Number(x.name.toLowerCase().startsWith(q)) : 0));
  }, [query, cat]);
  const [picked, setPicked] = useState<string | null>(null);
  const current = list.find((f) => f.name === picked) ?? list[0];
  const insert = (name: string): void => {
    close();
    actions.insertFunction(name);
  };
  return (
    <Dialog
      title="Insert function"
      onClose={close}
      width={560}
      onSubmit={() => current && insert(current.name)}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!current}>
            Insert {current?.name ?? ''}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex gap-2">
        <span className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-[9px] text-ink-3" />
          <TextInput aria-label="Search functions" value={query} onChange={setQuery} placeholder="Search by name or what it does" className="pl-8" data-autofocus="" />
        </span>
        <Select className="w-36" aria-label="Category" value={cat} onChange={setCat} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
      </div>
      <div className="grid h-[252px] grid-cols-[200px_1fr] gap-3">
        <div role="listbox" aria-label="Functions" className="overflow-auto rounded-md border border-line p-1">
          {list.map((f) => (
            <button
              key={f.name}
              type="button"
              role="option"
              aria-selected={f === current}
              onClick={() => setPicked(f.name)}
              onDoubleClick={() => insert(f.name)}
              className={cx('flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm', f === current ? 'bg-accent-soft font-medium' : 'hover:bg-hover')}
            >
              <FunctionSquare size={14} className="shrink-0 text-ink-3" />
              <span className="truncate">{f.name}</span>
            </button>
          ))}
          {list.length === 0 && <p className="p-3 text-ink-3">No functions match.</p>}
        </div>
        {current && (
          <div className="overflow-auto py-1 pr-1">
            <div className="text-base font-semibold">{current.name}</div>
            <div className="mb-2 text-xs text-ink-3">{current.category}</div>
            <p className="mb-3">{current.summary}</p>
            <div className="rounded-md bg-hover px-2.5 py-2 text-sm">{signatureText(current)}</div>
            {current.params.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {current.params.map((p) => (
                  <li key={p.name}>
                    <span className="font-medium">{p.name}</span>
                    <span className="text-ink-3">{p.optional ? ', optional' : ', required'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
