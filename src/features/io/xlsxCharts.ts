/**
 * DrawingML charts. ExcelJS does not handle charts, so they are written into
 * and read from the package directly.
 */
import type JSZip from 'jszip';
import { absCellName, parseRangeName, quoteSheet, rangeName, splitSheetRef, unionRange } from '@/engine/address';
import { colAxis, rowAxis } from '@/engine/axis';
import { readChartData, resolveChartRange } from '@/engine/chartData';
import { createChart } from '@/engine/commands/sheets';
import { themeById } from '@/engine/themes';
import type { CalcEngine } from '@/formulas/calcEngine';
import type { ChartModel, ChartType, Range, Sheet, Workbook } from '@/types';

const EMU = 9525;
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (t: string): string => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/* ----------------------------------------------------------------- export */

const rich = (text: string, size: number, bold: boolean): string =>
  `<c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}"/></a:pPr><a:r><a:rPr lang="en-US" sz="${size}" b="${bold ? 1 : 0}"/><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/>`;
const title = (text: string): string => (text ? `<c:title>${rich(text, 1300, true)}</c:title>` : '');
const solid = (hex: string): string => `<a:solidFill><a:srgbClr val="${hex.replace('#', '').toUpperCase()}"/></a:solidFill>`;

function numCache(values: (number | null)[]): string {
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')}</c:numCache>`;
}
function strCache(values: string[]): string {
  return `<c:strCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
}

export function chartXml(wb: Workbook, engine: CalcEngine, owner: Sheet, chart: ChartModel): string | null {
  const target = resolveChartRange(wb, owner, chart.range);
  const data = readChartData(wb, engine, owner, chart);
  if (!target || data.error) return null;
  const { sheet, range } = target;
  const prefix = `${quoteSheet(sheet.name)}!`;
  const flip = chart.seriesInRows;
  const hasNames = flip ? chart.firstColLabels : chart.firstRowHeaders;
  const hasCats = flip ? chart.firstRowHeaders : chart.firstColLabels;
  const theme = themeById(wb.themeId);
  const outer0 = (flip ? range.r1 : range.c1) + (hasCats ? 1 : 0);
  const inner0 = (flip ? range.c1 : range.r1) + (hasNames ? 1 : 0);
  const inner1 = flip ? range.c2 : range.r2;
  const line = (o: number): string => esc(prefix + rangeName(flip ? { r1: o, r2: o, c1: inner0, c2: inner1 } : { r1: inner0, r2: inner1, c1: o, c2: o }, true));
  const catRef = line(outer0 - 1);
  const scatter = chart.type === 'scatter';
  const pie = chart.type === 'pie' || chart.type === 'doughnut';

  const ser = data.series.map((s, i) => {
    const o = outer0 + i;
    const color = chart.colors[i] ?? theme.accents[i % theme.accents.length];
    const nameRef = esc(prefix + (flip ? absCellName(o, range.c1) : absCellName(range.r1, o)));
    const tx = hasNames ? `<c:tx><c:strRef><c:f>${nameRef}</c:f>${strCache([s.name])}</c:strRef></c:tx>` : `<c:tx><c:v>${esc(s.name)}</c:v></c:tx>`;
    const stroke = chart.type === 'line' ? `<a:ln w="28575" cap="rnd">${solid(color)}<a:round/></a:ln>` : scatter ? '<a:ln w="19050"><a:noFill/></a:ln>' : '';
    const alpha = chart.type === 'area' && !chart.stacked ? `<a:solidFill><a:srgbClr val="${color.replace('#', '').toUpperCase()}"><a:alpha val="35000"/></a:srgbClr></a:solidFill>` : solid(color);
    const sp = pie ? '' : `<c:spPr>${chart.type === 'line' || scatter ? '' : alpha}${stroke}</c:spPr>`;
    const marker = chart.type === 'line' || scatter ? `<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr>${solid(color)}</c:spPr></c:marker>` : '';
    const points = pie ? data.categories.map((_, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/><c:spPr>${solid(chart.colors[k] ?? theme.accents[k % theme.accents.length])}</c:spPr></c:dPt>`).join('') : '';
    const labels = chart.showLabels
      ? `<c:dLbls><c:showLegendKey val="0"/><c:showVal val="${pie ? 0 : 1}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="${pie ? 1 : 0}"/><c:showBubbleSize val="0"/></c:dLbls>`
      : '';
    const cat = hasCats ? (scatter ? `<c:xVal><c:numRef><c:f>${catRef}</c:f>${numCache(data.xs)}</c:numRef></c:xVal>` : `<c:cat><c:strRef><c:f>${catRef}</c:f>${strCache(data.categories)}</c:strRef></c:cat>`) : '';
    const valTag = scatter ? 'c:yVal' : 'c:val';
    const vals = `<${valTag}><c:numRef><c:f>${line(o)}</c:f>${numCache(s.values)}</c:numRef></${valTag}>`;
    const invert = chart.type === 'column' || chart.type === 'bar' ? '<c:invertIfNegative val="0"/>' : '';
    const smooth = chart.type === 'line' || scatter ? `<c:smooth val="${chart.smooth ? 1 : 0}"/>` : '';
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${sp}${invert}${marker}${points}${labels}${cat}${vals}${smooth}</c:ser>`;
  });

  const grouping = chart.stacked ? 'stacked' : chart.type === 'column' || chart.type === 'bar' ? 'clustered' : 'standard';
  const ax = '<c:axId val="111111111"/><c:axId val="222222222"/>';
  let plot: string;
  switch (chart.type) {
    case 'column':
    case 'bar':
      plot = `<c:barChart><c:barDir val="${chart.type === 'bar' ? 'bar' : 'col'}"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>${ser.join('')}<c:gapWidth val="70"/>${chart.stacked ? '<c:overlap val="100"/>' : ''}${ax}</c:barChart>`;
      break;
    case 'line':
      plot = `<c:lineChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${ser.join('')}<c:marker val="1"/>${ax}</c:lineChart>`;
      break;
    case 'area':
      plot = `<c:areaChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${ser.join('')}${ax}</c:areaChart>`;
      break;
    case 'scatter':
      plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${ser.join('')}${ax}</c:scatterChart>`;
      break;
    case 'doughnut':
      plot = `<c:doughnutChart><c:varyColors val="1"/>${ser[0]}<c:firstSliceAng val="0"/><c:holeSize val="62"/></c:doughnutChart>`;
      break;
    default:
      plot = `<c:pieChart><c:varyColors val="1"/>${ser[0]}<c:firstSliceAng val="0"/></c:pieChart>`;
  }
  const grid = chart.showGridlines ? '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E4E8EE"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' : '';
  const horizontal = chart.type === 'bar';
  const axTitle = (t: string): string => (t ? `<c:title>${rich(t, 1000, false)}</c:title>` : '');
  const catTitle = axTitle(horizontal ? chart.yTitle : chart.xTitle);
  const valTitle = axTitle(horizontal ? chart.xTitle : chart.yTitle);
  const valAx = `<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 'b' : 'l'}"/>${grid}${valTitle}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="111111111"/><c:crosses val="${horizontal ? 'max' : 'autoZero'}"/></c:valAx>`;
  const firstAx = scatter
    ? `<c:valAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${catTitle}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="222222222"/><c:crosses val="autoZero"/></c:valAx>`
    : `<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 'l' : 'b'}"/>${catTitle}<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/><c:crossAx val="222222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>`;
  const legendPos = { top: 't', bottom: 'b', left: 'l', right: 'r' }[chart.legendPosition];
  const legend = chart.showLegend && (pie || data.series.length > 1) ? `<c:legend><c:legendPos val="${legendPos}"/><c:overlay val="0"/></c:legend>` : '';
  return `${XML}<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/><c:chart>${title(chart.title)}<c:autoTitleDeleted val="${chart.title ? 0 : 1}"/><c:plotArea><c:layout/>${plot}${pie ? '' : firstAx + valAx}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr>${solid('#ffffff')}<a:ln w="9525"><a:solidFill><a:srgbClr val="DDE2EA"/></a:solidFill></a:ln></c:spPr></c:chartSpace>`;
}

