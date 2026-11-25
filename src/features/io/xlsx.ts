/** Excel workbook import and export. Loads ExcelJS and JSZip on demand. */
import type ExcelJS from 'exceljs';
import { cellKey, cellName, keyCol, keyRow, MAX_COLS, MAX_ROWS, parseRangeName, rangeName } from '@/engine/address';
import { DEFAULT_COL_WIDTH } from '@/engine/axis';
import { effectiveStyle } from '@/engine/effective';
import { DEFAULT_FONT, DEFAULT_FONT_SIZE, PT } from '@/engine/measure';
import { CHECKBOX_FORMAT } from '@/engine/numberFormat';
import { compactCell, createSheet, internStyle } from '@/engine/sheet';
import { mix, themeById } from '@/engine/themes';
import { CalcEngine, tokenize } from '@/formulas';
import { errorFromCode, dateToSerial } from '@/formulas/values';
import { CellError, type AxisMeta, type BorderEdge, type BorderLine, type Cell, type CellStyle, type CompareOp, type ConditionalKind, type ConditionalRule, type DefinedName, type Range, type Sheet, type ValidationKind, type ValidationRule, type Workbook } from '@/types';
import { APP_NAME } from '@/utils/brand';
import { uid } from '@/utils/id';
import { readCharts, writeCharts } from './xlsxCharts';

/** Functions newer than the original file format need a prefix inside files. */
const PREFIXED = new Set(
  'CONCAT TEXTJOIN IFS SWITCH MAXIFS MINIFS XLOOKUP XMATCH FILTER SORT SORTBY UNIQUE SEQUENCE RANDARRAY LET TEXTBEFORE TEXTAFTER TEXTSPLIT VSTACK HSTACK TOCOL TOROW TAKE DROP CHOOSECOLS CHOOSEROWS XOR IFNA STDEV.S STDEV.P VAR.S VAR.P MODE.SNGL PERCENTILE.INC QUARTILE.INC PERCENTRANK.INC RANK.EQ NORM.DIST NORM.S.DIST FORECAST.LINEAR NUMBERVALUE UNICHAR UNICODE FORMULATEXT ISFORMULA ISOWEEKNUM DAYS BASE DECIMAL CEILING.MATH FLOOR.MATH RRI AGGREGATE ARRAYTOTEXT REGEXTEST REGEXEXTRACT REGEXREPLACE'.split(' '),
);

export function toFileFormula(formula: string): string {
  let out = '';
  let last = formula.startsWith('=') ? 1 : 0;
  for (const t of tokenize(formula)) {
    if (t.type !== 'func') continue;
    const upper = t.text.toUpperCase();
    if (!PREFIXED.has(upper)) continue;
    out += formula.slice(last, t.start) + (upper === 'FILTER' || upper === 'SORT' ? '_xlfn._xlws.' : '_xlfn.') + upper;
    last = t.end;
  }
  return out + formula.slice(last);
}

export function fromFileFormula(formula: string): string {
  return `=${formula.replace(/_xlfn\.(?:_xlws\.)?/gi, '').replace(/_xlws\./gi, '')}`;
}

const argb = (hex: string): string => `FF${hex.replace('#', '').toUpperCase()}`;

/* ------------------------------------------------------------------ export */

const LINE_OUT: Record<BorderLine, ExcelJS.BorderStyle> = { thin: 'thin', medium: 'medium', thick: 'thick', dashed: 'dashed', dotted: 'dotted', double: 'double' };

function styleOut(s: CellStyle): Partial<ExcelJS.Style> {
  const out: Partial<ExcelJS.Style> = {};
  out.font = {
    name: s.fontFamily ?? 'Calibri',
    size: s.fontSize ?? DEFAULT_FONT_SIZE,
    ...(s.bold ? { bold: true } : {}),
    ...(s.italic ? { italic: true } : {}),
    ...(s.underline ? { underline: true } : {}),
    ...(s.strike ? { strike: true } : {}),
    ...(s.color ? { color: { argb: argb(s.color) } } : {}),
  };
  if (s.fill) out.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(s.fill) } };
  if (s.hAlign || s.vAlign || s.wrap || s.indent) {
    out.alignment = {
      ...(s.hAlign ? { horizontal: s.hAlign } : {}),
      ...(s.vAlign ? { vertical: s.vAlign } : {}),
      ...(s.wrap ? { wrapText: true } : {}),
      ...(s.indent ? { indent: s.indent } : {}),
    };
  }
  const b = (e: BorderEdge | undefined): Partial<ExcelJS.Border> | undefined => (e ? { style: LINE_OUT[e.style], color: { argb: argb(e.color) } } : undefined);
  if (s.borderTop || s.borderRight || s.borderBottom || s.borderLeft) out.border = { top: b(s.borderTop), right: b(s.borderRight), bottom: b(s.borderBottom), left: b(s.borderLeft) };
  if (s.numFmt && s.numFmt !== CHECKBOX_FORMAT) out.numFmt = s.numFmt;
  return out;
}

