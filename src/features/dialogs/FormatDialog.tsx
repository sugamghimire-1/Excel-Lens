/** Format cells: number, alignment, font, border and fill in one place. */
import { useState } from 'react';
import { Button } from '@/components/Button';
import { ColorPicker } from '@/components/ColorPicker';
import { Dialog } from '@/components/Dialog';
import { Checkbox, Field, Select, TextInput } from '@/components/Field';
import { applyBorders, applyStyle, type BorderPreset } from '@/engine/commands/format';
import { DEFAULT_FONT, DEFAULT_FONT_SIZE, FONT_FAMILIES, FONT_SIZES } from '@/engine/measure';
import { FORMAT_LIBRARY, formatValue } from '@/engine/numberFormat';
import { baseStyle } from '@/engine/sheet';
import * as actions from '@/state/actions';
import { activeSelection, activeSheet } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import type { HAlign, StylePatch, VAlign } from '@/types';
import { cx } from '@/utils/cx';

type Tab = 'number' | 'alignment' | 'font' | 'border' | 'fill';
const TABS: [Tab, string][] = [
  ['number', 'Number'],
  ['alignment', 'Alignment'],
  ['font', 'Font'],
  ['border', 'Border'],
  ['fill', 'Fill'],
];

const close = (): void => useUI.getState().set({ dialog: null });

const BORDERS: [BorderPreset, string][] = [
  ['none', 'None'],
  ['outside', 'Outside'],
  ['inside', 'Inside'],
  ['all', 'All'],
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['thickOutside', 'Thick outside'],
  ['topBottom', 'Top and bottom'],
  ['doubleBottom', 'Double bottom'],
  ['thickBottom', 'Thick bottom'],
];