function anchorXml(sheet: Sheet, chart: ChartModel, n: number): string {
  const cols = colAxis(sheet);
  const rows = rowAxis(sheet);
  const corner = (x: number, y: number, tag: string): string => {
    const c = cols.indexAt(x);
    const r = rows.indexAt(y);
    return `<xdr:${tag}><xdr:col>${c}</xdr:col><xdr:colOff>${Math.round((x - cols.offset(c)) * EMU)}</xdr:colOff><xdr:row>${r}</xdr:row><xdr:rowOff>${Math.round((y - rows.offset(r)) * EMU)}</xdr:rowOff></xdr:${tag}>`;
  };
  return `<xdr:twoCellAnchor>${corner(chart.x, chart.y, 'from')}${corner(chart.x + chart.w, chart.y + chart.h, 'to')}<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${n + 1}" name="${esc(chart.title || `Chart ${n}`)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" r:id="rId${n}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

/** Adds every chart in the workbook to an .xlsx package. `sheetPaths[i]` is the part for sheet i. */
export async function writeCharts(zip: JSZip, wb: Workbook, engine: CalcEngine, sheetPaths: string[]): Promise<void> {
  let chartNo = 0;
  let drawingNo = 0;
  const overrides: string[] = [];
  for (let i = 0; i < wb.sheets.length; i++) {
    const sheet = wb.sheets[i];
    const parts = sheet.charts.flatMap((chart) => {
      const xml = chartXml(wb, engine, sheet, chart);
      return xml ? [{ chart, xml }] : [];
    });
    if (!parts.length) continue;
    drawingNo++;
    const path = sheetPaths[i];
    const anchors: string[] = [];
    const rels: string[] = [];
    parts.forEach(({ chart, xml }, k) => {
      chartNo++;
      zip.file(`xl/charts/chart${chartNo}.xml`, xml);
      overrides.push(`<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
      rels.push(`<Relationship Id="rId${k + 1}" Type="${NS_R}/chart" Target="../charts/chart${chartNo}.xml"/>`);
      anchors.push(anchorXml(sheet, chart, k + 1));
    });
    const drawing = `drawing${900 + drawingNo}.xml`;
    zip.file(`xl/drawings/${drawing}`, `${XML}<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">${anchors.join('')}</xdr:wsDr>`);
    zip.file(`xl/drawings/_rels/${drawing}.rels`, `${XML}<Relationships xmlns="${NS_REL}">${rels.join('')}</Relationships>`);
    overrides.push(`<Override PartName="/xl/drawings/${drawing}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);

    const relPath = path.replace('worksheets/', 'worksheets/_rels/') + '.rels';
    const rel = `<Relationship Id="rIdCharts" Type="${NS_R}/drawing" Target="../drawings/${drawing}"/>`;
    const existing = await zip.file(relPath)?.async('string');
    zip.file(relPath, existing ? existing.replace('</Relationships>', `${rel}</Relationships>`) : `${XML}<Relationships xmlns="${NS_REL}">${rel}</Relationships>`);

    let xml = await zip.file(path)!.async('string');
    if (!/xmlns:r=/.test(xml.slice(0, 1200))) xml = xml.replace('<worksheet ', `<worksheet xmlns:r="${NS_R}" `);
    const tag = '<drawing r:id="rIdCharts"/>';
    const before = /<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)[\s>/]/.exec(xml);
    xml = before ? xml.slice(0, before.index) + tag + xml.slice(before.index) : xml.replace('</worksheet>', `${tag}</worksheet>`);
    zip.file(path, xml);
  }
  if (!overrides.length) return;
  const types = await zip.file('[Content_Types].xml')!.async('string');
  zip.file('[Content_Types].xml', types.replace('</Types>', `${overrides.join('')}</Types>`));
}

/* ----------------------------------------------------------------- import */

const tagBody = (xml: string, name: string): string | null => new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml)?.[1] ?? null;
const attrVal = (xml: string, name: string): string | null => new RegExp(`<(?:\\w+:)?${name}\\s[^>]*?val="([^"]*)"`).exec(xml)?.[1] ?? null;
const all = (xml: string, name: string): string[] => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'g'))].map((m) => m[1]);

