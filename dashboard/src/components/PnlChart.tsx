import { useEffect, useRef } from 'preact/hooks';
import { createChart, LineSeries } from 'lightweight-charts';

export interface PnlDataPoint {
  time: number; // Unix seconds
  value: number; // Cumulative P&L in SOL
}

interface PnlChartProps {
  data: PnlDataPoint[];
}

export function PnlChart({ data }: PnlChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Resolve CSS variables BEFORE passing to chart (avoids fallback color mismatch)
    const style = getComputedStyle(document.documentElement);
    const bgColor    = style.getPropertyValue('--bg2').trim()     || '#1a1a1a';
    const textColor  = style.getPropertyValue('--text').trim()    || '#e0e0e0';
    const borderColor = style.getPropertyValue('--border').trim() || '#2a2a2a';
    const grayColor  = style.getPropertyValue('--gray').trim()    || '#666666';

    // Determine line color based on final P&L value
    const lastValue = data.length > 0 ? data[data.length - 1]!.value : 0;
    const lineColor = lastValue >= 0
      ? (style.getPropertyValue('--green').trim() || '#00ff88')
      : (style.getPropertyValue('--red').trim()   || '#ff4444');

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 220,
      layout: {
        background: { color: bgColor },
        textColor,
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: borderColor },
        horzLines: { color: borderColor },
      },
      crosshair: {
        mode: 0, // CrosshairMode.Normal — free movement
        vertLine: { color: grayColor, labelBackgroundColor: bgColor },
        horzLine: { color: grayColor, labelBackgroundColor: bgColor },
      },
      rightPriceScale: {
        borderColor: borderColor,
        textColor,
      },
      timeScale: {
        borderColor: borderColor,
        textColor,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    });

    const series = chart.addSeries(LineSeries, {
      color: lineColor,
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: lineColor,
      crosshairMarkerBackgroundColor: bgColor,
    });

    if (data.length > 0) {
      series.setData(data);
      chart.timeScale().fitContent();
    }

    // ResizeObserver for responsive sizing
    const observer = new ResizeObserver(entries => {
      if (entries[0]) {
        const { width } = entries[0].contentRect;
        chart.resize(width, 220);
        chart.timeScale().fitContent();
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [data]);

  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        position: 'absolute',
        top: '0.5rem',
        left: '0.75rem',
        fontSize: '0.7rem',
        color: 'var(--gray)',
        letterSpacing: '0.05em',
        zIndex: 1,
        pointerEvents: 'none',
      }}>
        CUMULATIVE P&amp;L (SOL)
      </div>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '220px',
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
        }}
      />
    </div>
  );
}
