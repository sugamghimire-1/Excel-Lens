import {
  AArrowDown, AArrowUp, AlignCenter, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, ArrowDownAZ, ArrowUpZA, Baseline, BetweenHorizontalStart, Bold, Brush, ChevronDown, ClipboardPaste, Columns3,
  Copy, DecimalsArrowLeft, DecimalsArrowRight, DollarSign, Eraser, EyeOff, Filter, FilterX, Grid2x2, Hash, IndentDecrease, IndentIncrease, Italic, Link2Off, MessageSquareX, MoveDown, MoveRight, MoveUp, PaintBucket, Palette, PencilLine, Percent,
  Replace, RotateCw, Rows3, Ruler, Scissors, Search, Sheet, Sigma, SlidersHorizontal, SquareDashedMousePointer, SquareMinus, SquarePlus, Strikethrough, Table2, TableCellsMerge, TextWrap, Trash2, Underline, WandSparkles,
} from 'lucide-react';
import { useState } from 'react';
import { ColorPicker } from '@/components/ColorPicker';
import { MenuList, type MenuEntry } from '@/components/Menu';
import { Popover } from '@/components/Popover';
import { tableAt } from '@/engine/commands/data';
import { effectiveStyle } from '@/engine/effective';
import { DEFAULT_FONT, DEFAULT_FONT_SIZE, FONT_FAMILIES, FONT_SIZES } from '@/engine/measure';
import { FORMAT_PRESETS, formatValue, isDateFormat, isPercentFormat } from '@/engine/numberFormat';
import { mergeAt } from '@/engine/sheet';
import { themeById } from '@/engine/themes';
import * as actions from '@/state/actions';
import { useActiveCell } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import { borderMenu, CellStyleGallery, conditionalMenu, TableStyleGallery } from './galleries';
import { BigDrop, Combo, Group, keepFocus, Row, Rows, Separator, SmallButton, SmallDrop, SplitBig, SplitTool, Tool } from './parts';

const dialog = (d: Parameters<ReturnType<typeof useUI.getState>['set']>[0]['dialog']): void => useUI.getState().set({ dialog: d });