function refOf(xml: string | null): { sheet: string; range: Range } | null {
  const f = xml ? tagBody(xml, 'f') : null;
  if (!f) return null;
  const { sheet, local } = splitSheetRef(unesc(f));
  const range = parseRangeName(local);
  return sheet && range ? { sheet, range } : null;
}

/** Converts chart XML to a chart model positioned at the origin. */
export function parseChartXml(xml: string): ChartModel | null {
  const plot = tagBody(xml, 'plotArea');
  if (!plot) return null;
  const kinds: [string, ChartType][] = [['barChart', 'column'], ['bar3DChart', 'column'], ['lineChart', 'line'], ['line3DChart', 'line'], ['areaChart', 'area'], ['area3DChart', 'area'], ['pieChart', 'pie'], ['pie3DChart', 'pie'], ['doughnutChart', 'doughnut'], ['scatterChart', 'scatter']];
  const hit = kinds.find(([tag]) => new RegExp(`<(?:\\w+:)?${tag}[\\s>]`).test(plot));
  if (!hit) return null;
  const body = tagBody(plot, hit[0]) ?? '';
  let type = hit[1];
  if (type === 'column' && attrVal(body, 'barDir') === 'bar') type = 'bar';

  let union: Range | null = null;
  let sheetName = '';
  let hasNames = false;
  let hasCats = false;
  let rowVotes = 0;
  const colors: string[] = [];
  const series = all(body, 'ser');
  for (const s of series) {
    const tx = refOf(tagBody(s, 'tx'));
    const cat = refOf(tagBody(s, 'cat') ?? tagBody(s, 'xVal'));
    const val = refOf(tagBody(s, 'val') ?? tagBody(s, 'yVal'));
    if (!val) continue;
    sheetName ||= val.sheet;
    if (val.sheet !== sheetName) continue;
    union = union ? unionRange(union, val.range) : val.range;
    if (tx && tx.sheet === sheetName) {
      hasNames = true;
      union = unionRange(union, tx.range);
    }
    if (cat && cat.sheet === sheetName) {
      hasCats = true;
      union = unionRange(union, cat.range);
    }
    rowVotes += val.range.r1 === val.range.r2 && val.range.c1 !== val.range.c2 ? 1 : -1;
    const sp = /<(?:\w+:)?spPr>([\s\S]*?)<\/(?:\w+:)?spPr>/.exec(s.replace(/<(?:\w+:)?(marker|dPt|dLbls)>[\s\S]*?<\/(?:\w+:)?\1>/g, ''))?.[1];
    const color = sp ? /srgbClr val="([0-9A-Fa-f]{6})"/.exec(sp)?.[1] : undefined;
    if (color) colors.push(`#${color.toLowerCase()}`);
  }
  if (!union) return null;
  if (type === 'pie' || type === 'doughnut') {
    for (const p of all(series[0] ?? '', 'dPt')) {
      const c = /srgbClr val="([0-9A-Fa-f]{6})"/.exec(p)?.[1];
      if (c) colors.push(`#${c.toLowerCase()}`);
    }
  }
  const inRows = rowVotes > 0;
  const chart = createChart(type, sheetName, union, { x: 0, y: 0 });
  const titleXml = tagBody(xml.replace(plot, ''), 'title');
  const legend = tagBody(xml, 'legend');
  const pos = legend ? attrVal(legend, 'legendPos') : null;
  const axTitles = (ax: string): string => all(tagBody(tagBody(plot, ax) ?? '', 'title') ?? '', 't').map(unesc).join('');
  const horizontal = type === 'bar';
  const catTitle = axTitles('catAx');
  const valTitle = axTitles('valAx');
  return {
    ...chart,
    title: titleXml ? all(titleXml, 't').map(unesc).join('') : '',
    seriesInRows: inRows,
    firstRowHeaders: inRows ? hasCats : hasNames,
    firstColLabels: inRows ? hasNames : hasCats,
    stacked: /stacked/i.test(attrVal(body, 'grouping') ?? ''),
    smooth: attrVal(body, 'smooth') === '1',
    showLegend: legend !== null,
    legendPosition: pos === 't' ? 'top' : pos === 'l' ? 'left' : pos === 'r' || pos === 'tr' ? 'right' : 'bottom',
    showLabels: /<(?:\w+:)?show(Val|Percent) val="1"/.test(body),
    showGridlines: /majorGridlines/.test(plot),
    xTitle: horizontal ? valTitle : catTitle,
    yTitle: horizontal ? catTitle : valTitle,
    colors: colors.length >= (type === 'pie' || type === 'doughnut' ? 1 : series.length) ? colors : [],
  };
}