const OP_OUT: Record<CompareOp, string> = { gt: 'greaterThan', gte: 'greaterThanOrEqual', lt: 'lessThan', lte: 'lessThanOrEqual', eq: 'equal', neq: 'notEqual', between: 'between', notBetween: 'notBetween' };
const OP_IN = Object.fromEntries(Object.entries(OP_OUT).map(([k, v]) => [v, k])) as Record<string, CompareOp>;

function operandOut(text: string): string {
  if (text.startsWith('=')) return toFileFormula(text);
  return text !== '' && Number.isFinite(Number(text)) ? text : `"${text.replace(/"/g, '""')}"`;
}

function ruleOut(rule: ConditionalRule, priority: number): Record<string, unknown> {
  const { kind } = rule;
  const first = rule.ranges[0];
  const anchor = cellName(first.r1, first.c1);
  const style: Record<string, unknown> = {};
  if (rule.style) {
    const s = styleOut(rule.style);
    if (rule.style.color || rule.style.bold || rule.style.italic || rule.style.underline || rule.style.strike) {
      const { name: _n, size: _s, ...font } = s.font as ExcelJS.Font;
      style.font = font;
    }
    if (rule.style.fill) style.fill = { type: 'pattern', pattern: 'solid', bgColor: { argb: argb(rule.style.fill) } };
    if (s.border) style.border = s.border;
  }
  const base = { priority, style, ...(rule.stopIfTrue ? { stopIfTrue: true } : {}) };
  const expr = (f: string): Record<string, unknown> => ({ ...base, type: 'expression', formulae: [f] });
  switch (kind.type) {
    case 'compare':
      return { ...base, type: 'cellIs', operator: OP_OUT[kind.op], formulae: [operandOut(kind.a), ...(kind.b !== undefined && /etween/.test(kind.op) ? [operandOut(kind.b)] : [])] };
    case 'text': {
      const q = `"${kind.text.replace(/"/g, '""')}"`;
      if (kind.op === 'contains') return expr(`NOT(ISERROR(SEARCH(${q},${anchor})))`);
      if (kind.op === 'notContains') return expr(`ISERROR(SEARCH(${q},${anchor}))`);
      return expr(kind.op === 'begins' ? `LEFT(${anchor},${kind.text.length})=${q}` : `RIGHT(${anchor},${kind.text.length})=${q}`);
    }
    case 'duplicate':
      return expr(`COUNTIF(${rangeName(first, true)},${anchor})${kind.unique ? '=1' : '>1'}`);
    case 'rank':
      return { ...base, type: 'top10', rank: kind.count, percent: kind.percent ?? false, bottom: kind.bottom ?? false };
    case 'average':
      return { ...base, type: 'aboveAverage', aboveAverage: !kind.below };
    case 'blank':
      return expr(`LEN(TRIM(${anchor}))${kind.not ? '>0' : '=0'}`);
    case 'error':
      return expr(kind.not ? `NOT(ISERROR(${anchor}))` : `ISERROR(${anchor})`);
    case 'formula':
      return expr(toFileFormula(kind.formula));
    case 'scale':
      return {
        priority,
        type: 'colorScale',
        cfvo: kind.colors.length === 2 ? [{ type: 'min' }, { type: 'max' }] : [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }],
        color: kind.colors.map((c) => ({ argb: argb(c) })),
      };
    case 'bar':
      return { priority, type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: argb(kind.color) }, gradient: false };
    case 'icons':
      return {
        priority,
        type: 'iconSet',
        iconSet: kind.set === 'arrows' ? '3Arrows' : kind.set === 'lights' ? '3TrafficLights' : '3Flags',
        reverse: kind.reverse ?? false,
        cfvo: [{ type: 'percent', value: 0 }, { type: 'percent', value: 33 }, { type: 'percent', value: 67 }],
      };
  }
}

