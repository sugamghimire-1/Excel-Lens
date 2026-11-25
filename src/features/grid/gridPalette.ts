import { contrast, hexToRgb, luminance, rgbToHex } from '@/engine/themes';

export interface GridPalette {
  dark: boolean;
  canvas: string;
  text: string;
  line: string;
  headerBg: string;
  headerText: string;
  headerLine: string;
  headerHover: string;
  headerActive: string;
  headerActiveText: string;
  headerFull: string;
  headerFullText: string;
  accent: string;
  selection: string;
  freeze: string;
  link: string;
  note: string;
  invalid: string;
  hover: string;
  find: string;
  findCurrent: string;
}

export const LIGHT: GridPalette = {
  dark: false,
  canvas: '#ffffff',
  text: '#1b2333',
  line: '#e4e8ee',
  headerBg: '#f7f9fb',
  headerText: '#566176',
  headerLine: '#d9dfe7',
  headerHover: '#eaeef4',
  headerActive: '#dfe8fb',
  headerActiveText: '#1c49b8',
  headerFull: '#2457d6',
  headerFullText: '#ffffff',
  accent: '#2457d6',
  selection: 'rgba(36, 87, 214, 0.085)',
  freeze: '#b3bdcb',
  link: '#1c5bd0',
  note: '#e4572e',
  invalid: '#d1362f',
  hover: 'rgba(27, 35, 51, 0.022)',
  find: 'rgba(245, 190, 50, 0.32)',
  findCurrent: 'rgba(245, 150, 30, 0.55)',
};

export const DARK: GridPalette = {
  dark: true,
  canvas: '#1a1e26',
  text: '#e3e8f0',
  line: '#282e39',
  headerBg: '#1f242d',
  headerText: '#97a2b4',
  headerLine: '#303744',
  headerHover: '#282f3a',
  headerActive: '#26375f',
  headerActiveText: '#a9c4ff',
  headerFull: '#3f6fe0',
  headerFullText: '#ffffff',
  accent: '#6c9bff',
  selection: 'rgba(108, 155, 255, 0.14)',
  freeze: '#4a5466',
  link: '#8bb1ff',
  note: '#ff8a65',
  invalid: '#ff7a70',
  hover: 'rgba(255, 255, 255, 0.025)',
  find: 'rgba(245, 190, 50, 0.24)',
  findCurrent: 'rgba(245, 150, 30, 0.5)',
};

/* Documents are authored for a white page. In dark mode light fills become deep
   tints of the same hue and text is re-lit only when it would be unreadable. */

function toHsl(hex: string): [number, number, number] {
  const { r, g, b } = hexToRgb(hex);
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === x ? (y - z) / d + (y < z ? 6 : 0) : max === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  if (s === 0) return rgbToHex({ r: l * 255, g: l * 255, b: l * 255 });
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t0: number): number => {
    const t = (t0 + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex({ r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255 });
}

const fillCache = new Map<string, string>();
const textCache = new Map<string, string>();

export function adaptFill(hex: string, palette: GridPalette): string {
  if (!palette.dark) return hex;
  let out = fillCache.get(hex);
  if (out === undefined) {
    const [h, s, l] = toHsl(hex);
    // Pure white means "page"; mid and dark fills already sit well on a dark canvas.
    if (l > 0.985) out = DARK.canvas;
    else if (l > 0.55) out = fromHsl(h, Math.min(s, 0.55) * 0.72, 0.115 + (1 - l) * 0.42);
    else out = l < 0.14 ? fromHsl(h, s, 0.2) : hex;
    fillCache.set(hex, out);
  }
  return out;
}

export function adaptText(hex: string, background: string, palette: GridPalette): string {
  if (!palette.dark) return hex;
  const key = `${hex}|${background}`;
  let out = textCache.get(key);
  if (out === undefined) {
    out = hex;
    if (contrast(hex, background) < 4.5) {
      const [h, s] = toHsl(hex);
      const lightBg = luminance(background) > 0.35;
      out = lightBg ? fromHsl(h, s, 0.16) : fromHsl(h, Math.min(s, 0.75), s < 0.12 ? 0.89 : 0.76);
    }
    textCache.set(key, out);
  }
  return out;
}

export function adaptLine(hex: string, palette: GridPalette): string {
  if (!palette.dark) return hex;
  const [h, s, l] = toHsl(hex);
  if (l > 0.6) return fromHsl(h, s * 0.5, 0.3);
  return l < 0.3 ? fromHsl(h, s, 0.62) : hex;
}

/** Colours for references inside formulas, in order of appearance. */
export const REF_COLORS_LIGHT = ['#2457d6', '#b4471a', '#0b7a6e', '#8a3fb5', '#a11f52', '#4a6b12', '#0c6f9c', '#8a5a00'];
export const REF_COLORS_DARK = ['#7fa8ff', '#ff9d6b', '#4fd1bf', '#cf95f2', '#ff86ab', '#a9cf6a', '#6ec5ee', '#e5b454'];