function relTargets(xml: string, base: string): Map<string, { type: string; target: string }> {
  const out = new Map<string, { type: string; target: string }>();
  for (const m of xml.matchAll(/<Relationship\s([^>]*?)\/?>/g)) {
    const at = (n: string): string => new RegExp(`\\b${n}="([^"]*)"`).exec(m[1])?.[1] ?? '';
    const raw = unesc(at('Target'));
    const path = raw.startsWith('/') ? raw.slice(1) : raw.split('/').reduce<string[]>((acc, p) => (p === '..' ? acc.slice(0, -1) : p === '.' ? acc : [...acc, p]), base.split('/').slice(0, -1)).join('/');
    out.set(at('Id'), { type: at('Type').split('/').pop() ?? '', target: path });
  }
  return out;
}

async function relsFor(zip: JSZip, part: string): Promise<Map<string, { type: string; target: string }>> {
  const i = part.lastIndexOf('/');
  const xml = await zip.file(`${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`)?.async('string');
  return xml ? relTargets(xml, part) : new Map();
}

/** Reads charts for each sheet, keyed by sheet name. */
export async function readCharts(zip: JSZip, sheets: Sheet[]): Promise<Map<string, ChartModel[]>> {
  const out = new Map<string, ChartModel[]>();
  const book = await zip.file('xl/workbook.xml')?.async('string');
  if (!book) return out;
  const bookRels = await relsFor(zip, 'xl/workbook.xml');
  for (const m of book.matchAll(/<(?:\w+:)?sheet\s([^>]*?)\/?>/g)) {
    const name = unesc(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? '');
    const rid = /\br:id="([^"]*)"/.exec(m[1])?.[1] ?? '';
    const part = bookRels.get(rid)?.target;
    const sheet = sheets.find((s) => s.name === name);
    if (!part || !sheet) continue;
    const drawing = [...(await relsFor(zip, part)).values()].find((r) => r.type === 'drawing')?.target;
    const xml = drawing ? await zip.file(drawing)?.async('string') : undefined;
    if (!drawing || !xml) continue;
    const rels = await relsFor(zip, drawing);
    const charts: ChartModel[] = [];
    for (const a of xml.matchAll(/<(?:\w+:)?(twoCellAnchor|oneCellAnchor|absoluteAnchor)[^>]*>([\s\S]*?)<\/(?:\w+:)?\1>/g)) {
      const id = /<(?:\w+:)?chart\s[^>]*r:id="([^"]*)"/.exec(a[2])?.[1];
      const target = id ? rels.get(id)?.target : undefined;
      const chartPart = target ? await zip.file(target)?.async('string') : undefined;
      const model = chartPart ? parseChartXml(chartPart) : null;
      if (model) charts.push({ ...model, ...placement(sheet, a[2]) });
    }
    if (charts.length) out.set(name, charts);
  }
  return out;
}

function placement(sheet: Sheet, xml: string): Pick<ChartModel, 'x' | 'y' | 'w' | 'h'> {
  const cols = colAxis(sheet);
  const rows = rowAxis(sheet);
  const num = (body: string, tag: string): number => Number(tagBody(body, tag) ?? 0);
  const corner = (body: string): [number, number] => [cols.offset(num(body, 'col')) + num(body, 'colOff') / EMU, rows.offset(num(body, 'row')) + num(body, 'rowOff') / EMU];
  const from = tagBody(xml, 'from');
  const to = tagBody(xml, 'to');
  const ext = /<(?:\w+:)?ext\s[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(xml);
  const [x, y] = from ? corner(from) : [40, 40];
  if (to) {
    const [x2, y2] = corner(to);
    return { x: Math.round(x), y: Math.round(y), w: Math.max(180, Math.round(x2 - x)), h: Math.max(120, Math.round(y2 - y)) };
  }
  return { x: Math.round(x), y: Math.round(y), w: ext ? Math.max(180, Math.round(Number(ext[1]) / EMU)) : 480, h: ext ? Math.max(120, Math.round(Number(ext[2]) / EMU)) : 288 };
}
