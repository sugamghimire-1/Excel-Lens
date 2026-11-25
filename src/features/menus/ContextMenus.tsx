import {
  ArrowDownAZ, ArrowUpZA, BringToFront, Brush, ChartNoAxesColumn, ClipboardPaste, Columns3, Copy, CopyPlus, Eraser, Eye, EyeOff, Filter, Hash, Link, Link2Off, ListChecks, LockKeyhole, LockOpen, MessageSquarePlus, MessageSquareX, MoveLeft, MoveRight, Palette, PencilLine, Plus, RotateCw, Rows3,
  Ruler, Scissors, SendToBack, Settings2, Sigma, SlidersHorizontal, Trash2,
} from 'lucide-react';
import { ColorPicker } from '@/components/ColorPicker';
import { MenuList, type MenuEntry } from '@/components/Menu';
import { Floating } from '@/components/Popover';
import { cellKey } from '@/engine/address';
import * as actions from '@/state/actions';
import { gridApi } from '@/state/gridApi';
import { activeSelection, activeSheet } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import { download, safeFileName } from '@/utils/cx';
import { MiniToolbar } from './MiniToolbar';

const set = (p: Parameters<ReturnType<typeof useUI.getState>['set']>[0]): void => useUI.getState().set(p);

/** Right-click menus for cells, rows, columns, sheet tabs and charts. */
export function ContextMenus() {
  const menu = useUI((s) => s.menu);
  if (!menu) return null;
  const close = (): void => {
    set({ menu: null });
    gridApi.focus();
  };
  const anchor = { left: menu.x, top: menu.y, right: menu.x, bottom: menu.y };
  const withToolbar = menu.type === 'cell' || menu.type === 'row' || menu.type === 'col';
  const items = menu.type === 'cell' ? cellItems() : menu.type === 'row' || menu.type === 'col' ? axisItems(menu.type) : menu.type === 'sheet' ? sheetItems(menu.sheetId) : chartItems(menu.chartId);
  return (
    <Floating key={`${menu.x},${menu.y}`} anchor={anchor} onClose={close} gap={2} still>
      {withToolbar && (
        <div className="border-b border-line px-1 py-1">
          <MiniToolbar />
        </div>
      )}
      <MenuList items={items} onClose={close} label="Context menu" />
    </Floating>
  );
}

const clipboard = (): MenuEntry[] => [
  { label: 'Cut', icon: Scissors, keys: 'Ctrl+X', onSelect: () => void actions.copyToSystem(true) },
  { label: 'Copy', icon: Copy, keys: 'Ctrl+C', onSelect: () => void actions.copyToSystem(false) },
  { label: 'Paste', icon: ClipboardPaste, keys: 'Ctrl+V', onSelect: () => void actions.pasteFromSystem() },
  {
    label: 'Paste special',
    icon: ClipboardPaste,
    submenu: [
      { label: 'Values only', icon: Hash, onSelect: () => void actions.pasteFromSystem('values') },
      { label: 'Formulas only', icon: Sigma, onSelect: () => void actions.pasteFromSystem('formulas') },
      { label: 'Formatting only', icon: Brush, onSelect: () => void actions.pasteFromSystem('formats') },
      { label: 'Transposed', icon: RotateCw, onSelect: () => void actions.pasteFromSystem('transpose') },
    ],
  },
];

function cellItems(): MenuEntry[] {
  const sheet = activeSheet();
  const { active } = activeSelection();
  const cell = sheet.cells.get(cellKey(active.r, active.c));
  return [
    ...clipboard(),
    'separator',
    { label: 'Insert', icon: Plus, keys: 'Ctrl++', onSelect: actions.insertSmart },
    { label: 'Delete', icon: Trash2, keys: 'Ctrl+-', onSelect: actions.deleteSmart },
    { label: 'Clear contents', icon: Eraser, keys: 'Delete', onSelect: () => actions.clear('contents') },
    'separator',
    {
      label: 'Sort',
      icon: ArrowDownAZ,
      submenu: [
        { label: 'A to Z', icon: ArrowDownAZ, onSelect: () => actions.sort(false) },
        { label: 'Z to A', icon: ArrowUpZA, onSelect: () => actions.sort(true) },
        { label: 'Custom sort', icon: SlidersHorizontal, onSelect: () => set({ dialog: { type: 'sort' } }) },
      ],
    },
    { label: sheet.filter ? 'Remove filter' : 'Filter', icon: Filter, keys: 'Ctrl+Shift+L', onSelect: actions.toggleFilter },
    'separator',
    { label: cell?.note ? 'Edit note' : 'New note', icon: MessageSquarePlus, keys: 'Shift+F2', onSelect: actions.editNote },
    ...(cell?.note ? [{ label: 'Delete note', icon: MessageSquareX, onSelect: actions.deleteNote } as MenuEntry] : []),
    { label: cell?.link ? 'Edit link' : 'Add link', icon: Link, keys: 'Ctrl+K', onSelect: () => set({ dialog: { type: 'link' } }) },
    ...(cell?.link
      ? ([
          { label: 'Open link', icon: MoveRight, onSelect: () => actions.followLink(cell.link!) },
          { label: 'Remove link', icon: Link2Off, onSelect: () => actions.saveLink(null, null) },
        ] as MenuEntry[])
      : []),
    'separator',
    { label: 'Data validation', icon: ListChecks, onSelect: () => set({ dialog: { type: 'validation' } }) },
    { label: 'Define name', icon: PencilLine, onSelect: () => set({ dialog: { type: 'names', create: true } }) },
    { label: 'Format cells', icon: SlidersHorizontal, keys: 'Ctrl+1', onSelect: () => set({ dialog: { type: 'format' } }) },
  ];
}

