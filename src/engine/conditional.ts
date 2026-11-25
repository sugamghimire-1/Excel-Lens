/** Conditional-format evaluation with per-recalculation caching. */
import type { CalcEngine } from '@/formulas/calcEngine';
import { compareScalars, isError, Matrix, parseNumberText, scalarsEqual, toBool, toText, type Scalar } from '@/formulas/values';
import type { CellStyle, CompareOp, ConditionalRule, Range, Sheet } from '@/types';
import { inRange } from './address';
import { parseInput } from './input';
import { clipToContent, internStyle } from './sheet';
import { mix } from './themes';

export interface ConditionalResult {
  style?: CellStyle;
  bar?: { color: string; from: number; to: number; negative: boolean; hideValue: boolean };
  icon?: { set: 'arrows' | 'lights' | 'flags'; level: 0 | 1 | 2 };
}

interface RuleStats {
  counts?: Map<string, number>;
  sorted?: number[];
  min?: number;
  max?: number;
  mean?: number;
}

export function compareWith(op: CompareOp, v: Scalar, a: Scalar, b: Scalar): boolean {
  if (v === null || isError(v) || isError(a)) return false;
  // Numbers never match text operands, mirroring cell comparisons.
  if (typeof v !== typeof a && a !== null) {
    return op === 'neq';
  }
  switch (op) {
    case 'gt':
      return compareScalars(v, a) > 0;
    case 'gte':
      return compareScalars(v, a) >= 0;
    case 'lt':
      return compareScalars(v, a) < 0;
    case 'lte':
      return compareScalars(v, a) <= 0;
    case 'eq':
      return scalarsEqual(v, a);
    case 'neq':
      return !scalarsEqual(v, a);
    case 'between':
    case 'notBetween': {
      const [lo, hi] = compareScalars(a, b) <= 0 ? [a, b] : [b, a];
      const inside = compareScalars(v, lo) >= 0 && compareScalars(v, hi) <= 0;
      return op === 'between' ? inside : !inside;
    }
  }
}

const valueKey = (v: Scalar): string => (typeof v === 'string' ? `s:${v.toLowerCase()}` : `${typeof v}:${String(v)}`);

/**
 * Evaluates conditional formats for one sheet. Create a new instance whenever
 * the sheet's rules change; statistics are refreshed when values change.
 */
export class ConditionalEvaluator {
  private stats = new Map<string, RuleStats>();
  private cache = new Map<number, ConditionalResult | null>();
  private version = -1;

  constructor(
    private readonly sheet: Sheet,
    private readonly engine: CalcEngine,
  ) {}

  get empty(): boolean {
    return this.sheet.conditional.length === 0;
  }

  evaluate(r: number, c: number, sheet: Sheet): ConditionalResult | null {
    if (sheet.conditional.length === 0) return null;
    if (this.version !== this.engine.version) {
      this.stats.clear();
      this.cache.clear();
      this.version = this.engine.version;
    }
    const key = r * 16_384 + c;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const out = this.compute(r, c, sheet);
    this.cache.set(key, out);
    return out;
  }

  private compute(r: number, c: number, sheet: Sheet): ConditionalResult | null {
    let result: ConditionalResult | null = null;
    let style: CellStyle = {};
    let styled = false;
    for (const rule of sheet.conditional) {
      if (!rule.ranges.some((rg) => inRange(rg, r, c))) continue;
      const v = this.engine.readCell(sheet.id, r, c);
      const { kind } = rule;
      if (kind.type === 'scale') {
        if (typeof v !== 'number') continue;
        const { min, max } = this.numberStats(rule, sheet);
        if (min === undefined || max === undefined) continue;
        const t = max === min ? 0.5 : (v - min) / (max - min);
        const fill = kind.colors.length === 2 ? mix(kind.colors[0], kind.colors[1], t) : t < 0.5 ? mix(kind.colors[0], kind.colors[1], t * 2) : mix(kind.colors[1], kind.colors[2], t * 2 - 1);
        style = { fill, ...style };
        styled = true;
      } else if (kind.type === 'bar') {
        if (typeof v !== 'number') continue;
        const { min, max } = this.numberStats(rule, sheet);
        if (min === undefined || max === undefined) continue;
        const lo = Math.min(0, min);
        const hi = Math.max(0, max);
        const span = hi - lo || 1;
        const zero = lo === 0 ? 0 : -lo / span;
        const pos = (v - lo) / span;
        result ??= {};
        result.bar = { color: kind.color, from: Math.min(zero, pos), to: Math.max(zero, pos), negative: v < 0, hideValue: kind.hideValue ?? false };
      } else if (kind.type === 'icons') {
        if (typeof v !== 'number') continue;
        const { min, max } = this.numberStats(rule, sheet);
        if (min === undefined || max === undefined) continue;
        const t = max === min ? 1 : (v - min) / (max - min);
        let level = (t >= 0.67 ? 2 : t >= 0.33 ? 1 : 0) as 0 | 1 | 2;
        if (kind.reverse) level = (2 - level) as 0 | 1 | 2;
        result ??= {};
        result.icon = { set: kind.set, level };
      } else if (this.test(rule, v, r, c, sheet)) {
        // Earlier rules win when they set the same property.
        style = { ...rule.style, ...style };
        styled = true;
        if (rule.stopIfTrue) break;
      }
    }
    if (styled) {
      result ??= {};
      result.style = internStyle(style);
    }
    return result;
  }

