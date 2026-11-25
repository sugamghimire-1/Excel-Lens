/** Starter workbooks offered on the New screen. */
import { createWorkbook } from '@/engine/sheet';
import { CHECKBOX_FORMAT } from '@/engine/numberFormat';
import { themeById } from '@/engine/themes';
import { dateToSerial, localDateToSerial } from '@/formulas/values';
import type { CellStyle, Workbook } from '@/types';
import { startWorkbook } from '../io/fileActions';
import { SheetBuilder } from './builder';
import { SAMPLE_CELL, salesWorkbook } from './sample';

export interface Template {
  id: string;
  name: string;
  description: string;
  /** Colours for the thumbnail. */
  preview: 'blank' | 'dashboard' | 'budget' | 'tracker' | 'loan';
  build: () => Workbook;
  /** Cell selected when the template opens. */
  cell?: string;
}

const theme = themeById('cobalt');
const title: CellStyle = { fontSize: 18, bold: true, color: theme.ink, vAlign: 'middle' };
const muted: CellStyle = { color: '#5f6b7f' };
const input: CellStyle = { color: '#1f4fb8', fill: '#fff8de' };
const money: CellStyle = { numFmt: '$#,##0' };

function budgetWorkbook(): Workbook {
  const s = new SheetBuilder('Budget');
  s.width('A', 18).width('B', 170).width('C:E', 108).width('F', 120).width('G', 28).width('H:K', 92).height(2, 34);
  s.set('B2', 'Monthly budget', title).set('B3', 'Change the yellow cells. Everything else updates.', muted);
  const block = (start: number, name: string, rows: [string, number, number][], good: 'over' | 'under'): void => {
    s.row(`B${start}`, [name, 'Planned', 'Actual', 'Difference', 'Used']);
    rows.forEach(([label, plan, actual], i) => {
      const n = start + 1 + i;
      s.set(`B${n}`, label).set(`C${n}`, plan, { ...money, ...input }).set(`D${n}`, actual, { ...money, ...input });
      s.set(`E${n}`, good === 'over' ? `=D${n}-C${n}` : `=C${n}-D${n}`, { numFmt: '+$#,##0;-$#,##0;$0' }).set(`F${n}`, `=IFERROR(D${n}/C${n},0)`, { numFmt: '0%' });
    });
    const end = start + rows.length;
    const t = end + 1;
    s.set(`B${t}`, 'Total').set(`C${t}`, `=SUM(C${start + 1}:C${end})`, money).set(`D${t}`, `=SUM(D${start + 1}:D${end})`, money).set(`E${t}`, `=SUM(E${start + 1}:E${end})`, { numFmt: '+$#,##0;-$#,##0;$0' }).set(`F${t}`, `=IFERROR(D${t}/C${t},0)`, { numFmt: '0%' });
    s.style(`C${start}:F${start}`, { hAlign: 'right' });
    s.table(`B${start}:F${t}`, good === 'over' ? 'solid-3' : 'solid-1', { name, totalRow: true, bandedRows: false });
    s.rule(`F${start + 1}:F${end}`, { type: 'bar', color: theme.accents[good === 'over' ? 2 : 0] });
    s.rule(`E${start + 1}:E${t}`, { type: 'compare', op: 'lt', a: '0' }, { color: '#b42318', bold: true });
  };
  block(5, 'Income', [['Salary', 5200, 5200], ['Freelance', 600, 840], ['Interest', 40, 43]], 'over');
  block(11, 'Spending', [['Rent', 1650, 1650], ['Groceries', 520, 561], ['Transport', 180, 142], ['Utilities', 210, 224], ['Insurance', 190, 190], ['Eating out', 260, 318], ['Subscriptions', 65, 65], ['Savings', 1200, 1200]], 'under');
  s.set('B22', 'Left over', { bold: true, fontSize: 12, color: theme.ink }).set('D22', '=D9-D20', { numFmt: '$#,##0', bold: true, fontSize: 12 });
  s.validate('C6:D8', { kind: { type: 'decimal', op: 'gte', a: '0' }, required: false, errorStyle: 'stop', errorMessage: 'Enter zero or a positive amount.' });
  s.chart('doughnut', 'Budget!$B$11:$C$19', 'H5:K20', { title: 'Where the money goes' }, 0);
  s.set_({ showGridlines: false, tabColor: theme.accents[2] });
  return createWorkbook('Monthly budget', [s.build()]);
}

