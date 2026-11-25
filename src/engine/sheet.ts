/** Construction and read helpers for the workbook model. */
import type { Cell, CellStyle, Range, Sheet, StylePatch, Workbook } from '@/types';
import { uid } from '@/utils/id';
import { cellKey, inRange, keyCol, keyRow, MAX_COLS, MAX_ROWS, rangeSize } from './address';

export function createSheet(name: string, init: Partial<Sheet> = {}): Sheet {
  return {
    id: uid('sh'),
    name,
    tabColor: null,
    hidden: false,
    protected: false,
    showGridlines: true,
    zoom: 1,
    frozenRows: 0,
    frozenCols: 0,
    merges: [],
    conditional: [],
    validations: [],
    filter: null,
    filterHidden: new Set(),
    tables: [],
    charts: [],
    sparklines: [],
    rowCount: MAX_ROWS,
    colCount: MAX_COLS,
    cells: new Map(),
    rows: new Map(),
    cols: new Map(),
    ...init,
  };
}

export function createWorkbook(name: string, sheets: Sheet[] = [createSheet('Sheet1')]): Workbook {
  return { id: uid('wb'), name, themeId: 'cobalt', names: [], sheets };
}

/** Deep enough copy to be independent of later edits. Cells are immutable and shared. */
export function cloneSheet(sheet: Sheet, overrides: Partial<Sheet> = {}): Sheet {
  return { ...sheet, cells: new Map(sheet.cells), ...overrides };
}

export function getSheet(wb: Workbook, id: string): Sheet {
  const sheet = wb.sheets.find((s) => s.id === id);
  if (!sheet) throw new Error(`Unknown sheet ${id}`);
  return sheet;
}

export function getCell(sheet: Sheet, r: number, c: number): Cell | undefined {
  return sheet.cells.get(cellKey(r, c));
}

export function isBlankCell(cell: Cell | undefined): boolean {
  return !cell || (cell.f === undefined && (cell.v === undefined || cell.v === null));
}

/* ------------------------------------------------------------------ styles */

const stylePool = new Map<string, CellStyle>();

/** Returns one shared frozen instance per distinct style. */
export function internStyle(style: CellStyle): CellStyle | undefined {
  const entries = Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  if (entries.length === 0) return undefined;
  const key = JSON.stringify(entries);
  let hit = stylePool.get(key);
  if (!hit) {
    hit = Object.freeze(Object.fromEntries(entries)) as CellStyle;
    stylePool.set(key, hit);
  }
  return hit;
}

/** Merges a patch into a style; `null` removes a property. */
export function patchStyle(base: CellStyle | undefined, patch: StylePatch): CellStyle | undefined {
  const next: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete next[k];
    else next[k] = v;
  }
  return internStyle(next as CellStyle);
}

/** Style stored for a cell, falling back to its row and column. Excludes tables and conditional formats. */
export function baseStyle(sheet: Sheet, r: number, c: number): CellStyle | undefined {
  return sheet.cells.get(cellKey(r, c))?.s ?? sheet.rows.get(r)?.style ?? sheet.cols.get(c)?.style;
}

/** Drops empty fields so untouched cells never stay in the sparse map. */
export function compactCell(cell: Cell): Cell | null {
  const out: Cell = {};
  if (cell.f !== undefined) out.f = cell.f;
  else if (cell.v !== undefined && cell.v !== null) out.v = cell.v;
  if (cell.s) out.s = cell.s;
  if (cell.note) out.note = cell.note;
  if (cell.link) out.link = cell.link;
  return Object.keys(out).length ? out : null;
}

/* ------------------------------------------------------------------ ranges */

/** Bounding box of cells with content (values, formulas or notes). */
export function contentRange(sheet: Sheet): Range | null {
  let r1 = Infinity;
  let c1 = Infinity;
  let r2 = -1;
  let c2 = -1;
  for (const [key, cell] of sheet.cells) {
    if (isBlankCell(cell) && !cell.note) continue;
    const r = keyRow(key);
    const c = keyCol(key);
    if (r < r1) r1 = r;
    if (r > r2) r2 = r;
    if (c < c1) c1 = c;
    if (c > c2) c2 = c;
  }
  return r2 < 0 ? null : { r1, c1, r2, c2 };
}

/** Bounding box of every stored cell, including formatting, plus merges, charts and tables. */
export function extentRange(sheet: Sheet): Range {
  let r2 = 0;
  let c2 = 0;
  for (const key of sheet.cells.keys()) {
    const r = keyRow(key);
    const c = keyCol(key);
    if (r > r2) r2 = r;
    if (c > c2) c2 = c;
  }
  for (const m of [...sheet.merges, ...sheet.tables.map((t) => t.range)]) {
    if (m.r2 > r2) r2 = m.r2;
    if (m.c2 > c2) c2 = m.c2;
  }
  return { r1: 0, c1: 0, r2, c2 };
}

/** Restricts a possibly huge selection to the part that can contain data. */
export function clipToContent(sheet: Sheet, range: Range): Range | null {
  const ext = extentRange(sheet);
  const out: Range = {
    r1: range.r1,
    c1: range.c1,
    r2: Math.min(range.r2, Math.max(ext.r2, range.r1)),
    c2: Math.min(range.c2, Math.max(ext.c2, range.c1)),
  };
  return out.r1 <= out.r2 && out.c1 <= out.c2 ? out : null;
}

