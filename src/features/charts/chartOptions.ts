/** Translates a chart model into ECharts options. */
import type { EChartsCoreOption } from 'echarts/core';
import type { ChartData, ChartSeries } from '@/engine/chartData';
import { formatValue } from '@/engine/numberFormat';
import { luminance, mix, onColor, type WorkbookTheme } from '@/engine/themes';
import type { ChartModel } from '@/types';

export interface ChartLook {
  dark: boolean;
  /** Scale factor for text and strokes. */
  k: number;
  animate: boolean;
}

const FONT = '"IBM Plex Sans Variable", "IBM Plex Sans", "Segoe UI", sans-serif';

interface Ink {
  surface: string;
  text: string;
  muted: string;
  grid: string;
  axis: string;
  raised: string;
}

const inkFor = (dark: boolean): Ink =>
  dark
    ? { surface: '#1e232c', text: '#e6ebf3', muted: '#9aa6b8', grid: '#2d3440', axis: '#495365', raised: '#252b35' }
    : { surface: '#ffffff', text: '#1b2333', muted: '#5f6b7f', grid: '#e8ecf2', axis: '#bfc8d5', raised: '#ffffff' };

/** Compact axis labels: 12K, 3.4M. Percent and currency formats keep their symbol. */
export function axisLabel(n: number, numFmt?: string): string {
  if (numFmt?.includes('%')) return formatValue(n, '0%').text;
  const symbol = /[$€£¥₹]/.exec(numFmt ?? '')?.[0] ?? '';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const trim = (v: number): string => Number(v.toFixed(v < 10 ? 1 : 0)).toLocaleString('en-US');
  if (abs >= 1e9) return `${sign}${symbol}${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}${symbol}${trim(abs / 1e6)}M`;
  if (abs >= 1e4) return `${sign}${symbol}${trim(abs / 1e3)}K`;
  return `${sign}${symbol}${Number(abs.toFixed(2)).toLocaleString('en-US')}`;
}

export function valueLabel(n: number, numFmt?: string): string {
  return formatValue(n, numFmt ?? (Number.isInteger(n) ? '#,##0' : '#,##0.##')).text;
}

export function seriesColors(chart: ChartModel, theme: WorkbookTheme, dark: boolean, count: number): string[] {
  const palette = dark ? theme.accentsDark : theme.accents;
  return Array.from({ length: count }, (_, i) => {
    const own = chart.colors[i];
    if (!own) return palette[i % palette.length];
    // Pale custom colours would outshine everything else on a dark surface.
    return dark && luminance(own) > 0.42 ? mix(own, '#1e232c', 0.5) : own;
  });
}

const escapeHtml = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface TipParam {
  seriesIndex: number;
  seriesName: string;
  name: string;
  value: unknown;
  color: string;
  dataIndex: number;
  percent?: number;
}

function tipRow(color: string, label: string, value: string): string {
  return `<div style="display:flex;align-items:center;gap:8px;line-height:20px"><span style="width:9px;height:9px;border-radius:2.5px;background:${color}"></span><span style="flex:1;opacity:.8;padding-right:14px">${escapeHtml(label)}</span><b style="font-weight:600">${escapeHtml(value)}</b></div>`;
}

