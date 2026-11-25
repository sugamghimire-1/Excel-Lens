import { AArrowDown, AArrowUp, AlignCenter, AlignLeft, AlignRight, Baseline, Bold, DecimalsArrowLeft, DecimalsArrowRight, DollarSign, Grid2x2, Italic, PaintBucket, Percent, TableCellsMerge, Underline } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ColorPicker } from '@/components/ColorPicker';
import { DEFAULT_FONT_SIZE, FONT_SIZES } from '@/engine/measure';
import { applyStyle } from '@/engine/commands/format';
import { cellRange } from '@/engine/address';
import { baseStyle } from '@/engine/sheet';
import * as actions from '@/state/actions';
import { gridApi } from '@/state/gridApi';
import { sheetById, useActiveCell } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import type { StylePatch } from '@/types';
import { borderMenu } from '../ribbon/galleries';
import { Combo, Row, Separator, SplitTool, Tool } from '../ribbon/parts';

/** Formatting an edited cell must not end the edit, so it bypasses `run`. */
function applyWhileEditing(patch: StylePatch): void {
  const { edit } = useUI.getState();
  if (!edit) return;
  const { workbook, dispatch } = useWorkbook.getState();
  const sheet = sheetById(workbook, edit.sheetId);
  if (sheet.protected) return;
  dispatch('Format', applyStyle(sheet, [cellRange(edit.r, edit.c)], patch), { sheetId: sheet.id });
  gridApi.focus();
}

function format(label: string, patch: StylePatch): void {
  if (useUI.getState().edit) applyWhileEditing(patch);
  else actions.format(label, patch);
}

function toggle(key: 'bold' | 'italic' | 'underline'): void {
  const { edit } = useUI.getState();
  if (!edit) {
    actions.toggleStyle(key);
    return;
  }
  const sheet = sheetById(useWorkbook.getState().workbook, edit.sheetId);
  applyWhileEditing({ [key]: baseStyle(sheet, edit.r, edit.c)?.[key] ? null : true });
}

/** Compact formatting controls shown with the context menu and over selected text. */
export function MiniToolbar({ compact }: { compact?: boolean }) {
  const { style } = useActiveCell();
  return (
    <div className="space-y-0.5" role="toolbar" aria-label="Formatting">
      <Row className="gap-0.5">
        <Combo label="Font size" width={54} numeric value={String(style?.fontSize ?? DEFAULT_FONT_SIZE)} options={FONT_SIZES.map(String)} onPick={(v) => Number(v) >= 1 && Number(v) <= 200 && format('Font size', { fontSize: Number(v) })} />
        {!compact && (
          <>
            <Tool label="Increase font size" icon={AArrowUp} onClick={() => actions.changeFontSize(1)} />
            <Tool label="Decrease font size" icon={AArrowDown} onClick={() => actions.changeFontSize(-1)} />
          </>
        )}
        <Tool label="Bold" icon={Bold} keys="Ctrl+B" active={style?.bold} onClick={() => toggle('bold')} />
        <Tool label="Italic" icon={Italic} keys="Ctrl+I" active={style?.italic} onClick={() => toggle('italic')} />
        <Tool label="Underline" icon={Underline} keys="Ctrl+U" active={style?.underline} onClick={() => toggle('underline')} />
        <SplitTool
          label="Fill color"
          icon={PaintBucket}
          strip={style?.fill ?? '#fff3bf'}
          menuLabel="Choose fill color"
          onClick={() => format('Fill color', { fill: style?.fill ?? '#fff3bf' })}
          panel={(close) => (
            <ColorPicker
              value={style?.fill}
              none="No fill"
              onPick={(c) => {
                close();
                format('Fill color', { fill: c });
              }}
            />
          )}
        />
        <SplitTool
          label="Font color"
          icon={Baseline}
          strip={style?.color ?? '#c12d28'}
          menuLabel="Choose font color"
          onClick={() => format('Font color', { color: style?.color ?? '#c12d28' })}
          panel={(close) => (
            <ColorPicker
              value={style?.color}
              none="Automatic"
              onPick={(c) => {
                close();
                format('Font color', { color: c });
              }}
            />
          )}
        />
        {!compact && <SplitTool label="Bottom border" icon={Grid2x2} menuLabel="Borders" onClick={() => actions.borders('bottom')} items={borderMenu} />}
      </Row>
      {!compact && (
        <Row>
          <Tool label="Align left" icon={AlignLeft} active={style?.hAlign === 'left'} onClick={() => actions.setHAlign('left')} />
          <Tool label="Center" icon={AlignCenter} active={style?.hAlign === 'center'} onClick={() => actions.setHAlign('center')} />
          <Tool label="Align right" icon={AlignRight} active={style?.hAlign === 'right'} onClick={() => actions.setHAlign('right')} />
          <Tool label="Merge and center" icon={TableCellsMerge} onClick={() => actions.merge('toggle')} />
          <Separator />
          <Tool label="Currency" icon={DollarSign} onClick={() => actions.setNumberFormat('$#,##0.00')} />
          <Tool label="Percent" icon={Percent} onClick={() => actions.setNumberFormat('0%')} />
          <Tool label="Increase decimals" icon={DecimalsArrowRight} onClick={() => actions.changeDecimals(1)} />
          <Tool label="Decrease decimals" icon={DecimalsArrowLeft} onClick={() => actions.changeDecimals(-1)} />
        </Row>
      )}
    </div>
  );
}

/** Appears above the cell editor while text inside it is selected. */
export function SelectionToolbar() {
  const edit = useUI((s) => s.edit);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const on = edit !== null && edit.origin === 'cell' && edit.caretEnd - edit.caretStart > 0 && !edit.text.startsWith('=');
  useEffect(() => {
    if (!on) {
      setPos(null);
      return;
    }
    // Wait for the selection gesture to settle.
    const t = setTimeout(() => {
      const rect = gridApi.cellRect(edit.r, edit.c);
      if (!rect) return;
      const above = rect.top - 44;
      setPos({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 340)), top: above > 150 ? above : rect.bottom + 8 });
    }, 180);
    return () => clearTimeout(t);
  }, [on, edit?.r, edit?.c]);
  if (!on || !pos) return null;
  return createPortal(
    <div style={pos} className="fixed z-[64] animate-pop rounded-[10px] bg-raised p-1 shadow-pop">
      <MiniToolbar compact />
    </div>,
    document.body,
  );
}