function trackerWorkbook(): Workbook {
  const s = new SheetBuilder('Tasks');
  const today = Math.floor(localDateToSerial(new Date()));
  s.width('A', 18).width('B', 74).width('C', 230).width('D', 120).width('E', 110).width('F:G', 106).width('H', 92).width('I', 110).height(2, 34).height(4, 26);
  s.set('B2', 'Project tracker', title);
  s.set('F2', '=COUNTIF(B5:B14,TRUE)&" of "&COUNTA(C5:C14)&" tasks done"', { ...muted, vAlign: 'middle' });
  s.row('B4', ['Done', 'Task', 'Owner', 'Status', 'Start', 'Due', 'Days left', 'Progress'], { vAlign: 'middle' });
  const tasks: [boolean, string, string, string, number, number, number][] = [
    [true, 'Agree scope and success measures', 'Maya Lind', 'Done', -24, -18, 1],
    [true, 'Interview five customers', 'Theo Park', 'Done', -20, -12, 1],
    [true, 'Draft information architecture', 'Ines Calder', 'Done', -14, -8, 1],
    [false, 'Design checkout flow', 'Ines Calder', 'In progress', -8, 2, 0.7],
    [false, 'Build product search', 'Jonas Reid', 'In progress', -6, 6, 0.45],
    [false, 'Payment provider contract', 'Maya Lind', 'Blocked', -10, -1, 0.3],
    [false, 'Migrate order history', 'Priya Nair', 'In progress', -2, 9, 0.2],
    [false, 'Accessibility review', 'Theo Park', 'Not started', 4, 12, 0],
    [false, 'Load testing', 'Jonas Reid', 'Not started', 8, 15, 0],
    [false, 'Launch checklist', 'Maya Lind', 'Not started', 12, 20, 0],
  ];
  tasks.forEach(([done, task, owner, status, start, due, progress], i) => {
    const n = i + 5;
    s.set(`B${n}`, done, { numFmt: CHECKBOX_FORMAT, hAlign: 'center' }).set(`C${n}`, task).set(`D${n}`, owner).set(`E${n}`, status, { hAlign: 'center' });
    s.set(`F${n}`, today + start, { numFmt: 'mmm d' }).set(`G${n}`, today + due, { numFmt: 'mmm d' });
    s.set(`H${n}`, `=IF(B${n},"",G${n}-TODAY())`, { hAlign: 'right' }).set(`I${n}`, progress, { numFmt: '0%' });
  });
  s.style('F4:H4', { hAlign: 'right' }).style('E4', { hAlign: 'center' });
  s.table('B4:I14', 'solid-1', { name: 'Tasks' }, true);
  s.rule('B5:I14', { type: 'formula', formula: '=$B5' }, { color: '#7a8699', strike: true });
  s.rule('H5:H14', { type: 'compare', op: 'lt', a: '0' }, { color: '#8f1d18', fill: '#fbdcda', bold: true });
  s.rule('E5:E14', { type: 'text', op: 'contains', text: 'Blocked' }, { color: '#8f1d18', fill: '#fbdcda' });
  s.rule('E5:E14', { type: 'text', op: 'contains', text: 'In progress' }, { color: '#1c49b8', fill: '#e2ebfc' });
  s.rule('E5:E14', { type: 'text', op: 'contains', text: 'Done' }, { color: '#14532d', fill: '#dcf3e2' });
  s.rule('I5:I14', { type: 'bar', color: theme.accents[0] });
  s.validate('E5:E60', { kind: { type: 'list', source: 'Not started, In progress, Blocked, Done' }, required: false, errorStyle: 'stop' });
  s.validate('I5:I60', { kind: { type: 'decimal', op: 'between', a: '0', b: '1' }, required: false, errorStyle: 'stop', errorMessage: 'Enter a progress value between 0% and 100%.' });
  s.set_({ showGridlines: false, frozenRows: 4, tabColor: theme.accents[6] });
  return createWorkbook('Project tracker', [s.build()]);
}