export function chartOptions(chart: ChartModel, data: ChartData, theme: WorkbookTheme, look: ChartLook): EChartsCoreOption {
  const { k, dark } = look;
  const ink = inkFor(dark);
  const pie = chart.type === 'pie' || chart.type === 'doughnut';
  const scatter = chart.type === 'scatter';
  const horizontal = chart.type === 'bar';
  const count = pie ? data.categories.length : data.series.length;
  const colors = seriesColors(chart, theme, dark, Math.max(count, 1));
  const fs = (n: number): number => Math.round(n * k * 10) / 10;
  const title = chart.title.trim();
  // One series needs no legend box: the title already names it.
  const legend = chart.showLegend && (pie ? count > 1 : data.series.length > 1);
  const sideLegend = chart.legendPosition === 'left' || chart.legendPosition === 'right';
  // Rough width of the legend entries, to reserve a second row when they wrap.
  const pieLegendRows = pie ? Math.ceil(data.categories.reduce((n, c) => n + c.length * 6.2 + 26, 0) / Math.max(80, chart.w - 24)) : 1;
  const top = title ? 44 : 18;
  const legendTop = chart.legendPosition === 'top';

  const base: EChartsCoreOption = {
    backgroundColor: 'transparent',
    color: colors,
    animation: look.animate,
    animationDuration: 420,
    animationDurationUpdate: 260,
    textStyle: { fontFamily: FONT, fontSize: fs(11), color: ink.text },
    title: title
      ? { text: title, left: fs(14), top: fs(12), textStyle: { fontFamily: FONT, fontSize: fs(13.5), fontWeight: 600, color: ink.text, overflow: 'truncate', width: (chart.w - 60) * k } }
      : undefined,
    legend: legend
      ? {
          show: true,
          type: pie && chart.legendPosition === 'bottom' && pieLegendRows <= 2 ? 'plain' : 'scroll',
          orient: chart.legendPosition === 'left' || chart.legendPosition === 'right' ? 'vertical' : 'horizontal',
          ...(legendTop
            ? { top: fs(title ? 38 : 10), left: fs(12) }
            : chart.legendPosition === 'bottom'
              ? { bottom: fs(8), left: 'center' }
              : chart.legendPosition === 'left'
                ? { left: fs(12), top: 'middle' }
                : { right: fs(12), top: 'middle' }),
          icon: 'roundRect',
          itemWidth: fs(9),
          itemHeight: fs(9),
          itemGap: fs(pie ? 11 : 14),
          ...(pie && !sideLegend ? { width: (chart.w - 24) * k } : {}),
          pageIconSize: fs(10),
          textStyle: { color: ink.muted, fontSize: fs(11), fontFamily: FONT },
        }
      : { show: false },
    tooltip: {
      trigger: pie || scatter ? 'item' : 'axis',
      confine: true,
      backgroundColor: ink.raised,
      borderColor: ink.axis,
      borderWidth: 1,
      padding: [7, 11],
      extraCssText: 'border-radius:8px;box-shadow:0 6px 20px -6px rgba(10,20,45,.3);',
      textStyle: { color: ink.text, fontSize: 12, fontFamily: FONT },
      axisPointer: { type: chart.type === 'column' || chart.type === 'bar' ? 'shadow' : 'line', lineStyle: { color: ink.axis, width: 1 }, shadowStyle: { color: dark ? 'rgba(255,255,255,.04)' : 'rgba(27,35,51,.045)' } },
      formatter: (raw: unknown): string => {
        const list = (Array.isArray(raw) ? raw : [raw]) as TipParam[];
        if (!list.length) return '';
        if (pie) {
          const p = list[0];
          return tipRow(p.color, p.name, `${valueLabel(Number(p.value), data.series[0]?.numFmt)}  (${(p.percent ?? 0).toFixed(1)}%)`);
        }
        if (scatter) {
          const p = list[0];
          const [x, y] = p.value as [number, number];
          return tipRow(p.color, p.seriesName, `${valueLabel(x)}, ${valueLabel(y, data.series[p.seriesIndex]?.numFmt)}`);
        }
        const rows = list
          .filter((p) => p.value !== null && p.value !== undefined)
          .map((p) => tipRow(p.color, p.seriesName, valueLabel(Number(p.value), data.series[p.seriesIndex]?.numFmt)));
        return `<div style="font-weight:600;margin-bottom:3px">${escapeHtml(list[0].name)}</div>${rows.join('')}`;
      },
    },
  };

  if (pie) {
    const s = data.series[0];
    const cx = legend && sideLegend ? (chart.legendPosition === 'right' ? '40%' : '60%') : '50%';
    return {
      ...base,
      series: [
        {
          type: 'pie',
          radius: chart.type === 'doughnut' ? ['40%', '66%'] : ['0%', '66%'],
          center: [cx, title ? (legend && !sideLegend ? (pieLegendRows > 1 ? '48%' : '51%') : '56%') : '50%'],
          itemStyle: { borderColor: ink.surface, borderWidth: 2 * k, borderRadius: 3 * k },
          label: {
            show: chart.showLabels,
            color: ink.muted,
            fontSize: fs(11),
            fontFamily: FONT,
            formatter: (p: { name: string; percent: number }) => (legend ? `${Math.round(p.percent)}%` : `${p.name}\n${Math.round(p.percent)}%`),
            ...(legend ? { position: 'inside', color: undefined } : {}),
          },
          labelLine: { length: fs(8), length2: fs(8), lineStyle: { color: ink.axis } },
          emphasis: { scaleSize: 4 * k },
          data: data.categories.map((name, i) => ({
            name,
            value: Math.max(0, s.values[i] ?? 0),
            ...(legend && chart.showLabels ? { label: { color: onColor(colors[i % colors.length]), show: share(s, i) > 0.045 } } : {}),
          })),
        },
      ],
    };
  }

  const fmt = data.series[0]?.numFmt;
  const valueAxis = {
    type: 'value',
    scale: scatter || chart.type === 'line',
    name: horizontal ? chart.xTitle : chart.yTitle,
    nameLocation: 'middle',
    nameGap: fs(horizontal ? 26 : 46),
    nameTextStyle: { color: ink.muted, fontSize: fs(11), fontFamily: FONT },
    axisLabel: { color: ink.muted, fontSize: fs(10.5), fontFamily: FONT, hideOverlap: true, formatter: (n: number) => axisLabel(n, fmt) },
    axisLine: { show: false },
    axisTick: { show: false },
    splitNumber: (horizontal ? chart.w < 420 : chart.h < 220) ? 3 : 5,
    splitLine: { show: chart.showGridlines, lineStyle: { color: ink.grid, width: 1 } },
  };
  const categoryAxis = {
    type: 'category',
    data: data.categories,
    inverse: horizontal,
    boundaryGap: chart.type !== 'line' && chart.type !== 'area',
    name: horizontal ? chart.yTitle : chart.xTitle,
    nameLocation: 'middle',
    nameGap: fs(horizontal ? 70 : 26),
    nameTextStyle: { color: ink.muted, fontSize: fs(11), fontFamily: FONT },
    axisLabel: { color: ink.muted, fontSize: fs(10.5), fontFamily: FONT, hideOverlap: true, width: horizontal ? fs(110) : undefined, overflow: horizontal ? 'truncate' : undefined },
    axisLine: { lineStyle: { color: ink.axis, width: 1 } },
    axisTick: { show: false },
  };
  const numericX = { ...valueAxis, scale: true, name: chart.xTitle, nameGap: fs(26), axisLabel: { ...valueAxis.axisLabel, formatter: (n: number) => axisLabel(n) }, splitLine: { show: false }, axisLine: { show: true, lineStyle: { color: ink.axis } } };

  return {
    ...base,
    grid: {
      left: fs(14 + (chart.yTitle ? 20 : 0) + (legend && chart.legendPosition === 'left' ? 96 : 0)),
      right: fs(18 + (legend && chart.legendPosition === 'right' ? 96 : 0)),
      top: fs(top + (legend && legendTop ? 26 : 0) + (chart.showLabels ? 10 : 0)),
      bottom: fs(12 + (legend && chart.legendPosition === 'bottom' ? 24 : 0) + (chart.xTitle ? 18 : 0)),
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    },
    xAxis: scatter ? numericX : horizontal ? valueAxis : categoryAxis,
    yAxis: scatter ? valueAxis : horizontal ? categoryAxis : valueAxis,
    series: data.series.map((s, i) => seriesOption(chart, data, s, i, colors[i], ink, k, horizontal, fs)),
  };
}

