/** Resolves the style a cell is drawn with: table, then own, then conditional. */
import type { CellStyle, Sheet, TableDef } from '@/types';
import type { ConditionalResult } from './conditional';
import { baseStyle, internStyle } from './sheet';
import { tableStyle, type TableStyle, type WorkbookTheme } from './themes';

const EMPTY: CellStyle = Object.freeze({});
const combos = new WeakMap<CellStyle, WeakMap<CellStyle, CellStyle>>();

/** Layers `over` on top of `under`. Results are cached per pair of shared style objects. */
export function layer(under: CellStyle | undefined, over: CellStyle | undefined): CellStyle | undefined {
  if (!under) return over;
  if (!over) return under;
  let inner = combos.get(under);
  if (!inner) combos.set(under, (inner = new WeakMap()));
  let hit = inner.get(over);
  if (!hit) {
    hit = internStyle({ ...under, ...over }) ?? EMPTY;
    inner.set(over, hit);
  }
  return hit;
}

const tableCache = new Map<string, TableStyle>();

export function resolvedTableStyle(id: string, theme: WorkbookTheme): TableStyle {
  const key = `${theme.id}/${id}`;
  let style = tableCache.get(key);
  if (!style) {
    const raw = tableStyle(id, theme);
    const keep = (s: CellStyle): CellStyle => internStyle(s) ?? EMPTY;
    style = { id, header: keep(raw.header), band: keep(raw.band), body: keep(raw.body), total: keep(raw.total), firstColumn: keep(raw.firstColumn) };
    tableCache.set(key, style);
  }
  return style;
}

export function tableLayer(table: TableDef, r: number, c: number, theme: WorkbookTheme): CellStyle | undefined {
  const style = resolvedTableStyle(table.styleId, theme);
  if (table.headerRow && r === table.range.r1) return style.header;
  if (table.totalRow && r === table.range.r2) return style.total;
  const index = r - table.range.r1 - (table.headerRow ? 1 : 0);
  const body = table.bandedRows && index % 2 === 1 ? style.band : style.body;
  return table.firstColumn && c === table.range.c1 ? layer(body, style.firstColumn) : body;
}

export function effectiveStyle(sheet: Sheet, r: number, c: number, theme: WorkbookTheme, cond?: ConditionalResult | null): CellStyle | undefined {
  let style = baseStyle(sheet, r, c);
  for (const t of sheet.tables) {
    if (r >= t.range.r1 && r <= t.range.r2 && c >= t.range.c1 && c <= t.range.c2) {
      style = layer(tableLayer(t, r, c, theme), style);
      break;
    }
  }
  return cond?.style ? layer(style, cond.style) : style;
}