function validationOut(rule: ValidationRule): ExcelJS.DataValidation | null {
  const { kind } = rule;
  const shared = {
    allowBlank: !rule.required,
    showErrorMessage: true,
    showInputMessage: Boolean(rule.inputMessage),
    errorStyle: rule.errorStyle === 'info' ? 'information' : rule.errorStyle,
    ...(rule.errorTitle ? { errorTitle: rule.errorTitle } : {}),
    ...(rule.errorMessage ? { error: rule.errorMessage } : {}),
    ...(rule.inputTitle ? { promptTitle: rule.inputTitle } : {}),
    ...(rule.inputMessage ? { prompt: rule.inputMessage } : {}),
  };
  const bound = (t: string): string | number => {
    if (t.startsWith('=')) return toFileFormula(t);
    return Number.isFinite(Number(t)) && t !== '' ? Number(t) : t;
  };
  switch (kind.type) {
    case 'list':
      return { ...shared, type: 'list', formulae: [kind.source.startsWith('=') ? toFileFormula(kind.source) : `"${kind.source.split(',').map((x) => x.trim()).join(',')}"`] } as ExcelJS.DataValidation;
    case 'custom':
      return { ...shared, type: 'custom', formulae: [toFileFormula(kind.formula.startsWith('=') ? kind.formula : `=${kind.formula}`)] } as ExcelJS.DataValidation;
    case 'any':
      return null;
    case 'date': {
      const day = (t: string): unknown => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
        return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : bound(t);
      };
      return { ...shared, type: 'date', operator: OP_OUT[kind.op], formulae: [day(kind.a), ...(kind.b ? [day(kind.b)] : [])] } as ExcelJS.DataValidation;
    }
    default:
      return { ...shared, type: kind.type, operator: OP_OUT[kind.op], formulae: [bound(kind.a), ...(kind.b ? [bound(kind.b)] : [])] } as ExcelJS.DataValidation;
  }
}

const scalarOut = (v: unknown): ExcelJS.CellValue => (v instanceof CellError ? ({ error: v.code === '#CIRC!' || v.code === '#SPILL!' || v.code === '#CALC!' ? '#VALUE!' : v.code } as ExcelJS.CellErrorValue) : ((v ?? null) as ExcelJS.CellValue));