export function FormatDialog({ tab: initial }: { tab?: string }) {
  const [tab, setTab] = useState<Tab>((initial as Tab) ?? 'number');
  const sheet = activeSheet();
  const { active } = activeSelection();
  const style = baseStyle(sheet, active.r, active.c) ?? {};
  const value = useWorkbook((s) => s.engine).readCell(sheet.id, active.r, active.c);
  const [patch, setPatch] = useState<StylePatch>({});
  const [border, setBorder] = useState<BorderPreset | null>(null);
  const [borderColor, setBorderColor] = useState('#1b2333');
  const now = { ...style, ...patch };
  const category = Object.entries(FORMAT_LIBRARY).find(([, codes]) => codes.includes(now.numFmt ?? ''))?.[0] ?? (now.numFmt ? 'Custom' : 'General');
  const [cat, setCat] = useState(category);
  const set = (p: StylePatch): void => setPatch((x) => ({ ...x, ...p }));
  const sample = typeof value === 'number' ? value : 1234.5;

  const submit = (): void => {
    actions.run('Format cells', (s, ranges) => [...(Object.keys(patch).length ? applyStyle(s, ranges, patch) : [])]);
    if (border) actions.run('Borders', (s, ranges) => applyBorders(s, ranges, border, borderColor));
    close();
  };

  return (
    <Dialog
      title="Format cells"
      onClose={close}
      width={520}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary">
            Apply
          </Button>
        </>
      }
    >
      <div role="tablist" aria-label="Format" className="mb-4 flex gap-1 border-b border-line">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('-mb-px border-b-2 px-3 pb-2 pt-1 text-sm', tab === id ? 'border-accent font-semibold text-ink' : 'border-transparent text-ink-2 hover:text-ink')}>
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-[268px]">
        {tab === 'number' && (
          <div className="grid grid-cols-[128px_1fr] gap-4">
            <div className="space-y-px">
              {['General', ...Object.keys(FORMAT_LIBRARY), 'Custom'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setCat(c);
                    if (c === 'General') set({ numFmt: null });
                    else if (FORMAT_LIBRARY[c]) set({ numFmt: FORMAT_LIBRARY[c][0] });
                  }}
                  className={cx('block w-full rounded-md px-2.5 py-1 text-left text-sm', cat === c ? 'bg-accent-soft font-medium text-accent' : 'hover:bg-hover')}
                >
                  {c}
                </button>
              ))}
            </div>
            <div>
              <div className="mb-3 rounded-md bg-hover px-3 py-2">
                <div className="text-xs text-ink-3">Sample</div>
                <div className="truncate text-base font-medium" style={{ color: formatValue(sample, now.numFmt ?? undefined).color }}>
                  {formatValue(typeof value === 'string' && now.numFmt === '@' ? value : sample, now.numFmt ?? undefined).text || ' '}
                </div>
              </div>
              {FORMAT_LIBRARY[cat] && (
                <div className="max-h-[188px] overflow-auto rounded-md border border-line p-1">
                  {FORMAT_LIBRARY[cat].map((code) => (
                    <button key={code} type="button" onClick={() => set({ numFmt: code })} className={cx('flex w-full justify-between gap-3 rounded px-2 py-1 text-left text-sm', now.numFmt === code ? 'bg-accent-soft' : 'hover:bg-hover')}>
                      <span>{formatValue(cat === 'Date' || cat === 'Time' ? 46351.6 : cat === 'Percentage' ? 0.1234 : cat === 'Fraction' ? 2.25 : cat === 'Accounting' ? -1234.5 : sample, code).text.trim()}</span>
                      <span className="truncate text-xs text-ink-3">{code}</span>
                    </button>
                  ))}
                </div>
              )}
              {cat === 'General' && <p className="text-ink-2">Numbers are shown as typed, with no specific format.</p>}
              {cat === 'Custom' && (
                <Field label="Format code" hint="Use 0 and # for digits, % for percent, and sections separated by semicolons.">
                  {(id) => <TextInput id={id} value={now.numFmt ?? ''} onChange={(numFmt) => set({ numFmt: numFmt || null })} placeholder="#,##0.00;[Red]-#,##0.00" />}
                </Field>
              )}
            </div>
          </div>
        )}
        {tab === 'alignment' && (
          <div className="grid max-w-[380px] grid-cols-2 gap-4">
            <Field label="Horizontal">
              {(id) => (
                <Select
                  id={id}
                  value={now.hAlign ?? 'auto'}
                  onChange={(v) => set({ hAlign: v === 'auto' ? null : (v as HAlign) })}
                  options={[
                    { value: 'auto', label: 'Automatic' },
                    { value: 'left', label: 'Left' },
                    { value: 'center', label: 'Center' },
                    { value: 'right', label: 'Right' },
                  ]}
                />
              )}
            </Field>
            <Field label="Vertical">
              {(id) => (
                <Select
                  id={id}
                  value={now.vAlign ?? 'bottom'}
                  onChange={(v) => set({ vAlign: v === 'bottom' ? null : (v as VAlign) })}
                  options={[
                    { value: 'top', label: 'Top' },
                    { value: 'middle', label: 'Middle' },
                    { value: 'bottom', label: 'Bottom' },
                  ]}
                />
              )}
            </Field>
            <Field label="Indent">{(id) => <TextInput id={id} inputMode="numeric" value={String(now.indent ?? 0)} onChange={(v) => set({ indent: Math.max(0, Math.min(15, Number.parseInt(v, 10) || 0)) || null })} />}</Field>
            <div className="self-end pb-1.5">
              <Checkbox label="Wrap text" checked={now.wrap ?? false} onChange={(wrap) => set({ wrap: wrap || null })} />
            </div>
          </div>
        )}
        {tab === 'font' && (
          <div className="max-w-[420px] space-y-4">
            <div className="grid grid-cols-[1fr_96px] gap-4">
              <Field label="Font">{(id) => <Select id={id} value={now.fontFamily ?? DEFAULT_FONT} onChange={(v) => set({ fontFamily: v === DEFAULT_FONT ? null : v })} options={FONT_FAMILIES.map((f) => ({ value: f, label: f }))} />}</Field>
              <Field label="Size">{(id) => <Select id={id} value={String(now.fontSize ?? DEFAULT_FONT_SIZE)} onChange={(v) => set({ fontSize: Number(v) === DEFAULT_FONT_SIZE ? null : Number(v) })} options={[...new Set([...FONT_SIZES, now.fontSize ?? DEFAULT_FONT_SIZE])].sort((x, y) => x - y).map((n) => ({ value: String(n), label: String(n) }))} />}</Field>
            </div>
            <div className="flex gap-5">
              <Checkbox label="Bold" checked={now.bold ?? false} onChange={(v) => set({ bold: v || null })} />
              <Checkbox label="Italic" checked={now.italic ?? false} onChange={(v) => set({ italic: v || null })} />
              <Checkbox label="Underline" checked={now.underline ?? false} onChange={(v) => set({ underline: v || null })} />
              <Checkbox label="Strikethrough" checked={now.strike ?? false} onChange={(v) => set({ strike: v || null })} />
            </div>
            <div className="-ml-3">
              <ColorPicker value={now.color} none="Automatic" onPick={(color) => set({ color })} />
            </div>
          </div>
        )}
        {tab === 'border' && (
          <div className="flex gap-6">
            <div className="grid flex-1 grid-cols-2 content-start gap-1.5">
              {BORDERS.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={border === id} onClick={() => setBorder(border === id ? null : id)} className={cx('h-8 rounded-md border px-2.5 text-left text-sm', border === id ? 'border-accent bg-accent-soft font-medium' : 'border-line hover:border-line-strong')}>
                  {label}
                </button>
              ))}
            </div>
            <ColorPicker value={borderColor} onPick={(c) => c && setBorderColor(c)} />
          </div>
        )}
        {tab === 'fill' && (
          <div className="flex gap-6">
            <div className="-ml-3">
              <ColorPicker value={now.fill} none="No fill" onPick={(fill) => set({ fill })} />
            </div>
            <div className="flex-1">
              <div className="mb-1 text-xs font-medium text-ink-2">Sample</div>
              <div className={cx('flex h-20 items-center justify-center rounded-md border border-line text-base', !now.fill && 'checker')} style={{ backgroundColor: now.fill ?? undefined, color: now.color ?? undefined }}>
                AaBbCc 123
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
