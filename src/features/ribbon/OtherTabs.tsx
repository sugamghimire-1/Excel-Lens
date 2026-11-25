import {
  ArrowDownAZ, ArrowRightFromLine, ArrowUpZA, BadgeInfo, BookOpen, Calculator, CalendarClock, ChartArea, ChartBar, ChartColumn, ChartLine, ChartNoAxesColumn, ChartPie, ChartScatter, CircleDot, CircleHelp, ClipboardCheck, ClipboardList, Columns3, CopyMinus, Contrast, Eraser,
  FileSpreadsheet, Filter, FilterX, Fullscreen, FunctionSquare, Grid2x2, Heading, History, Keyboard, Landmark, LetterText, Link, ListChecks, ListTree, LockKeyhole, LockOpen, MessageSquarePlus, MessageSquareText, MessageSquareX, Minus, Monitor, Moon, PanelTop, Palette,
  Plus, RefreshCw, RotateCw, Rows3, Search, Sigma, SlidersHorizontal, Snowflake, SplitSquareHorizontal, SquareCheckBig, SquareFunction, SquareSigma, Sun, Table2, Tag, Tags, TextSearch, TrendingUp, TriangleAlert, Workflow, ZoomIn,
} from 'lucide-react';
import type { MenuEntry } from '@/components/Menu';
import { allFunctions, type FunctionCategory } from '@/formulas';
import * as actions from '@/state/actions';
import { insertAtCaret, startEdit } from '@/state/editing';
import { useActiveSheet } from '@/state/selectors';
import { useUI, type ThemeMode } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import { APP_NAME } from '@/utils/brand';
import { openFileDialog } from '../io/fileActions';
import { openSample } from '../backstage/templates';
import { ThemeGallery } from './galleries';
import { BigButton, BigDrop, Group, Rows, SmallButton, SmallDrop, SplitBig } from './parts';

const set = (p: Parameters<ReturnType<typeof useUI.getState>['set']>[0]): void => useUI.getState().set(p);

/* ------------------------------------------------------------------ insert */

export function InsertTab() {
  return (
    <>
      <Group label="Tables">
        <BigButton label="Table" icon={Table2} keys="Ctrl+T" desc="Turn the selected data into a styled table with filters." onClick={() => actions.makeTable('solid-1')} />
      </Group>
      <Group label="Charts">
        <BigButton label="Column" icon={ChartColumn} desc="Compare values across categories." onClick={() => actions.insertChart('column')} />
        <BigButton label="Bar" icon={ChartBar} desc="Compare values when labels are long." onClick={() => actions.insertChart('bar')} />
        <BigButton label="Line" icon={ChartLine} desc="Show change over time." onClick={() => actions.insertChart('line')} />
        <BigButton label="Area" icon={ChartArea} desc="Show change over time with volume." onClick={() => actions.insertChart('area')} />
        <BigButton label="Pie" icon={ChartPie} desc="Show parts of a whole." onClick={() => actions.insertChart('pie')} />
        <Rows>
          <SmallButton label="Doughnut" icon={CircleDot} onClick={() => actions.insertChart('doughnut')} />
          <SmallButton label="Scatter" icon={ChartScatter} onClick={() => actions.insertChart('scatter')} />
        </Rows>
      </Group>
      <Group label="Sparklines">
        <Rows>
          <SmallButton label="Line" icon={TrendingUp} desc="A tiny line chart inside a cell." onClick={() => set({ dialog: { type: 'sparkline', kind: 'line' } })} />
          <SmallButton label="Column" icon={ChartNoAxesColumn} desc="A tiny column chart inside a cell." onClick={() => set({ dialog: { type: 'sparkline', kind: 'column' } })} />
          <SmallButton label="Win/loss" icon={Minus} desc="Shows only whether each value is positive or negative." onClick={() => set({ dialog: { type: 'sparkline', kind: 'winloss' } })} />
        </Rows>
      </Group>
      <Group label="Cells">
        <BigButton
          label="Checkbox"
          icon={SquareCheckBig}
          desc="Adds checkboxes to the selected cells."
          onClick={actions.insertCheckboxes}
        />
        <BigButton label="Link" icon={Link} keys="Ctrl+K" onClick={() => set({ dialog: { type: 'link' } })} />
        <BigButton label="Note" icon={MessageSquarePlus} keys="Shift+F2" onClick={actions.editNote} />
      </Group>
      <Group label="Values">
        <BigButton label="Function" icon={FunctionSquare} keys="Shift+F3" onClick={() => set({ dialog: { type: 'function' } })} />
        <Rows>
          <SmallButton label="Today's date" icon={CalendarClock} keys="Ctrl+;" onClick={() => actions.insertNow('date')} />
          <SmallButton label="Current time" icon={CalendarClock} keys="Ctrl+Shift+;" onClick={() => actions.insertNow('time')} />
        </Rows>
      </Group>
    </>
  );
}