export async function exportXlsx(wb: Workbook, engine: CalcEngine): Promise<Uint8Array> {
  const [{ default: Excel }, { default: Zip }] = await Promise.all([import('exceljs'), import('jszip')]);
  const book = new Excel.Workbook();
  book.creator = APP_NAME;
  book.created = new Date();
  const theme = themeById(wb.themeId);

  for (const sheet of wb.sheets) {
    const ws = book.addWorksheet(sheet.name, {
      state: sheet.hidden ? 'hidden' : 'visible',
      properties: { defaultRowHeight: 22 / PT, ...(sheet.tabColor ? { tabColor: { argb: argb(sheet.tabColor) } } : {}) } as Partial<ExcelJS.WorksheetProperties>,
      views: [
        {
          ...(sheet.frozenRows || sheet.frozenCols ? { state: 'frozen', xSplit: sheet.frozenCols, ySplit: sheet.frozenRows } : { state: 'normal' }),
          showGridLines: sheet.showGridlines,
          zoomScale: Math.round(sheet.zoom * 100),
        } as ExcelJS.WorksheetView,
      ],
    });
    (ws.properties as { defaultColWidth?: number }).defaultColWidth = (DEFAULT_COL_WIDTH - 5) / 7;
    for (const [c, meta] of sheet.cols) {
      const col = ws.getColumn(c + 1);
      if (meta.size !== undefined) col.width = Math.max(0.5, (meta.size - 5) / 7);
      if (meta.hidden) col.hidden = true;
      if (meta.style) Object.assign(col, { style: styleOut(meta.style) });
    }
    for (const [r, meta] of sheet.rows) {
      const row = ws.getRow(r + 1);
      if (meta.size !== undefined) row.height = meta.size / PT;
      if (meta.hidden) row.hidden = true;
      if (meta.style) Object.assign(row, styleOut(meta.style));
    }
    for (const r of sheet.filterHidden) ws.getRow(r + 1).hidden = true;

    const write = (r: number, c: number, cell: Cell | undefined): void => {
      const target = ws.getCell(r + 1, c + 1);
      if (cell?.f !== undefined) {
        const value = scalarOut(engine.readCell(sheet.id, r, c));
        const spill = engine.spillAt(sheet.id, r, c);
        target.value = (spill ? { formula: toFileFormula(cell.f), result: value, shareType: 'array', ref: rangeName(spill.range) } : { formula: toFileFormula(cell.f), result: value }) as ExcelJS.CellValue;
      } else if (cell?.link && typeof cell.v === 'string') {
        target.value = { text: cell.v, hyperlink: cell.link.startsWith('#') ? cell.link : cell.link };
      } else if (cell?.v !== undefined) target.value = scalarOut(cell.v);
      const style = effectiveStyle(sheet, r, c, theme);
      if (style) target.style = styleOut(style);
      if (cell?.note) target.note = { texts: [{ text: cell.note.text }] };
    };
    for (const [key, cell] of sheet.cells) write(keyRow(key), keyCol(key), cell);
    // Table styling covers blank cells too.
    for (const t of sheet.tables) {
      if ((t.range.r2 - t.range.r1 + 1) * (t.range.c2 - t.range.c1 + 1) > 200_000) continue;
      for (let r = t.range.r1; r <= t.range.r2; r++) for (let c = t.range.c1; c <= t.range.c2; c++) if (!sheet.cells.has(cellKey(r, c))) write(r, c, undefined);
    }
    for (const m of sheet.merges) ws.mergeCells(m.r1 + 1, m.c1 + 1, m.r2 + 1, m.c2 + 1);
    if (sheet.filter) ws.autoFilter = rangeName(sheet.filter.range);
    sheet.conditional.forEach((rule, i) => {
      ws.addConditionalFormatting({ ref: rule.ranges.map((r) => rangeName(r)).join(' '), rules: [ruleOut(rule, i + 1) as unknown as ExcelJS.ConditionalFormattingRule] });
    });
    const dv = (ws as unknown as { dataValidations: { add(address: string, v: ExcelJS.DataValidation): void } }).dataValidations;
    for (const rule of sheet.validations) {
      const v = validationOut(rule);
      if (v) dv.add(rangeName(rule.range), v);
    }
    if (sheet.protected) await ws.protect('', { selectLockedCells: true, selectUnlockedCells: true });
  }
  for (const n of wb.names) {
    if (/^('[^']+'|[\w.]+)!\$[A-Z]+\$\d+(:\$[A-Z]+\$\d+)?$/.test(n.ref)) book.definedNames.add(n.ref, n.name);
  }
  const buffer = await book.xlsx.writeBuffer();
  if (!wb.sheets.some((s) => s.charts.length)) return new Uint8Array(buffer as ArrayBuffer);
  const zip = await Zip.loadAsync(buffer as ArrayBuffer);
  await writeCharts(zip, wb, engine, wb.sheets.map((_, i) => `xl/worksheets/sheet${i + 1}.xml`));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/* ------------------------------------------------------------------ import */

const OFFICE_THEME = ['#ffffff', '#000000', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#0563c1', '#954f72'];
const INDEXED = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];

type Color = Partial<ExcelJS.Color> & { tint?: number; indexed?: number };

function makeColorReader(theme: string[]): (c: Color | undefined) => string | undefined {
  return (c) => {
    if (!c) return undefined;
    if (c.argb && /^[0-9a-f]{8}$/i.test(c.argb)) return `#${c.argb.slice(2).toLowerCase()}`;
    if (c.argb && /^[0-9a-f]{6}$/i.test(c.argb)) return `#${c.argb.toLowerCase()}`;
    if (c.theme !== undefined) {
      const base = theme[c.theme] ?? '#000000';
      const tint = c.tint ?? 0;
      return tint === 0 ? base : tint > 0 ? mix(base, '#ffffff', tint) : mix(base, '#000000', -tint);
    }
    if (c.indexed !== undefined && c.indexed < 64) return INDEXED[c.indexed % 8];
    return undefined;
  };
}

const LINE_IN: Record<string, BorderLine> = { thin: 'thin', hair: 'dotted', dotted: 'dotted', dashed: 'dashed', dashDot: 'dashed', dashDotDot: 'dashed', mediumDashed: 'dashed', mediumDashDot: 'dashed', mediumDashDotDot: 'dashed', slantDashDot: 'dashed', medium: 'medium', thick: 'thick', double: 'double' };
const DEFAULT_FONTS = new Set(['Calibri', 'Aptos', 'Aptos Narrow', DEFAULT_FONT]);

function styleIn(s: Partial<ExcelJS.Style> | undefined, color: (c: Color | undefined) => string | undefined): CellStyle | undefined {
  if (!s) return undefined;
  const out: CellStyle = {};
  const { font, fill, alignment, border, numFmt } = s;
  if (font) {
    if (font.name && !DEFAULT_FONTS.has(font.name)) out.fontFamily = font.name;
    if (font.size && font.size !== 11 && font.size !== DEFAULT_FONT_SIZE) out.fontSize = font.size;
    if (font.bold) out.bold = true;
    if (font.italic) out.italic = true;
    if (font.underline && font.underline !== 'none') out.underline = true;
    if (font.strike) out.strike = true;
    const c = color(font.color as Color);
    if (c && c !== '#000000') out.color = c;
  }
  if (fill?.type === 'pattern' && fill.pattern === 'solid') out.fill = color(fill.fgColor as Color);
  if (alignment) {
    if (alignment.horizontal === 'left' || alignment.horizontal === 'center' || alignment.horizontal === 'right') out.hAlign = alignment.horizontal;
    else if (alignment.horizontal === 'centerContinuous') out.hAlign = 'center';
    if (alignment.vertical === 'top' || alignment.vertical === 'middle' || alignment.vertical === 'bottom') out.vAlign = alignment.vertical;
    if (alignment.wrapText) out.wrap = true;
    if (alignment.indent) out.indent = alignment.indent;
  }
  if (border) {
    const e = (b: Partial<ExcelJS.Border> | undefined): BorderEdge | undefined => (b?.style ? { style: LINE_IN[b.style] ?? 'thin', color: color(b.color as Color) ?? '#1b2333' } : undefined);
    out.borderTop = e(border.top);
    out.borderRight = e(border.right);
    out.borderBottom = e(border.bottom);
    out.borderLeft = e(border.left);
  }
  if (numFmt && numFmt !== 'General') out.numFmt = numFmt;
  return internStyle(out);
}

function valueIn(v: ExcelJS.CellValue, ws: ExcelJS.Worksheet, cell: ExcelJS.Cell): Pick<Cell, 'v' | 'f' | 'link'> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return { v };
  if (v instanceof Date) return { v: dateToSerial(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate(), v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds()) };
  const o = v as unknown as Record<string, unknown>;
  if ('error' in o) return { v: errorFromCode(String(o.error)) ?? errorFromCode('#VALUE!')! };
  if ('formula' in o || 'sharedFormula' in o) {
    const f = (cell.formula ?? o.formula) as string | undefined;
    if (f) return { f: fromFileFormula(f) };
    return valueIn(o.result as ExcelJS.CellValue, ws, cell);
  }
  if ('richText' in o) return { v: (o.richText as { text: string }[]).map((t) => t.text).join('') };
  if ('hyperlink' in o) {
    const text = o.text as unknown;
    const shown = typeof text === 'object' && text !== null && 'richText' in text ? (text as { richText: { text: string }[] }).richText.map((t) => t.text).join('') : String(text ?? o.hyperlink);
    const link = String(o.hyperlink);
    return { v: shown, link: /^(https?:|mailto:|#)/i.test(link) ? link : undefined };
  }
  return { v: String(v) };
}

function kindIn(rule: Record<string, unknown>): ConditionalKind | null {
  const formulae = ((rule.formulae as unknown[] | undefined) ?? []).map(String);
  const operand = (t: string | undefined): string => {
    if (t === undefined) return '';
    const m = /^"(.*)"$/s.exec(t);
    if (m) return m[1].replace(/""/g, '"');
    return Number.isFinite(Number(t)) ? t : fromFileFormula(t);
  };
  switch (rule.type) {
    case 'cellIs': {
      const op = OP_IN[String(rule.operator)];
      return op ? { type: 'compare', op, a: operand(formulae[0]), b: formulae[1] === undefined ? undefined : operand(formulae[1]) } : null;
    }
    case 'containsText':
      return rule.text ? { type: 'text', op: 'contains', text: String(rule.text) } : formulae[0] ? { type: 'formula', formula: fromFileFormula(formulae[0]) } : null;
    case 'top10':
      return { type: 'rank', count: Number(rule.rank ?? 10), percent: Boolean(rule.percent), bottom: Boolean(rule.bottom) };
    case 'aboveAverage':
      return { type: 'average', below: rule.aboveAverage === false };
    case 'duplicateValues':
      return { type: 'duplicate' };
    case 'uniqueValues':
      return { type: 'duplicate', unique: true };
    case 'colorScale': {
      const colors = ((rule.color as { argb?: string }[] | undefined) ?? []).flatMap((c) => (c.argb ? [`#${c.argb.slice(-6).toLowerCase()}`] : []));
      return colors.length >= 2 ? { type: 'scale', colors: colors.slice(0, 3) } : null;
    }
    case 'dataBar': {
      const c = (rule.color as { argb?: string } | undefined)?.argb;
      return { type: 'bar', color: c ? `#${c.slice(-6).toLowerCase()}` : '#2457d6' };
    }
    case 'iconSet': {
      const set = String(rule.iconSet ?? '');
      return { type: 'icons', set: /Light|Sign|Symbol/.test(set) ? 'lights' : /Flag/.test(set) ? 'flags' : 'arrows', reverse: Boolean(rule.reverse) };
    }
    case 'expression': {
      const f = formulae[0];
      if (!f) return null;
      const dup = /^COUNTIF\(\$[A-Z]+\$\d+(?::\$[A-Z]+\$\d+)?,[A-Z]+\d+\)(>1|=1)$/.exec(f);
      if (dup) return { type: 'duplicate', unique: dup[1] === '=1' };
      const text = /^(NOT\()?ISERROR\(SEARCH\("((?:[^"]|"")*)",[A-Z]+\d+\)\)\)?$/.exec(f);
      if (text) return { type: 'text', op: text[1] ? 'contains' : 'notContains', text: text[2].replace(/""/g, '"') };
      const blank = /^LEN\(TRIM\([A-Z]+\d+\)\)(=0|>0)$/.exec(f);
      if (blank) return { type: 'blank', not: blank[1] === '>0' };
      if (/^ISERROR\([A-Z]+\d+\)$/.test(f)) return { type: 'error' };
      return { type: 'formula', formula: fromFileFormula(f) };
    }
    default:
      return null;
  }
}

function validationIn(dv: ExcelJS.DataValidation): Omit<ValidationRule, 'id' | 'range'> | null {
  const f = (dv.formulae ?? []) as unknown[];
  const bound = (v: unknown): string => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const t = String(v ?? '');
    return t === '' || Number.isFinite(Number(t)) ? t : fromFileFormula(t);
  };
  const op = OP_IN[String(dv.operator ?? 'between')] ?? 'between';
  let kind: ValidationKind;
  switch (dv.type as string) {
    case 'list': {
      const src = String(f[0] ?? '');
      kind = { type: 'list', source: src.startsWith('"') ? src.slice(1, -1) : fromFileFormula(src) };
      break;
    }
    case 'custom':
      kind = { type: 'custom', formula: fromFileFormula(String(f[0] ?? '')) };
      break;
    case 'whole':
    case 'decimal':
    case 'date':
    case 'textLength':
      kind = { type: dv.type as 'whole', op, a: bound(f[0]), b: f[1] === undefined ? undefined : bound(f[1]) };
      break;
    default:
      return null;
  }
  const style = String((dv as { errorStyle?: string }).errorStyle ?? 'stop');
  return {
    kind,
    // The attribute is only written when blanks are allowed.
    required: !dv.allowBlank,
    errorStyle: style === 'warning' ? 'warning' : style === 'information' ? 'info' : 'stop',
    errorTitle: dv.errorTitle,
    errorMessage: dv.error,
    inputTitle: dv.promptTitle,
    inputMessage: dv.prompt,
  };
}

/** Rebuilds rectangles from per-cell validation entries. */
function groupValidations(model: Record<string, ExcelJS.DataValidation>): ValidationRule[] {
  const groups = new Map<string, { dv: ExcelJS.DataValidation; cells: Map<number, number[]>; ranges: Range[] }>();
  for (const [addr, dv] of Object.entries(model)) {
    const range = parseRangeName(addr.replace(/^range:/, ''));
    if (!range) continue;
    const id = JSON.stringify(dv);
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { dv, cells: new Map(), ranges: [] }));
    if (range.r1 !== range.r2 || range.c1 !== range.c2) g.ranges.push(range);
    else {
      const list = g.cells.get(range.c1);
      if (list) list.push(range.r1);
      else g.cells.set(range.c1, [range.r1]);
    }
  }
  const out: ValidationRule[] = [];
  for (const { dv, cells, ranges } of groups.values()) {
    const rule = validationIn(dv);
    if (!rule) continue;
    const runs: Range[] = [...ranges];
    for (const [c, rows] of [...cells].sort((a, b) => a[0] - b[0])) {
      rows.sort((a, b) => a - b);
      for (let i = 0; i < rows.length; ) {
        let j = i;
        while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
        const left = runs.find((r) => r.c2 === c - 1 && r.r1 === rows[i] && r.r2 === rows[j]);
        if (left) left.c2 = c;
        else runs.push({ r1: rows[i], r2: rows[j], c1: c, c2: c });
        i = j + 1;
      }
    }
    for (const range of runs) out.push({ ...rule, id: uid('dv'), range });
  }
  return out;
}

