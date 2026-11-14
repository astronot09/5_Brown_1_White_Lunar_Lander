import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { VisibilityState } from '../map/lunarTypes';
import './charts.css';

export interface VisibilityTimelineChartProps {
  data: VisibilityState[];
  selectedIndex?: number;
  onTimeChange?: (state: VisibilityState, index: number) => void;
  height?: number;
  className?: string;
  earthClearanceMarginDeg?: number;
}

function formatUtc(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${d3.utcFormat('%d %b %Y · %H:%M')(date)} UTC`;
}

export function VisibilityTimelineChart({
  data,
  selectedIndex: controlledIndex,
  onTimeChange,
  height = 330,
  className = '',
  earthClearanceMarginDeg = 1,
}: VisibilityTimelineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const [internalIndex, setInternalIndex] = useState(0);
  const sortedData = useMemo(() => [...data].sort(
    (a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime(),
  ), [data]);
  const selectedIndex = controlledIndex === undefined
    ? Math.min(internalIndex, Math.max(0, sortedData.length - 1))
    : Math.max(0, Math.min(controlledIndex, sortedData.length - 1));
  const selected = sortedData[selectedIndex] ?? null;

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const width = chartWidth || svgRef.current.clientWidth || 720;
    const margin = { top: 20, right: 58, bottom: 100, left: 54 };
    const innerWidth = Math.max(1, width - margin.left - margin.right);
    const plotHeight = Math.max(1, height - margin.top - margin.bottom);
    const root = svg.attr('viewBox', `0 0 ${width} ${height}`).append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    if (!sortedData.length) {
      root.append('text').attr('x', innerWidth / 2).attr('y', plotHeight / 2)
        .attr('text-anchor', 'middle').attr('class', 'chart-empty')
        .text('No visibility samples available');
      return;
    }

    const parsed = sortedData.map((state) => ({ ...state, date: new Date(state.timeUtc) }))
      .filter((state) => !Number.isNaN(state.date.getTime()));
    if (!parsed.length) {
      root.append('text').attr('x', innerWidth / 2).attr('y', plotHeight / 2)
        .attr('text-anchor', 'middle').attr('class', 'chart-empty')
        .text('Visibility samples contain invalid UTC timestamps');
      return;
    }

    const start = parsed[0].date;
    const end = parsed[parsed.length - 1].date;
    const x = d3.scaleTime().domain(start.getTime() === end.getTime()
      ? [new Date(start.getTime() - 30_000), new Date(end.getTime() + 30_000)]
      : [start, end]).range([0, innerWidth]);
    const maxIrradiance = Math.max(1, d3.max(parsed, (state) => state.solarIrradianceWm2) ?? 1);
    const y = d3.scaleLinear().domain([0, maxIrradiance * 1.08]).nice().range([plotHeight, 0]);

    root.append('g').attr('class', 'chart-grid')
      .call(d3.axisLeft(y).ticks(4).tickSize(-innerWidth).tickFormat((value) => `${value}`));
    root.append('g').attr('class', 'chart-axis').attr('transform', `translate(0,${plotHeight})`)
      .call(
  d3.axisBottom(x)
    .ticks(Math.min(6, parsed.length))
    .tickFormat((value) => d3.utcFormat('%d %b %H:%M')(new Date(value.valueOf()))) as any
);
    root.append('text').attr('class', 'chart-axis-label').attr('transform', 'rotate(-90)')
      .attr('x', -plotHeight / 2).attr('y', -42).attr('text-anchor', 'middle')
      .text('Solar irradiance · W/m²');

    const stripHeight = 13;
    const sunlightY = plotHeight + 38;
    const earthY = plotHeight + 55;
    const operationsY = plotHeight + 72;
    const stepWidth = (innerWidth / Math.max(1, parsed.length - 1)) * 0.92;
    const sunlightSegments = parsed.filter((state) => state.sunVisible || state.sunlitFraction > 0);
    const earthSamples = parsed;
    root.append('g').attr('class', 'timeline-sunlight').selectAll('rect')
      .data(sunlightSegments).join('rect')
      .attr('x', (state) => x(state.date) - stepWidth / 2).attr('y', sunlightY)
      .attr('width', Math.max(2, stepWidth)).attr('height', stripHeight)
      .attr('opacity', (state) => Math.max(0.25, Math.min(1, state.sunlitFraction)))
      .append('title').text((state) => `Sunlight · ${formatUtc(state.timeUtc)} · ${Math.round(state.sunlitFraction * 100)}% visible`);
    root.append('g').attr('class', 'timeline-earth').selectAll('rect')
      .data(earthSamples).join('rect')
      .attr('class', (state) => state.earthVisible && state.earthClearanceDeg >= earthClearanceMarginDeg
        ? 'earth-clearance-cell is-clear' : 'earth-clearance-cell is-blocked')
      .attr('x', (state) => x(state.date) - stepWidth / 2).attr('y', earthY)
      .attr('width', Math.max(2, stepWidth)).attr('height', stripHeight)
      .append('title').text((state) => `${state.earthVisible && state.earthClearanceDeg >= earthClearanceMarginDeg ? 'Earth DTE available' : 'Earth DTE blocked'} · ${formatUtc(state.timeUtc)} · clearance ${state.earthClearanceDeg.toFixed(2)}°`);
    const operationsSegments = parsed.filter((state) => state.operationsWindow === true);
    if (operationsSegments.length) {
      root.append('g').attr('class', 'timeline-operations').selectAll('rect')
        .data(operationsSegments).join('rect')
        .attr('x', (state) => x(state.date) - stepWidth / 2).attr('y', operationsY)
        .attr('width', Math.max(2, stepWidth)).attr('height', stripHeight)
        .append('title').text((state) => `Combined operations window · ${formatUtc(state.timeUtc)}`);
    }

    root.append('path').datum(parsed).attr('class', 'irradiance-line')
      .attr('d', d3.line<(typeof parsed)[number]>().defined((state) => Number.isFinite(state.solarIrradianceWm2))
        .x((state) => x(state.date)).y((state) => y(state.solarIrradianceWm2))
        .curve(d3.curveMonotoneX));
    root.append('path').datum(parsed).attr('class', 'irradiance-area')
      .attr('d', d3.area<(typeof parsed)[number]>().defined((state) => Number.isFinite(state.solarIrradianceWm2))
        .x((state) => x(state.date)).y0(plotHeight).y1((state) => y(state.solarIrradianceWm2))
        .curve(d3.curveMonotoneX));
    const powerSamples = parsed.filter((state) => state.powerIndex !== undefined);
    if (powerSamples.length) {
      const powerY = d3.scaleLinear().domain([0, 1]).range([plotHeight, 0]);
      root.append('g').attr('class', 'chart-axis power-index-axis').attr('transform', `translate(${innerWidth},0)`)
        .call(d3.axisRight(powerY).ticks(4));
      root.append('path').datum(powerSamples).attr('class', 'power-index-line')
        .attr('d', d3.line<(typeof powerSamples)[number]>().x((state) => x(state.date))
          .y((state) => powerY(state.powerIndex ?? 0)).curve(d3.curveMonotoneX));
    }

    const active = parsed.find((state) => state.timeUtc === selected?.timeUtc);
    if (active) {
      const markerX = x(active.date);
      root.append('line').attr('class', 'timeline-cursor').attr('x1', markerX).attr('x2', markerX)
        .attr('y1', 0).attr('y2', plotHeight + (operationsSegments.length ? 87 : 70));
      root.append('circle').attr('class', 'timeline-cursor-dot').attr('cx', markerX)
        .attr('cy', y(active.solarIrradianceWm2)).attr('r', 4.5);
    }

    root.append('text').attr('class', 'timeline-strip-label').attr('x', 0)
      .attr('y', sunlightY + 10).text('SUNLIGHT');
    root.append('text').attr('class', 'timeline-strip-label').attr('x', 0)
      .attr('y', earthY + 10).text('EARTH DTE');
    if (operationsSegments.length) {
      root.append('text').attr('class', 'timeline-strip-label').attr('x', 0)
        .attr('y', operationsY + 10).text('OPS WINDOW');
    }
    svg.append('text').attr('class', 'timeline-y-unit')
      .attr('x', width - 8).attr('y', 13).attr('text-anchor', 'end').text('W/m²');
  }, [sortedData, selected?.timeUtc, height, earthClearanceMarginDeg, chartWidth]);

  useEffect(() => {
    const node = svgRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setChartWidth(Math.round(width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const events = useMemo(() => {
    const transitions: { timeUtc: string; label: string; kind: 'sun' | 'earth' }[] = [];
    sortedData.forEach((state, index) => {
      const previous = sortedData[index - 1];
      if (!previous) return;
      const sunNow = state.sunVisible || state.sunlitFraction > 0;
      const sunBefore = previous.sunVisible || previous.sunlitFraction > 0;
      if (sunNow !== sunBefore) transitions.push({
        timeUtc: state.timeUtc,
        label: sunNow ? 'Sunlight begins' : 'Sunlight ends · shadow begins',
        kind: 'sun',
      });
      const earthNow = state.earthVisible && state.earthClearanceDeg >= earthClearanceMarginDeg;
      const earthBefore = previous.earthVisible && previous.earthClearanceDeg >= earthClearanceMarginDeg;
      if (earthNow !== earthBefore) transitions.push({
        timeUtc: state.timeUtc,
        label: earthNow ? 'Earth DTE window opens' : 'Earth DTE window closes',
        kind: 'earth',
      });
    });
    return transitions;
  }, [sortedData, earthClearanceMarginDeg]);

  const handleScrub = (value: number) => {
    if (controlledIndex === undefined) setInternalIndex(value);
    const state = sortedData[value];
    if (state) onTimeChange?.(state, value);
  };

  return (
    <section className={`lunar-chart-panel lunar-timeline-panel ${className}`} aria-label="Solar and Earth visibility timeline">
      <div className="lunar-chart-heading">
        <div><p className="lunar-chart-eyebrow">TIME SERIES · UTC</p><h3>Visibility timeline</h3></div>
        <span className="lunar-chart-meta">{data.length} samples</span>
      </div>
      {selected && (
        <div className="timeline-readout" aria-live="polite">
          <strong>{formatUtc(selected.timeUtc)}</strong>
          <span>{selected.solarIrradianceWm2.toFixed(1)} W/m² solar irradiance</span>
          <span>{Math.round(selected.sunlitFraction * 100)}% Sun visible</span>
          <span>{selected.earthClearanceDeg.toFixed(2)}° Earth clearance</span>
          {selected.powerIndex !== undefined && <span>{selected.powerIndex.toFixed(3)} panel power index</span>}
        </div>
      )}
      <svg ref={svgRef} className="lunar-chart-svg timeline-svg" role="img"
        aria-label="Solar irradiance over time, with separate strips showing sunlight and Earth direct-to-Earth visibility windows." />
      {data.length > 0 && (
        <div className="timeline-scrubber">
          <label htmlFor="lunar-time-scrubber">Time scrubber</label>
          <input
            id="lunar-time-scrubber"
            type="range"
            min={0}
            max={Math.max(0, sortedData.length - 1)}
            step={1}
            value={selectedIndex}
            onChange={(event) => handleScrub(Number(event.currentTarget.value))}
            aria-valuetext={selected ? formatUtc(selected.timeUtc) : 'No selected time'}
          />
          <span>{selected ? `${selectedIndex + 1} / ${data.length}` : '—'}</span>
        </div>
      )}
      <div className="timeline-legend" aria-label="Timeline legend">
        <span><i className="legend-irradiance" /> Solar irradiance</span>
        {sortedData.some((state) => state.powerIndex !== undefined) && <span><i className="legend-power-index" /> Panel power index</span>}
        <span><i className="legend-sunlight" /> Sunlight window</span>
        <span><i className="legend-dte" /> Earth DTE window (≥ {earthClearanceMarginDeg.toFixed(1)}° clearance)</span>
        {sortedData.some((state) => state.operationsWindow !== undefined) && <span><i className="legend-ops" /> Operations window</span>}
      </div>
      <details className="timeline-events">
        <summary>Visibility event list ({events.length} transitions)</summary>
        {events.length ? (
          <ol>{events.map((event, index) => (
            <li key={`${event.timeUtc}-${event.kind}-${index}`} className={`event-${event.kind}`}>
              <time dateTime={event.timeUtc}>{formatUtc(event.timeUtc)}</time><span>{event.label}</span>
            </li>
          ))}</ol>
        ) : <p>No sunlight or Earth-visibility transitions in the supplied samples.</p>}
      </details>
      <p className="lunar-chart-footnote">Sunlight strip opacity reflects the supplied visible fraction. The optional panel power-index line is dimensionless (right axis). Earth DTE windows use the supplied Earth visibility state and a {earthClearanceMarginDeg.toFixed(1)}° clearance threshold; this is line-of-sight geometry, not a DSN link-budget prediction. An operations strip appears when operationsWindow samples are supplied.</p>
    </section>
  );
}

export default VisibilityTimelineChart;