function loanWorkbook(): Workbook {
  const s = new SheetBuilder('Loan');
  s.width('A', 18).width('B', 150).width('C', 120).width('D', 28).width('E:I', 104).height(2, 34);
  s.set('B2', 'Loan calculator', title);
  const rows: [string, string | number, CellStyle][] = [
    ['Amount', 320000, { ...money, ...input }],
    ['Annual rate', 0.0575, { numFmt: '0.00%', ...input }],
    ['Years', 30, input],
    ['Start date', dateToSerial(2027, 1, 1), { numFmt: 'mmm yyyy', ...input }],
    ['Monthly payment', '=-PMT(C5/12,C6*12,C4)', { numFmt: '$#,##0.00', bold: true }],
    ['Total paid', '=C8*C6*12', { numFmt: '$#,##0' }],
    ['Total interest', '=C9-C4', { numFmt: '$#,##0' }],
  ];
  rows.forEach(([label, v, style], i) => s.set(`B${i + 4}`, label).set(`C${i + 4}`, v, { hAlign: 'right', ...style }));
  s.style('B8:C8', { fill: theme.tint });
  s.row('E3', ['Year', 'Balance', 'Principal', 'Interest', 'Paid off'], { hAlign: 'right' });
  for (let y = 0; y < 30; y++) {
    const n = 4 + y;
    s.set(`E${n}`, `=IF(${y + 1}<=$C$6,YEAR($C$7)+${y},"")`, { hAlign: 'right' });
    s.set(`F${n}`, `=IF(E${n}="","",MAX(0,-FV($C$5/12,${(y + 1) * 12},-$C$8,$C$4)))`, money);
    s.set(`G${n}`, y === 0 ? `=IF(E${n}="","",$C$4-F${n})` : `=IF(E${n}="","",F${n - 1}-F${n})`, money);
    s.set(`H${n}`, `=IF(E${n}="","",$C$8*12-G${n})`, money);
    s.set(`I${n}`, `=IF(E${n}="","",1-F${n}/$C$4)`, { numFmt: '0%' });
  }
  s.table('E3:I33', 'solid-1', { name: 'Schedule' }).rule('I4:I33', { type: 'bar', color: theme.accents[2] });
  s.validate('C4', { kind: { type: 'decimal', op: 'gt', a: '0' }, required: true, errorStyle: 'stop', errorMessage: 'Enter an amount above zero.' });
  s.validate('C5', { kind: { type: 'decimal', op: 'between', a: '0', b: '1' }, required: true, errorStyle: 'stop', errorMessage: 'Enter a rate between 0% and 100%.' });
  s.validate('C6', { kind: { type: 'whole', op: 'between', a: '1', b: '30' }, required: true, errorStyle: 'stop', errorMessage: 'Enter a whole number of years from 1 to 30.' });
  s.width('J', 28).width('K:P', 88);
  s.chart('area', 'Loan!$E$3:$H$33', 'K3:P19', { title: 'Balance, principal and interest by year', legendPosition: 'top' }, 0);
  s.set_({ showGridlines: false, tabColor: theme.accents[1] });
  return createWorkbook('Loan calculator', [s.build()]);
}

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Blank workbook', description: 'An empty sheet', preview: 'blank', build: () => createWorkbook('Untitled workbook') },
  { id: 'sales', name: 'Sales dashboard', description: 'Orders, targets and charts', preview: 'dashboard', build: salesWorkbook, cell: SAMPLE_CELL },
  { id: 'budget', name: 'Monthly budget', description: 'Planned against actual', preview: 'budget', build: budgetWorkbook, cell: 'D6' },
  { id: 'tracker', name: 'Project tracker', description: 'Tasks, owners and due dates', preview: 'tracker', build: trackerWorkbook, cell: 'C8' },
  { id: 'loan', name: 'Loan calculator', description: 'Payments and balance by year', preview: 'loan', build: loanWorkbook, cell: 'C8' },
];

export function openSample(): void {
  void startWorkbook(salesWorkbook(), SAMPLE_CELL);
}