function axisItems(axis: 'row' | 'col'): MenuEntry[] {
  const isRow = axis === 'row';
  const Icon = isRow ? Rows3 : Columns3;
  return [
    ...clipboard(),
    'separator',
    { label: isRow ? 'Insert above' : 'Insert left', icon: Icon, keys: 'Ctrl++', onSelect: () => (isRow ? actions.insertRows('above') : actions.insertCols('left')) },
    { label: isRow ? 'Insert below' : 'Insert right', icon: Icon, onSelect: () => (isRow ? actions.insertRows('below') : actions.insertCols('right')) },
    { label: isRow ? 'Delete rows' : 'Delete columns', icon: Trash2, keys: 'Ctrl+-', onSelect: isRow ? actions.deleteRows : actions.deleteCols },
    { label: 'Clear contents', icon: Eraser, keys: 'Delete', onSelect: () => actions.clear('contents') },
    'separator',
    { label: isRow ? 'Row height' : 'Column width', icon: Ruler, onSelect: () => set({ dialog: { type: 'size', axis } }) },
    { label: 'AutoFit', icon: Ruler, onSelect: () => actions.autoFit(axis) },
    { label: 'Hide', icon: EyeOff, keys: isRow ? 'Ctrl+9' : 'Ctrl+0', onSelect: () => actions.hideAxis(axis, true) },
    { label: 'Unhide', icon: Eye, onSelect: () => actions.hideAxis(axis, false) },
    ...(isRow
      ? []
      : ([
          'separator',
          { label: 'Sort A to Z', icon: ArrowDownAZ, onSelect: () => actions.sort(false) },
          { label: 'Sort Z to A', icon: ArrowUpZA, onSelect: () => actions.sort(true) },
        ] as MenuEntry[])),
    'separator',
    { label: 'Format cells', icon: SlidersHorizontal, keys: 'Ctrl+1', onSelect: () => set({ dialog: { type: 'format' } }) },
  ];
}

function sheetItems(sheetId: string): MenuEntry[] {
  const { workbook } = useWorkbook.getState();
  const sheet = workbook.sheets.find((s) => s.id === sheetId);
  if (!sheet) return [];
  const index = workbook.sheets.indexOf(sheet);
  const hidden = workbook.sheets.filter((s) => s.hidden);
  return [
    { label: 'Insert sheet', icon: Plus, keys: 'Shift+F11', onSelect: () => actions.newSheet(sheetId) },
    { label: 'Duplicate', icon: CopyPlus, onSelect: () => actions.copySheet(sheetId) },
    { label: 'Rename', icon: PencilLine, onSelect: () => set({ renamingSheet: sheetId }) },
    {
      label: 'Tab color',
      icon: Palette,
      panel: (close) => (
        <ColorPicker
          value={sheet.tabColor}
          none="No color"
          onPick={(c) => {
            close();
            actions.setTabColor(sheetId, c);
          }}
        />
      ),
    },
    'separator',
    { label: 'Move left', icon: MoveLeft, disabled: index === 0, onSelect: () => actions.moveSheetTo(sheetId, index - 1) },
    { label: 'Move right', icon: MoveRight, disabled: index === workbook.sheets.length - 1, onSelect: () => actions.moveSheetTo(sheetId, index + 1) },
    { label: sheet.protected ? 'Unprotect sheet' : 'Protect sheet', icon: sheet.protected ? LockOpen : LockKeyhole, onSelect: actions.toggleProtection },
    'separator',
    { label: 'Hide', icon: EyeOff, onSelect: () => actions.hideSheet(sheetId, true) },
    { label: 'Unhide', icon: Eye, disabled: !hidden.length, submenu: hidden.length ? hidden.map((s) => ({ label: s.name, onSelect: () => actions.hideSheet(s.id, false) })) : undefined },
    'separator',
    { label: 'Delete', icon: Trash2, danger: true, onSelect: () => actions.deleteSheet(sheetId) },
  ];
}

function chartItems(chartId: string): MenuEntry[] {
  const chart = activeSheet().charts.find((c) => c.id === chartId);
  return [
    { label: 'Chart settings', icon: Settings2, onSelect: () => set({ panel: { type: 'chart', chartId }, selectedChart: chartId }) },
    {
      label: 'Change type',
      icon: ChartNoAxesColumn,
      submenu: (
        [
          ['column', 'Column'],
          ['bar', 'Bar'],
          ['line', 'Line'],
          ['area', 'Area'],
          ['pie', 'Pie'],
          ['doughnut', 'Doughnut'],
          ['scatter', 'Scatter'],
        ] as const
      ).map(([type, label]) => ({ label, checked: chart?.type === type, onSelect: () => actions.updateChart(chartId, { type }, 'Change chart type') })),
    },
    'separator',
    { label: 'Duplicate', icon: CopyPlus, onSelect: () => actions.duplicateChart(chartId) },
    { label: 'Bring to front', icon: BringToFront, onSelect: () => actions.reorderChart(chartId, 'front') },
    { label: 'Send to back', icon: SendToBack, onSelect: () => actions.reorderChart(chartId, 'back') },
    {
      label: 'Download as image',
      icon: Copy,
      onSelect: () => {
        if (!chart) return;
        const { workbook, engine } = useWorkbook.getState();
        void import('../charts/echarts').then(async ({ chartImage }) => {
          const url = chartImage(workbook, engine, activeSheet(), chart, 3);
          if (url) download(await (await fetch(url)).blob(), `${safeFileName(chart.title || 'chart')}.png`, 'image/png');
        });
      },
    },
    'separator',
    { label: 'Delete', icon: Trash2, danger: true, keys: 'Delete', onSelect: () => actions.deleteChart(chartId) },
  ];
}
