/** JSON codec for workbooks, used by storage, share links and file export. */
import { errorFromCode } from '@/formulas/values';
import { CellError, type AxisMeta, type Cell, type CellNote, type CellScalar, type CellStyle, type DefinedName, type Sheet, type SheetProps, type Workbook } from '@/types';
import { createSheet, internStyle } from './sheet';

export const FORMAT_VERSION = 1;

type JsonScalar = string | number | boolean | null | { e: string };

interface JsonCell {
  v?: JsonScalar;
  f?: string;
  /** Index into the style table. */
  s?: number;
  n?: CellNote;
  l?: string;
}

type JsonAxis = Omit<AxisMeta, 'style'> & { s?: number };

interface JsonSheet extends Partial<Omit<SheetProps, 'filterHidden'>> {
  id: string;
  name: string;
  filterHidden?: number[];
  cells: [number, JsonCell][];
  rows: [number, JsonAxis][];
  cols: [number, JsonAxis][];
}

export interface JsonWorkbook {
  format: 'tessera';
  version: number;
  id: string;
  name: string;
  themeId: string;
  names: DefinedName[];
  styles: CellStyle[];
  sheets: JsonSheet[];
}

const encode = (v: CellScalar): JsonScalar => (v instanceof CellError ? { e: v.code } : v);
const decode = (v: JsonScalar): CellScalar => (v !== null && typeof v === 'object' ? errorFromCode(v.e) : v);

export function serializeWorkbook(wb: Workbook): JsonWorkbook {
  const styles: CellStyle[] = [];
  const index = new Map<CellStyle, number>();
  const styleId = (s: CellStyle): number => {
    let i = index.get(s);
    if (i === undefined) {
      i = styles.push(s) - 1;
      index.set(s, i);
    }
    return i;
  };
  const axis = (map: ReadonlyMap<number, AxisMeta>): [number, JsonAxis][] =>
    [...map].map(([i, { style, ...rest }]) => [i, style ? { ...rest, s: styleId(style) } : rest]);

  const sheets = wb.sheets.map((sheet): JsonSheet => {
    const { id, cells, rows, cols, filterHidden, rowCount: _r, colCount: _c, ...props } = sheet;
    return {
      ...props,
      id,
      filterHidden: [...filterHidden],
      cells: [...cells].map(([key, cell]) => {
        const out: JsonCell = {};
        if (cell.v !== undefined) out.v = encode(cell.v);
        if (cell.f !== undefined) out.f = cell.f;
        if (cell.s) out.s = styleId(cell.s);
        if (cell.note) out.n = cell.note;
        if (cell.link) out.l = cell.link;
        return [key, out];
      }),
      rows: axis(rows),
      cols: axis(cols),
    };
  });
  return { format: 'tessera', version: FORMAT_VERSION, id: wb.id, name: wb.name, themeId: wb.themeId, names: wb.names, styles, sheets };
}

export function isWorkbookJson(data: unknown): data is JsonWorkbook {
  const d = data as Partial<JsonWorkbook> | null;
  return typeof d === 'object' && d !== null && d.format === 'tessera' && Array.isArray(d.sheets) && d.sheets.length > 0;
}

export function deserializeWorkbook(json: JsonWorkbook): Workbook {
  if (!isWorkbookJson(json)) throw new Error('This file is not a Tessera workbook.');
  if (json.version > FORMAT_VERSION) throw new Error('This workbook was saved by a newer version of Tessera.');
  const styles = json.styles.map((s) => internStyle(s));
  const axis = (list: [number, JsonAxis][]): Map<number, AxisMeta> =>
    new Map(list.map(([i, { s, ...rest }]) => [i, s === undefined ? rest : { ...rest, style: styles[s] }]));
  return {
    id: json.id,
    name: json.name,
    themeId: json.themeId,
    names: json.names ?? [],
    sheets: json.sheets.map(({ cells, rows, cols, filterHidden, ...props }): Sheet =>
      createSheet(props.name, {
        ...props,
        filterHidden: new Set(filterHidden ?? []),
        cells: new Map(
          cells.map(([key, c]) => {
            const cell: Cell = {};
            if (c.v !== undefined) cell.v = decode(c.v);
            if (c.f !== undefined) cell.f = c.f;
            if (c.s !== undefined) cell.s = styles[c.s];
            if (c.n) cell.note = c.n;
            if (c.l) cell.link = c.l;
            return [key, cell];
          }),
        ),
        rows: axis(rows),
        cols: axis(cols),
      }),
    ),
  };
}