async function themeColors(zip: { file(p: string): { async(t: 'string'): Promise<string> } | null }): Promise<string[]> {
  const xml = await zip.file('xl/theme/theme1.xml')?.async('string');
  const scheme = xml ? /<a:clrScheme[\s\S]*?<\/a:clrScheme>/.exec(xml)?.[0] : undefined;
  if (!scheme) return OFFICE_THEME;
  const pick = (tag: string): string | undefined => {
    const body = new RegExp(`<a:${tag}>([\\s\\S]*?)</a:${tag}>`).exec(scheme)?.[1] ?? '';
    const hex = /srgbClr val="([0-9A-Fa-f]{6})"/.exec(body)?.[1] ?? /lastClr="([0-9A-Fa-f]{6})"/.exec(body)?.[1];
    return hex ? `#${hex.toLowerCase()}` : undefined;
  };
  return ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map((t, i) => pick(t) ?? OFFICE_THEME[i]);
}

export interface ImportResult {
  workbook: Workbook;
  warnings: string[];
}

export async function importXlsx(data: ArrayBuffer | Uint8Array, name: string): Promise<ImportResult> {
  const [{ default: Excel }, { default: Zip }] = await Promise.all([import('exceljs'), import('jszip')]);
  const book = new Excel.Workbook();
  await book.xlsx.load(data as ArrayBuffer);
  const zip = await Zip.loadAsync(data);
  const color = makeColorReader(await themeColors(zip));
  const warnings: string[] = [];
  let truncated = false;

  const sheets = book.worksheets.map((ws): Sheet => {
    const cells = new Map<number, Cell>();
    const rows = new Map<number, AxisMeta>();
    const cols = new Map<number, AxisMeta>();
    const merges: Range[] = ((ws.model as { merges?: string[] }).merges ?? []).flatMap((m) => parseRangeName(m) ?? []);
    const covered = new Set<number>();
    for (const m of merges) for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(cellKey(r, c));

    ws.eachRow({ includeEmpty: true }, (row, rn) => {
      const r = rn - 1;
      if (r >= MAX_ROWS) {
        truncated = true;
        return;
      }
      const meta: AxisMeta = {};
      if (row.height) {
        meta.size = Math.round(row.height * PT);
        meta.custom = true;
      }
      if (row.hidden) meta.hidden = true;
      if (meta.size !== undefined || meta.hidden) rows.set(r, meta);
      row.eachCell({ includeEmpty: true }, (cell, cn) => {
        const c = cn - 1;
        if (c >= MAX_COLS) {
          truncated = true;
          return;
        }
        const key = cellKey(r, c);
        const isCovered = covered.has(key);
        const content = isCovered ? {} : valueIn(cell.value, ws, cell);
        const raw = cell.note as unknown;
        const noteText = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && 'texts' in raw ? ((raw as { texts?: { text: string }[] }).texts ?? []).map((t) => t.text).join('') : '';
        const out = compactCell({
          ...content,
          s: styleIn(cell.style, color),
          note: noteText && !isCovered ? { text: noteText.replace(/^[^\n:]{1,40}:\n/, ''), author: 'Imported', updated: Date.now() } : undefined,
        });
        if (out) cells.set(key, out);
      });
    });
    (ws.columns ?? []).forEach((col, c) => {
      if (c >= MAX_COLS) return;
      const meta: AxisMeta = {};
      if (col.width) {
        meta.size = Math.round(col.width * 7 + 5);
        meta.custom = true;
      }
      if (col.hidden) meta.hidden = true;
      const style = styleIn(col.style as Partial<ExcelJS.Style>, color);
      if (style) meta.style = style;
      if (Object.keys(meta).length) cols.set(c, meta);
    });

    const view = ws.views?.[0] as (ExcelJS.WorksheetViewFrozen & { zoomScale?: number; showGridLines?: boolean }) | undefined;
    const conditional = ((ws as unknown as { conditionalFormattings?: { ref: string; rules: Record<string, unknown>[] }[] }).conditionalFormattings ?? [])
      .flatMap((cf) =>
        cf.rules.flatMap((rule): (ConditionalRule & { priority: number })[] => {
          const kind = kindIn(rule);
          const ranges = cf.ref.split(/\s+/).flatMap((x) => parseRangeName(x) ?? []);
          if (!kind || !ranges.length) return [];
          const st = rule.style as Partial<ExcelJS.Style> | undefined;
          const style: CellStyle = { ...(styleIn(st, color) ?? {}) };
          const bg = (st?.fill as { bgColor?: Color; fgColor?: Color } | undefined) ?? {};
          const fillColor = color(bg.bgColor) ?? color(bg.fgColor);
          if (fillColor) style.fill = fillColor;
          return [{ id: uid('cf'), ranges, kind, style: internStyle(style), stopIfTrue: Boolean(rule.stopIfTrue) || undefined, priority: Number(rule.priority ?? 99) }];
        }),
      )
      .sort((a, b) => a.priority - b.priority)
      .map(({ priority: _p, ...rule }): ConditionalRule => rule);

    const af = ws.autoFilter as unknown;
    const filterRange = typeof af === 'string' ? parseRangeName(af) : null;
    return createSheet(ws.name, {
      cells,
      rows,
      cols,
      merges,
      hidden: ws.state !== 'visible',
      tabColor: color(ws.properties?.tabColor as Color) ?? null,
      frozenRows: view?.state === 'frozen' ? (view.ySplit ?? 0) : 0,
      frozenCols: view?.state === 'frozen' ? (view.xSplit ?? 0) : 0,
      showGridlines: view?.showGridLines !== false,
      zoom: Math.max(0.25, Math.min(4, (view?.zoomScale ?? 100) / 100)),
      conditional,
      validations: groupValidations(((ws as unknown as { dataValidations?: { model?: Record<string, ExcelJS.DataValidation> } }).dataValidations?.model ?? {})),
      filter: filterRange ? { range: filterRange, criteria: {} } : null,
    });
  });
  if (!sheets.length) throw new Error('The file has no worksheets.');
  if (sheets.every((s) => s.hidden)) sheets[0].hidden = false;
  if (truncated) warnings.push(`Data beyond ${MAX_ROWS.toLocaleString('en-US')} rows or ${MAX_COLS} columns was left out.`);

  const charts = await readCharts(zip, sheets);
  for (const s of sheets) s.charts = charts.get(s.name) ?? [];

  const names: DefinedName[] = [];
  const model = (book.definedNames as unknown as { model?: { name: string; ranges: string[] }[] }).model ?? [];
  for (const n of model) {
    if (n.name.startsWith('_xlnm') || !n.ranges[0]) continue;
    names.push({ name: n.name, ref: n.ranges[0] });
  }
  return { workbook: { id: uid('wb'), name, themeId: 'cobalt', names, sheets }, warnings };
}
