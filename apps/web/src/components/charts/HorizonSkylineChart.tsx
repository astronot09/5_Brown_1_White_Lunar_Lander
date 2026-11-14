import { useEffect, useId, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { LunarSite, SkyPosition, VisibilityState } from '../map/lunarTypes';
import './charts.css';

export interface SkyTrackPoint {
  timeUtc: string;
  position: SkyPosition;
}

const EMPTY_TRACK: SkyTrackPoint[] = [];

export interface HorizonSkylineChartProps {
  site?: LunarSite | null;
  sunPosition?: SkyPosition | null;
  earthPosition?: SkyPosition | null;
  currentVisibility?: VisibilityState | null;
  sunPath?: SkyTrackPoint[];
  earthPath?: SkyTrackPoint[];
  dteMarginDeg?: number;
  height?: number;
  className?: string;
}

function normalizeAzimuth(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function HorizonSkylineChart({
  site,
  sunPosition,
  earthPosition,
  currentVisibility,
  sunPath = EMPTY_TRACK,
  earthPath = EMPTY_TRACK,
  dteMarginDeg = 1,
  height = 310,
  className = '',
}: HorizonSkylineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const clipId = useId().replace(/:/g, '');
  const hasSun = Boolean(sunPosition || (currentVisibility?.sunAzimuthDeg !== undefined && currentVisibility.sunElevationDeg !== undefined));
  const hasEarth = Boolean(earthPosition || (currentVisibility?.earthAzimuthDeg !== undefined && currentVisibility.earthElevationDeg !== undefined));

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const width = chartWidth || svgRef.current.clientWidth || 720;
    const margin = { top: 22, right: 22, bottom: 42, left: 48 };
    const innerWidth = Math.max(1, width - margin.left - margin.right);
    const innerHeight = Math.max(1, height - margin.top - margin.bottom);
    const root = svg.attr('viewBox', `0 0 ${width} ${height}`).append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    if (!site?.horizonMaskDeg?.length) {
      root.append('text').attr('x', innerWidth / 2).attr('y', innerHeight / 2)
        .attr('text-anchor', 'middle').attr('class', 'chart-empty')
        .text('Horizon mask unavailable for this site');
      return;
    }

    const mask = site.horizonMaskDeg;
    const step = site.azimuthStepDeg ?? 360 / mask.length;
    const data = mask.map((elevation, index) => ({
      azimuth: index * step,
      elevation,
      low: site.horizonMaskP5Deg?.[index] ?? elevation,
      high: site.horizonMaskP95Deg?.[index] ?? elevation,
    }));
    // Close the silhouette at 360° without mutating the source mask.
    if (data.length && data[data.length - 1].azimuth < 360) data.push({ ...data[0], azimuth: 360 });

    const sun = sunPosition ?? (currentVisibility?.sunAzimuthDeg !== undefined && currentVisibility.sunElevationDeg !== undefined
      ? { azimuthDeg: currentVisibility.sunAzimuthDeg, elevationDeg: currentVisibility.sunElevationDeg }
      : null);
    const earth = earthPosition ?? (currentVisibility?.earthAzimuthDeg !== undefined && currentVisibility.earthElevationDeg !== undefined
      ? { azimuthDeg: currentVisibility.earthAzimuthDeg, elevationDeg: currentVisibility.earthElevationDeg }
      : null);
    const values = [0, ...data.map((point) => point.elevation), ...data.map((point) => point.elevation + dteMarginDeg), ...(sun ? [sun.elevationDeg] : []), ...(earth ? [earth.elevationDeg] : []), ...sunPath.map((point) => point.position.elevationDeg), ...earthPath.map((point) => point.position.elevationDeg)];
    const minElevation = Math.min(-5, d3.min(values) ?? -5) - 2;
    const maxElevation = Math.max(15, d3.max(values) ?? 15) + 3;
    const x = d3.scaleLinear().domain([0, 360]).range([0, innerWidth]);
    const y = d3.scaleLinear().domain([minElevation, maxElevation]).nice().range([innerHeight, 0]);
    const clip = root.append('defs').append('clipPath').attr('id', clipId);
    clip.append('rect').attr('width', innerWidth).attr('height', innerHeight);

    root.append('g').attr('class', 'chart-grid')
      .call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat((value) => `${value}°`));
    root.append('g').attr('class', 'chart-axis').attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickValues(d3.range(0, 361, 45)).tickFormat((value) => `${value}°`));
    root.append('text').attr('class', 'chart-axis-label').attr('x', innerWidth / 2)
      .attr('y', innerHeight + 36).attr('text-anchor', 'middle').text('Azimuth · clockwise from north');

    const plot = root.append('g').attr('clip-path', `url(#${clipId})`);
    plot.append('path').datum(data).attr('class', 'skyline-area')
      .attr('d', d3.area<(typeof data)[number]>().x((point) => x(point.azimuth)).y0(y(0))
        .y1((point) => y(point.elevation)).curve(d3.curveLinear));
    if (site?.horizonMaskP5Deg && site.horizonMaskP95Deg) {
      plot.append('path').datum(data).attr('class', 'skyline-envelope')
        .attr('d', d3.area<(typeof data)[number]>().x((point) => x(point.azimuth))
          .y0((point) => y(point.low)).y1((point) => y(point.high)));
    }
    plot.append('path').datum(data).attr('class', 'skyline-line')
      .attr('d', d3.line<(typeof data)[number]>().x((point) => x(point.azimuth))
        .y((point) => y(point.elevation)).curve(d3.curveLinear));
    plot.append('path').datum(data).attr('class', 'skyline-dte')
      .attr('d', d3.line<(typeof data)[number]>().x((point) => x(point.azimuth))
        .y((point) => y(point.elevation + dteMarginDeg)).curve(d3.curveLinear));
    plot.append('line').attr('class', 'skyline-zero').attr('x1', 0).attr('x2', innerWidth)
      .attr('y1', y(0)).attr('y2', y(0));

    const addTrack = (track: SkyTrackPoint[], className: string) => {
      if (track.length < 2) return;
      const trackData = track.map((point) => ({ ...point, azimuth: normalizeAzimuth(point.position.azimuthDeg) }))
        .sort((a, b) => a.timeUtc.localeCompare(b.timeUtc));
      plot.append('path').datum(trackData).attr('class', `sky-track ${className}`)
        .attr('d', d3.line<(typeof trackData)[number]>()
          .defined((point, index, points) => index === 0 || Math.abs(point.azimuth - points[index - 1].azimuth) < 180)
          .x((point) => x(point.azimuth)).y((point) => y(point.position.elevationDeg))
          .curve(d3.curveCatmullRom.alpha(0.5)));
      const tickEvery = Math.max(1, Math.floor(trackData.length / 5));
      const ticks = trackData.filter((_, index) => index % tickEvery === 0);
      plot.selectAll(`.track-tick-${className}`).data(ticks)
        .join('circle').attr('class', `track-tick-${className}`).attr('cx', (point) => x(point.azimuth))
        .attr('cy', (point) => y(point.position.elevationDeg)).attr('r', 2.3);
      plot.selectAll(`.track-label-${className}`).data(ticks).join('text')
        .attr('class', `track-label track-label-${className}`).attr('x', (point) => x(point.azimuth) + 3)
        .attr('y', (point) => y(point.position.elevationDeg) - 5)
        .text((point) => d3.utcFormat('%d %Hh')(new Date(point.timeUtc)));
    };
    addTrack(sunPath, 'sun-track');
    addTrack(earthPath, 'earth-track');

    const addBody = (position: SkyPosition | null, label: string, cssClass: string) => {
      if (!position) return;
      const azimuth = normalizeAzimuth(position.azimuthDeg);
      const group = plot.append('g').attr('class', `sky-body ${cssClass}`)
        .attr('transform', `translate(${x(azimuth)},${y(position.elevationDeg)})`);
      const angularRadius = position.angularRadiusDeg ?? (label === 'Sun' ? 0.27 : 0.95);
      const rx = Math.abs(x(azimuth + angularRadius) - x(azimuth));
      const ry = Math.abs(y(position.elevationDeg + angularRadius) - y(position.elevationDeg));
      group.append('ellipse').attr('rx', rx).attr('ry', ry);
      group.append('circle').attr('r', 2.5);
      group.append('text').attr('x', 9).attr('y', -9).text(label);
      group.append('title').text(`${label}: azimuth ${azimuth.toFixed(1)}°, elevation ${position.elevationDeg.toFixed(2)}°`);
    };
    addBody(sun, 'Sun', 'sky-sun');
    addBody(earth, 'Earth', 'sky-earth');

  }, [site, sunPosition, earthPosition, currentVisibility, sunPath, earthPath, dteMarginDeg, height, clipId, chartWidth]);

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

  return (
    <section className={`lunar-chart-panel ${className}`} aria-label="360 degree terrain horizon profile">
      <div className="lunar-chart-heading">
        <div><p className="lunar-chart-eyebrow">LOCAL SKY · TERRAIN MASK</p><h3>Horizon skyline</h3></div>
        {site && <span className="lunar-chart-meta">{site.siteId.replaceAll('_', ' ')}</span>}
      </div>
      <svg ref={svgRef} className="lunar-chart-svg" role="img" aria-label="Terrain horizon elevation around the full 360 degree azimuth, with current Sun and Earth positions where available." />
      <div className="skyline-legend" aria-label="Horizon chart legend">
        <span><i className="sky-legend-terrain" />Terrain horizon</span>
        {hasSun && <span><i className="sky-legend-sun" />Sun</span>}
        {hasEarth && <span><i className="sky-legend-earth" />Earth</span>}
        <span><i className="sky-legend-dte" />DTE clearance (+{dteMarginDeg.toFixed(1)}°)</span>
        {sunPath.length > 1 && <span><i className="sky-legend-sun-path" />Sun path</span>}
        {earthPath.length > 1 && <span><i className="sky-legend-earth-path" />Earth libration</span>}
        {site?.horizonMaskP5Deg && site.horizonMaskP95Deg && <span><i className="sky-legend-envelope" />P5–P95 terrain envelope</span>}
      </div>
      {site?.horizonMaskDeg && (
        <details className="horizon-text-values">
          <summary>Text alternative · horizon at 30° intervals</summary>
          <ul>{Array.from({ length: 12 }, (_, index) => {
            const azimuth = index * 30;
            const sampleIndex = Math.min(site.horizonMaskDeg!.length - 1, Math.round(azimuth / (site.azimuthStepDeg ?? 360 / site.horizonMaskDeg!.length)));
            return <li key={azimuth}>{azimuth}° azimuth: {site.horizonMaskDeg![sampleIndex].toFixed(1)}° elevation</li>;
          })}</ul>
        </details>
      )}
      <p className="lunar-chart-footnote">{site?.demSource && (site.demSource.includes('MOCK') || site.demSource.includes('SYNTHETIC')) ? `Illustrative terrain input: ${site.demSource}. ` : ''}Azimuth is clockwise from north. The dashed DTE clearance profile is the terrain mask plus the {dteMarginDeg.toFixed(1)}° Earth-disk margin. Optional time tracks show the Sun path and Earth libration; body ellipses use nominal angular radii unless precise values are supplied by the ephemeris.</p>
    </section>
  );
}

export default HorizonSkylineChart;
