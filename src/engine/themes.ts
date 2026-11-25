/** Workbook colour themes, cell styles and table styles. */
import type { BorderEdge, CellStyle } from '@/types';

export interface WorkbookTheme {
  id: string;
  name: string;
  /** Dark text/header colour, light tint, then eight categorical colours in fixed order. */
  ink: string;
  tint: string;
  accents: string[];
  /** The same categorical slots stepped for a dark surface. */
  accentsDark: string[];
}

export const THEMES: WorkbookTheme[] = [
  {
    id: 'cobalt',
    name: 'Cobalt',
    ink: '#1d2f5c',
    tint: '#eaf0fc',
    accents: ['#2457d6', '#ee7b3c', '#12a594', '#e5a50a', '#d65c94', '#2e8b3d', '#7a5ad9', '#d9463f'],
    accentsDark: ['#4c82f0', '#d9602b', '#179c86', '#c08705', '#d1548c', '#2fa043', '#9181ea', '#e4645e'],
  },
  {
    id: 'harbor',
    name: 'Harbor',
    ink: '#103c4a',
    tint: '#e3f3f5',
    accents: ['#0e7c93', '#e8853a', '#4a5fc1', '#c9a227', '#b8558f', '#2f8f5b', '#8a6bd1', '#cf4b4b'],
    accentsDark: ['#2499b3', '#d4702a', '#7183e0', '#b08b1a', '#c96aa0', '#34a067', '#9c82e0', '#e0655f'],
  },
  {
    id: 'orchard',
    name: 'Orchard',
    ink: '#23402b',
    tint: '#e9f4ea',
    accents: ['#2f7d46', '#d9772b', '#3b6fc4', '#d1a51a', '#a94f9c', '#158f86', '#7c62cf', '#c6443e'],
    accentsDark: ['#43a05f', '#cf6a26', '#5f8fe0', '#b98f14', '#bd68b0', '#1f9f95', '#9680e3', '#e0605a'],
  },
  {
    id: 'plum',
    name: 'Plum',
    ink: '#3f2355',
    tint: '#f3ecf9',
    accents: ['#7b3fa8', '#dd7a34', '#1496a0', '#d9a518', '#d4548a', '#3a8a48', '#4c6bd6', '#cf4a3c'],
    accentsDark: ['#a36ad0', '#d06a2a', '#1fa0a8', '#bb8c12', '#d8659a', '#3f9c50', '#6f8cf0', '#e0655a'],
  },
  {
    id: 'slate',
    name: 'Slate',
    ink: '#28303d',
    tint: '#eef1f5',
    accents: ['#45566f', '#d67a3d', '#2a8f9d', '#c49a22', '#b25a86', '#4a8a52', '#6f66c2', '#c24e49'],
    accentsDark: ['#7c90ad', '#cc6f34', '#35a0ae', '#b08a1c', '#c26c98', '#559a5e', '#8d84da', '#d9655f'],
  },
];

export function themeById(id: string): WorkbookTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/* ------------------------------------------------------------------ colour */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((x) => x + x).join('') : h.slice(0, 6);
  const n = Number.parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Linear blend: t = 0 gives `a`, t = 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

export const lighten = (hex: string, t: number): string => mix(hex, '#ffffff', t);
export const darken = (hex: string, t: number): string => mix(hex, '#000000', t);

export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Readable text colour for a fill. */
export function onColor(fill: string): string {
  return contrast(fill, '#ffffff') >= 3.4 ? '#ffffff' : '#1b2333';
}

/** Six tints and shades for the colour picker. */
export function tintColumn(hex: string): string[] {
  return [lighten(hex, 0.82), lighten(hex, 0.62), lighten(hex, 0.4), hex, darken(hex, 0.25), darken(hex, 0.5)];
}

export const STANDARD_COLORS = ['#b42318', '#e5484d', '#f2a20c', '#f7d34b', '#8fc93a', '#1c7c43', '#17a2b8', '#2457d6', '#1d2f5c', '#7a3fb0'];
export const NEUTRALS = ['#ffffff', '#f3f5f9', '#d8dde6', '#a4adbb', '#5b6679', '#1b2333'];

/* ------------------------------------------------------------- cell styles */

export interface NamedStyle {
  id: string;
  name: string;
  group: 'Status' | 'Headings' | 'Data' | 'Accents';
  style: CellStyle;
}