/* -------------------------------------------------------------------- data */

export function DataTab() {
  const sheet = useActiveSheet();
  const circle = useUI((s) => s.circleInvalid);
  return (
    <>
      <Group label="Get data">
        <BigButton label="Import file" icon={FileSpreadsheet} desc="Open an .xlsx or .csv file as a new workbook." onClick={() => openFileDialog('workbook')} />
        <BigButton label="CSV as sheet" icon={Plus} desc="Add a .csv file to this workbook as a new sheet." onClick={() => openFileDialog('sheet')} />
      </Group>
      <Group label="Sort and filter">
        <Rows>
          <SmallButton label="Sort A to Z" icon={ArrowDownAZ} onClick={() => actions.sort(false)} />
          <SmallButton label="Sort Z to A" icon={ArrowUpZA} onClick={() => actions.sort(true)} />
        </Rows>
        <BigButton label="Custom sort" icon={SlidersHorizontal} onClick={() => set({ dialog: { type: 'sort' } })} />
        <BigButton label="Filter" icon={Filter} keys="Ctrl+Shift+L" active={sheet.filter !== null} onClick={actions.toggleFilter} />
        <Rows>
          <SmallButton label="Clear" icon={FilterX} disabled={!sheet.filter || !Object.keys(sheet.filter.criteria).length} onClick={actions.clearFilter} />
          <SmallButton label="Reapply" icon={RotateCw} disabled={!sheet.filter} onClick={actions.reapplyFilter} />
        </Rows>
      </Group>
      <Group label="Data tools">
        <BigButton label="Text to columns" icon={SplitSquareHorizontal} desc="Split text at commas, spaces or another character." onClick={() => set({ dialog: { type: 'split' } })} />
        <BigButton label="Remove duplicates" icon={CopyMinus} onClick={() => set({ dialog: { type: 'duplicates' } })} />
        <BigDrop
          label="Data validation"
          icon={ListChecks}
          items={[
            { label: 'Validation rules', icon: ListChecks, onSelect: () => set({ dialog: { type: 'validation' } }) },
            { label: 'Circle invalid data', icon: CircleDot, checked: circle, onSelect: () => set({ circleInvalid: !circle }) },
            { label: 'Clear validation', icon: Eraser, onSelect: () => actions.setValidation(null) },
          ]}
        />
      </Group>
      <Group label="Fill">
        <Rows>
          <SmallButton label="Fill down" icon={ArrowDownAZ} keys="Ctrl+D" onClick={() => actions.fillDir('down')} />
          <SmallButton label="Fill right" icon={ArrowRightFromLine} keys="Ctrl+R" onClick={() => actions.fillDir('right')} />
        </Rows>
      </Group>
    </>
  );
}

/* ---------------------------------------------------------------- formulas */

function functionMenu(category: FunctionCategory): MenuEntry[] {
  return [
    ...allFunctions()
      .filter((f) => f.category === category)
      .map((f): MenuEntry => ({ label: f.name, onSelect: () => actions.insertFunction(f.name) })),
    'separator',
    { label: 'Browse functions', icon: TextSearch, onSelect: () => set({ dialog: { type: 'function', category } }) },
  ];
}

