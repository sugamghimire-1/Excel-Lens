import { tokenize, type Token } from '@/formulas';
import type { Range, Workbook } from '@/types';

export interface FormulaRef {
  start: number;
  end: number;
  colorIndex: number;
  sheetId: string | null;
  range: Range;
}

/** References in a formula being edited, with a stable colour per distinct range. */
export function formulaRefs(text: string, ownSheetId: string, workbook: Workbook): FormulaRef[] {
  if (!text.startsWith('=')) return [];
  const colors = new Map<string, number>();
  const out: FormulaRef[] = [];
  for (const t of tokenize(text)) {
    if (t.type !== 'ref') continue;
    const ref = t.ref!;
    const name = ref.sheet?.toLowerCase();
    const sheetId = name === undefined ? ownSheetId : (workbook.sheets.find((s) => s.name.toLowerCase() === name)?.id ?? null);
    const range: Range = {
      r1: Math.min(ref.a.r, ref.b.r),
      c1: Math.min(ref.a.c, ref.b.c),
      r2: Math.max(ref.a.r, ref.b.r),
      c2: Math.max(ref.a.c, ref.b.c),
    };
    const key = `${sheetId}:${range.r1}:${range.c1}:${range.r2}:${range.c2}`;
    let colorIndex = colors.get(key);
    if (colorIndex === undefined) {
      colorIndex = colors.size;
      colors.set(key, colorIndex);
    }
    out.push({ start: t.start, end: t.end, colorIndex, sheetId, range });
  }
  return out;
}

export interface CallContext {
  name: string;
  /** Zero-based argument the caret is in. */
  arg: number;
}

/** The innermost function call around the caret. */
export function callAt(text: string, caret: number): CallContext | null {
  if (!text.startsWith('=')) return null;
  const stack: { name: string | null; arg: number }[] = [];
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.start >= caret) break;
    if (t.type === 'lparen') {
      const prev = tokens[i - 1];
      stack.push({ name: prev?.type === 'func' ? prev.text.toUpperCase() : null, arg: 0 });
    } else if (t.type === 'rparen') stack.pop();
    else if (t.type === 'sep' && stack.length) stack[stack.length - 1].arg++;
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const s = stack[i];
    if (s.name) return { name: s.name, arg: s.arg };
  }
  return null;
}

/** The partial identifier directly before the caret, for autocomplete. */
export function wordAt(text: string, caret: number): { word: string; start: number } | null {
  if (!text.startsWith('=')) return null;
  const m = /[A-Za-z_][\w.]*$/.exec(text.slice(0, caret));
  if (!m) return null;
  if (/[\w.(!']/.test(text[caret] ?? '')) return null;
  const inString = (text.slice(0, m.index).match(/"/g) ?? []).length % 2 === 1;
  if (inString || text[m.index - 1] === '$' || text[m.index - 1] === '!' || text[m.index - 1] === "'") return null;
  return { word: m[0], start: m.index };
}

export type { Token };
