/** Public type models for workbooks, sheets, cells, formatting and charts. */

/* ------------------------------------------------------------------ values */

export type ErrorCode =
  | '#DIV/0!'
  | '#VALUE!'
  | '#REF!'
  | '#NAME?'
  | '#N/A'
  | '#NUM!'
  | '#NULL!'
  | '#SPILL!'
  | '#CALC!'
  | '#CIRC!';

export class CellError {
  constructor(readonly code: ErrorCode) {}
  toString(): string {
    return this.code;
  }
}

/** A literal stored in a cell. Error literals such as a typed `#N/A` are kept as `CellError`. */
export type CellScalar = string | number | boolean | null | CellError;

/* --------------------------------------------------------------- geometry */

export interface CellPos {
  r: number;
  c: number;
}

/** Inclusive, zero-based, normalised rectangle. */
export interface Range {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/* ------------------------------------------------------------- formatting */

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';
export type BorderLine = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double';

export interface BorderEdge {
  style: BorderLine;
  color: string;
}

export interface CellStyle {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  fill?: string;
  hAlign?: HAlign;
  vAlign?: VAlign;
  wrap?: boolean;
  indent?: number;
  numFmt?: string;
  borderTop?: BorderEdge;
  borderRight?: BorderEdge;
  borderBottom?: BorderEdge;
  borderLeft?: BorderEdge;
}

export type StylePatch = { [K in keyof CellStyle]?: CellStyle[K] | null };

/* ------------------------------------------------------------------ cells */

export interface CellNote {
  text: string;
  author: string;
  /** Epoch milliseconds. */
  updated: number;
}

/** Cells are immutable: every edit replaces the whole object. */
export interface Cell {
  /** Literal value. Ignored when `f` is present. */
  v?: CellScalar;
  /** Formula source, always starting with `=`. */
  f?: string;
  s?: CellStyle;
  note?: CellNote;
  /** Hyperlink target: a URL, or `#Sheet!A1` for an in-workbook link. */
  link?: string;
}

/* ------------------------------------------------------------------- rows */

export interface AxisMeta {
  size?: number;
  hidden?: boolean;
  /** True when the user set the size, which disables auto-fit. */
  custom?: boolean;
  style?: CellStyle;
}

/* ------------------------------------------------- conditional formatting */

export type CompareOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'between' | 'notBetween';

export type ConditionalKind =
  | { type: 'compare'; op: CompareOp; a: string; b?: string }
  | { type: 'text'; op: 'contains' | 'notContains' | 'begins' | 'ends'; text: string }
  | { type: 'duplicate'; unique?: boolean }
  | { type: 'rank'; bottom?: boolean; count: number; percent?: boolean }
  | { type: 'average'; below?: boolean }
  | { type: 'blank'; not?: boolean }
  | { type: 'error'; not?: boolean }
  | { type: 'formula'; formula: string }
  | { type: 'scale'; colors: string[] }
  | { type: 'bar'; color: string; hideValue?: boolean }
  | { type: 'icons'; set: 'arrows' | 'lights' | 'flags'; reverse?: boolean };

export interface ConditionalRule {
  id: string;
  ranges: Range[];
  kind: ConditionalKind;
  style?: CellStyle;
  stopIfTrue?: boolean;
}

/* -------------------------------------------------------- data validation */

export type ValidationKind =
  | { type: 'any' }
  | { type: 'list'; source: string }
  | { type: 'whole' | 'decimal' | 'date' | 'textLength'; op: CompareOp; a: string; b?: string }
  | { type: 'custom'; formula: string };

export interface ValidationRule {
  id: string;
  range: Range;
  kind: ValidationKind;
  /** When true, blank entries are rejected. */
  required: boolean;
  inputTitle?: string;
  inputMessage?: string;
  errorStyle: 'stop' | 'warning' | 'info';
  errorTitle?: string;
  errorMessage?: string;
}

/* ---------------------------------------------------------------- filters */

export type FilterCriterion =
  | { type: 'values'; hidden: string[] }
  | { type: 'condition'; op: CompareOp | 'contains' | 'notContains' | 'begins' | 'ends' | 'blank' | 'notBlank'; a: string; b?: string }
  | { type: 'top'; count: number; bottom?: boolean };

export interface AutoFilter {
  range: Range;
  /** Keyed by absolute column index. */
  criteria: Record<number, FilterCriterion>;
}

/* ----------------------------------------------------------------- tables */

export interface TableDef {
  id: string;
  name: string;
  range: Range;
  styleId: string;
  headerRow: boolean;
  bandedRows: boolean;
  totalRow: boolean;
  firstColumn: boolean;
}

/* ------------------------------------------------------------- sparklines */

export interface Sparkline {
  id: string;
  r: number;
  c: number;
  range: Range;
  type: 'line' | 'column' | 'winloss';
  color: string;
}

/* ----------------------------------------------------------------- charts */

export type ChartType = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter';

export interface ChartModel {
  id: string;
  type: ChartType;
  title: string;
  /** Data source in A1 notation, optionally sheet-qualified. */
  range: string;
  /** Read series from rows instead of columns. */
  seriesInRows: boolean;
  firstRowHeaders: boolean;
  firstColLabels: boolean;
  stacked: boolean;
  smooth: boolean;
  showLegend: boolean;
  legendPosition: 'top' | 'bottom' | 'right' | 'left';
  showLabels: boolean;
  showGridlines: boolean;
  xTitle: string;
  yTitle: string;
  /** Per-series colours; falls back to the workbook theme palette. */
  colors: string[];
  /** Position in unzoomed sheet pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ----------------------------------------------------------------- sheets */

export interface SheetProps {
  name: string;
  tabColor: string | null;
  hidden: boolean;
  protected: boolean;
  showGridlines: boolean;
  zoom: number;
  frozenRows: number;
  frozenCols: number;
  merges: Range[];
  conditional: ConditionalRule[];
  validations: ValidationRule[];
  filter: AutoFilter | null;
  /** Rows currently hidden by `filter`. Replaced, never mutated. */
  filterHidden: ReadonlySet<number>;
  tables: TableDef[];
  charts: ChartModel[];
  sparklines: Sparkline[];
}

export interface Sheet extends SheetProps {
  readonly id: string;
  rowCount: number;
  colCount: number;
  /** Sparse cells keyed by `cellKey(r, c)`. */
  cells: Map<number, Cell>;
  rows: ReadonlyMap<number, AxisMeta>;
  cols: ReadonlyMap<number, AxisMeta>;
}

/* --------------------------------------------------------------- workbook */

export interface DefinedName {
  name: string;
  /** Formula text without the leading `=`; usually an absolute reference. */
  ref: string;
  comment?: string;
}

export interface Workbook {
  readonly id: string;
  name: string;
  themeId: string;
  names: DefinedName[];
  sheets: Sheet[];
}

/* ------------------------------------------------------------- operations */

/**
 * Every change to a workbook is expressed as a list of these serialisable
 * operations. `applyOp` returns the inverse, which powers undo/redo and is the
 * seam where a real-time collaboration transport can be attached.
 */
export type Op =
  | { t: 'cells'; sheetId: string; set: [key: number, cell: Cell | null][] }
  | { t: 'rows'; sheetId: string; set: [index: number, meta: AxisMeta | null][] }
  | { t: 'cols'; sheetId: string; set: [index: number, meta: AxisMeta | null][] }
  | { t: 'sheet'; sheetId: string; props: Partial<SheetProps> }
  | { t: 'addSheet'; sheet: Sheet; index: number }
  | { t: 'removeSheet'; sheetId: string }
  | { t: 'moveSheet'; sheetId: string; index: number }
  | { t: 'workbook'; props: Partial<Pick<Workbook, 'name' | 'themeId' | 'names'>> }
  | { t: 'structure'; sheetId: string; axis: 'row' | 'col'; kind: 'insert' | 'delete'; index: number; count: number }
  | { t: 'restore'; sheets: Sheet[]; names: DefinedName[] };

export interface SelectionState {
  /** The active (editable) cell. */
  active: CellPos;
  /** All selected rectangles; the last one is the one being extended. */
  ranges: Range[];
}

export interface Transaction {
  id: string;
  label: string;
  at: number;
  ops: Op[];
  inverse: Op[];
  sheetId: string;
  before: SelectionState | null;
  after: SelectionState | null;
}