function share(s: ChartSeries, i: number): number {
  const total = s.values.reduce<number>((a, v) => a + Math.max(0, v ?? 0), 0);
  return total ? Math.max(0, s.values[i] ?? 0) / total : 0;
}

function seriesOption(chart: ChartModel, data: ChartData, s: ChartSeries, i: number, color: string, ink: Ink, k: number, horizontal: boolean, fs: (n: number) => number): Record<string, unknown> {
  const last = i === data.series.length - 1;
  const label = {
    show: chart.showLabels,
    color: ink.muted,
    fontSize: fs(10),
    fontFamily: FONT,
    formatter: (p: { value: unknown }) => {
      const v = Array.isArray(p.value) ? p.value[1] : p.value;
      return typeof v === 'number' ? axisLabel(v, s.numFmt) : '';
    },
  };
  if (chart.type === 'scatter') {
    return {
      type: 'scatter',
      name: s.name,
      symbolSize: 9 * k,
      itemStyle: { color, borderColor: ink.surface, borderWidth: 1.5 * k },
      label: { ...label, position: 'top' },
      data: s.values.flatMap((v, n) => (v === null || data.xs[n] === null ? [] : [[data.xs[n], v]])),
    };
  }
  if (chart.type === 'line' || chart.type === 'area') {
    const dense = data.categories.length > 40;
    return {
      type: 'line',
      name: s.name,
      data: s.values,
      smooth: chart.smooth ? 0.35 : false,
      symbol: 'circle',
      symbolSize: 7 * k,
      showSymbol: !dense && chart.type === 'line',
      lineStyle: { width: 2 * k, color, join: 'round', cap: 'round' },
      itemStyle: { color, borderColor: ink.surface, borderWidth: 1.5 * k },
      areaStyle: chart.type === 'area' ? { color, opacity: chart.stacked ? 0.28 : 0.13 } : undefined,
      stack: chart.stacked ? 'total' : undefined,
      connectNulls: false,
      label: { ...label, position: 'top' },
      emphasis: { focus: 'series' },
    };
  }
  const r = 4 * k;
  const rounded = !chart.stacked || last;
  return {
    type: 'bar',
    name: s.name,
    data: s.values.map((v) => ({
      value: v,
      itemStyle: rounded ? { borderRadius: horizontal ? ((v ?? 0) < 0 ? [r, 0, 0, r] : [0, r, r, 0]) : (v ?? 0) < 0 ? [0, 0, r, r] : [r, r, 0, 0] } : undefined,
    })),
    stack: chart.stacked ? 'total' : undefined,
    barMaxWidth: 30 * k,
    barGap: '12%',
    barCategoryGap: data.series.length > 1 && !chart.stacked ? '32%' : '42%',
    itemStyle: { color, ...(chart.stacked ? { borderColor: ink.surface, borderWidth: k } : {}) },
    label: { ...label, position: chart.stacked ? 'inside' : horizontal ? 'right' : 'top', ...(chart.stacked ? { color: onColor(color) } : {}) },
    emphasis: { focus: data.series.length > 1 ? 'series' : 'none' },
  };
}
