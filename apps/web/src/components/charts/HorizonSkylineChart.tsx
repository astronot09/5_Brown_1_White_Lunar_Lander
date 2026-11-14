import { useMemo } from 'react';
import type { LunarSite, VisibilityState } from '../map';

export interface SkyTrackPoint {
  timeUtc: string;
  position: {
    azimuthDeg: number;
    elevationDeg: number;
    angularRadiusDeg: number;
  };
}

export interface HorizonSkylineChartProps {
  site: LunarSite;
  sunPosition: { azimuthDeg: number; elevationDeg: number; angularRadiusDeg: number } | null;
  earthPosition: { azimuthDeg: number; elevationDeg: number; angularRadiusDeg: number } | null;
  currentVisibility: VisibilityState | null;
  sunPath?: SkyTrackPoint[];
  earthPath?: SkyTrackPoint[];
  height?: number;
}

export function HorizonSkylineChart({
  site,
  sunPosition,
  earthPosition,
  currentVisibility,
  sunPath = [],
  earthPath = [],
  height = 310,
}: HorizonSkylineChartProps) {
  const width = 680;
  const padLeft = 44;
  const padRight = 18;
  const padTop = 22;
  const padBottom = 32;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const minElev = -8;
  const maxElev = 18;

  const azToX = (az: number) => padLeft + ((((az % 360) + 360) % 360) / 360) * plotW;
  const elToY = (el: number) => {
    const clamped = Math.max(minElev, Math.min(maxElev, el));
    return padTop + ((maxElev - clamped) / (maxElev - minElev)) * plotH;
  };

  // Build SVG path for the 360° lunar mountain horizon profile
  const { terrainPath, ridgeLinePath } = useMemo(() => {
    const mask = site.horizonMaskDeg ?? new Array(360).fill(0);
    const step = site.azimuthStepDeg ?? 1;
    const pts: string[] = [];

    for (let deg = 0; deg <= 360; deg += 2) {
      const idx = Math.floor((deg % 360) / step) % mask.length;
      const elev = mask[idx] ?? 0;
      const x = azToX(deg);
      const y = elToY(elev);
      pts.push(`${deg === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }

    const line = pts.join(' ');
    const area = `${line} L ${azToX(360).toFixed(1)} ${elToY(minElev).toFixed(1)} L ${azToX(0).toFixed(1)} ${elToY(minElev).toFixed(1)} Z`;
    return { terrainPath: area, ridgeLinePath: line };
  }, [site, plotW, plotH]);

  // Helper to convert sky track points into SVG polyline segments (splitting across 360°->0° wrap)
  const buildTrackSegments = (track: SkyTrackPoint[]) => {
    const segments: string[][] = [];
    let current: string[] = [];
    let prevAz: number | null = null;

    track.forEach((pt) => {
      const az = ((pt.position.azimuthDeg % 360) + 360) % 360;
      if (prevAz !== null && Math.abs(az - prevAz) > 180) {
        if (current.length > 1) segments.push(current);
        current = [];
      }
      current.push(`${azToX(az).toFixed(1)},${elToY(pt.position.elevationDeg).toFixed(1)}`);
      prevAz = az;
    });
    if (current.length > 1) segments.push(current);
    return segments;
  };

  const sunSegments = useMemo(() => buildTrackSegments(sunPath), [sunPath, plotW, plotH]);
  const earthSegments = useMemo(() => buildTrackSegments(earthPath), [earthPath, plotW, plotH]);

  const yTicks = [-5, 0, 5, 10, 15];
  const xTicks = [
    { deg: 0, label: '0° N' },
    { deg: 90, label: '90° E' },
    { deg: 180, label: '180° S' },
    { deg: 270, label: '270° W' },
    { deg: 360, label: '360° N' },
  ];

  return (
    <div style={{ position: 'relative', width: '100%', background: '#060a14', borderRadius: 10, border: '1px solid #1e293b', overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height, display: 'block' }}>
        <defs>
          <linearGradient id="lunarRidgeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#334155" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#090d16" stopOpacity="0.98" />
          </linearGradient>
        </defs>

        {/* Elevation Grid Lines */}
        {yTicks.map((deg) => {
          const y = elToY(deg);
          const isZero = deg === 0;
          return (
            <g key={deg}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke={isZero ? 'rgba(56, 189, 248, 0.35)' : '#1e293b'}
                strokeDasharray={isZero ? '4 4' : undefined}
                strokeWidth={1}
              />
              <text x={padLeft - 6} y={y + 3.5} textAnchor="end" fontSize="10" fill="#94a3b8">
                {deg}°
              </text>
            </g>
          );
        })}

        {/* Azimuth Compass Grid Lines */}
        {xTicks.map((t) => {
          const x = azToX(t.deg);
          return (
            <g key={t.deg}>
              <line x1={x} y1={padTop} x2={x} y2={height - padBottom} stroke="#1e293b" strokeWidth={1} />
              <text x={x} y={height - 10} textAnchor="middle" fontSize="10" fill="#94a3b8">
                {t.label}
              </text>
            </g>
          );
        })}

        {/* Sun & Earth Ephemeris Trajectory Paths */}
        {sunSegments.map((pts, i) => (
          <polyline
            key={`sun-seg-${i}`}
            fill="none"
            stroke="rgba(250, 204, 21, 0.35)"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            points={pts.join(' ')}
          />
        ))}

        {earthSegments.map((pts, i) => (
          <polyline
            key={`earth-seg-${i}`}
            fill="none"
            stroke="rgba(56, 189, 248, 0.35)"
            strokeWidth={1.5}
            points={pts.join(' ')}
          />
        ))}

        {/* Shaded Lunar Terrain Mask */}
        <path d={terrainPath} fill="url(#lunarRidgeGrad)" />
        <path d={ridgeLinePath} fill="none" stroke="#64748b" strokeWidth={1.75} />

        {/* Current Earth Position Marker */}
        {earthPosition && (
          <g transform={`translate(${azToX(earthPosition.azimuthDeg)}, ${elToY(earthPosition.elevationDeg)})`}>
            <circle
              r={9}
              fill={currentVisibility?.earthVisible ? 'rgba(56, 189, 248, 0.25)' : 'rgba(244, 63, 94, 0.25)'}
              stroke={currentVisibility?.earthVisible ? '#38bdf8' : '#f43f5e'}
              strokeWidth={1.5}
            />
            <circle r={4} fill={currentVisibility?.earthVisible ? '#38bdf8' : '#f43f5e'} />
            <text y={-12} textAnchor="middle" fontSize="10" fontWeight="700" fill="#7dd3fc">
              EARTH ({earthPosition.elevationDeg.toFixed(1)}°)
            </text>
          </g>
        )}

        {/* Current Sun Position Marker */}
        {sunPosition && (
          <g transform={`translate(${azToX(sunPosition.azimuthDeg)}, ${elToY(sunPosition.elevationDeg)})`}>
            <circle
              r={10}
              fill={currentVisibility?.sunVisible ? 'rgba(250, 204, 21, 0.3)' : 'rgba(148, 163, 184, 0.2)'}
              stroke={currentVisibility?.sunVisible ? '#facc15' : '#94a3b8'}
              strokeWidth={1.5}
            />
            <circle r={5} fill={currentVisibility?.sunVisible ? '#fde047' : '#64748b'} />
            <text y={-13} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fde047">
              SUN ({sunPosition.elevationDeg.toFixed(1)}°)
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}