export function FormulasTab() {
  const showFormulas = useUI((s) => s.showFormulas);
  const traces = useUI((s) => s.traces.length);
  const mode = useWorkbook((s) => s.engine.mode);
  useWorkbook((s) => s.revision);
  return (
    <>
      <Group label="Function library">
        <BigButton label="Insert function" icon={FunctionSquare} keys="Shift+F3" onClick={() => set({ dialog: { type: 'function' } })} />
        <SplitBig
          label="AutoSum"
          icon={Sigma}
          keys="Alt+="
          onClick={() => actions.autoSum()}
          items={['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN'].map((f) => ({ label: f, onSelect: () => actions.autoSum(f) }))}
        />
        <Rows>
          <SmallDrop label="Math" icon={SquareSigma} items={() => functionMenu('Math')} />
          <SmallDrop label="Logical" icon={Workflow} items={() => functionMenu('Logical')} />
          <SmallDrop label="Text" icon={LetterText} items={() => functionMenu('Text')} />
        </Rows>
        <Rows>
          <SmallDrop label="Lookup" icon={Search} items={() => functionMenu('Lookup')} />
          <SmallDrop label="Date and time" icon={CalendarClock} items={() => functionMenu('Date')} />
          <SmallDrop label="Financial" icon={Landmark} items={() => functionMenu('Financial')} />
        </Rows>
        <Rows>
          <SmallDrop label="Statistical" icon={ChartColumn} items={() => functionMenu('Statistical')} />
          <SmallDrop label="Arrays" icon={Grid2x2} items={() => functionMenu('Array')} />
          <SmallDrop label="Information" icon={BadgeInfo} items={() => functionMenu('Information')} />
        </Rows>
      </Group>
      <Group label="Defined names">
        <BigButton label="Name manager" icon={Tags} onClick={() => set({ dialog: { type: 'names' } })} />
        <Rows>
          <SmallButton label="Define name" icon={Tag} onClick={() => set({ dialog: { type: 'names', create: true } })} />
          <SmallDrop
            label="Use in formula"
            icon={SquareFunction}
            items={() => {
              const { names } = useWorkbook.getState().workbook;
              return names.length ? names.map((n) => ({ label: n.name, hint: n.ref, onSelect: () => insertName(n.name) })) : [{ label: 'No names defined yet', disabled: true }];
            }}
          />
        </Rows>
      </Group>
      <Group label="Formula auditing">
        <Rows>
          <SmallButton label="Trace precedents" icon={ListTree} desc="Show the cells this formula reads." onClick={() => actions.trace('precedents')} />
          <SmallButton label="Trace dependents" icon={Workflow} desc="Show the formulas that use this cell." onClick={() => actions.trace('dependents')} />
          <SmallButton label="Remove arrows" icon={Eraser} disabled={!traces} onClick={() => set({ traces: [] })} />
        </Rows>
        <Rows>
          <SmallButton label="Show formulas" icon={SquareFunction} keys="Ctrl+`" active={showFormulas} onClick={() => set({ showFormulas: !showFormulas })} />
          <SmallButton label="Next error" icon={TriangleAlert} onClick={actions.nextError} />
        </Rows>
      </Group>
      <Group label="Calculation">
        <BigDrop
          label="Calculation options"
          icon={Calculator}
          items={() => [
            { label: 'Automatic', checked: mode === 'auto', onSelect: () => actions.setCalcMode('auto') },
            { label: 'Manual', checked: mode === 'manual', onSelect: () => actions.setCalcMode('manual') },
          ]}
        />
        <BigButton label="Calculate now" icon={RefreshCw} keys="F9" onClick={actions.calculateNow} />
      </Group>
    </>
  );
}

function insertName(name: string): void {
  const { edit } = useUI.getState();
  if (edit) insertAtCaret(edit.text ? name : `=${name}`);
  else startEdit({ text: `=${name}`, mode: 'enter' });
}

/* ------------------------------------------------------------------ review */

export function ReviewTab() {
  const sheet = useActiveSheet();
  const panel = useUI((s) => s.panel);
  return (
    <>
      <Group label="Notes">
        <BigButton label="New note" icon={MessageSquarePlus} keys="Shift+F2" onClick={actions.editNote} />
        <Rows>
          <SmallButton label="Previous" icon={MessageSquareText} onClick={() => actions.gotoNote(-1)} />
          <SmallButton label="Next" icon={MessageSquareText} onClick={() => actions.gotoNote(1)} />
          <SmallButton label="Delete" icon={MessageSquareX} onClick={actions.deleteNote} />
        </Rows>
        <BigButton label="All notes" icon={ClipboardList} active={panel?.type === 'notes'} onClick={() => set({ panel: panel?.type === 'notes' ? null : { type: 'notes' } })} />
      </Group>
      <Group label="Check">
        <BigButton label="Workbook statistics" icon={ClipboardCheck} onClick={() => set({ dialog: { type: 'stats' } })} />
        <BigButton label="Next error" icon={TriangleAlert} desc="Jump to the next formula that returns an error." onClick={actions.nextError} />
      </Group>
      <Group label="Changes">
        <BigButton label={sheet.protected ? 'Unprotect sheet' : 'Protect sheet'} icon={sheet.protected ? LockOpen : LockKeyhole} active={sheet.protected} desc="Prevent accidental edits on this sheet." onClick={actions.toggleProtection} />
        <BigButton label="History" icon={History} active={panel?.type === 'history'} desc="See and undo recent changes." onClick={() => set({ panel: panel?.type === 'history' ? null : { type: 'history' } })} />
      </Group>
    </>
  );
}

