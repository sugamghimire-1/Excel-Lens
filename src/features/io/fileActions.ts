/** User-facing open, import, export and download actions. */
import { deserializeWorkbook, isWorkbookJson, serializeWorkbook } from '@/engine/serialize';
import { createWorkbook, uniqueSheetName } from '@/engine/sheet';
import { settleEdit } from '@/state/editing';
import { openWorkbook, saveNow } from '@/state/persistence';
import { activateSheet } from '@/state/selection';
import { activeSheet, primaryRange } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import type { Workbook } from '@/types';
import { download, safeFileName } from '@/utils/cx';
import { uid } from '@/utils/id';
import type { PdfOptions } from './pdf';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const ACCEPT = '.xlsx,.xlsm,.csv,.tsv,.txt,.tessera,.json';

function baseName(file: string): string {
  return file.replace(/\.[^.]+$/, '');
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function busy<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  const ui = useUI.getState();
  ui.set({ busy: label });
  // Let the overlay paint before heavy work starts.
  await new Promise((r) => setTimeout(r, 30));
  try {
    return await fn();
  } catch (e) {
    ui.toast('error', message(e));
    return null;
  } finally {
    ui.set({ busy: null });
  }
}

async function readWorkbook(file: File): Promise<{ workbook: Workbook; warnings: string[] }> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const name = baseName(file.name);
  if (ext === 'xlsx' || ext === 'xlsm') {
    const { importXlsx } = await import('./xlsx');
    try {
      return await importXlsx(await file.arrayBuffer(), name);
    } catch (e) {
      throw new Error(`${file.name} could not be read. Check that it is an unprotected Excel workbook. (${message(e)})`);
    }
  }
  if (ext === 'xls') throw new Error('The old .xls format is not supported. Save the file as .xlsx and try again.');
  const text = await file.text();
  if (ext === 'tessera' || ext === 'json') {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${file.name} is not a Tessera workbook.`);
    }
    if (!isWorkbookJson(data)) throw new Error(`${file.name} is not a Tessera workbook.`);
    return { workbook: { ...deserializeWorkbook(data), id: uid('wb') }, warnings: [] };
  }
  if (['csv', 'tsv', 'txt'].includes(ext)) {
    const { sheetFromCsv } = await import('./csv');
    return { workbook: createWorkbook(name, [sheetFromCsv(text, name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet1')]), warnings: [] };
  }
  throw new Error(`${file.name} cannot be opened. Choose an .xlsx, .csv or .tessera file.`);
}

/** Opens a file as a new workbook. The current one stays saved in this browser. */
export async function openFile(file: File): Promise<void> {
  if (!settleEdit()) return;
  await busy(`Opening ${file.name}`, async () => {
    if (useWorkbook.getState().saveState === 'unsaved') await saveNow();
    const { workbook, warnings } = await readWorkbook(file);
    openWorkbook(workbook);
    useWorkbook.setState({ saveState: 'unsaved' });
    await saveNow();
    for (const w of warnings) useUI.getState().toast('info', w);
  });
}

/** Adds the sheets of a file to the current workbook. */
export async function importAsSheets(file: File): Promise<void> {
  if (!settleEdit()) return;
  await busy(`Importing ${file.name}`, async () => {
    const { workbook: incoming } = await readWorkbook(file);
    const store = useWorkbook.getState();
    let index = store.workbook.sheets.length;
    let staged = store.workbook;
    const ops = incoming.sheets.map((s) => {
      const sheet = { ...s, id: uid('sh'), name: uniqueSheetName(staged, s.name) };
      staged = { ...staged, sheets: [...staged.sheets, sheet] };
      return { t: 'addSheet' as const, sheet, index: index++ };
    });
    store.dispatch(`Import ${file.name}`, ops, { sheetId: ops[0].sheet.id });
    activateSheet(ops[0].sheet.id);
  });
}

/** Shows the system file picker. */
export function openFileDialog(target: 'workbook' | 'sheet'): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPT;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void (target === 'workbook' ? openFile(file) : importAsSheets(file));
  };
  input.click();
}

/* ------------------------------------------------------------------ export */

export async function downloadXlsx(): Promise<void> {
  if (!settleEdit()) return;
  await busy('Preparing Excel file', async () => {
    const { workbook, engine } = useWorkbook.getState();
    const { exportXlsx } = await import('./xlsx');
    const data = await exportXlsx(workbook, engine);
    download(data as BlobPart, `${safeFileName(workbook.name)}.xlsx`, XLSX_TYPE);
    useUI.getState().toast('success', `Downloaded ${safeFileName(workbook.name)}.xlsx`);
  });
}

export async function downloadCsv(): Promise<void> {
  if (!settleEdit()) return;
  const { workbook, engine } = useWorkbook.getState();
  const sheet = activeSheet();
  const { sheetToCsv } = await import('./csv');
  const name = workbook.sheets.length > 1 ? `${workbook.name} - ${sheet.name}` : workbook.name;
  // The byte-order mark makes Excel read the file as UTF-8.
  download(`﻿${sheetToCsv(sheet, engine)}`, `${safeFileName(name)}.csv`, 'text/csv;charset=utf-8');
  useUI.getState().toast('success', `Downloaded ${sheet.name} as CSV`);
}

export function downloadTessera(): void {
  if (!settleEdit()) return;
  const { workbook } = useWorkbook.getState();
  download(JSON.stringify(serializeWorkbook(workbook)), `${safeFileName(workbook.name)}.tessera`, 'application/json');
  useUI.getState().toast('success', `Downloaded ${safeFileName(workbook.name)}.tessera`);
}

export async function downloadPdf(options: PdfOptions): Promise<void> {
  if (!settleEdit()) return;
  await busy('Preparing PDF', async () => {
    const { workbook, engine } = useWorkbook.getState();
    const sheet = activeSheet();
    const { exportPdf } = await import('./pdf');
    const data = await exportPdf(workbook, engine, sheet, primaryRange(), options);
    const name = options.scope === 'workbook' || workbook.sheets.length === 1 ? workbook.name : `${workbook.name} - ${sheet.name}`;
    download(data as BlobPart, `${safeFileName(name)}.pdf`, 'application/pdf');
    useUI.getState().toast('success', `Downloaded ${safeFileName(name)}.pdf`);
  });
}

/** Starts a new workbook; the current one stays saved in this browser. */
export async function startWorkbook(workbook: Workbook, cell?: string): Promise<void> {
  if (!settleEdit()) return;
  if (useWorkbook.getState().saveState === 'unsaved') await saveNow();
  openWorkbook(workbook, cell);
  useWorkbook.setState({ saveState: 'unsaved' });
  await saveNow();
}

/** Saves the current workbook under a new name and continues in the copy. */
export async function saveCopy(name: string): Promise<void> {
  if (!settleEdit()) return;
  if (useWorkbook.getState().saveState === 'unsaved') await saveNow();
  const json = serializeWorkbook(useWorkbook.getState().workbook);
  await startWorkbook({ ...deserializeWorkbook(json), id: uid('wb'), name });
  useUI.getState().toast('success', `Saved a copy as ${name}`);
}
