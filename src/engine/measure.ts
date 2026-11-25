/** Text measurement shared by the renderer, auto-fit and PDF export. */
import type { CellStyle } from '@/types';

export const DEFAULT_FONT = 'IBM Plex Sans';
export const DEFAULT_FONT_SIZE = 10;

/** Points to CSS pixels. */
export const PT = 96 / 72;

export const FONT_FAMILIES = [
  'IBM Plex Sans',
  'Arial',
  'Calibri',
  'Cambria',
  'Consolas',
  'Courier New',
  'Georgia',
  'Helvetica',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
];

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 36, 48, 72];

const families = new Map<string, string>();

function family(name: string): string {
  let f = families.get(name);
  if (!f) {
    f = name === DEFAULT_FONT ? '"IBM Plex Sans Variable", "IBM Plex Sans", "Segoe UI", sans-serif' : `"${name}", "IBM Plex Sans Variable", sans-serif`;
    families.set(name, f);
  }
  return f;
}

const fontCache = new WeakMap<CellStyle, Map<number, string>>();
const plainFonts = new Map<number, string>();

/** CSS font shorthand for a style at a scale factor. */
export function fontString(style: CellStyle | undefined, scale = 1): string {
  const cache = style ? (fontCache.get(style) ?? new Map<number, string>()) : plainFonts;
  if (style && !fontCache.has(style)) fontCache.set(style, cache);
  let font = cache.get(scale);
  if (!font) {
    const size = (style?.fontSize ?? DEFAULT_FONT_SIZE) * PT * scale;
    font = `${style?.italic ? 'italic ' : ''}${style?.bold ? '600 ' : '400 '}${size.toFixed(2)}px ${family(style?.fontFamily ?? DEFAULT_FONT)}`;
    cache.set(scale, font);
  }
  return font;
}

export function lineHeight(fontSize = DEFAULT_FONT_SIZE): number {
  return Math.round(fontSize * PT * 1.32);
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
let ctx: Ctx | null | undefined;

function context(): Ctx | null {
  if (ctx !== undefined) return ctx;
  if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(8, 8).getContext('2d');
  else if (typeof document !== 'undefined') ctx = document.createElement('canvas').getContext('2d');
  else ctx = null;
  return ctx;
}

let widthCache = new Map<string, number>();

export function clearMeasureCache(): void {
  widthCache = new Map();
}

export function measureText(text: string, font: string): number {
  if (!text) return 0;
  const key = `${font}\u0000${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  const c = context();
  let w: number;
  if (c) {
    if (c.font !== font) c.font = font;
    w = c.measureText(text).width;
  } else {
    // Headless fallback: average glyph width of a sans-serif face.
    const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 13);
    w = text.length * size * 0.55;
  }
  if (widthCache.size > 30_000) widthCache = new Map();
  widthCache.set(key, w);
  return w;
}

/** Greedy word wrap that breaks overlong words. */
export function wrapText(text: string, font: string, width: number): string[] {
  const out: string[] = [];
  const max = Math.max(8, width);
  for (const para of text.split('\n')) {
    if (measureText(para, font) <= max) {
      out.push(para);
      continue;
    }
    let line = '';
    for (const word of para.split(/(?<=\s)/)) {
      const candidate = line + word;
      if (measureText(candidate.trimEnd(), font) <= max) {
        line = candidate;
        continue;
      }
      if (line) out.push(line.trimEnd());
      line = word;
      while (measureText(line.trimEnd(), font) > max && line.length > 1) {
        let n = line.length - 1;
        while (n > 1 && measureText(line.slice(0, n), font) > max) n--;
        out.push(line.slice(0, n));
        line = line.slice(n);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}