export function HomeTab() {
  const { sheet, pos, style } = useActiveCell();
  const painter = useUI((s) => s.painter);
  const themeId = useWorkbook((s) => s.workbook.themeId);
  const theme = themeById(themeId);
  const shown = effectiveStyle(sheet, pos.r, pos.c, theme);
  const [fill, setFill] = useState('#fff3bf');
  const [ink, setInk] = useState('#c12d28');
  const merged = mergeAt(sheet, pos.r, pos.c) !== null;

  return (
    <>
      <Group label="Clipboard">
        <SplitBig label="Paste" icon={ClipboardPaste} keys="Ctrl+V" onClick={() => void actions.pasteFromSystem()} items={pasteMenu} />
        <Rows>
          <SmallButton label="Cut" icon={Scissors} keys="Ctrl+X" onClick={() => void actions.copyToSystem(true)} />
          <SmallButton label="Copy" icon={Copy} keys="Ctrl+C" onClick={() => void actions.copyToSystem(false)} />
          <span onDoubleClick={() => actions.startPainter(true)}>
            <SmallButton label="Format painter" icon={Brush} active={painter !== null} desc="Click, then select cells to copy formatting to. Double-click to use it several times." onClick={() => actions.startPainter(false)} />
          </span>
        </Rows>
      </Group>

      <Group label="Font">
        <Rows className="gap-1">
          <Row className="gap-1">
            <Combo label="Font" width={118} value={style?.fontFamily ?? DEFAULT_FONT} options={FONT_FAMILIES} render={(o) => <span style={{ fontFamily: o === DEFAULT_FONT ? undefined : o }}>{o}</span>} onPick={(v) => actions.format('Font', { fontFamily: v === DEFAULT_FONT ? null : v })} />
            <Combo label="Font size" width={54} numeric value={String(style?.fontSize ?? DEFAULT_FONT_SIZE)} options={FONT_SIZES.map(String)} onPick={(v) => Number(v) >= 1 && Number(v) <= 200 && actions.format('Font size', { fontSize: Number(v) === DEFAULT_FONT_SIZE ? null : Number(v) })} />
            <Tool label="Increase font size" icon={AArrowUp} keys="Ctrl+Shift+>" onClick={() => actions.changeFontSize(1)} />
            <Tool label="Decrease font size" icon={AArrowDown} keys="Ctrl+Shift+<" onClick={() => actions.changeFontSize(-1)} />
          </Row>
          <Row>
            <Tool label="Bold" icon={Bold} keys="Ctrl+B" active={shown?.bold} onClick={() => actions.toggleStyle('bold')} />
            <Tool label="Italic" icon={Italic} keys="Ctrl+I" active={shown?.italic} onClick={() => actions.toggleStyle('italic')} />
            <Tool label="Underline" icon={Underline} keys="Ctrl+U" active={shown?.underline} onClick={() => actions.toggleStyle('underline')} />
            <Tool label="Strikethrough" icon={Strikethrough} keys="Ctrl+5" active={shown?.strike} onClick={() => actions.toggleStyle('strike')} />
            <Separator />
            <SplitTool label="Bottom border" icon={Grid2x2} menuLabel="Borders" onClick={() => actions.borders('bottom')} items={borderMenu} />
            <SplitTool
              label="Fill color"
              icon={PaintBucket}
              strip={fill}
              menuLabel="Choose fill color"
              onClick={() => actions.format('Fill color', { fill })}
              panel={(close) => (
                <ColorPicker
                  value={style?.fill}
                  none="No fill"
                  onPick={(c) => {
                    close();
                    if (c) setFill(c);
                    actions.format('Fill color', { fill: c });
                  }}
                />
              )}
            />
            <SplitTool
              label="Font color"
              icon={Baseline}
              strip={ink}
              menuLabel="Choose font color"
              onClick={() => actions.format('Font color', { color: ink })}
              panel={(close) => (
                <ColorPicker
                  value={style?.color}
                  none="Automatic"
                  onPick={(c) => {
                    close();
                    if (c) setInk(c);
                    actions.format('Font color', { color: c });
                  }}
                />
              )}
            />
          </Row>
        </Rows>
      </Group>

      <Group label="Alignment">
        <Rows className="gap-1">
          <Row>
            <Tool label="Top align" icon={AlignVerticalJustifyStart} active={shown?.vAlign === 'top'} onClick={() => actions.setVAlign('top')} />
            <Tool label="Middle align" icon={AlignVerticalJustifyCenter} active={shown?.vAlign === 'middle'} onClick={() => actions.setVAlign('middle')} />
            <Tool label="Bottom align" icon={AlignVerticalJustifyEnd} active={shown?.vAlign === 'bottom'} onClick={() => actions.setVAlign('bottom')} />
            <Separator />
            <Tool label="Decrease indent" icon={IndentDecrease} onClick={() => actions.changeIndent(-1)} />
            <Tool label="Increase indent" icon={IndentIncrease} onClick={() => actions.changeIndent(1)} />
          </Row>
          <Row>
            <Tool label="Align left" icon={AlignLeft} active={shown?.hAlign === 'left'} onClick={() => actions.setHAlign('left')} />
            <Tool label="Center" icon={AlignCenter} active={shown?.hAlign === 'center'} onClick={() => actions.setHAlign('center')} />
            <Tool label="Align right" icon={AlignRight} active={shown?.hAlign === 'right'} onClick={() => actions.setHAlign('right')} />
            <Separator />
            <Tool label="Wrap text" icon={TextWrap} active={shown?.wrap} onClick={() => actions.toggleStyle('wrap')} />
            <SplitTool
              label="Merge and center"
              icon={TableCellsMerge}
              menuLabel="Merge options"
              active={merged}
              onClick={() => actions.merge('toggle')}
              items={[
                { label: 'Merge and center', onSelect: () => actions.merge('center') },
                { label: 'Merge across', onSelect: () => actions.merge('across') },
                { label: 'Merge cells', onSelect: () => actions.merge('all') },
                'separator',
                { label: 'Unmerge cells', onSelect: () => actions.merge('unmerge') },
              ]}
            />
          </Row>
        </Rows>
      </Group>

      <Group label="Number">
        <Rows className="gap-1">
          <NumberFormatSelect code={style?.numFmt} />
          <Row>
            <Tool label="Currency" icon={DollarSign} keys="Ctrl+Shift+$" onClick={() => actions.setNumberFormat('$#,##0.00;[Red]-$#,##0.00')} />
            <Tool label="Percent" icon={Percent} keys="Ctrl+Shift+%" active={isPercentFormat(style?.numFmt)} onClick={() => actions.setNumberFormat('0%')} />
            <Tool label="Thousands separator" icon={Hash} keys="Ctrl+Shift+!" onClick={() => actions.setNumberFormat('#,##0.00')} />
            <Separator />
            <Tool label="Increase decimals" icon={DecimalsArrowRight} onClick={() => actions.changeDecimals(1)} />
            <Tool label="Decrease decimals" icon={DecimalsArrowLeft} onClick={() => actions.changeDecimals(-1)} />
          </Row>
        </Rows>
      </Group>

      <Group label="Styles">
        <Rows>
          <SmallDrop label="Conditional formatting" icon={WandSparkles} items={conditionalMenu} />
          <SmallDrop label="Format as table" icon={Table2} active={tableAt(sheet, pos.r, pos.c) !== null} panel={(close) => <TableStyleGallery close={close} />} />
          <SmallDrop label="Cell styles" icon={Palette} panel={(close) => <CellStyleGallery close={close} />} />
        </Rows>
      </Group>

      <Group label="Cells">
        <Rows>
          <SmallDrop label="Insert" icon={SquarePlus} items={insertMenu} />
          <SmallDrop label="Delete" icon={SquareMinus} items={deleteMenu} />
          <SmallDrop label="Format" icon={SlidersHorizontal} items={formatMenu} />
        </Rows>
      </Group>

      <Group label="Editing">
        <SplitBig
          label="AutoSum"
          icon={Sigma}
          keys="Alt+="
          onClick={() => actions.autoSum()}
          items={[
            { label: 'Sum', onSelect: () => actions.autoSum('SUM') },
            { label: 'Average', onSelect: () => actions.autoSum('AVERAGE') },
            { label: 'Count numbers', onSelect: () => actions.autoSum('COUNT') },
            { label: 'Max', onSelect: () => actions.autoSum('MAX') },
            { label: 'Min', onSelect: () => actions.autoSum('MIN') },
            'separator',
            { label: 'More functions', onSelect: () => dialog({ type: 'function' }) },
          ]}
        />
        <Rows>
          <SmallDrop
            label="Fill"
            icon={MoveDown}
            items={[
              { label: 'Down', icon: MoveDown, keys: 'Ctrl+D', onSelect: () => actions.fillDir('down') },
              { label: 'Right', icon: MoveRight, keys: 'Ctrl+R', onSelect: () => actions.fillDir('right') },
              { label: 'Up', icon: MoveUp, onSelect: () => actions.fillDir('up') },
            ]}
          />
          <SmallDrop
            label="Clear"
            icon={Eraser}
            items={[
              { label: 'Clear all', icon: Trash2, onSelect: () => actions.clear('all') },
              { label: 'Clear formatting', icon: Eraser, keys: 'Ctrl+\\', onSelect: () => actions.clear('formats') },
              { label: 'Clear contents', icon: SquareDashedMousePointer, keys: 'Delete', onSelect: () => actions.clear('contents') },
              { label: 'Clear notes', icon: MessageSquareX, onSelect: () => actions.clear('notes') },
              { label: 'Remove links', icon: Link2Off, onSelect: () => actions.clear('links') },
            ]}
          />
        </Rows>
        <BigDrop
          label="Sort and filter"
          icon={Filter}
          active={sheet.filter !== null}
          items={() => [
            { label: 'Sort A to Z', icon: ArrowDownAZ, onSelect: () => actions.sort(false) },
            { label: 'Sort Z to A', icon: ArrowUpZA, onSelect: () => actions.sort(true) },
            { label: 'Custom sort', icon: SlidersHorizontal, onSelect: () => dialog({ type: 'sort' }) },
            'separator',
            { label: 'Filter', icon: Filter, keys: 'Ctrl+Shift+L', checked: sheet.filter !== null, onSelect: actions.toggleFilter },
            { label: 'Clear filter', icon: FilterX, disabled: !sheet.filter, onSelect: actions.clearFilter },
            { label: 'Reapply', icon: RotateCw, disabled: !sheet.filter, onSelect: actions.reapplyFilter },
          ]}
        />
        <BigDrop
          label="Find and select"
          icon={Search}
          items={[
            { label: 'Find', icon: Search, keys: 'Ctrl+F', onSelect: () => dialog({ type: 'find', replace: false }) },
            { label: 'Replace', icon: Replace, keys: 'Ctrl+H', onSelect: () => dialog({ type: 'find', replace: true }) },
            { label: 'Go to', icon: MoveRight, keys: 'Ctrl+G', onSelect: () => dialog({ type: 'goto' }) },
          ]}
        />
      </Group>
    </>
  );
}

