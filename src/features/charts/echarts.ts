/** Tree-shaken ECharts build. Loaded on demand. */
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, LegendScrollComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { init, use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { readChartData } from '@/engine/chartData';
import { themeById } from '@/engine/themes';
import type { CalcEngine } from '@/formulas/calcEngine';
import type { ChartModel, Sheet, Workbook } from '@/types';
import { chartOptions } from './chartOptions';

use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, LegendComponent, LegendScrollComponent, TitleComponent, TooltipComponent, CanvasRenderer]);

export { init };

/** Renders a chart off screen in light colours, for PDF and image export. */
export function chartImage(wb: Workbook, engine: CalcEngine, sheet: Sheet, chart: ChartModel, scale = 2, type: 'png' | 'jpeg' = 'png'): string | null {
  const data = readChartData(wb, engine, sheet, chart);
  if (data.error) return null;
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${chart.w}px;height:${chart.h}px`;
  document.body.append(host);
  try {
    const instance = init(host, undefined, { devicePixelRatio: scale });
    instance.setOption(chartOptions(chart, data, themeById(wb.themeId), { dark: false, k: 1, animate: false }));
    const url = instance.getDataURL({ type, pixelRatio: scale, backgroundColor: '#ffffff' });
    instance.dispose();
    return url;
  } finally {
    host.remove();
  }
}