export function cellStyles(theme: WorkbookTheme): NamedStyle[] {
  const line = (style: BorderEdge['style'], color: string): BorderEdge => ({ style, color });
  const [a1] = theme.accents;
  return [
    { id: 'good', name: 'Good', group: 'Status', style: { color: '#14532d', fill: '#d6f2dd' } },
    { id: 'bad', name: 'Bad', group: 'Status', style: { color: '#8f1d18', fill: '#fbdcda' } },
    { id: 'neutral', name: 'Neutral', group: 'Status', style: { color: '#7a4d05', fill: '#fdeec4' } },
    { id: 'title', name: 'Title', group: 'Headings', style: { fontSize: 18, bold: true, color: theme.ink } },
    { id: 'h1', name: 'Heading 1', group: 'Headings', style: { fontSize: 14, bold: true, color: theme.ink, borderBottom: line('thick', a1) } },
    { id: 'h2', name: 'Heading 2', group: 'Headings', style: { fontSize: 12, bold: true, color: theme.ink, borderBottom: line('medium', lighten(a1, 0.5)) } },
    { id: 'h3', name: 'Heading 3', group: 'Headings', style: { bold: true, color: theme.ink } },
    { id: 'total', name: 'Total', group: 'Headings', style: { bold: true, borderTop: line('thin', a1), borderBottom: line('double', a1) } },
    { id: 'input', name: 'Input', group: 'Data', style: { color: '#1f4fb8', fill: '#fff8de', borderTop: line('thin', '#d9c98a'), borderBottom: line('thin', '#d9c98a'), borderLeft: line('thin', '#d9c98a'), borderRight: line('thin', '#d9c98a') } },
    { id: 'output', name: 'Output', group: 'Data', style: { bold: true, color: '#1b2333', fill: '#f3f5f9', borderTop: line('thin', '#a4adbb'), borderBottom: line('thin', '#a4adbb'), borderLeft: line('thin', '#a4adbb'), borderRight: line('thin', '#a4adbb') } },
    { id: 'calc', name: 'Calculation', group: 'Data', style: { bold: true, color: '#b45309', fill: '#f7f4ee' } },
    { id: 'noteStyle', name: 'Note', group: 'Data', style: { italic: true, color: '#5b6679' } },
    ...theme.accents.slice(0, 6).flatMap((color, i): NamedStyle[] => [
      { id: `acc${i}`, name: `Accent ${i + 1}`, group: 'Accents', style: { fill: color, color: onColor(color) } },
      { id: `accl${i}`, name: `Accent ${i + 1} light`, group: 'Accents', style: { fill: lighten(color, 0.82), color: darken(color, 0.45) } },
    ]),
  ];
}

/* ------------------------------------------------------------ table styles */

export interface TableStyle {
  id: string;
  header: CellStyle;
  band: CellStyle;
  body: CellStyle;
  total: CellStyle;
  firstColumn: CellStyle;
}

/** `solid-2` means a solid header in the theme's second accent. */
export function tableStyle(id: string, theme: WorkbookTheme): TableStyle {
  const [kind, slot] = id.split('-');
  const n = Number(slot);
  const color = n === 0 || Number.isNaN(n) ? theme.ink : theme.accents[(n - 1) % theme.accents.length];
  const soft: BorderEdge = { style: 'thin', color: lighten(color, 0.72) };
  const firm: BorderEdge = { style: 'medium', color };
  const bold: CellStyle = { bold: true };
  const total: CellStyle = { bold: true, borderTop: { style: 'double', color } };
  switch (kind) {
    case 'light':
      return {
        id,
        header: { bold: true, color: darken(color, 0.25), borderTop: { style: 'thin', color }, borderBottom: { style: 'thin', color } },
        band: { fill: lighten(color, 0.9) },
        body: {},
        total: { bold: true, borderTop: { style: 'thin', color }, borderBottom: { style: 'thin', color } },
        firstColumn: bold,
      };
    case 'lined':
      return {
        id,
        header: { bold: true, color: darken(color, 0.25), borderBottom: firm },
        band: { borderBottom: soft },
        body: { borderBottom: soft },
        total,
        firstColumn: bold,
      };
    case 'deep':
      return {
        id,
        header: { bold: true, color: '#ffffff', fill: darken(color, 0.35) },
        band: { fill: lighten(color, 0.7) },
        body: { fill: lighten(color, 0.84) },
        total: { bold: true, color: '#ffffff', fill: darken(color, 0.35) },
        firstColumn: bold,
      };
    default:
      return {
        id,
        header: { bold: true, color: onColor(color), fill: color },
        band: { fill: lighten(color, 0.94), borderBottom: soft },
        body: { borderBottom: soft },
        total,
        firstColumn: bold,
      };
  }
}

export const TABLE_STYLE_IDS = ['solid', 'light', 'lined', 'deep'].flatMap((k) => [0, 1, 2, 3, 4, 5, 6].map((n) => `${k}-${n}`));