function pasteMenu(): MenuEntry[] {
  return [
    { label: 'Paste', icon: ClipboardPaste, keys: 'Ctrl+V', onSelect: () => void actions.pasteFromSystem('all') },
    { label: 'Values only', icon: Hash, keys: 'Ctrl+Shift+V', onSelect: () => void actions.pasteFromSystem('values') },
    { label: 'Formulas only', icon: Sigma, onSelect: () => void actions.pasteFromSystem('formulas') },
    { label: 'Values and formatting', icon: PencilLine, onSelect: () => void actions.pasteFromSystem('valuesAndFormats') },
    { label: 'Formatting only', icon: Brush, onSelect: () => void actions.pasteFromSystem('formats') },
    { label: 'Transposed', icon: RotateCw, onSelect: () => void actions.pasteFromSystem('transpose') },
    { label: 'Column widths', icon: Ruler, onSelect: () => void actions.pasteFromSystem('widths') },
    { label: 'Link to cells', icon: MoveRight, onSelect: () => void actions.pasteFromSystem('link') },
  ];
}

function insertMenu(): MenuEntry[] {
  return [
    { label: 'Insert cells', icon: BetweenHorizontalStart, onSelect: () => dialog({ type: 'shift', mode: 'insert' }) },
    { label: 'Insert rows above', icon: Rows3, onSelect: () => actions.insertRows() },
    { label: 'Insert columns left', icon: Columns3, onSelect: () => actions.insertCols() },
    { label: 'Insert sheet', icon: Sheet, keys: 'Shift+F11', onSelect: () => actions.newSheet() },
  ];
}

