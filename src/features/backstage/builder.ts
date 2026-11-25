/** Small helper for describing template sheets in code. */
import { cellKey, parseCellName, parseRangeName } from '@/engine/address';
import { colAxis, rowAxis } from '@/engine/axis';
import { createChart } from '@/engine/commands/sheets';
import { compactCell, createSheet, internStyle, patchStyle } from '@/engine/sheet';
import type { AxisMeta, Cell, CellStyle, ChartModel, ChartType, ConditionalKind, Range, Sheet, SheetProps, Sparkline, TableDef, ValidationRule } from '@/types';
import { uid } from '@/utils/id';

type Value = string | number | boolean | null;

export const R = (a: string): Range => {
  const r = parseRangeName(a);
  if (!r) throw new Error(`Bad range ${a}`);
  return r;
};

export class SheetBuilder {
  private cells = new Map<number, Cell>();
  private rows = new Map<number, AxisMeta>();
  private cols = new Map<number, AxisMeta>();
  private props: Partial<SheetProps> = {};

  constructor(private readonly name: string) {}

  /** Sets a value or formula, merging the style into the cell. */
  set(addr: string, value: Value, style?: CellStyle): this {
    const p = parseCellName(addr);
    if (!p) throw new Error(`Bad cell ${addr}`);
    return this.at(p.r, p.c, value, style);
  }

  at(r: number, c: number, value: Value, style?: CellStyle): this {
    const key = cellKey(r, c);
    const prev = this.cells.get(key);
    const s = style ? patchStyle(prev?.s, style) : prev?.s;
    const isFormula = typeof value === 'string' && value.startsWith('=') && value.length > 1;
    const cell = compactCell({ ...prev, v: isFormula ? undefined : value, f: isFormula ? (value as string) : undefined, s });
    if (cell) this.cells.set(key, cell);
    return this;
  }

  /** Writes a row of values starting at `addr`. */
  row(addr: string, values: Value[], style?: CellStyle): this {
    const p = parseCellName(addr)!;
    values.forEach((v, i) => this.at(p.r, p.c + i, v, style));
    return this;
  }

  style(range: string, style: CellStyle): this {
    const r = R(range);
    for (let i = r.r1; i <= r.r2; i++) {
      for (let j = r.c1; j <= r.c2; j++) {
        const key = cellKey(i, j);
        const prev = this.cells.get(key);
        this.cells.set(key, { ...prev, s: patchStyle(prev?.s, style) });
      }
    }
    return this;
  }

  note(addr: string, text: string): this {
    const p = parseCellName(addr)!;
    const key = cellKey(p.r, p.c);
    this.cells.set(key, { ...this.cells.get(key), note: { text, author: 'Maya Lind', updated: Date.UTC(2026, 10, 18, 9) } });
    return this;
  }

  width(cols: string, px: number): this {
    const r = R(cols.includes(':') ? cols : `${cols}:${cols}`);
    for (let c = r.c1; c <= r.c2; c++) this.cols.set(c, { size: px, custom: true });
    return this;
  }

  height(row: number, px: number): this {
    this.rows.set(row - 1, { size: px, custom: true });
    return this;
  }

  merge(...ranges: string[]): this {
    this.props.merges = [...(this.props.merges ?? []), ...ranges.map(R)];
    return this;
  }

  rule(ranges: string, kind: ConditionalKind, style?: CellStyle): this {
    this.props.conditional = [...(this.props.conditional ?? []), { id: uid('cf'), ranges: ranges.split(' ').map(R), kind, style: style && internStyle(style) }];
    return this;
  }

  validate(range: string, rule: Omit<ValidationRule, 'id' | 'range'>): this {
    this.props.validations = [...(this.props.validations ?? []), { ...rule, id: uid('dv'), range: R(range) }];
    return this;
  }

  table(range: string, styleId: string, options: Partial<TableDef> = {}, filter = false): this {
    const t: TableDef = { id: uid('tb'), name: `Table${(this.props.tables?.length ?? 0) + 1}`, range: R(range), styleId, headerRow: true, bandedRows: true, totalRow: false, firstColumn: false, ...options };
    this.props.tables = [...(this.props.tables ?? []), t];
    if (filter) this.props.filter = { range: t.range, criteria: {} };
    return this;
  }

  sparkline(addr: string, range: string, type: Sparkline['type'], color: string): this {
    const p = parseCellName(addr)!;
    this.props.sparklines = [...(this.props.sparklines ?? []), { id: uid('sp'), r: p.r, c: p.c, range: R(range), type, color }];
    return this;
  }

  /** Places a chart so that it covers a cell range, with an inset. */
  chart(type: ChartType, source: string, area: string, patch: Partial<ChartModel> = {}, inset = 6): this {
    const sheet = this.build();
    const a = R(area);
    const cols = colAxis(sheet);
    const rows = rowAxis(sheet);
    const x = cols.offset(a.c1) + inset;
    const y = rows.offset(a.r1) + inset;
    const base = createChart(type, this.name, R('A1'), { x, y });
    const chart: ChartModel = { ...base, range: source, seriesInRows: false, w: cols.offset(a.c2 + 1) - x - inset, h: rows.offset(a.r2 + 1) - y - inset, ...patch };
    this.props.charts = [...(this.props.charts ?? []), chart];
    return this;
  }

  set_(props: Partial<SheetProps>): this {
    Object.assign(this.props, props);
    return this;
  }

  build(): Sheet {
    return createSheet(this.name, { ...this.props, cells: this.cells, rows: this.rows, cols: this.cols });
  }
}