/** Visits stored cells inside a range using whichever traversal is cheaper. */
export function eachCell(sheet: Sheet, range: Range, visit: (cell: Cell, r: number, c: number, key: number) => void): void {
  if (rangeSize(range).cells <= sheet.cells.size * 2) {
    for (let r = range.r1; r <= range.r2; r++) {
      for (let c = range.c1; c <= range.c2; c++) {
        const key = cellKey(r, c);
        const cell = sheet.cells.get(key);
        if (cell) visit(cell, r, c, key);
      }
    }
    return;
  }
  for (const [key, cell] of sheet.cells) {
    const r = keyRow(key);
    const c = keyCol(key);
    if (inRange(range, r, c)) visit(cell, r, c, key);
  }
}

/** Grows outward from a cell to the surrounding block of non-empty cells (Ctrl+A). */
export function currentRegion(sheet: Sheet, r: number, c: number, filled?: (r: number, c: number) => boolean): Range {
  const has = filled ?? ((rr: number, cc: number) => !isBlankCell(sheet.cells.get(cellKey(rr, cc))));
  const region: Range = { r1: r, c1: c, r2: r, c2: c };
  const rowHas = (rr: number): boolean => {
    for (let cc = Math.max(0, region.c1 - 1); cc <= Math.min(MAX_COLS - 1, region.c2 + 1); cc++) if (has(rr, cc)) return true;
    return false;
  };
  const colHas = (cc: number): boolean => {
    for (let rr = Math.max(0, region.r1 - 1); rr <= Math.min(MAX_ROWS - 1, region.r2 + 1); rr++) if (has(rr, cc)) return true;
    return false;
  };
  for (let changed = true; changed; ) {
    changed = false;
    if (region.r1 > 0 && rowHas(region.r1 - 1)) {
      region.r1--;
      changed = true;
    }
    if (region.r2 < MAX_ROWS - 1 && rowHas(region.r2 + 1)) {
      region.r2++;
      changed = true;
    }
    if (region.c1 > 0 && colHas(region.c1 - 1)) {
      region.c1--;
      changed = true;
    }
    if (region.c2 < MAX_COLS - 1 && colHas(region.c2 + 1)) {
      region.c2++;
      changed = true;
    }
  }
  // Trim an empty leading row or column that was only adjacent to the data.
  const rowFilled = (rr: number): boolean => {
    for (let cc = region.c1; cc <= region.c2; cc++) if (has(rr, cc)) return true;
    return false;
  };
  const colFilled = (cc: number): boolean => {
    for (let rr = region.r1; rr <= region.r2; rr++) if (has(rr, cc)) return true;
    return false;
  };
  while (region.r1 < region.r2 && !rowFilled(region.r1)) region.r1++;
  while (region.r2 > region.r1 && !rowFilled(region.r2)) region.r2--;
  while (region.c1 < region.c2 && !colFilled(region.c1)) region.c1++;
  while (region.c2 > region.c1 && !colFilled(region.c2)) region.c2--;
  return region;
}

/* ------------------------------------------------------------------ merges */

const mergeIndex = new WeakMap<Range[], Map<number, Range[]>>();

function mergesByRow(merges: Range[]): Map<number, Range[]> {
  let index = mergeIndex.get(merges);
  if (index) return index;
  index = new Map();
  for (const m of merges) {
    for (let r = m.r1; r <= m.r2; r++) {
      const list = index.get(r);
      if (list) list.push(m);
      else index.set(r, [m]);
    }
  }
  mergeIndex.set(merges, index);
  return index;
}

export function mergeAt(sheet: Sheet, r: number, c: number): Range | null {
  if (sheet.merges.length === 0) return null;
  return mergesByRow(sheet.merges).get(r)?.find((m) => c >= m.c1 && c <= m.c2) ?? null;
}

/** Expands a range until it fully contains every merge it touches. */
export function expandToMerges(sheet: Sheet, range: Range): Range {
  if (sheet.merges.length === 0) return range;
  let out = range;
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of sheet.merges) {
      if (m.r1 > out.r2 || m.r2 < out.r1 || m.c1 > out.c2 || m.c2 < out.c1) continue;
      if (m.r1 < out.r1 || m.c1 < out.c1 || m.r2 > out.r2 || m.c2 > out.c2) {
        out = { r1: Math.min(out.r1, m.r1), c1: Math.min(out.c1, m.c1), r2: Math.max(out.r2, m.r2), c2: Math.max(out.c2, m.c2) };
        changed = true;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------- names */

const BAD_SHEET_CHARS = /[\\/?*[\]:]/;

/** Returns a problem description, or null when the name can be used. */
export function validateSheetName(wb: Workbook, name: string, ignoreId?: string): string | null {
  const t = name.trim();
  if (!t) return 'Enter a name for the sheet.';
  if (t.length > 31) return 'Sheet names can have at most 31 characters.';
  if (BAD_SHEET_CHARS.test(t)) return 'Sheet names cannot contain \\ / ? * [ ] or :';
  if (t.startsWith("'") || t.endsWith("'")) return 'Sheet names cannot start or end with an apostrophe.';
  if (wb.sheets.some((s) => s.id !== ignoreId && s.name.toLowerCase() === t.toLowerCase())) return `A sheet named "${t}" already exists.`;
  return null;
}

export function uniqueSheetName(wb: Workbook, base: string): string {
  const taken = new Set(wb.sheets.map((s) => s.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const suffix = ` (${i})`;
    const name = base.slice(0, 31 - suffix.length) + suffix;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

export function nextSheetName(wb: Workbook): string {
  const taken = new Set(wb.sheets.map((s) => s.name.toLowerCase()));
  for (let i = wb.sheets.length + 1; ; i++) if (!taken.has(`sheet${i}`)) return `Sheet${i}`;
}
