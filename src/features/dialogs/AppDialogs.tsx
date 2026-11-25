/** Share, PDF, shortcuts, statistics, about and confirmation dialogs. */
import { Check, Copy, FileJson, FileSpreadsheet, Link2, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Checkbox, Field, Segmented, Select, TextInput } from '@/components/Field';
import { isError } from '@/formulas/values';
import { keyCol, keyRow, MAX_COLS, MAX_ROWS } from '@/engine/address';
import { allFunctions } from '@/formulas';
import { useUI, type DialogState } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import { APP_NAME, FILE_EXT } from '@/utils/brand';
import { shortcut } from '@/utils/cx';
import { Logo } from '../appBar/Logo';
import { downloadPdf, downloadNative, downloadXlsx } from '../io/fileActions';
import type { PdfOptions } from '../io/pdf';
import { shareLink } from '../io/share';

const close = (): void => useUI.getState().set({ dialog: null });

export function ConfirmDialog({ dialog }: { dialog: Extract<DialogState, { type: 'confirm' }> }) {
  const cancel = (): void => {
    close();
    dialog.onCancel?.();
  };
  return (
    <Dialog
      title={dialog.title}
      onClose={cancel}
      width={400}
      onSubmit={() => {
        close();
        dialog.onConfirm();
      }}
      footer={
        <>
          <Button onClick={cancel}>{dialog.cancelLabel ?? 'Cancel'}</Button>
          <Button type="submit" variant={dialog.danger ? 'danger' : 'primary'} data-autofocus="">
            {dialog.confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-ink-2">{dialog.message}</p>
    </Dialog>
  );
}

/* ------------------------------------------------------------------- share */

export function ShareDialog() {
  const workbook = useWorkbook((s) => s.workbook);
  const [link, setLink] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    shareLink(workbook)
      .then((l) => alive && setLink(l))
      .catch(() => alive && setLink(null));
    return () => {
      alive = false;
    };
  }, [workbook]);

  const copy = async (): Promise<void> => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      useUI.getState().toast('info', 'Your browser blocked copying. Select the link and press Ctrl+C.');
    }
  };
  return (
    <Dialog title={`Share ${workbook.name}`} onClose={close} width={480}>
      <div className="space-y-5">
        <section>
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Link2 size={16} className="text-accent" /> Link to a copy
          </h3>
          <p className="mb-2 text-ink-2">Anyone with the link gets their own editable copy. The workbook travels inside the link, so nothing is uploaded.</p>
          {link === undefined && (
            <p className="flex h-8 items-center gap-2 text-ink-3" role="status">
              <LoaderCircle size={15} className="animate-spin" /> Preparing link
            </p>
          )}
          {link === null && <p className="rounded-md bg-hover px-3 py-2 text-ink-2">This workbook is too large for a link. Send one of the files below instead.</p>}
          {link && (
            <div className="flex gap-2">
              <TextInput aria-label="Share link" readOnly value={link} onChange={() => undefined} onFocus={(e) => e.target.select()} className="text-ink-2" />
              <Button variant="primary" className="w-28" icon={copied ? <Check size={15} /> : <Copy size={15} />} onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
          )}
        </section>
        <section className="border-t border-line pt-4">
          <h3 className="mb-2 text-sm font-semibold">Send a file</h3>
          <div className="flex gap-2">
            <Button icon={<FileSpreadsheet size={15} />} onClick={() => void downloadXlsx()}>
              Download .xlsx
            </Button>
            <Button icon={<FileJson size={15} />} onClick={downloadNative}>
              Download .{FILE_EXT}
            </Button>
          </div>
        </section>
        <p className="flex items-start gap-2 text-xs text-ink-3">
          <ShieldCheck size={15} className="mt-px shrink-0" /> Workbooks are stored in this browser only. Live co-editing needs a sync service, which is not set up.
        </p>
      </div>
    </Dialog>
  );
}

/* --------------------------------------------------------------------- pdf */