  private test(rule: ConditionalRule, v: Scalar, r: number, c: number, sheet: Sheet): boolean {
    const { kind } = rule;
    switch (kind.type) {
      case 'compare':
        return compareWith(kind.op, v, this.operand(kind.a, rule, r, c, sheet), kind.b === undefined ? null : this.operand(kind.b, rule, r, c, sheet));
      case 'text': {
        const t = isError(v) ? v.code : (toText(v) as string);
        const hay = t.toLowerCase();
        const needle = kind.text.toLowerCase();
        if (!needle) return false;
        if (kind.op === 'contains') return hay.includes(needle);
        if (kind.op === 'notContains') return !hay.includes(needle);
        return kind.op === 'begins' ? hay.startsWith(needle) : hay.endsWith(needle);
      }
      case 'duplicate': {
        if (v === null || v === '') return false;
        const n = this.countStats(rule, sheet).get(valueKey(v)) ?? 0;
        return kind.unique ? n === 1 : n > 1;
      }
      case 'rank': {
        if (typeof v !== 'number') return false;
        const { sorted = [] } = this.numberStats(rule, sheet);
        const n = kind.percent ? Math.max(1, Math.floor((sorted.length * kind.count) / 100)) : Math.min(kind.count, sorted.length);
        if (!n) return false;
        return kind.bottom ? v <= sorted[n - 1] : v >= sorted[sorted.length - n];
      }
      case 'average': {
        if (typeof v !== 'number') return false;
        const { mean } = this.numberStats(rule, sheet);
        return mean !== undefined && (kind.below ? v < mean : v > mean);
      }
      case 'blank':
        return (v === null || v === '') !== (kind.not ?? false);
      case 'error':
        return isError(v) !== (kind.not ?? false);
      case 'formula': {
        const out = this.relative(kind.formula, rule, r, c, sheet);
        const b = toBool(out);
        return b === true;
      }
      default:
        return false;
    }
  }

  /** Operands are literals, or formulas relative to the rule's top-left cell. */
  private operand(text: string, rule: ConditionalRule, r: number, c: number, sheet: Sheet): Scalar {
    if (text.startsWith('=')) return this.relative(text, rule, r, c, sheet);
    const n = parseNumberText(text);
    return n ?? parseInput(text).v ?? null;
  }

  private relative(formula: string, rule: ConditionalRule, r: number, c: number, sheet: Sheet): Scalar {
    const origin = rule.ranges[0];
    const f = formula.startsWith('=') ? formula : `=${formula}`;
    const out = this.engine.evaluateFormula(sheet.id, r, c, f, r - origin.r1, c - origin.c1);
    return out instanceof Matrix ? out.at(0, 0) : out;
  }

  private each(rule: ConditionalRule, sheet: Sheet, visit: (v: Scalar) => void): void {
    for (const full of rule.ranges) {
      const range: Range | null = clipToContent(sheet, full);
      if (!range) continue;
      for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) visit(this.engine.readCell(sheet.id, r, c));
    }
  }

  private numberStats(rule: ConditionalRule, sheet: Sheet): RuleStats {
    const hit = this.stats.get(rule.id);
    if (hit?.sorted) return hit;
    const ns: number[] = [];
    this.each(rule, sheet, (v) => {
      if (typeof v === 'number') ns.push(v);
    });
    ns.sort((a, b) => a - b);
    const stats: RuleStats = { ...hit, sorted: ns };
    if (ns.length) {
      stats.min = ns[0];
      stats.max = ns[ns.length - 1];
      stats.mean = ns.reduce((a, b) => a + b, 0) / ns.length;
    }
    this.stats.set(rule.id, stats);
    return stats;
  }

  private countStats(rule: ConditionalRule, sheet: Sheet): Map<string, number> {
    const hit = this.stats.get(rule.id);
    if (hit?.counts) return hit.counts;
    const counts = new Map<string, number>();
    this.each(rule, sheet, (v) => {
      if (v === null || v === '') return;
      const k = valueKey(v);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    this.stats.set(rule.id, { ...hit, counts });
    return counts;
  }
}

export function describeRule(rule: ConditionalRule): string {
  const { kind } = rule;
  const ops: Record<CompareOp, string> = {
    gt: 'is greater than',
    gte: 'is at least',
    lt: 'is less than',
    lte: 'is at most',
    eq: 'equals',
    neq: 'does not equal',
    between: 'is between',
    notBetween: 'is not between',
  };
  switch (kind.type) {
    case 'compare':
      return `Value ${ops[kind.op]} ${kind.a}${kind.b !== undefined && /etween/.test(kind.op) ? ` and ${kind.b}` : ''}`;
    case 'text':
      return `Text ${{ contains: 'contains', notContains: 'does not contain', begins: 'begins with', ends: 'ends with' }[kind.op]} "${kind.text}"`;
    case 'duplicate':
      return kind.unique ? 'Unique values' : 'Duplicate values';
    case 'rank':
      return `${kind.bottom ? 'Bottom' : 'Top'} ${kind.count}${kind.percent ? '%' : ''}`;
    case 'average':
      return kind.below ? 'Below average' : 'Above average';
    case 'blank':
      return kind.not ? 'Not blank' : 'Blank cells';
    case 'error':
      return kind.not ? 'No errors' : 'Cells with errors';
    case 'formula':
      return `Formula ${kind.formula}`;
    case 'scale':
      return 'Color scale';
    case 'bar':
      return 'Data bars';
    case 'icons':
      return 'Icon set';
  }
}
