import { useMemo } from 'react';
import { cellKey } from '@/engine/address';
import { editText } from '@/engine/input';
import { baseStyle } from '@/engine/sheet';
import type { Cell, CellPos, CellStyle, Range, SelectionState, Sheet, Workbook } from '@/types';
import { DEFAULT_SELECTION, useUI } from './uiStore';
import { useWorkbook } from './workbookStore';

export function sheetById(wb: Workbook, id: string): Sheet {
  return wb.sheets.find((s) => s.id === id) ?? wb.sheets.find((s) => !s.hidden) ?? wb.sheets[0];
}

/** The sheet on screen, read imperatively. */
export function activeSheet(): Sheet {
  return sheetById(useWorkbook.getState().workbook, useUI.getState().activeSheetId);
}

export function activeSelection(): SelectionState {
  const { selections } = useUI.getState();
  return selections[activeSheet().id] ?? DEFAULT_SELECTION;
}

/** The rectangle most recently selected. */
export function primaryRange(sel: SelectionState = activeSelection()): Range {
  return sel.ranges[sel.ranges.length - 1];
}

export function useActiveSheet(): Sheet {
  const wb = useWorkbook((s) => s.workbook);
  const id = useUI((s) => s.activeSheetId);
  return sheetById(wb, id);
}

export function useSelection(): SelectionState {
  const sheet = useActiveSheet();
  return useUI((s) => s.selections[sheet.id]) ?? DEFAULT_SELECTION;
}

export interface ActiveCellInfo {
  sheet: Sheet;
  pos: CellPos;
  cell: Cell | undefined;
  style: CellStyle | undefined;
  text: string;
}

export function useActiveCell(): ActiveCellInfo {
  const sheet = useActiveSheet();
  const { active } = useSelection();
  return useMemo(() => {
    const cell = sheet.cells.get(cellKey(active.r, active.c));
    const style = baseStyle(sheet, active.r, active.c);
    return { sheet, pos: active, cell, style, text: editText(cell, style?.numFmt) };
  }, [sheet, active]);
}
