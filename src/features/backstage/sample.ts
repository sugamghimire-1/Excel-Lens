/** The sales dashboard that opens on first run. */
import { colName } from '@/engine/address';
import { createWorkbook } from '@/engine/sheet';
import { lighten, themeById } from '@/engine/themes';
import { dateToSerial } from '@/formulas/values';
import type { CellStyle, Workbook } from '@/types';
import { SheetBuilder } from './builder';

/** Selected on first open, so the formula bar shows a real formula. */
export const SAMPLE_CELL = 'C17';

/** Deterministic generator, so the sample is the same every time. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRODUCTS: [name: string, category: string, price: number, cost: number, stock: number, reorder: number][] = [
  ['Aero 45 wheelset', 'Wheels', 420, 271, 64, 40],
  ['Trail 29 wheelset', 'Wheels', 365, 240, 31, 40],
  ['12-speed groupset', 'Drivetrain', 610, 418, 22, 25],
  ['Chainring 48T', 'Drivetrain', 78, 33, 210, 90],
  ['Hydraulic disc set', 'Brakes', 189, 104, 96, 60],
  ['Rotor pair 160 mm', 'Brakes', 64, 24, 330, 120],
  ['Carbon bar 420 mm', 'Cockpit', 145, 72, 58, 50],
  ['Alloy stem 100 mm', 'Cockpit', 58, 21, 140, 80],
  ['Endurance saddle', 'Saddles', 112, 49, 47, 60],
  ['Race saddle', 'Saddles', 138, 63, 88, 50],
];

const CUSTOMERS: [string, string][] = [
  ['Velo Norte', 'North'],
  ['Pedal & Post', 'East'],
  ['Ridgeline Bikes', 'West'],
  ['Harbor Cycle Co.', 'East'],
  ['Two Wheel Supply', 'South'],
  ['Summit Cycleworks', 'West'],
  ['Canal Street Bikes', 'East'],
  ['Old Mill Cycles', 'North'],
  ['Bridgeport Velo', 'East'],
  ['Cedar Valley Bikes', 'South'],
  ['Northgate Cycling', 'North'],
  ['Lakeshore Riders', 'North'],
  ['Foundry Bikes', 'West'],
  ['Sandstone Cycles', 'South'],
];

const REPS: Record<string, string[]> = { North: ['Maya Lind', 'Theo Park'], East: ['Ines Calder', 'Maya Lind'], South: ['Jonas Reid', 'Theo Park'], West: ['Priya Nair', 'Ines Calder'] };
const REP_NAMES = ['Maya Lind', 'Theo Park', 'Ines Calder', 'Jonas Reid', 'Priya Nair'];
const REGIONS = ['North', 'East', 'South', 'West'];
const CATEGORIES = ['Wheels', 'Drivetrain', 'Brakes', 'Cockpit', 'Saddles'];
const STATUSES = ['Delivered', 'Shipped', 'Processing', 'On hold'];
const MONTHS = 12;
/** Orders per month and targets, December 2025 to November 2026. */
const VOLUME = [15, 13, 15, 19, 22, 25, 27, 26, 23, 22, 20, 19];
const TARGETS = [52000, 50000, 54000, 66000, 78000, 88000, 92000, 90000, 82000, 76000, 70000, 72000];
const monthStart = (i: number): number => dateToSerial(2025, 12 + i, 1);