function deleteMenu(): MenuEntry[] {
  return [
    { label: 'Delete cells', icon: SquareMinus, onSelect: () => dialog({ type: 'shift', mode: 'delete' }) },
    { label: 'Delete rows', icon: Rows3, onSelect: actions.deleteRows },
    { label: 'Delete columns', icon: Columns3, onSelect: actions.deleteCols },
    { label: 'Delete sheet', icon: Sheet, onSelect: () => actions.deleteSheet(useUI.getState().activeSheetId) },
  ];
}

function formatMenu(): MenuEntry[] {
  return [
    { heading: 'Size' },
    { label: 'Row height', icon: Ruler, onSelect: () => dialog({ type: 'size', axis: 'row' }) },
    { label: 'AutoFit row height', icon: Rows3, onSelect: () => actions.autoFit('row') },
    { label: 'Column width', icon: Ruler, onSelect: () => dialog({ type: 'size', axis: 'col' }) },
    { label: 'AutoFit column width', icon: Columns3, onSelect: () => actions.autoFit('col') },
    { heading: 'Visibility' },
    { label: 'Hide rows', icon: EyeOff, keys: 'Ctrl+9', onSelect: () => actions.hideAxis('row', true) },
    { label: 'Unhide rows', keys: 'Ctrl+Shift+9', onSelect: () => actions.hideAxis('row', false) },
    { label: 'Hide columns', icon: EyeOff, keys: 'Ctrl+0', onSelect: () => actions.hideAxis('col', true) },
    { label: 'Unhide columns', keys: 'Ctrl+Shift+0', onSelect: () => actions.hideAxis('col', false) },
    'separator',
    { label: 'Rename sheet', icon: PencilLine, onSelect: () => useUI.getState().set({ renamingSheet: useUI.getState().activeSheetId }) },
    { label: 'Format cells', icon: SlidersHorizontal, keys: 'Ctrl+1', onSelect: () => dialog({ type: 'format' }) },
  ];
}

function NumberFormatSelect({ code }: { code: string | undefined }) {
  const current = FORMAT_PRESETS.find((p) => p.code === code)?.label ?? (isDateFormat(code) ? 'Date' : isPercentFormat(code) ? 'Percentage' : /[$€£¥₹]/.test(code ?? '') ? 'Currency' : 'Custom');
  return (
    <Popover
      trigger={(p) => (
        <button type="button" {...keepFocus} {...p} aria-label="Number format" className="flex h-[26px] w-[138px] items-center justify-between rounded-md border border-line bg-panel pl-2 pr-1 text-xs transition-colors hover:border-line-strong">
          {current}
          <ChevronDown size={12} className="text-ink-3" />
        </button>
      )}
    >
      {(close) => (
        <MenuList
          onClose={close}
          className="w-[250px]"
          items={[
            ...FORMAT_PRESETS.map((f): MenuEntry => ({ label: f.label, hint: typeof f.sample === 'number' ? formatValue(f.sample, f.code).text.trim() : String(f.sample), checked: f.code === code, onSelect: () => actions.setNumberFormat(f.code) })),
            'separator',
            { label: 'More number formats', onSelect: () => dialog({ type: 'format', tab: 'number' }) },
          ]}
        />
      )}
    </Popover>
  );
}
