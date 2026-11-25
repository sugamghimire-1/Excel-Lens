/** Data-validation checks. */
import type { CalcEngine } from '@/formulas/calcEngine';
import { isError, Matrix, parseDateText, parseNumberText, toBool, toText, type Scalar } from '@/formulas/values';
import type { Sheet, ValidationRule } from '@/types';
import { inRange } from './address';
import { compareWith } from './conditional';
import { formatValue } from './numberFormat';
import { baseStyle } from './sheet';

export function validationAt(sheet: Sheet, r: number, c: number): ValidationRule | null {
  for (let i = sheet.validations.length - 1; i >= 0; i--) {
    const rule = sheet.validations[i];
    if (inRange(rule.range, r, c)) return rule;
  }
  return null;
}

/** Choices offered by a list rule. */
export function listOptions(rule: ValidationRule, sheet: Sheet, engine: CalcEngine): string[] {
  if (rule.kind.type !== 'list') return [];
  const { source } = rule.kind;
  if (!source.startsWith('=')) {
    return source
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const out = engine.evaluateFormula(sheet.id, rule.range.r1, rule.range.c1, source);
  const values = out instanceof Matrix ? out.rows.flat() : [out];
  const seen = new Set<string>();
  for (const v of values) {
    if (v === null || v === '' || isError(v)) continue;
    seen.add(typeof v === 'number' ? formatValue(v, undefined).text : (toText(v) as string));
  }
  return [...seen];
}

function bound(text: string | undefined, rule: ValidationRule, sheet: Sheet, engine: CalcEngine, r: number, c: number): Scalar {
  if (text === undefined || text === '') return null;
  if (text.startsWith('=')) {
    const out = engine.evaluateFormula(sheet.id, r, c, text, r - rule.range.r1, c - rule.range.c1);
    return out instanceof Matrix ? out.at(0, 0) : out;
  }
  return parseNumberText(text) ?? parseDateText(text)?.serial ?? text;
}

/** True when a value is allowed by the rule. */
export function isValid(rule: ValidationRule, value: Scalar, sheet: Sheet, engine: CalcEngine, r: number, c: number): boolean {
  if (value === null || value === '') return !rule.required;
  const { kind } = rule;
  switch (kind.type) {
    case 'any':
      return true;
    case 'list': {
      const shown = isError(value) ? value.code : typeof value === 'number' ? formatValue(value, undefined).text : (toText(value) as string);
      return listOptions(rule, sheet, engine).some((o) => o.toLowerCase() === shown.toLowerCase());
    }
    case 'whole':
    case 'decimal':
    case 'date': {
      if (typeof value !== 'number') return false;
      if (kind.type === 'whole' && !Number.isInteger(value)) return false;
      return compareWith(kind.op, value, bound(kind.a, rule, sheet, engine, r, c), bound(kind.b, rule, sheet, engine, r, c));
    }
    case 'textLength': {
      const t = isError(value) ? value.code : (toText(value) as string);
      return compareWith(kind.op, t.length, bound(kind.a, rule, sheet, engine, r, c), bound(kind.b, rule, sheet, engine, r, c));
    }
    case 'custom': {
      const f = kind.formula.startsWith('=') ? kind.formula : `=${kind.formula}`;
      const out = engine.evaluateFormula(sheet.id, r, c, f, r - rule.range.r1, c - rule.range.c1);
      return toBool(out instanceof Matrix ? out.at(0, 0) : out) === true;
    }
  }
}

const OP_TEXT = {
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
  eq: 'equal to',
  neq: 'not equal to',
  between: 'between',
  notBetween: 'not between',
} as const;

/** Default message when the rule has no custom error text. */
export function validationMessage(rule: ValidationRule): string {
  if (rule.errorMessage) return rule.errorMessage;
  const { kind } = rule;
  switch (kind.type) {
    case 'list':
      return 'Choose one of the items in the list.';
    case 'whole':
    case 'decimal':
    case 'date':
    case 'textLength': {
      const what = { whole: 'a whole number', decimal: 'a number', date: 'a date', textLength: 'text with a length' }[kind.type];
      const tail = kind.op === 'between' || kind.op === 'notBetween' ? `${kind.a} and ${kind.b ?? ''}` : kind.a;
      return `Enter ${what} ${OP_TEXT[kind.op]} ${tail}.`;
    }
    case 'custom':
      return 'This value does not meet the rule for this cell.';
    case 'any':
      return 'This cell needs a value.';
  }
}

/** Cells in a sheet that break their validation rule (used by "Circle invalid data"). */
export function invalidAt(sheet: Sheet, engine: CalcEngine, r: number, c: number): boolean {
  const rule = validationAt(sheet, r, c);
  if (!rule) return false;
  return !isValid(rule, engine.readCell(sheet.id, r, c), sheet, engine, r, c);
}

export function displayText(sheet: Sheet, engine: CalcEngine, r: number, c: number): string {
  return formatValue(engine.readCell(sheet.id, r, c), baseStyle(sheet, r, c)?.numFmt).text;
}
