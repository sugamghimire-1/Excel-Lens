import type { EChartsType } from 'echarts/core';
import { ChartNoAxesColumn } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { readChartData } from '@/engine/chartData';
import { themeById } from '@/engine/themes';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import type { ChartModel, Sheet } from '@/types';
import { chartOptions } from './chartOptions';

interface ChartViewProps {
  chart: ChartModel;
  sheet: Sheet;
  zoom: number;
}

/** A live chart. Redraws when its data, settings, theme or size change. */
export const ChartView = memo(function ChartView({ chart, sheet, zoom }: ChartViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<EChartsType | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const revision = useWorkbook((s) => s.revision);
  const themeId = useWorkbook((s) => s.workbook.themeId);
  const dark = useUI((s) => s.dark);

  const data = useMemo(() => {
    void revision;
    const { workbook, engine } = useWorkbook.getState();
    return readChartData(workbook, engine, sheet, chart);
  }, [revision, sheet, chart]);
  // Only redraw when the numbers actually differ.
  const signature = useMemo(() => JSON.stringify(data), [data]);

  useEffect(() => {
    let alive = true;
    let observer: ResizeObserver | undefined;
    import('./echarts').then(({ init }) => {
      if (!alive || !host.current) return;
      const chartInstance = init(host.current);
      instance.current = chartInstance;
      observer = new ResizeObserver(() => chartInstance.resize());
      observer.observe(host.current);
      setReady(true);
    }).catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      observer?.disconnect();
      instance.current?.dispose();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !instance.current || data.error) return;
    const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    instance.current.setOption(chartOptions(chart, data, themeById(themeId), { dark, k: zoom, animate }), { notMerge: true });
    // `signature` stands in for `data`, whose identity changes on every edit.
  }, [ready, chart, signature, themeId, dark, zoom]);

  const problem = failed ? 'Charts could not be loaded. Check your connection and reload the page.' : data.error ? `${data.error} Open the chart settings to choose another range.` : null;

  return (
    <div className="relative h-full w-full">
      <div ref={host} role="img" aria-label={describe(chart, data.series.map((s) => s.name))} className="absolute inset-0" style={{ visibility: problem ? 'hidden' : 'visible' }} />
      {problem && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-ink-2">
          <ChartNoAxesColumn size={26} className="text-ink-3" />
          <span className="font-medium text-ink">{chart.title || 'Chart'}</span>
          <span className="text-xs">{problem}</span>
        </div>
      )}
    </div>
  );
});

function describe(chart: ChartModel, names: string[]): string {
  return `${chart.title || 'Untitled'}, ${chart.type} chart of ${names.join(', ') || chart.range}`;
}