/* -------------------------------------------------------------------- view */

export function ViewTab() {
  const sheet = useActiveSheet();
  const { theme, showFormulaBar, showHeadings, showFormulas } = useUI();
  const modes: [ThemeMode, string, typeof Sun][] = [
    ['light', 'Light', Sun],
    ['dark', 'Dark', Moon],
    ['system', 'System', Monitor],
  ];
  return (
    <>
      <Group label="Appearance">
        {modes.map(([m, label, icon]) => (
          <BigButton key={m} label={label} icon={icon} active={theme === m} onClick={() => useUI.getState().setTheme(m)} />
        ))}
        <BigDrop label="Themes" icon={Palette} desc="Change the workbook's colors." panel={(close) => <ThemeGallery close={close} />} />
      </Group>
      <Group label="Show">
        <Rows>
          <SmallButton label="Gridlines" icon={Grid2x2} active={sheet.showGridlines} onClick={actions.toggleGridlines} />
          <SmallButton label="Headings" icon={Heading} active={showHeadings} onClick={() => set({ showHeadings: !showHeadings })} />
          <SmallButton label="Formula bar" icon={PanelTop} active={showFormulaBar} onClick={() => set({ showFormulaBar: !showFormulaBar })} />
        </Rows>
        <Rows>
          <SmallButton label="Formulas" icon={SquareFunction} keys="Ctrl+`" active={showFormulas} onClick={() => set({ showFormulas: !showFormulas })} />
        </Rows>
      </Group>
      <Group label="Freeze">
        <BigDrop
          label="Freeze panes"
          icon={Snowflake}
          active={sheet.frozenRows + sheet.frozenCols > 0}
          items={() => [
            { label: 'Freeze at selection', icon: Snowflake, hint: 'Rows above and columns left stay visible', onSelect: () => actions.freeze('panes') },
            { label: 'Freeze top row', icon: Rows3, onSelect: () => actions.freeze('row') },
            { label: 'Freeze first column', icon: Columns3, onSelect: () => actions.freeze('col') },
            'separator',
            { label: 'Unfreeze', disabled: sheet.frozenRows + sheet.frozenCols === 0, onSelect: () => actions.freeze('none') },
          ]}
        />
      </Group>
      <Group label="Zoom">
        <BigDrop label="Zoom" icon={ZoomIn} items={[50, 75, 100, 125, 150, 200, 300].map((z) => ({ label: `${z}%`, checked: Math.round(sheet.zoom * 100) === z, onSelect: () => actions.setZoom(z / 100) }))} />
        <BigButton label="100%" icon={Contrast} onClick={() => actions.setZoom(1)} />
        <BigButton label="Fit selection" icon={Search} onClick={actions.zoomToSelection} />
      </Group>
      <Group label="Window">
        <BigButton
          label="Full screen"
          icon={Fullscreen}
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void document.documentElement.requestFullscreen().catch(() => useUI.getState().toast('info', 'Full screen is not available here.'));
          }}
        />
      </Group>
    </>
  );
}

/* -------------------------------------------------------------------- help */

export function HelpTab() {
  return (
    <Group label="Help">
      <BigButton label="Keyboard shortcuts" icon={Keyboard} keys="F1" onClick={() => set({ dialog: { type: 'shortcuts' } })} />
      <BigButton label="Function reference" icon={BookOpen} onClick={() => set({ dialog: { type: 'function' } })} />
      <BigButton label="Find a command" icon={Search} keys="Alt+Q" onClick={() => set({ palette: true })} />
      <BigButton label="Open sample" icon={FileSpreadsheet} desc="Open a fresh copy of the sales dashboard." onClick={openSample} />
      <BigButton label={`About ${APP_NAME}`} icon={CircleHelp} onClick={() => set({ dialog: { type: 'about' } })} />
    </Group>
  );
}
