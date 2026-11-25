import { useMemo } from 'react';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import { formulaRefs } from './formulaRefs';
import { REF_COLORS_DARK, REF_COLORS_LIGHT } from './gridPalette';

/** Formula text with references coloured to match their outlines in the grid. */
export function FormulaText({ text, sheetId }: { text: string; sheetId: string }) {
  const workbook = useWorkbook((s) => s.workbook);
  const dark = useUI((s) => s.dark);
  const parts = useMemo(() => {
    const colors = dark ? REF_COLORS_DARK : REF_COLORS_LIGHT;
    const out: { text: string; color?: string }[] = [];
    let last = 0;
    for (const r of formulaRefs(text, sheetId, workbook)) {
      if (r.start > last) out.push({ text: text.slice(last, r.start) });
      out.push({ text: text.slice(r.start, r.end), color: colors[r.colorIndex % colors.length] });
      last = r.end;
    }
    out.push({ text: text.slice(last) });
    return out;
  }, [text, sheetId, workbook, dark]);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} style={p.color ? { color: p.color } : undefined}>
          {p.text}
        </span>
      ))}
      {/* Keeps a trailing newline visible so both layers have the same height. */}
      {text.endsWith('\n') && ' '}
    </>
  );
}