export function PdfDialog() {
  const [o, setO] = useState<PdfOptions>({ scope: 'sheet', paper: 'a4', orientation: 'landscape', fit: 'width', gridlines: false, headings: false, pageNumbers: true });
  const patch = (p: Partial<PdfOptions>): void => setO((x) => ({ ...x, ...p }));
  return (
    <Dialog
      title="Export as PDF"
      onClose={close}
      width={420}
      onSubmit={() => {
        close();
        void downloadPdf(o);
      }}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary">
            Download PDF
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          label="What to export"
          value={o.scope}
          onChange={(scope) => patch({ scope })}
          options={[
            { value: 'sheet', label: 'This sheet' },
            { value: 'workbook', label: 'Workbook' },
            { value: 'selection', label: 'Selection' },
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paper">{(id) => <Select id={id} value={o.paper} onChange={(v) => patch({ paper: v as PdfOptions['paper'] })} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'a3', label: 'A3' }]} />}</Field>
          <Field label="Orientation">{(id) => <Select id={id} value={o.orientation} onChange={(v) => patch({ orientation: v as PdfOptions['orientation'] })} options={[{ value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }]} />}</Field>
        </div>
        <Field label="Scale">
          {(id) => (
            <Select
              id={id}
              value={o.fit}
              onChange={(v) => patch({ fit: v as PdfOptions['fit'] })}
              options={[
                { value: 'width', label: 'Fit all columns on one page' },
                { value: 'page', label: 'Fit everything on one page' },
                { value: 'actual', label: 'Actual size' },
              ]}
            />
          )}
        </Field>
        <div>
          <Checkbox label="Gridlines" checked={o.gridlines} onChange={(gridlines) => patch({ gridlines })} />
          <Checkbox label="Row and column headings" checked={o.headings} onChange={(headings) => patch({ headings })} />
          <Checkbox label="Title and page numbers" checked={o.pageNumbers} onChange={(pageNumbers) => patch({ pageNumbers })} />
        </div>
      </div>
    </Dialog>
  );
}

/* --------------------------------------------------------------- shortcuts */

const SHORTCUTS: [string, [string, string][]][] = [
  ['Move and select', [['Arrow keys', 'Move one cell'], ['Ctrl+Arrow', 'Jump to the edge of the data'], ['Shift+Arrow', 'Extend the selection'], ['Ctrl+A', 'Select the data, then everything'], ['Ctrl+Space', 'Select the column'], ['Shift+Space', 'Select the row'], ['Ctrl+Home', 'Go to the first cell'], ['Ctrl+End', 'Go to the last cell'], ['Ctrl+G', 'Go to a cell or name'], ['Ctrl+PageDown', 'Next sheet']]],
  ['Edit', [['F2', 'Edit the cell'], ['Enter', 'Confirm and move down'], ['Tab', 'Confirm and move right'], ['Esc', 'Cancel'], ['Alt+Enter', 'New line in the cell'], ['Ctrl+Enter', 'Fill the selection'], ['Delete', 'Clear contents'], ['Ctrl+Z', 'Undo'], ['Ctrl+Y', 'Redo'], ['Ctrl+D', 'Fill down'], ['Ctrl+R', 'Fill right'], ['Ctrl+;', "Insert today's date"]]],
  ['Format', [['Ctrl+B', 'Bold'], ['Ctrl+I', 'Italic'], ['Ctrl+U', 'Underline'], ['Ctrl+1', 'Format cells'], ['Ctrl+Shift+$', 'Currency'], ['Ctrl+Shift+%', 'Percent'], ['Ctrl+Shift+&', 'Outside border']]],
  ['Data', [['Alt+=', 'AutoSum'], ['Ctrl+F', 'Find'], ['Ctrl+H', 'Replace'], ['Ctrl+Shift+L', 'Filter'], ['Ctrl+T', 'Create table'], ['Alt+Down', 'Open a list'], ['Ctrl+K', 'Add a link'], ['Shift+F2', 'Add a note']]],
  ['Formulas', [['=', 'Start a formula'], ['F4', 'Switch $ in a reference'], ['Shift+F3', 'Insert a function'], ['Ctrl+`', 'Show formulas'], ['F9', 'Calculate now']]],
  ['App', [['Alt+Q', 'Find a command'], ['Ctrl+S', 'Save'], ['Ctrl+P', 'Export as PDF'], ['Ctrl+O', 'Open'], ['Shift+F11', 'New sheet']]],
];

export function ShortcutsDialog() {
  return (
    <Dialog title="Keyboard shortcuts" onClose={close} width={720}>
      <div className="columns-2 gap-8">
        {SHORTCUTS.map(([group, items]) => (
          <section key={group} className="mb-5 break-inside-avoid">
            <h3 className="mb-1.5 text-sm font-semibold">{group}</h3>
            <dl>
              {items.map(([keys, what]) => (
                <div key={keys} className="flex items-center justify-between gap-3 py-[3px]">
                  <dt className="text-ink-2">{what}</dt>
                  <dd className="flex shrink-0 gap-1">
                    {shortcut(keys)
                      .split(/\+(?=.)/)
                      .map((k) => (
                        <kbd key={k} className="kbd">
                          {k}
                        </kbd>
                      ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------- statistics */

export function StatsDialog() {
  const workbook = useWorkbook((s) => s.workbook);
  const engine = useWorkbook((s) => s.engine);
  const rows = useMemo(
    () =>
      workbook.sheets.map((s) => {
        let formulas = 0;
        let errors = 0;
        let notes = 0;
        for (const [k, c] of s.cells) {
          if (c.f !== undefined) formulas++;
          if (c.note) notes++;
          if (isError(engine.readCell(s.id, keyRow(k), keyCol(k)))) errors++;
        }
        return { name: s.name, cells: s.cells.size, formulas, errors, notes, charts: s.charts.length, tables: s.tables.length };
      }),
    [workbook, engine],
  );
  const total = rows.reduce((a, r) => ({ ...a, cells: a.cells + r.cells, formulas: a.formulas + r.formulas, errors: a.errors + r.errors, notes: a.notes + r.notes, charts: a.charts + r.charts, tables: a.tables + r.tables }), { name: 'Workbook', cells: 0, formulas: 0, errors: 0, notes: 0, charts: 0, tables: 0 });
  const heads = ['Sheet', 'Cells', 'Formulas', 'Errors', 'Notes', 'Charts', 'Tables'];
  return (
    <Dialog title="Workbook statistics" onClose={close} width={580} footer={<Button onClick={close}>Close</Button>}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-3">
            {heads.map((h, i) => (
              <th key={h} className={i ? 'pb-2 text-right font-medium' : 'pb-2 font-medium'}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...rows, total].map((r, i) => (
            <tr key={r.name + i} className={i === rows.length ? 'border-t-2 border-line-strong font-semibold' : 'border-t border-line'}>
              <td className="max-w-[180px] truncate py-1.5">{r.name}</td>
              {[r.cells, r.formulas, r.errors, r.notes, r.charts, r.tables].map((n, j) => (
                <td key={j} className={`py-1.5 text-right tabular-nums ${j === 2 && n ? 'font-semibold text-bad' : ''}`}>
                  {n.toLocaleString('en-US')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

export function AboutDialog() {
  return (
    <Dialog title={`About ${APP_NAME}`} onClose={close} width={420} footer={<Button onClick={close}>Close</Button>}>
      <div className="flex gap-4">
        <Logo size={52} />
        <div>
          <p>A spreadsheet that runs entirely in your browser and works offline.</p>
          <p className="mt-2 text-ink-2">
            {MAX_ROWS.toLocaleString('en-US')} rows by {MAX_COLS.toLocaleString('en-US')} columns per sheet, {allFunctions().length} functions. Open source under the MIT license.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