export function salesWorkbook(): Workbook {
  const theme = themeById('cobalt');
  const [blue, orange, teal] = theme.accents;
  const rand = random(20261125);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];

  /* ---------------------------------------------------------------- orders */
  const orders = new SheetBuilder('Orders');
  orders.row('A1', ['Order', 'Date', 'Customer', 'Region', 'Rep', 'Product', 'Category', 'Units', 'Unit price', 'Discount', 'Revenue', 'Status']);
  let r = 1;
  for (let m = 0; m < MONTHS; m++) {
    const days = Math.min(monthStart(m + 1) - monthStart(m), m === MONTHS - 1 ? 24 : 31);
    const dates = Array.from({ length: VOLUME[m] }, () => monthStart(m) + Math.floor(rand() * days)).sort((a, b) => a - b);
    for (const date of dates) {
      const [customer, region] = pick(CUSTOMERS);
      const product = PRODUCTS[Math.floor(rand() ** 1.15 * PRODUCTS.length)];
      const units = Math.max(2, Math.round((product[2] > 300 ? 11 : product[2] > 100 ? 20 : 34) * (0.45 + rand() * 1.25)));
      const discount = rand() < 0.45 ? 0 : pick([0.05, 0.05, 0.1, 0.1, 0.15]);
      const recent = date > dateToSerial(2026, 11, 12);
      const status = recent ? pick(STATUSES) : date > dateToSerial(2026, 10, 25) ? pick(['Delivered', 'Delivered', 'Shipped', 'On hold']) : 'Delivered';
      const n = r + 1;
      orders.at(r, 0, `HC-${1000 + r}`, { color: '#4a566a' });
      orders.at(r, 1, date, { numFmt: 'mmm d, yyyy' });
      orders.at(r, 2, customer);
      orders.at(r, 3, region);
      orders.at(r, 4, pick(REPS[region]));
      orders.at(r, 5, product[0]);
      orders.at(r, 6, `=XLOOKUP(F${n},Products!$A$2:$A$11,Products!$B$2:$B$11)`);
      orders.at(r, 7, units, { numFmt: '#,##0' });
      orders.at(r, 8, `=XLOOKUP(F${n},Products!$A$2:$A$11,Products!$C$2:$C$11)`, { numFmt: '$#,##0' });
      orders.at(r, 9, discount, { numFmt: '0%;;"–"', hAlign: 'right' });
      orders.at(r, 10, `=H${n}*I${n}*(1-J${n})`, { numFmt: '$#,##0', bold: true });
      orders.at(r, 11, status, { hAlign: 'center' });
      r++;
    }
  }
  const last = r;
  orders
    .width('A', 84)
    .width('B', 108)
    .width('C', 158)
    .width('D', 88)
    .width('E', 108)
    .width('F', 152)
    .width('G', 104)
    .width('H', 78)
    .width('I', 100)
    .width('J', 96)
    .width('K', 100)
    .width('L', 108)
    .height(1, 28)
    .style('A1:L1', { vAlign: 'middle' })
    .style('H1:K1', { hAlign: 'right' })
    .style('L1', { hAlign: 'center' })
    .table(`A1:L${last}`, 'solid-1', { name: 'Orders' }, true)
    .rule(`L2:L${last}`, { type: 'text', op: 'contains', text: 'On hold' }, { color: '#8f1d18', fill: '#fbdcda', bold: true })
    .rule(`L2:L${last}`, { type: 'text', op: 'contains', text: 'Processing' }, { color: '#7a4d05', fill: '#fdeec4' })
    .rule(`L2:L${last}`, { type: 'text', op: 'contains', text: 'Shipped' }, { color: '#1c49b8', fill: '#e2ebfc' })
    .rule(`L2:L${last}`, { type: 'text', op: 'contains', text: 'Delivered' }, { color: '#14532d', fill: '#dcf3e2' })
    .rule(`K2:K${last}`, { type: 'bar', color: teal })
    .validate(`L2:L${last + 200}`, { kind: { type: 'list', source: STATUSES.join(', ') }, required: false, errorStyle: 'stop', errorTitle: 'Unknown status', errorMessage: 'Choose Delivered, Shipped, Processing or On hold.' })
    .validate(`J2:J${last + 200}`, { kind: { type: 'decimal', op: 'between', a: '0', b: '0.3' }, required: false, errorStyle: 'warning', errorTitle: 'Large discount', errorMessage: 'Discounts above 30% need approval.' })
    .validate(`F2:F${last + 200}`, { kind: { type: 'list', source: '=Products!$A$2:$A$11' }, required: true, errorStyle: 'stop' })
    .set_({ frozenRows: 1, tabColor: teal });

  /* -------------------------------------------------------------- products */
  const products = new SheetBuilder('Products');
  products.row('A1', ['Product', 'Category', 'Unit price', 'Unit cost', 'Margin', 'In stock', 'Reorder at', 'Action', 'Units sold']);
  PRODUCTS.forEach(([name, category, price, cost, stock, reorder], i) => {
    const n = i + 2;
    products.row(`A${n}`, [name, category]);
    products.set(`C${n}`, price, { numFmt: '$#,##0.00' }).set(`D${n}`, cost, { numFmt: '$#,##0.00' });
    products.set(`E${n}`, `=(C${n}-D${n})/C${n}`, { numFmt: '0.0%' });
    products.set(`F${n}`, stock, { numFmt: '#,##0' }).set(`G${n}`, reorder, { numFmt: '#,##0' });
    products.set(`H${n}`, `=IF(F${n}<G${n},"Reorder "&(G${n}*2-F${n}),"OK")`);
    products.set(`I${n}`, `=SUMIFS(Orders!$H:$H,Orders!$F:$F,A${n})`, { numFmt: '#,##0' });
  });
  products
    .width('A', 168)
    .width('B', 110)
    .width('C:I', 104)
    .height(1, 28)
    .style('A1:I1', { vAlign: 'middle' })
    .style('C1:G1', { hAlign: 'right' })
    .style('I1', { hAlign: 'right' })
    .table('A1:I11', 'lined-1', { name: 'Products', firstColumn: true })
    .rule('E2:E11', { type: 'scale', colors: ['#fde2c8', '#ffffff', '#a9dcc9'] })
    .rule('H2:H11', { type: 'text', op: 'begins', text: 'Reorder' }, { color: '#8f1d18', bold: true })
    .rule('F2:F11', { type: 'formula', formula: '=F2<G2' }, { fill: '#fbdcda', color: '#8f1d18' })
    .rule('I2:I11', { type: 'bar', color: blue })
    .set_({ frozenRows: 1 });

  /* --------------------------------------------------------------- targets */
  const targets = new SheetBuilder('Targets');
  targets.set('A1', 'Monthly targets', { bold: true, fontSize: 14, color: theme.ink }).row('A3', ['Month', 'Target']);
  TARGETS.forEach((t, i) => {
    targets.set(`A${i + 4}`, monthStart(i), { numFmt: 'mmm yyyy', hAlign: 'left' });
    targets.set(`B${i + 4}`, t, { numFmt: '$#,##0', color: '#1f4fb8', fill: '#fff8de' });
  });
  targets.set('A16', 'Total').set('B16', '=SUM(B4:B15)', { numFmt: '$#,##0' });
  targets.set('D1', 'Rep quotas', { bold: true, fontSize: 14, color: theme.ink }).row('D3', ['Rep', 'Quota', 'Booked', 'Attainment']);
  REP_NAMES.forEach((name, i) => {
    const n = i + 4;
    targets.set(`D${n}`, name).set(`E${n}`, [225000, 160000, 190000, 110000, 130000][i], { numFmt: '$#,##0', color: '#1f4fb8', fill: '#fff8de' });
    targets.set(`F${n}`, `=SUMIFS(Orders!$K:$K,Orders!$E:$E,D${n})`, { numFmt: '$#,##0' }).set(`G${n}`, `=F${n}/E${n}`, { numFmt: '0%' });
  });
  targets
    .height(1, 30)
    .width('A:B', 112)
    .width('C', 32)
    .width('D', 128)
    .width('E:G', 112)
    .table('A3:B16', 'lined-1', { name: 'MonthTargets', totalRow: true })
    .table('D3:G8', 'lined-1', { name: 'Quotas' })
    .style('B3', { hAlign: 'right' })
    .style('E3:G3', { hAlign: 'right' })
    .rule('G4:G8', { type: 'icons', set: 'arrows' })
    .validate('B4:B15', { kind: { type: 'decimal', op: 'gt', a: '0' }, required: true, errorStyle: 'stop', errorMessage: 'Enter a target above zero.', inputTitle: 'Monthly target', inputMessage: 'Dollars, before returns.' });

  /* ------------------------------------------------------------ by month */
  const grid = new SheetBuilder('Regions by month');
  grid.set('A1', 'Revenue by region and month', { bold: true, fontSize: 14, color: theme.ink });
  grid.set('A3', 'Region');
  for (let m = 0; m < MONTHS; m++) grid.at(2, m + 1, monthStart(m), { numFmt: 'mmm yy', hAlign: 'right' });
  grid.set('N3', 'Total', { hAlign: 'right' }).set('O3', 'Trend', { hAlign: 'center' });
  REGIONS.forEach((region, i) => {
    const n = i + 4;
    grid.set(`A${n}`, region, { bold: true });
    for (let m = 0; m < MONTHS; m++) {
      const c = colName(m + 1);
      grid.at(n - 1, m + 1, `=SUMIFS(Orders!$K:$K,Orders!$D:$D,$A${n},Orders!$B:$B,">="&${c}$3,Orders!$B:$B,"<"&EDATE(${c}$3,1))`, { numFmt: '#,##0' });
    }
    grid.set(`N${n}`, `=SUM(B${n}:M${n})`, { numFmt: '$#,##0', bold: true }).sparkline(`O${n}`, `B${n}:M${n}`, 'line', blue);
  });
  grid.set('A8', 'Total');
  for (let m = 0; m <= MONTHS; m++) grid.at(7, m + 1, `=SUM(${colName(m + 1)}4:${colName(m + 1)}7)`, { numFmt: m === MONTHS ? '$#,##0' : '#,##0' });
  grid
    .sparkline('O8', 'B8:M8', 'column', theme.ink)
    .width('A', 96)
    .width('B:M', 70)
    .width('N', 96)
    .width('O', 118)
    .height(1, 30)
    .height(3, 26)
    .style('A3:O3', { vAlign: 'middle' })
    .table('A3:O8', 'lined-1', { name: 'RegionMonths', totalRow: true, bandedRows: false })
    .rule('B4:M7', { type: 'scale', colors: ['#ffffff', lighten(blue, 0.45)] })
    .chart('column', "'Regions by month'!$A$3:$M$7", 'B10:N28', { title: 'Revenue by region', seriesInRows: true, stacked: true }, 0)
    .set_({ frozenCols: 1 });

  /* ------------------------------------------------------------- dashboard */
  const d = new SheetBuilder('Dashboard');
  const muted: CellStyle = { color: '#5f6b7f' };
  const head: CellStyle = { bold: true, fontSize: 12, color: theme.ink, vAlign: 'middle' };
  d.width('A', 18).width('B', 100).width('C:G', 82).width('H', 22).width('I:N', 82).width('O', 22).width('P:S', 80);
  d.height(1, 12).height(2, 34).height(3, 20).height(4, 10);

  d.set('B2', 'Halden Cycles sales', { fontSize: 20, bold: true, color: theme.ink, vAlign: 'middle' });
  d.set('B3', '="Orders from "&TEXT(MIN(Orders!B:B),"mmm d, yyyy")&" to "&TEXT(MAX(Orders!B:B),"mmm d, yyyy")', muted);

  // Summary tiles: label, figure with trend, and one line of context.
  const tiles: [cols: string[], label: string, formula: string, fmt: string, foot: string, spark: string | null][] = [
    [['B', 'C', 'D'], 'Revenue', '=SUM(C12:C23)', '$#,##0', '=TEXT(C23/C22-1,"+0.0%;-0.0%")&" on last month"', 'C12:C23'],
    [['E', 'F', 'G'], 'Orders', '=COUNTA(Orders!A:A)-1', '#,##0', '=G23&" so far this month"', 'G12:G23'],
    [['I', 'J', 'K'], 'Average order', '=B6/E6', '$#,##0', '="Largest "&TEXT(MAX(Orders!K:K),"$#,##0")', null],
    [['L', 'M', 'N'], 'Target attainment', '=B6/Targets!B16', '0.0%', '=COUNTIF(F12:F23,">=1")&" of 12 months on target"', 'F12:F23'],
    [['P', 'Q', 'S'], 'Open orders', '=COUNTIF(Orders!L:L,"Processing")+COUNTIF(Orders!L:L,"Shipped")+COUNTIF(Orders!L:L,"On hold")', '#,##0', '=COUNTIF(Orders!L:L,"On hold")&" on hold"', null],
  ];
  d.height(5, 26).height(6, 38).height(7, 24).height(8, 14);
  tiles.forEach(([[a, b, z], label, formula, fmt, foot, spark], i) => {
    const color = theme.accents[[0, 0, 0, 0, 1][i]];
    const fill = i === 4 ? lighten(orange, 0.88) : theme.tint;
    d.style(`${a}5:${z}7`, { fill });
    d.style(`${a}5:${a}7`, { borderLeft: { style: 'thick', color } });
    d.set(`${a}5`, label, { color: '#47536a', vAlign: 'bottom', indent: 1 });
    d.set(`${a}6`, formula, { numFmt: fmt, fontSize: 20, bold: true, color: theme.ink, vAlign: 'middle', hAlign: 'left', indent: 1 });
    d.set(`${a}7`, foot, { color: '#5f6b7f', vAlign: 'top', indent: 1, fontSize: 9 });
    d.merge(`${a}5:${z}5`, spark ? `${a}6:${b}6` : `${a}6:${z}6`, `${a}7:${z}7`);
    if (spark) d.sparkline(`${z}6`, spark, i === 1 ? 'column' : 'line', color);
  });
  d.note('L6', 'Revenue divided by the total on the Targets sheet.');

  // Monthly performance
  d.height(9, 26).height(10, 6).height(11, 24);
  d.set('B9', 'Monthly performance', head);
  d.row('B11', ['Month', 'Revenue', 'Target', 'Variance', 'Attained', 'Orders']);
  d.style('C11:G11', { hAlign: 'right' });
  d.style('B11:G11', { vAlign: 'middle' });
  for (let m = 0; m < MONTHS; m++) {
    const n = 12 + m;
    d.set(`B${n}`, `=Targets!A${4 + m}`, { numFmt: 'mmm yyyy', hAlign: 'left' });
    d.set(`C${n}`, `=SUMIFS(Orders!$K:$K,Orders!$B:$B,">="&$B${n},Orders!$B:$B,"<"&EDATE($B${n},1))`, { numFmt: '$#,##0' });
    d.set(`D${n}`, `=Targets!B${4 + m}`, { numFmt: '$#,##0' });
    d.set(`E${n}`, `=C${n}-D${n}`, { numFmt: '+#,##0;-#,##0;0' });
    d.set(`F${n}`, `=IFERROR(C${n}/D${n},0)`, { numFmt: '0%' });
    d.set(`G${n}`, `=COUNTIFS(Orders!$B:$B,">="&$B${n},Orders!$B:$B,"<"&EDATE($B${n},1))`, { numFmt: '#,##0' });
  }
  d.set('B24', 'Total').set('C24', '=SUM(C12:C23)', { numFmt: '$#,##0' }).set('D24', '=SUM(D12:D23)', { numFmt: '$#,##0' }).set('E24', '=C24-D24', { numFmt: '+#,##0;-#,##0;0' }).set('F24', '=C24/D24', { numFmt: '0%' }).set('G24', '=SUM(G12:G23)', { numFmt: '#,##0' });
  d.table('B11:G24', 'solid-0', { name: 'Monthly', totalRow: true });
  d.rule('E12:E24', { type: 'compare', op: 'lt', a: '0' }, { color: '#b42318' });
  d.rule('E12:E24', { type: 'compare', op: 'gt', a: '0' }, { color: '#1c7c43' });
  d.rule('F12:F23', { type: 'bar', color: blue });
  d.rule('C12:C23', { type: 'rank', count: 1 }, { bold: true, fill: '#dcf3e2', color: '#14532d' });

  // Regions
  d.height(26, 26).height(27, 24);
  d.set('B26', 'Regions', head);
  d.row('B27', ['Region', 'Revenue', 'Share', 'Orders', 'Average', 'Rank']);
  d.style('C27:G27', { hAlign: 'right' }).style('B27:G27', { vAlign: 'middle' });
  REGIONS.forEach((region, i) => {
    const n = 28 + i;
    d.set(`B${n}`, region).set(`C${n}`, `=SUMIFS(Orders!$K:$K,Orders!$D:$D,B${n})`, { numFmt: '$#,##0' }).set(`D${n}`, `=C${n}/SUM(C$28:C$31)`, { numFmt: '0%' });
    d.set(`E${n}`, `=COUNTIF(Orders!$D:$D,B${n})`, { numFmt: '#,##0' }).set(`F${n}`, `=C${n}/E${n}`, { numFmt: '$#,##0' }).set(`G${n}`, `=RANK(C${n},C$28:C$31)`);
  });
  d.table('B27:G31', 'lined-1', { name: 'Regions' }).rule('D28:D31', { type: 'bar', color: teal }).rule('G28:G31', { type: 'compare', op: 'eq', a: '1' }, { bold: true, color: '#14532d', fill: '#dcf3e2' });

  // Categories
  d.height(33, 26).height(34, 24);
  d.set('B33', 'Categories', head);
  d.row('B34', ['Category', 'Revenue', 'Share', 'Units', 'Orders', 'Per unit']);
  d.style('C34:G34', { hAlign: 'right' }).style('B34:G34', { vAlign: 'middle' });
  CATEGORIES.forEach((category, i) => {
    const n = 35 + i;
    d.set(`B${n}`, category).set(`C${n}`, `=SUMIFS(Orders!$K:$K,Orders!$G:$G,B${n})`, { numFmt: '$#,##0' }).set(`D${n}`, `=C${n}/SUM(C$35:C$39)`, { numFmt: '0%' });
    d.set(`E${n}`, `=SUMIFS(Orders!$H:$H,Orders!$G:$G,B${n})`, { numFmt: '#,##0' }).set(`F${n}`, `=COUNTIF(Orders!$G:$G,B${n})`, { numFmt: '#,##0' }).set(`G${n}`, `=C${n}/E${n}`, { numFmt: '$#,##0' });
  });
  d.table('B34:G39', 'lined-1', { name: 'Categories' }).rule('D35:D39', { type: 'bar', color: orange });

  // Reps and largest orders, using dynamic arrays
  d.height(41, 26).height(42, 24);
  d.set('B41', 'Sales reps', head);
  d.row('B42', ['Rep', 'Revenue', 'Orders', 'Average', 'Quota', 'Attained']);
  d.style('C42:G42', { hAlign: 'right' }).style('B42:G42', { vAlign: 'middle' });
  REP_NAMES.forEach((name, i) => {
    const n = 43 + i;
    d.set(`B${n}`, name).set(`C${n}`, `=SUMIFS(Orders!$K:$K,Orders!$E:$E,B${n})`, { numFmt: '$#,##0' }).set(`D${n}`, `=COUNTIF(Orders!$E:$E,B${n})`);
    d.set(`E${n}`, `=C${n}/D${n}`, { numFmt: '$#,##0' }).set(`F${n}`, `=VLOOKUP(B${n},Targets!$D$4:$E$8,2,FALSE)`, { numFmt: '$#,##0' }).set(`G${n}`, `=C${n}/F${n}`, { numFmt: '0%' });
  });
  d.table('B42:G47', 'lined-1', { name: 'Reps' }).rule('G43:G47', { type: 'icons', set: 'arrows' });

  d.set('I41', 'Largest orders', head);
  d.row('I42', ['Order', 'Customer', null, 'Product', null, 'Revenue']);
  d.style('I42:N42', { vAlign: 'middle' }).style('N42', { hAlign: 'right' });
  for (let i = 0; i < 5; i++) {
    const n = 43 + i;
    d.set(`N${n}`, `=LARGE(Orders!$K$2:$K$${last},${i + 1})`, { numFmt: '$#,##0', bold: true });
    d.set(`I${n}`, `=INDEX(Orders!$A$2:$A$${last},MATCH(N${n},Orders!$K$2:$K$${last},0))`);
    d.set(`J${n}`, `=INDEX(Orders!$C$2:$C$${last},MATCH(N${n},Orders!$K$2:$K$${last},0))`);
    d.set(`L${n}`, `=INDEX(Orders!$F$2:$F$${last},MATCH(N${n},Orders!$K$2:$K$${last},0))`);
  }
  d.table('I42:N47', 'lined-1', { name: 'Largest' });

  d.chart('column', 'Dashboard!$B$11:$D$23', 'I9:N24', { title: 'Revenue against target', legendPosition: 'top', colors: [blue, lighten(blue, 0.62)] }, 0);
  d.chart('doughnut', 'Dashboard!$B$34:$C$39', 'P9:S24', { title: 'Revenue by category', legendPosition: 'bottom', showLabels: true }, 0);
  d.chart('line', "'Regions by month'!$A$3:$M$7", 'I26:N39', { title: 'Regions over time', seriesInRows: true, legendPosition: 'top' }, 0);
  d.chart('bar', 'Dashboard!$B$42:$C$47', 'P26:S39', { title: 'Revenue by rep', showLabels: true }, 0);
  d.set_({ showGridlines: false, tabColor: blue, frozenRows: 0 });

  const wb = createWorkbook('Halden Cycles sales 2026', [d.build(), orders.build(), grid.build(), products.build(), targets.build()]);
  wb.names = [
    { name: 'TotalRevenue', ref: 'Dashboard!$B$6' },
    { name: 'AnnualTarget', ref: 'Targets!$B$16' },
    { name: 'ProductList', ref: 'Products!$A$2:$A$11' },
  ];
  return wb;
}
