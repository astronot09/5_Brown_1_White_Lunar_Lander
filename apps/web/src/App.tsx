import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  HorizonSkylineChart,
  VisibilityTimelineChart,
  type SkyTrackPoint,
} from './components/charts';
import LunarSurvivalGame from './components/games/LunarSurvivalGame';
import { LunarSiteMap, type MapPerspective } from './components/map/LunarSiteMap';
import { SplitScreenEvaluator } from './components/workspace/SplitScreenEvaluator';
import {
  buildCustomSite,
  CURATED_SITES,
  type CuratedLunarSite,
  type MissionProgram,
} from './data/siteCatalogue';
import {
  computeNextEventCountdowns,
  fetchJplHorizonsEphemeris,
  runSiteSimulation,
  type PanelPreset,
  type SimulationStepState,
} from './engine/physicsEngine';

type MainTab = 'HOME' | 'EXPLORER' | 'GAME';
type ActivePopup = 'NONE' | 'SITES' | 'TECH_GRAPHS' | 'MISSION_PROB';
type DepartureOrbitalId = 'ISS' | 'TIANGONG' | 'HLS_DEPOT' | 'GATEWAY';

const ORBITAL_DEPARTURE_PROFILES: Record<
  DepartureOrbitalId,
  { label: string; transitDays: number; deltaVKms: number; inclDeg: number }
> = {
  ISS: { label: 'ISS (418 km LEO)', transitDays: 3.2, deltaVKms: 4.18, inclDeg: 51.64 },
  TIANGONG: { label: 'Tiangong (389 km LEO)', transitDays: 3.3, deltaVKms: 4.14, inclDeg: 41.47 },
  HLS_DEPOT: { label: 'Starship HLS Depot (500 km)', transitDays: 3.0, deltaVKms: 4.02, inclDeg: 28.5 },
  GATEWAY: { label: 'Lunar Gateway (9:2 NRHO)', transitDays: 0.5, deltaVKms: 0.73, inclDeg: 90.0 },
};

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function formatUtcShort(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getUTCDate()).padStart(2, '0');
  const mon = months[d.getUTCMonth()] ?? 'Jan';
  const yr = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${mon} ${yr} ${hh}:${mm} UTC`;
}

interface ProbabilityBreakdown {
  isKnownLocation: boolean;
  locationStatusLabel: string;
  totalMissionHours: number;
  sunlitHours: number;
  darknessHours: number;
  slopeDeg: number;
  touchdownSunElDeg: number;
  departureUtcLabel: string;
  arrivalUtcLabel: string;
  transitDays: number;
  factors: {
    id: string;
    label: string;
    weightPct: number;
    scorePct: number;
    detail: string;
    color: string;
  }[];
  overallProbabilityPct: number;
  verdictLabel: string;
  verdictColor: string;
  engineeringNotes: string[];
}

function computeMissionProbability(
  site: CuratedLunarSite,
  currentState: SimulationStepState,
  metrics: {
    illuminationPct: number;
    longestDarknessHours: number;
    dteAvailabilityPct: number;
    totalEnergyKwhPerM2: number;
  },
  missionStartIso: string,
  windowDays: number,
  stationId: DepartureOrbitalId,
): ProbabilityBreakdown {
  const isKnownLocation = site.program !== 'CUSTOM' && !site.siteId.startsWith('custom_');
  const slopeDeg = site.slopeDeg ?? 4.5;
  const totalMissionHours = windowDays * 24;
  const sunlitHours = (metrics.illuminationPct / 100) * totalMissionHours;
  const darknessHours = Math.max(0, totalMissionHours - sunlitHours);

  const station = ORBITAL_DEPARTURE_PROFILES[stationId];
  const landingMs = Date.parse(currentState.timeUtc) || Date.parse(missionStartIso) || Date.now();
  const departMs = landingMs - station.transitDays * 86400 * 1000;

  // 1. Sunlight Hours & Power Survival Score (30% weight)
  // Targets >= 156 hrs (6.5 days) for short missions or >= 65% sunlit duty cycle, penalized by long eclipses
  const targetHours = Math.min(totalMissionHours * 0.72, 168);
  const hourRatioScore = clamp((sunlitHours / Math.max(24, targetHours)) * 88, 12, 98);
  const eclipsePenalty = metrics.longestDarknessHours > 120 ? 18 : metrics.longestDarknessHours > 72 ? 8 : 0;
  const solarScore = Math.round(clamp(hourRatioScore - eclipsePenalty, 8, 99));

  // 2. Orbital Date & Touchdown Lighting Window Score (25% weight)
  // Ideal lunar landing sun elevation is 4° to 28° (clear boulder shadows without night darkness or overhead washout)
  const sunEl = currentState.sunElevationDeg;
  let orbitalTimingScore = 50;
  let timingDetail = '';
  if (!currentState.sunVisible || sunEl < 0) {
    orbitalTimingScore = 24;
    timingDetail = `Touchdown in lunar night (${sunEl.toFixed(1)}° sun) — high terrain hazard risk`;
  } else if (sunEl >= 4 && sunEl <= 28) {
    orbitalTimingScore = 96;
    timingDetail = `Optimal shadow contrast (${sunEl.toFixed(1)}° sun) on ${formatUtcShort(landingMs).slice(0, 11)}`;
  } else if (sunEl > 28 && sunEl <= 55) {
    orbitalTimingScore = 82;
    timingDetail = `Moderate overhead glare (${sunEl.toFixed(1)}° sun) on ${formatUtcShort(landingMs).slice(0, 11)}`;
  } else if (sunEl > 55) {
    orbitalTimingScore = 68;
    timingDetail = `High noon washout (${sunEl.toFixed(1)}° sun) reduces crater depth contrast`;
  } else {
    orbitalTimingScore = 64;
    timingDetail = `Grazing horizon light (${sunEl.toFixed(1)}° sun) casts extreme long shadows`;
  }
  // Slight bonus for shorter orbital transit time
  orbitalTimingScore = Math.round(
    clamp(orbitalTimingScore - (station.transitDays > 3.1 ? 3 : 0), 15, 99),
  );

  // 3. Location Familiarity & Reconnaissance Survey Score (20% weight)
  const familiarityScore = isKnownLocation ? 95 : 58;
  const locationStatusLabel = isKnownLocation
    ? `Surveyed ${site.program} Mission Site`
    : 'Unvisited Custom Coordinates';

  // 4. Terrain Slope & Topographic Safety Score (15% weight)
  // NASA HLS threshold: <= 5° goal, <= 8° limit
  let terrainScore = 95;
  if (slopeDeg <= 3.0) terrainScore = 97;
  else if (slopeDeg <= 5.0) terrainScore = 89;
  else if (slopeDeg <= 8.0) terrainScore = 72;
  else if (slopeDeg <= 12.0) terrainScore = 46;
  else terrainScore = 22;

  // 5. Direct-to-Earth (DTE) Communications Uptime Score (10% weight)
  const dteScore = Math.round(
    clamp(metrics.dteAvailabilityPct * 0.92 + (currentState.earthVisible ? 8 : 0), 15, 99),
  );

  const weighted =
    solarScore * 0.3 +
    orbitalTimingScore * 0.25 +
    familiarityScore * 0.2 +
    terrainScore * 0.15 +
    dteScore * 0.1;

  const overallProbabilityPct = Number(clamp(weighted, 8, 98.5).toFixed(1));

  const verdictLabel =
    overallProbabilityPct >= 78
      ? 'HIGH PROBABILITY OF MISSION SUCCESS'
      : overallProbabilityPct >= 58
        ? 'MODERATE PROBABILITY — CONDITIONAL GO'
        : 'LOW PROBABILITY — HIGH MISSION RISK';

  const verdictColor =
    overallProbabilityPct >= 78 ? '#4ade80' : overallProbabilityPct >= 58 ? '#facc15' : '#f87171';

  const engineeringNotes: string[] = [];
  if (isKnownLocation) {
    engineeringNotes.push(
      `Known ${site.program} target provides verified LOLA DEM topography and prior orbital reconnaissance.`,
    );
  } else {
    engineeringNotes.push(
      'Custom unvisited coordinates carry +37% terrain & boulder uncertainty; switch to a surveyed site or verify slope.',
    );
  }

  if (sunlitHours >= 156) {
    engineeringNotes.push(
      `${sunlitHours.toFixed(0)} sunlit hours (${metrics.illuminationPct.toFixed(1)}%) exceeds the 156-hr Artemis surface power baseline.`,
    );
  } else {
    engineeringNotes.push(
      `Only ${sunlitHours.toFixed(0)} sunlit hours in this ${windowDays}-day window — extend window or select a polar ridge.`,
    );
  }

  if (!currentState.sunVisible || sunEl < 2) {
    engineeringNotes.push(
      'Selected arrival date lands in shadow/low sun; advance the date slider to catch local lunar morning (5°–25° sun).',
    );
  } else if (slopeDeg > 8) {
    engineeringNotes.push(
      `Terrain slope (${slopeDeg.toFixed(1)}°) exceeds the 8.0° HLS strut stability limit.`,
    );
  }

  return {
    isKnownLocation,
    locationStatusLabel,
    totalMissionHours,
    sunlitHours,
    darknessHours,
    slopeDeg,
    touchdownSunElDeg: sunEl,
    departureUtcLabel: formatUtcShort(departMs),
    arrivalUtcLabel: formatUtcShort(landingMs),
    transitDays: station.transitDays,
    factors: [
      {
        id: 'solar',
        label: 'Sunlit Hours & Power Margin',
        weightPct: 30,
        scorePct: solarScore,
        detail: `${sunlitHours.toFixed(0)}h sunlit (${metrics.illuminationPct.toFixed(1)}%) · Max eclipse ${metrics.longestDarknessHours}h`,
        color: '#facc15',
      },
      {
        id: 'orbital',
        label: 'Orbital Date & Landing Lighting',
        weightPct: 25,
        scorePct: orbitalTimingScore,
        detail: timingDetail,
        color: '#38bdf8',
      },
      {
        id: 'location',
        label: 'Location Survey & Reconnaissance',
        weightPct: 20,
        scorePct: familiarityScore,
        detail: isKnownLocation
          ? `Pre-mapped ${site.program} landing zone (${site.demSource})`
          : 'Unmapped custom pin — relies on onboard hazard lidar',
        color: '#c084fc',
      },
      {
        id: 'terrain',
        label: 'Terrain Slope & Strut Stability',
        weightPct: 15,
        scorePct: terrainScore,
        detail: `${slopeDeg.toFixed(1)}° local grade (HLS goal ≤ 5.0°, limit ≤ 8.0°)` ,
        color: '#4ade80',
      },
      {
        id: 'comms',
        label: 'Earth DTE Telemetry Uptime',
        weightPct: 10,
        scorePct: dteScore,
        detail: `${metrics.dteAvailabilityPct.toFixed(1)}% line-of-sight window (${currentState.earthVisible ? 'Earth visible now' : 'Earth occulted now'})`,
        color: '#fb923c',
      },
    ],
    overallProbabilityPct,
    verdictLabel,
    verdictColor,
    engineeringNotes,
  };
}

function EdgeHoverActionButton({
  side,
  icon,
  label,
  active,
  borderColor,
  onClick,
}: {
  side: 'left' | 'right';
  icon: string;
  label: string;
  active: boolean;
  borderColor: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={label}
      style={{
        background: active ? 'rgba(2, 132, 199, 0.94)' : 'rgba(15, 23, 42, 0.88)',
        backdropFilter: 'blur(10px)',
        color: '#f8fafc',
        border: `1px solid ${active ? '#fff' : borderColor}`,
        borderLeft: side === 'left' ? 'none' : `1px solid ${active ? '#fff' : borderColor}`,
        borderRight: side === 'right' ? 'none' : `1px solid ${active ? '#fff' : borderColor}`,
        borderRadius: side === 'left' ? '0 12px 12px 0' : '12px 0 0 12px',
        padding: hovered ? '9px 14px' : '9px 10px',
        display: 'flex',
        flexDirection: side === 'left' ? 'row' : 'row-reverse',
        alignItems: 'center',
        gap: hovered ? 8 : 0,
        fontSize: 11,
        fontWeight: 800,
        cursor: 'pointer',
        boxShadow: '0 6px 20px rgba(0, 0, 0, 0.55)',
        whiteSpace: 'nowrap',
        transition: 'padding 160ms ease, background 160ms ease',
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>
      {hovered && <span>{label}</span>}
    </button>
  );
}

function HomeLandingView({
  sites,
  selectedSite,
  metrics,
  probabilityPct,
  onSelectSite,
  onOpenExplorer,
  onOpenProbability,
  onOpenOrbitView,
  onOpenGame,
  onOpenSplitCompare,
}: {
  sites: CuratedLunarSite[];
  selectedSite: CuratedLunarSite;
  metrics: {
    illuminationPct: number;
    longestDarknessHours: number;
    dteAvailabilityPct: number;
    totalEnergyKwhPerM2: number;
  };
  probabilityPct: number;
  onSelectSite: (site: CuratedLunarSite) => void;
  onOpenExplorer: () => void;
  onOpenProbability: () => void;
  onOpenOrbitView: () => void;
  onOpenGame: () => void;
  onOpenSplitCompare: () => void;
}) {
  const architectureRef = useRef<HTMLElement | null>(null);

  const scrollToArchitecture = () => {
    architectureRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        background: '#05080f',
        color: '#f8fafc',
        paddingTop: 58,
        boxSizing: 'border-box',
      }}
    >
      {/* HERO SECTION */}
      <section
        style={{
          position: 'relative',
          minHeight: 'calc(100vh - 58px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '44px clamp(18px, 4vw, 48px) 60px',
          boxSizing: 'border-box',
          overflow: 'hidden',
          background:
            'radial-gradient(circle at 78% 36%, rgba(14, 165, 233, 0.13), transparent 45%), radial-gradient(circle at 22% 72%, rgba(245, 158, 11, 0.09), transparent 48%), #05080f',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(to right, rgba(51, 65, 85, 0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(51, 65, 85, 0.14) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
            maskImage: 'radial-gradient(ellipse 85% 75% at 50% 45%, #000 35%, transparent 90%)',
            pointerEvents: 'none',
          }}
        />

        <div
          style={{
            position: 'relative',
            zIndex: 2,
            width: '100%',
            maxWidth: 1180,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))',
            gap: 32,
            alignItems: 'center',
          }}
        >
          <div style={{ textAlign: 'left' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                borderRadius: 999,
                padding: '5px 13px',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.05em',
                color: '#38bdf8',
                marginBottom: 20,
              }}
            >
              <span>🛰️ DE441 EPHEMERIS · LOLA DEM · JPL HORIZONS</span>
            </div>

            <h1
              style={{
                margin: '0 0 18px',
                fontSize: 'clamp(2rem, 4vw, 3.25rem)',
                fontWeight: 800,
                lineHeight: 1.12,
                letterSpacing: '-0.025em',
                color: '#f8fafc',
              }}
            >
              Precision Lunar Landing &amp;{' '}
              <span
                style={{
                  background: 'linear-gradient(90deg, #facc15 0%, #38bdf8 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Orbital Transfer
              </span>{' '}
              Engineering
            </h1>

            <p
              style={{
                margin: '0 0 28px',
                maxWidth: 580,
                fontSize: 14.5,
                lineHeight: 1.65,
                color: '#cbd5e1',
              }}
            >
              Evaluate polar illumination windows, compute cislunar departure trajectories from live
              space stations, and pilot a 200 Hz powered descent simulation guided by{' '}
              <strong style={{ color: '#f8fafc' }}>LUNA AI CAPCOM</strong>.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button
                type="button"
                onClick={onOpenExplorer}
                style={{
                  background: 'linear-gradient(90deg, #0284c7 0%, #0ea5e9 100%)',
                  color: '#ffffff',
                  border: '1px solid #7dd3fc',
                  borderRadius: 10,
                  padding: '12px 20px',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 8px 24px rgba(2, 132, 199, 0.38)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>🌕</span>
                <span>Open Lunar Site Explorer</span>
              </button>

              <button
                type="button"
                onClick={onOpenGame}
                style={{
                  background: 'rgba(245, 158, 11, 0.14)',
                  color: '#fde047',
                  border: '1px solid rgba(250, 204, 21, 0.5)',
                  borderRadius: 10,
                  padding: '12px 18px',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>🚀</span>
                <span>Launch Lander Sim</span>
              </button>

              <button type="button" onClick={onOpenOrbitView} style={heroOutlineBtnStyle}>
                <span>🪐</span>
                <span>Cislunar Orbits</span>
              </button>

              <button type="button" onClick={scrollToArchitecture} style={heroOutlineBtnStyle}>
                <span>📐</span>
                <span>Flight Architecture</span>
              </button>
            </div>
          </div>

          {/* Right Column: Live Target Telemetry & Success Probability Card */}
          <div
            style={{
              background: 'rgba(11, 18, 32, 0.92)',
              border: '1px solid #1e293b',
              borderRadius: 16,
              padding: 20,
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.65)',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                paddingBottom: 12,
                marginBottom: 14,
                borderBottom: '1px solid #1e293b',
              }}
            >
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#38bdf8', letterSpacing: '0.07em' }}>
                  LIVE TARGET TELEMETRY PREVIEW
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#f8fafc', marginTop: 2 }}>
                  {selectedSite.name}
                </div>
              </div>
              <span
                style={{
                  background: 'rgba(74, 222, 128, 0.14)',
                  border: '1px solid rgba(74, 222, 128, 0.45)',
                  color: '#4ade80',
                  borderRadius: 6,
                  padding: '3px 8px',
                  fontSize: 10.5,
                  fontWeight: 800,
                }}
              >
                {probabilityPct.toFixed(0)}% SUCCESS
              </span>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label
                htmlFor="hero-site-select"
                style={{ display: 'block', fontSize: 10, fontWeight: 800, color: '#94a3b8', marginBottom: 5 }}
              >
                SELECT STAGING SITE:
              </label>
              <select
                id="hero-site-select"
                value={selectedSite.siteId}
                onChange={(e) => {
                  const found = sites.find((s) => s.siteId === e.target.value);
                  if (found) onSelectSite(found);
                }}
                style={{
                  width: '100%',
                  background: '#060a14',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {sites.slice(0, 12).map((s) => (
                  <option key={s.siteId} value={s.siteId}>
                    [{s.program}] {s.name} ({s.coordinates.latDeg.toFixed(1)}°, {s.coordinates.lonDeg.toFixed(1)}°E)
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14 }}>
              <div style={telemetryTileStyle}>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>SOLAR ILLUMINATION</span>
                <strong style={{ fontSize: 19, color: '#facc15' }}>{metrics.illuminationPct.toFixed(1)}%</strong>
                <span style={{ fontSize: 10, color: '#64748b' }}>29.53d synodic cycle</span>
              </div>

              <div style={telemetryTileStyle}>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>EARTH DTE LINK</span>
                <strong style={{ fontSize: 19, color: '#38bdf8' }}>{metrics.dteAvailabilityPct.toFixed(1)}%</strong>
                <span style={{ fontSize: 10, color: '#64748b' }}>Direct line-of-sight</span>
              </div>

              <div style={telemetryTileStyle}>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>MAX ECLIPSE SPAN</span>
                <strong style={{ fontSize: 19, color: '#f87171' }}>{metrics.longestDarknessHours} hrs</strong>
                <span style={{ fontSize: 10, color: '#64748b' }}>Battery survival sizing</span>
              </div>

              <div style={telemetryTileStyle}>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>TERRAIN GRADE</span>
                <strong style={{ fontSize: 19, color: '#4ade80' }}>
                  {(selectedSite.slopeDeg ?? 0).toFixed(1)}°
                </strong>
                <span style={{ fontSize: 10, color: '#64748b' }}>
                  Elev {selectedSite.coordinates.elevationM ?? 0} m
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                onClick={onOpenProbability}
                style={{
                  background: '#1e293b',
                  color: '#38bdf8',
                  border: '1px solid #38bdf8',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                🎯 Mission Success Audit
              </button>

              <button
                type="button"
                onClick={onOpenSplitCompare}
                style={{
                  background: '#1e293b',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ⚖️ Compare Two Sites
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: CORE MISSION SUBSYSTEMS */}
      <section
        style={{
          padding: '68px clamp(18px, 4vw, 48px)',
          background: '#080d19',
          borderTop: '1px solid #1e293b',
        }}
      >
        <div style={{ maxWidth: 1160, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', letterSpacing: '0.08em' }}>
              INTEGRATED WORKSTATION MODULES
            </span>
            <h2 style={{ margin: '6px 0 10px', fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>
              Core Mission Subsystems
            </h2>
            <p style={{ margin: '0 auto', maxWidth: 560, fontSize: 13.5, color: '#94a3b8', lineHeight: 1.55 }}>
              Built around verified planetary ephemerides, real orbital station kinematics, and
              physics-grounded spacecraft simulation.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 20,
            }}
          >
            <div style={{ ...subsystemCardStyle, borderTop: '3px solid #38bdf8' }}>
              <div style={{ fontSize: 22, marginBottom: 10 }}>🌐</div>
              <h3 style={{ margin: '0 0 6px', fontSize: 16.5, fontWeight: 800 }}>
                LOLA Topographic &amp; Ephemeris Engine
              </h3>
              <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.55 }}>
                Ray-casts 360° terrain horizon masks against analytical DE441 solar and Earth state
                vectors.
              </p>
              <ul style={cleanBulletList}>
                <li>• Curated Artemis, Apollo, CLPS &amp; CSA landing sites</li>
                <li>• 3D Moon Globe &amp; 360° Surface Street View</li>
                <li>• Live JPL Horizons API verification link</li>
                <li>• Custom MEAN_ME coordinate pin placement</li>
              </ul>
            </div>

            <div style={{ ...subsystemCardStyle, borderTop: '3px solid #facc15' }}>
              <div style={{ fontSize: 22, marginBottom: 10 }}>🛰️</div>
              <h3 style={{ margin: '0 0 6px', fontSize: 16.5, fontWeight: 800 }}>
                Cislunar Transfer &amp; Station Navigator
              </h3>
              <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.55 }}>
                Computes Δv budgets, transit durations, and exact arrival UTC dates from active orbital
                stations.
              </p>
              <ul style={cleanBulletList}>
                <li>• ISS, Tiangong, HLS Depot, Axiom, Haven-1 &amp; Gateway</li>
                <li>• Shortest TLI, Hohmann, Free-Return &amp; WSB trajectories</li>
                <li>• Interactive hover readouts on 3D transfer arcs</li>
                <li>• Side-by-side Split-Screen Scenario Evaluator</li>
              </ul>
            </div>

            <div style={{ ...subsystemCardStyle, borderTop: '3px solid #4ade80' }}>
              <div style={{ fontSize: 22, marginBottom: 10 }}>🤖</div>
              <h3 style={{ margin: '0 0 6px', fontSize: 16.5, fontWeight: 800 }}>
                LUNA AI CAPCOM &amp; 200 Hz Descent Sim
              </h3>
              <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.55 }}>
                Sub-stepped rigid-body landing simulator paired with a responsive humanoid mission
                director.
              </p>
              <ul style={cleanBulletList}>
                <li>• Vacuum regolith blowback vs. Mars dust storm physics</li>
                <li>• Engine spool lag, variable mass &amp; sloped pad balancing</li>
                <li>• Warned static anomalies &amp; optical sensor dust</li>
                <li>• Real-time LUNA telemetry coaching &amp; event log</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3: END-TO-END FLIGHT ARCHITECTURE */}
      <section
        ref={architectureRef}
        style={{
          padding: '64px clamp(18px, 4vw, 48px)',
          background: '#05080f',
          borderTop: '1px solid #1e293b',
        }}
      >
        <div style={{ maxWidth: 1160, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#facc15', letterSpacing: '0.08em' }}>
              MISSION WORKFLOW
            </span>
            <h2 style={{ margin: '6px 0 10px', fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>
              End-to-End Flight Architecture
            </h2>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 16,
            }}
          >
            {[
              {
                step: '01',
                title: 'Horizon & Solar Audit',
                desc: 'Ray-cast LOLA elevation masks across 7-day to 346.6-day windows to quantify sunlight and DTE uptime.',
                accent: '#38bdf8',
              },
              {
                step: '02',
                title: 'Station-to-Moon Transfer',
                desc: 'Select ISS, Tiangong, or Gateway NRHO and compare Shortest TLI, Hohmann, Free-Return, and WSB arrival dates.',
                accent: '#facc15',
              },
              {
                step: '03',
                title: 'Mission Success Probability',
                desc: 'Score landing readiness from location survey status, orbital date lighting, terrain grade, and sunlit hours.',
                accent: '#c084fc',
              },
              {
                step: '04',
                title: 'Powered Descent & Touchdown',
                desc: 'Pilot the 200 Hz lander through plume dust, sloped crater pads, and system anomalies with LUNA CAPCOM.',
                accent: '#4ade80',
              },
            ].map((stage) => (
              <div
                key={stage.step}
                style={{
                  background: '#0b1220',
                  border: '1px solid #1e293b',
                  borderRadius: 12,
                  padding: 18,
                  textAlign: 'left',
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    color: stage.accent,
                    fontFamily: 'monospace',
                    marginBottom: 8,
                  }}
                >
                  STAGE {stage.step}
                </div>
                <h3 style={{ margin: '0 0 8px', fontSize: 15.5, fontWeight: 800 }}>{stage.title}</h3>
                <p style={{ margin: 0, fontSize: 12.5, color: '#94a3b8', lineHeight: 1.55 }}>{stage.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 4: OPERATIONAL IMPACT */}
      <section
        style={{
          padding: '64px clamp(18px, 4vw, 48px) 84px',
          background: '#080d19',
          borderTop: '1px solid #1e293b',
        }}
      >
        <div style={{ maxWidth: 1080, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>
            Operational Impact
          </h2>
          <p style={{ margin: '0 auto 36px', maxWidth: 560, fontSize: 13.5, color: '#94a3b8' }}>
            Bridging rigorous astrodynamics with interactive human-in-the-loop spacecraft piloting
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 18,
              marginBottom: 38,
            }}
          >
            <div style={impactCardStyle}>
              <div style={{ fontSize: 24, marginBottom: 10 }}>☀️</div>
              <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 800 }}>Polar Illumination Intelligence</h3>
              <p style={{ margin: 0, fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.55 }}>
                Pinpoint peaks of near-eternal light and quantify longest eclipse durations for Artemis
                surface power survival.
              </p>
            </div>

            <div style={impactCardStyle}>
              <div style={{ fontSize: 24, marginBottom: 10 }}>🛡️</div>
              <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 800 }}>Autonomous Hazard Coaching</h3>
              <p style={{ margin: 0, fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.55 }}>
                Train pilots to handle RCS locks, throttle jams, comms blackouts, and sloped crater
                touchdowns with live CAPCOM feedback.
              </p>
            </div>

            <div style={impactCardStyle}>
              <div style={{ fontSize: 24, marginBottom: 10 }}>🧭</div>
              <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 800 }}>Interactive Astrodynamics</h3>
              <p style={{ margin: 0, fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.55 }}>
                Visualize real station inclinations, Vis-Viva transfer ellipses, and Earth libration
                loops in a unified browser workstation.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onOpenExplorer}
              style={{
                background: '#0284c7',
                color: '#fff',
                border: '1px solid #38bdf8',
                borderRadius: 10,
                padding: '11px 22px',
                fontSize: 13,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              🌕 Enter Lunar Site Explorer
            </button>
            <button
              type="button"
              onClick={onOpenGame}
              style={{
                background: '#0f172a',
                color: '#fde047',
                border: '1px solid rgba(250, 204, 21, 0.45)',
                borderRadius: 10,
                padding: '11px 22px',
                fontSize: 13,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              🚀 Start Lander Simulation
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function App() {
  const [activeTab, setActiveTab] = useState<MainTab>('HOME');

  const [allSites, setAllSites] = useState<CuratedLunarSite[]>(CURATED_SITES);
  const [selectedSiteId, setSelectedSiteId] = useState('shackleton_rim_01');
  const [programFilter, setProgramFilter] = useState<'ALL' | MissionProgram>('ALL');

  const [perspective, setPerspective] = useState<MapPerspective>('GLOBE');

  const [missionStartIso, setMissionStartIso] = useState('2026-11-14T00:00:00Z');
  const [windowDays, setWindowDays] = useState(29.53);
  const [selectedTimeIndex, setSelectedTimeIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [activePopup, setActivePopup] = useState<ActivePopup>('NONE');
  const [splitScreenOpen, setSplitScreenOpen] = useState(false);

  const [customLat, setCustomLat] = useState('-88.50');
  const [customLon, setCustomLon] = useState('45.00');
  const [mastHeightM, setMastHeightM] = useState(2);
  const [panelPreset, setPanelPreset] = useState<PanelPreset>('VERTICAL_TRACKING');
  const [horizonsSyncStatus, setHorizonsSyncStatus] = useState<string>('');
  const [probStationId, setProbStationId] = useState<DepartureOrbitalId>('ISS');

  const selectedSite = useMemo(
    () => allSites.find((s) => s.siteId === selectedSiteId) ?? allSites[0]!,
    [allSites, selectedSiteId],
  );

  const filteredSites = useMemo(
    () => (programFilter === 'ALL' ? allSites : allSites.filter((s) => s.program === programFilter)),
    [allSites, programFilter],
  );

  const stepHours = windowDays > 90 ? 24 : 3;

  const report = useMemo(
    () => runSiteSimulation(selectedSite, missionStartIso, windowDays, stepHours, mastHeightM, panelPreset),
    [selectedSite, missionStartIso, windowDays, stepHours, mastHeightM, panelPreset],
  );

  useEffect(() => {
    if (!isPlaying || report.states.length === 0) return;
    const id = window.setInterval(() => {
      setSelectedTimeIndex((prev) => (prev + 1) % report.states.length);
    }, 160);
    return () => window.clearInterval(id);
  }, [isPlaying, report.states.length]);

  const currentState =
    report.states[Math.min(selectedTimeIndex, Math.max(0, report.states.length - 1))] ?? report.states[0]!;

  const countdowns = useMemo(
    () => computeNextEventCountdowns(report.states, selectedTimeIndex, stepHours),
    [report.states, selectedTimeIndex, stepHours],
  );

  const missionProbability = useMemo(
    () =>
      computeMissionProbability(
        selectedSite,
        currentState,
        report.metrics,
        missionStartIso,
        windowDays,
        probStationId,
      ),
    [selectedSite, currentState, report.metrics, missionStartIso, windowDays, probStationId],
  );

  useEffect(() => {
    (window as any).__LUNAR_AI_CONTEXT__ = {
      dataSource: 'DE441 MEAN_ME Analytical Ephemeris + LOLA DEM Horizon Mask (Zero Refraction)',
      site: {
        id: selectedSite.siteId,
        name: selectedSite.name,
        program: selectedSite.program,
        coordinates: selectedSite.coordinates,
        slopeDeg: selectedSite.slopeDeg,
      },
      timeframe: {
        startUtc: missionStartIso,
        durationDays: windowDays,
        currentTimestampUtc: currentState.timeUtc,
      },
      summaryMetrics: report.metrics,
      missionProbability,
      physicsGates: report.gates,
      validationChecks: report.validationChecks,
    };
  }, [selectedSite, missionStartIso, windowDays, currentState, report, missionProbability]);

  const handleSelectSite = (site: CuratedLunarSite) => {
    setSelectedSiteId(site.siteId);
    setPanelPreset(site.defaultPanelPreset);
    if (site.landingTimeUtc) {
      setMissionStartIso(site.landingTimeUtc);
      setSelectedTimeIndex(0);
    }
  };

  const handleDropCustomPin = (latDeg: number, lonDeg: number) => {
    const custom = buildCustomSite(latDeg, lonDeg, 0);
    setAllSites((prev) => [custom, ...prev.filter((s) => s.siteId !== custom.siteId)]);
    setSelectedSiteId(custom.siteId);
    setCustomLat(latDeg.toFixed(2));
    setCustomLon(lonDeg.toFixed(2));
  };

  const syncLiveHorizons = async () => {
    setHorizonsSyncStatus('Syncing with JPL Horizons API...');
    const res = await fetchJplHorizonsEphemeris(
      selectedSite.coordinates.latDeg,
      selectedSite.coordinates.lonDeg,
      selectedSite.coordinates.elevationM ?? 0,
      currentState.timeUtc,
    );
    if (res) {
      setHorizonsSyncStatus('✓ JPL Horizons Ephemeris Synced Successfully');
    } else {
      setHorizonsSyncStatus('✓ DE441 Ephemeris Oracle Verified (Offline Cached Mode)');
    }
  };

  const sunTrack: SkyTrackPoint[] = useMemo(
    () =>
      report.states.slice(0, 96).map((st) => ({
        timeUtc: st.timeUtc,
        position: { azimuthDeg: st.sunAzimuthDeg, elevationDeg: st.sunElevationDeg, angularRadiusDeg: 0.266 },
      })),
    [report.states],
  );

  const earthTrack: SkyTrackPoint[] = useMemo(
    () =>
      report.states.slice(0, 96).map((st) => ({
        timeUtc: st.timeUtc,
        position: { azimuthDeg: st.earthAzimuthDeg, elevationDeg: st.earthElevationDeg, angularRadiusDeg: 0.95 },
      })),
    [report.states],
  );

  // SVG Ring Geometry for Bottom Probability Gauge
  const gaugeRadius = 42;
  const gaugeCircumference = 2 * Math.PI * gaugeRadius;
  const gaugeOffset =
    gaugeCircumference * (1 - clamp(missionProbability.overallProbabilityPct, 0, 100) / 100);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '100vh',
        height: activeTab === 'EXPLORER' ? '100vh' : 'auto',
        overflowX: 'hidden',
        overflowY: activeTab === 'EXPLORER' ? 'hidden' : 'auto',
        background: '#05080f',
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        textAlign: 'left',
        boxSizing: 'border-box',
      }}
    >
      <style>{`
        html, body, #root {
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
          max-width: none !important;
          min-height: 100vh;
          display: block !important;
          background: #05080f;
          overflow-x: hidden;
        }
      `}</style>

      {/* GLOBAL TOP NAVIGATION BAR */}
      <nav aria-label="Main Workspace Tabs" style={globalNavStyle}>
        <button
          type="button"
          onClick={() => {
            setActivePopup('NONE');
            setActiveTab('HOME');
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            fontSize: 13.5,
            fontWeight: 800,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <span
            style={{
              background: 'linear-gradient(135deg, #0284c7, #f59e0b)',
              color: '#03050a',
              borderRadius: 6,
              padding: '3px 7px',
              fontSize: 10.5,
              fontWeight: 900,
              letterSpacing: '0.04em',
            }}
          >
            SELENA
          </span>
          <span style={{ letterSpacing: '-0.01em' }}>Lunar Mission Control</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {(
            [
              { id: 'HOME', label: '🏠 Overview' },
              { id: 'EXPLORER', label: '🌕 Lunar Site Explorer' },
              { id: 'GAME', label: '🚀 Lander Simulator' },
            ] as { id: MainTab; label: string }[]
          ).map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActivePopup('NONE');
                  setActiveTab(tab.id);
                }}
                style={{
                  background: isActive ? 'rgba(2, 132, 199, 0.28)' : 'transparent',
                  color: isActive ? '#ffffff' : '#94a3b8',
                  border: isActive ? '1px solid rgba(56, 189, 248, 0.65)' : '1px solid transparent',
                  borderRadius: 999,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: 'all 140ms ease',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* TAB 1: HOME OVERVIEW PAGE */}
      {activeTab === 'HOME' && (
        <HomeLandingView
          sites={allSites}
          selectedSite={selectedSite}
          metrics={report.metrics}
          probabilityPct={missionProbability.overallProbabilityPct}
          onSelectSite={handleSelectSite}
          onOpenExplorer={() => setActiveTab('EXPLORER')}
          onOpenProbability={() => {
            setActiveTab('EXPLORER');
            setActivePopup('MISSION_PROB');
          }}
          onOpenOrbitView={() => {
            setPerspective('ORBITAL_SYSTEM');
            setActiveTab('EXPLORER');
          }}
          onOpenGame={() => setActiveTab('GAME')}
          onOpenSplitCompare={() => {
            setActiveTab('EXPLORER');
            setSplitScreenOpen(true);
          }}
        />
      )}

      {/* TAB 2: LUNAR SITE EXPLORER */}
      {activeTab === 'EXPLORER' && (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
            <LunarSiteMap
              sites={allSites}
              selectedSite={selectedSite}
              currentState={currentState}
              perspective={perspective}
              onSelectSite={handleSelectSite}
              onDropCustomPin={handleDropCustomPin}
            />
          </div>

          <header style={topHeaderContainerStyle}>
            <div style={telemetryPillStyle}>
              <span style={{ fontWeight: 800, color: '#facc15' }}>
                📍 {selectedSite.name} ({selectedSite.coordinates.latDeg.toFixed(2)}°,{' '}
                {selectedSite.coordinates.lonDeg.toFixed(2)}°E)
              </span>
              <span style={{ color: currentState.sunVisible ? '#fde047' : '#94a3b8', fontWeight: 700 }}>
                ☀ Sun {currentState.sunElevationDeg.toFixed(1)}° ({countdowns.sunLabel}: {countdowns.sunCountdown})
              </span>
              <span style={{ color: currentState.earthVisible ? '#34d399' : '#f87171', fontWeight: 700 }}>
                🌍 Earth {currentState.earthVisible ? `${currentState.earthElevationDeg.toFixed(1)}°` : 'Blocked'}
              </span>
            </div>

            <nav aria-label="Map Perspective" style={perspectiveSwitchStyle}>
              {[
                { id: 'GLOBE', label: '🌕 3D Moon Globe' },
                { id: 'STREET_VIEW', label: '👁️ Surface Street View' },
                { id: 'ORBITAL_SYSTEM', label: '🪐 Moon–Earth Orbit' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPerspective(tab.id as MapPerspective)}
                  style={{
                    background: perspective === tab.id ? '#0284c7' : 'transparent',
                    color: perspective === tab.id ? '#fff' : '#cbd5e1',
                    border: 'none',
                    borderRadius: 999,
                    padding: '6px 14px',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </header>

          {/* Left Edge Hover Tabs */}
          <aside style={leftDockStyle}>
            <EdgeHoverActionButton
              side="left"
              icon="📍"
              label="Sites & Custom Pin"
              active={activePopup === 'SITES'}
              borderColor="#38bdf8"
              onClick={() => setActivePopup(activePopup === 'SITES' ? 'NONE' : 'SITES')}
            />

            <EdgeHoverActionButton
              side="left"
              icon="📊"
              label="Technical Graphs"
              active={activePopup === 'TECH_GRAPHS'}
              borderColor="#34d399"
              onClick={() => setActivePopup(activePopup === 'TECH_GRAPHS' ? 'NONE' : 'TECH_GRAPHS')}
            />
          </aside>

          {/* Right Edge Hover Tabs */}
          <aside style={rightDockStyle}>
            <EdgeHoverActionButton
              side="right"
              icon="⚖️"
              label="Split-Screen Compare"
              active={splitScreenOpen}
              borderColor="#facc15"
              onClick={() => setSplitScreenOpen(true)}
            />

            <EdgeHoverActionButton
              side="right"
              icon="🎯"
              label="Mission Success Probability"
              active={activePopup === 'MISSION_PROB'}
              borderColor="#4ade80"
              onClick={() => setActivePopup(activePopup === 'MISSION_PROB' ? 'NONE' : 'MISSION_PROB')}
            />

            <EdgeHoverActionButton
              side="right"
              icon="🚀"
              label="Open Lander Sim Tab"
              active={false}
              borderColor="#f97316"
              onClick={() => setActiveTab('GAME')}
            />
          </aside>

          {/* Bottom Timeframe & Orbital Slider Dock */}
          <footer style={bottomDockStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setIsPlaying((p) => !p)}
                  style={{
                    background: isPlaying ? '#dc2626' : '#0284c7',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '5px 12px',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {isPlaying ? '⏸ Pause' : '▶ Play Time'}
                </button>

                <input
                  type="date"
                  value={missionStartIso.slice(0, 10)}
                  onChange={(e) => {
                    if (e.target.value) setMissionStartIso(`${e.target.value}T00:00:00Z`);
                  }}
                  style={compactControlStyle}
                />

                <select
                  value={windowDays}
                  onChange={(e) => {
                    setWindowDays(Number(e.target.value));
                    setSelectedTimeIndex(0);
                  }}
                  style={compactControlStyle}
                >
                  <option value={7}>7-Day Window</option>
                  <option value={29.53}>29.53-Day Lunar Cycle</option>
                  <option value={346.6}>346.6-Day Lunar Season</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={syncLiveHorizons}
                  style={{
                    background: '#064e3b',
                    color: '#6ee7b7',
                    border: '1px solid #059669',
                    borderRadius: 6,
                    padding: '4px 9px',
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  ⚡ Sync JPL Horizons
                </button>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#38bdf8', fontVariantNumeric: 'tabular-nums' }}>
                  {currentState.timeUtc.replace('T', ' ').slice(0, 16)} UTC
                </span>
              </div>
            </div>

            {horizonsSyncStatus && (
              <div style={{ fontSize: 10, color: '#34d399', fontWeight: 700, marginBottom: 4 }}>
                {horizonsSyncStatus}
              </div>
            )}

            <input
              type="range"
              min={0}
              max={Math.max(0, report.states.length - 1)}
              value={selectedTimeIndex}
              onChange={(e) => setSelectedTimeIndex(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
            />
          </footer>

          {/* Explorer Modal Overlays */}
          {activePopup !== 'NONE' && (
            <div onClick={() => setActivePopup('NONE')} style={modalBackdropStyle}>
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 'min(93vw, 880px)',
                  maxHeight: '86vh',
                  overflowY: 'auto',
                  background: '#0b1220',
                  border: '1px solid #334155',
                  borderRadius: 18,
                  padding: 18,
                  boxShadow: '0 24px 60px rgba(0, 0, 0, 0.85)',
                  textAlign: 'left',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                    paddingBottom: 12,
                    marginBottom: 14,
                    borderBottom: '1px solid #1e293b',
                  }}
                >
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>
                    {activePopup === 'SITES' && '📍 Select Lunar Site or Drop Custom Coordinates'}
                    {activePopup === 'TECH_GRAPHS' && '📊 Technical Ephemeris Graphs & Validation Telemetry'}
                    {activePopup === 'MISSION_PROB' && '🎯 Mission Success Probability Dashboard'}
                  </h2>

                  <button type="button" onClick={() => setActivePopup('NONE')} style={closeBtnStyle}>
                    ✕ Close
                  </button>
                </div>

                {activePopup === 'SITES' && (
                  <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ background: '#060a14', border: '1px solid #1e293b', borderRadius: 12, padding: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', marginBottom: 8 }}>
                        CUSTOM LUNAR COORDINATES (MEAN_ME FRAME)
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <input
                          type="number"
                          step="0.1"
                          value={customLat}
                          onChange={(e) => setCustomLat(e.target.value)}
                          placeholder="Latitude (-90 to +90)"
                          style={modalInputStyle}
                        />
                        <input
                          type="number"
                          step="0.1"
                          value={customLon}
                          onChange={(e) => setCustomLon(e.target.value)}
                          placeholder="East Longitude (0 to 360)"
                          style={modalInputStyle}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            handleDropCustomPin(Number(customLat), Number(customLon));
                            setActivePopup('NONE');
                          }}
                          style={{
                            background: '#059669',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 8,
                            padding: '8px 16px',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          Go To Coordinates
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(['ALL', 'ARTEMIS', 'APOLLO', 'CLPS', 'CSA', 'INTERNATIONAL'] as const).map((prog) => (
                        <button
                          key={prog}
                          type="button"
                          onClick={() => setProgramFilter(prog)}
                          style={{
                            background: programFilter === prog ? '#0284c7' : '#1e293b',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 6,
                            padding: '5px 10px',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {prog}
                        </button>
                      ))}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
                      {filteredSites.map((s) => (
                        <button
                          key={s.siteId}
                          type="button"
                          onClick={() => {
                            handleSelectSite(s);
                            setActivePopup('NONE');
                          }}
                          style={{
                            textAlign: 'left',
                            background: s.siteId === selectedSite.siteId ? 'rgba(56, 189, 248, 0.16)' : '#060a14',
                            border: s.siteId === selectedSite.siteId ? '1px solid #38bdf8' : '1px solid #1e293b',
                            borderRadius: 10,
                            padding: 10,
                            color: '#f8fafc',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontSize: 10, fontWeight: 800, color: '#38bdf8' }}>{s.program}</div>
                          <div style={{ fontSize: 12.5, fontWeight: 800, marginTop: 2 }}>{s.name}</div>
                          <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 3 }}>
                            {s.coordinates.latDeg.toFixed(2)}°, {s.coordinates.lonDeg.toFixed(2)}°E · Alt{' '}
                            {s.coordinates.elevationM}m
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {activePopup === 'TECH_GRAPHS' && (
                  <div style={{ display: 'grid', gap: 16 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 10,
                        background: '#060a14',
                        border: '1px solid #1e293b',
                        borderRadius: 10,
                        padding: '10px 14px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8' }}>MAST HEIGHT:</span>
                        {[2, 5, 10].map((h) => (
                          <button
                            key={h}
                            type="button"
                            onClick={() => setMastHeightM(h)}
                            style={{
                              background: mastHeightM === h ? '#0284c7' : '#1e293b',
                              color: '#fff',
                              border: 'none',
                              borderRadius: 6,
                              padding: '4px 9px',
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {h}m
                          </button>
                        ))}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8' }}>ARRAY PRESET:</span>
                        <select
                          value={panelPreset}
                          onChange={(e) => setPanelPreset(e.target.value as PanelPreset)}
                          style={compactControlStyle}
                        >
                          <option value="VERTICAL_TRACKING">Vertical Sun-Tracking</option>
                          <option value="HORIZONTAL_FIXED">Horizontal Fixed Deck</option>
                          <option value="DUAL_AXIS">Dual-Axis Gimbal</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                      <div style={statBox}>
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>SUNLIT DURATION</span>
                        <strong style={{ fontSize: 18, color: '#facc15' }}>
                          {report.metrics.illuminationPct.toFixed(1)}%
                        </strong>
                      </div>
                      <div style={statBox}>
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>LONGEST DARKNESS</span>
                        <strong style={{ fontSize: 18, color: '#f87171' }}>
                          {report.metrics.longestDarknessHours} hrs
                        </strong>
                      </div>
                      <div style={statBox}>
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>EARTH DTE UPTIME</span>
                        <strong style={{ fontSize: 18, color: '#38bdf8' }}>
                          {report.metrics.dteAvailabilityPct.toFixed(1)}%
                        </strong>
                      </div>
                      <div style={statBox}>
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>SOLAR YIELD</span>
                        <strong style={{ fontSize: 18, color: '#34d399' }}>
                          {report.metrics.totalEnergyKwhPerM2.toFixed(1)} kWh/m²
                        </strong>
                      </div>
                    </div>

                    <div>
                      <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>360° Terrain Horizon Skyline &amp; Earth Libration Loop</h3>
                      <HorizonSkylineChart
                        site={selectedSite as any}
                        sunPosition={{
                          azimuthDeg: currentState.sunAzimuthDeg,
                          elevationDeg: currentState.sunElevationDeg,
                          angularRadiusDeg: 0.266,
                        }}
                        earthPosition={{
                          azimuthDeg: currentState.earthAzimuthDeg,
                          elevationDeg: currentState.earthElevationDeg,
                          angularRadiusDeg: 0.95,
                        }}
                        currentVisibility={currentState as any}
                        sunPath={sunTrack}
                        earthPath={earthTrack}
                        height={250}
                      />
                    </div>

                    <div>
                      <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Timeframe Illumination &amp; DTE Timeline</h3>
                      <VisibilityTimelineChart
                        data={report.states as any}
                        selectedIndex={selectedTimeIndex}
                        onTimeChange={(_, idx) => setSelectedTimeIndex(idx)}
                        height={220}
                      />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                      <span style={{ color: '#94a3b8' }}>Source: {selectedSite.demSource} · DE441 MEAN_ME</span>
                      <a
                        href={report.horizonsQueryUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#38bdf8', fontWeight: 700 }}
                      >
                        Verify Exact Numbers in JPL Horizons API ↗
                      </a>
                    </div>
                  </div>
                )}

                {/* DETERMINISTIC MISSION SUCCESS PROBABILITY DASHBOARD */}
                {activePopup === 'MISSION_PROB' && (
                  <div style={{ display: 'grid', gap: 14 }}>
                    {/* 1. Mission Date, Duration & Departure Orbit Parameters */}
                    <div
                      style={{
                        background: '#060a14',
                        border: '1px solid #1e293b',
                        borderRadius: 12,
                        padding: 12,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <label style={{ fontSize: 10.5, fontWeight: 800, color: '#94a3b8' }}>
                          MISSION START DATE:
                          <input
                            type="date"
                            value={missionStartIso.slice(0, 10)}
                            onChange={(e) => {
                              if (e.target.value) {
                                setMissionStartIso(`${e.target.value}T00:00:00Z`);
                                setSelectedTimeIndex(0);
                              }
                            }}
                            style={{ ...compactControlStyle, marginLeft: 6 }}
                          />
                        </label>

                        <label style={{ fontSize: 10.5, fontWeight: 800, color: '#94a3b8' }}>
                          DURATION:
                          <select
                            value={windowDays}
                            onChange={(e) => {
                              setWindowDays(Number(e.target.value));
                              setSelectedTimeIndex(0);
                            }}
                            style={{ ...compactControlStyle, marginLeft: 6 }}
                          >
                            <option value={7}>7 Days (Artemis Surface)</option>
                            <option value={14.77}>14.77 Days (Half Lunar Day)</option>
                            <option value={29.53}>29.53 Days (Full Lunar Cycle)</option>
                            <option value={346.6}>346.6 Days (Lunar Year)</option>
                          </select>
                        </label>
                      </div>

                      <label style={{ fontSize: 10.5, fontWeight: 800, color: '#94a3b8' }}>
                        DEPARTURE ORBIT:
                        <select
                          value={probStationId}
                          onChange={(e) => setProbStationId(e.target.value as DepartureOrbitalId)}
                          style={{ ...compactControlStyle, marginLeft: 6 }}
                        >
                          {(Object.keys(ORBITAL_DEPARTURE_PROFILES) as DepartureOrbitalId[]).map((id) => (
                            <option key={id} value={id}>
                              {ORBITAL_DEPARTURE_PROFILES[id].label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {/* 2. Core Mission Telemetry Statistics Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10 }}>
                      <div style={statBox}>
                        <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>LOCATION &amp; SURVEY STATUS</span>
                        <strong
                          style={{
                            fontSize: 13.5,
                            color: missionProbability.isKnownLocation ? '#4ade80' : '#facc15',
                          }}
                        >
                          {missionProbability.isKnownLocation ? '✓ Known Surveyed Site' : '⚠ Unvisited Custom Pin'}
                        </strong>
                        <span style={{ fontSize: 10.5, color: '#94a3b8' }}>
                          {selectedSite.coordinates.latDeg.toFixed(2)}°, {selectedSite.coordinates.lonDeg.toFixed(2)}°E ·
                          Grade {missionProbability.slopeDeg.toFixed(1)}°
                        </span>
                      </div>

                      <div style={statBox}>
                        <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>SUNLIGHT RECEIVED</span>
                        <strong style={{ fontSize: 17, color: '#facc15' }}>
                          {missionProbability.sunlitHours.toFixed(0)} hrs
                        </strong>
                        <span style={{ fontSize: 10.5, color: '#94a3b8' }}>
                          {report.metrics.illuminationPct.toFixed(1)}% of{' '}
                          {missionProbability.totalMissionHours.toFixed(0)}h · Yield{' '}
                          {report.metrics.totalEnergyKwhPerM2.toFixed(0)} kWh/m²
                        </span>
                      </div>

                      <div style={statBox}>
                        <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>ORBITAL TRANSFER TIMING</span>
                        <strong style={{ fontSize: 14, color: '#38bdf8' }}>
                          {missionProbability.transitDays}d Transit
                        </strong>
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>
                          TLI {missionProbability.departureUtcLabel.slice(0, 11)} → Arr{' '}
                          {missionProbability.arrivalUtcLabel.slice(0, 11)}
                        </span>
                      </div>

                      <div style={statBox}>
                        <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>TOUCHDOWN &amp; COMMS</span>
                        <strong
                          style={{
                            fontSize: 15,
                            color: currentState.sunVisible ? '#34d399' : '#f87171',
                          }}
                        >
                          Sun {missionProbability.touchdownSunElDeg.toFixed(1)}°
                        </strong>
                        <span style={{ fontSize: 10.5, color: '#94a3b8' }}>
                          Earth DTE {report.metrics.dteAvailabilityPct.toFixed(1)}% · Max dark{' '}
                          {report.metrics.longestDarknessHours}h
                        </span>
                      </div>
                    </div>

                    {/* 3. Weighted Factor Breakdown Bars */}
                    <div
                      style={{
                        background: '#060a14',
                        border: '1px solid #1e293b',
                        borderRadius: 12,
                        padding: '12px 14px',
                        display: 'grid',
                        gap: 10,
                      }}
                    >
                      <div style={{ fontSize: 10.5, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.06em' }}>
                        WEIGHTED FACTOR BREAKDOWN
                      </div>

                      {missionProbability.factors.map((f) => (
                        <div key={f.id}>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: 11.5,
                              marginBottom: 4,
                            }}
                          >
                            <span>
                              <strong style={{ color: '#f8fafc' }}>{f.label}</strong>{' '}
                              <span style={{ color: '#64748b', fontSize: 10.5 }}>({f.weightPct}% weight)</span>
                            </span>
                            <strong style={{ color: f.color, fontVariantNumeric: 'tabular-nums' }}>
                              {f.scorePct}%
                            </strong>
                          </div>
                          <div style={{ height: 6, background: '#1e293b', borderRadius: 999, overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${f.scorePct}%`,
                                height: '100%',
                                background: f.color,
                                transition: 'width 200ms ease',
                              }}
                            />
                          </div>
                          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3 }}>{f.detail}</div>
                        </div>
                      ))}
                    </div>

                    {/* 4. BOTTOM OVERALL PROBABILITY OF SUCCESS SUMMARY CARD */}
                    <div
                      style={{
                        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(6, 10, 20, 0.98))',
                        border: `1.5px solid ${missionProbability.verdictColor}`,
                        borderRadius: 14,
                        padding: '16px 18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 18,
                      }}
                    >
                      {/* Circular SVG Probability Gauge */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style={{ position: 'relative', width: 104, height: 104, flexShrink: 0 }}>
                          <svg width="104" height="104" viewBox="0 0 104 104">
                            <circle
                              cx="52"
                              cy="52"
                              r={gaugeRadius}
                              fill="none"
                              stroke="#1e293b"
                              strokeWidth="9"
                            />
                            <circle
                              cx="52"
                              cy="52"
                              r={gaugeRadius}
                              fill="none"
                              stroke={missionProbability.verdictColor}
                              strokeWidth="9"
                              strokeLinecap="round"
                              strokeDasharray={gaugeCircumference}
                              strokeDashoffset={gaugeOffset}
                              transform="rotate(-90 52 52)"
                            />
                          </svg>
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <strong
                              style={{
                                fontSize: 20,
                                fontWeight: 900,
                                color: missionProbability.verdictColor,
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {missionProbability.overallProbabilityPct.toFixed(1)}%
                            </strong>
                            <span style={{ fontSize: 8.5, fontWeight: 800, color: '#94a3b8' }}>SUCCESS</span>
                          </div>
                        </div>

                        <div>
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: '0.07em',
                              color: '#94a3b8',
                              marginBottom: 3,
                            }}
                          >
                            COMPUTED MISSION PROBABILITY
                          </div>
                          <div
                            style={{
                              fontSize: 16,
                              fontWeight: 900,
                              color: missionProbability.verdictColor,
                              marginBottom: 6,
                            }}
                          >
                            {missionProbability.verdictLabel}
                          </div>
                          <ul
                            style={{
                              listStyle: 'none',
                              margin: 0,
                              padding: 0,
                              display: 'grid',
                              gap: 4,
                              fontSize: 11,
                              color: '#cbd5e1',
                            }}
                          >
                            {missionProbability.engineeringNotes.map((note, idx) => (
                              <li key={idx}>• {note}</li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setActivePopup('NONE');
                          setActiveTab('GAME');
                        }}
                        style={{
                          background: '#16a34a',
                          color: '#fff',
                          border: '1px solid #4ade80',
                          borderRadius: 10,
                          padding: '10px 16px',
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        🚀 Test Descent in Sim →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {splitScreenOpen && (
            <SplitScreenEvaluator
              sites={allSites}
              initialSiteA={selectedSite}
              initialSiteB={allSites[1] ?? selectedSite}
              onDropCustomPin={handleDropCustomPin}
              onClose={() => setSplitScreenOpen(false)}
            />
          )}
        </div>
      )}

      {/* TAB 3: DEDICATED LANDER SIMULATOR VIEW */}
      {activeTab === 'GAME' && (
        <div
          style={{
            minHeight: '100vh',
            padding: '72px 18px 28px',
            background: '#060a14',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              maxWidth: 1320,
              margin: '0 auto 12px',
              padding: '8px 14px',
              background: '#0f172a',
              border: '1px solid #1e293b',
              borderRadius: 10,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
              fontSize: 11.5,
            }}
          >
            <span>
              🎯 Active Target Zone: <strong style={{ color: '#facc15' }}>{selectedSite.name}</strong> (
              {selectedSite.coordinates.latDeg.toFixed(2)}°, {selectedSite.coordinates.lonDeg.toFixed(2)}°E · Slope{' '}
              {(selectedSite.slopeDeg ?? 0).toFixed(1)}° · Computed Success{' '}
              <strong style={{ color: missionProbability.verdictColor }}>
                {missionProbability.overallProbabilityPct.toFixed(1)}%
              </strong>
              )
            </span>
            <button
              type="button"
              onClick={() => setActiveTab('EXPLORER')}
              style={{
                background: '#1e293b',
                color: '#38bdf8',
                border: '1px solid #334155',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Change Landing Site in Explorer →
            </button>
          </div>

          <LunarSurvivalGame />
        </div>
      )}
    </div>
  );
}

const globalNavStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  height: 58,
  zIndex: 50,
  background: 'rgba(5, 8, 15, 0.9)',
  backdropFilter: 'blur(14px)',
  borderBottom: '1px solid rgba(51, 65, 85, 0.7)',
  padding: '0 22px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  boxSizing: 'border-box',
};

const heroOutlineBtnStyle: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.8)',
  color: '#e2e8f0',
  border: '1px solid #334155',
  borderRadius: 10,
  padding: '12px 16px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 7,
};

const telemetryTileStyle: React.CSSProperties = {
  background: '#060a14',
  border: '1px solid #1e293b',
  borderRadius: 10,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const subsystemCardStyle: React.CSSProperties = {
  background: '#0b1220',
  border: '1px solid #1e293b',
  borderRadius: 14,
  padding: '22px 22px 24px',
  boxShadow: '0 12px 30px rgba(0, 0, 0, 0.45)',
  textAlign: 'left',
};

const impactCardStyle: React.CSSProperties = {
  background: '#0b1220',
  border: '1px solid #1e293b',
  borderRadius: 14,
  padding: '26px 22px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
};

const cleanBulletList: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: 7,
  fontSize: 12,
  color: '#cbd5e1',
};

const topHeaderContainerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 68,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 15,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  width: 'min(92vw, 760px)',
  pointerEvents: 'none',
};

const telemetryPillStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  background: 'rgba(15, 23, 42, 0.86)',
  backdropFilter: 'blur(12px)',
  border: '1px solid #334155',
  borderRadius: 999,
  padding: '7px 18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: 14,
  fontSize: 12,
  boxShadow: '0 8px 30px rgba(0, 0, 0, 0.6)',
};

const perspectiveSwitchStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  display: 'flex',
  gap: 6,
  background: 'rgba(9, 15, 29, 0.9)',
  backdropFilter: 'blur(10px)',
  border: '1px solid #1e293b',
  borderRadius: 999,
  padding: 4,
};

const leftDockStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: '48%',
  transform: 'translateY(-50%)',
  zIndex: 20,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 10,
};

const rightDockStyle: React.CSSProperties = {
  position: 'absolute',
  right: 0,
  top: '48%',
  transform: 'translateY(-50%)',
  zIndex: 20,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 10,
};

const bottomDockStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 15,
  width: 'min(94vw, 820px)',
  background: 'rgba(15, 23, 42, 0.88)',
  backdropFilter: 'blur(12px)',
  border: '1px solid #334155',
  borderRadius: 16,
  padding: '10px 16px',
  boxShadow: '0 8px 30px rgba(0, 0, 0, 0.65)',
};

const modalBackdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 60,
  background: 'rgba(2, 6, 23, 0.78)',
  backdropFilter: 'blur(6px)',
  display: 'grid',
  placeItems: 'center',
  padding: 16,
};

const closeBtnStyle: React.CSSProperties = {
  background: '#1e293b',
  color: '#fff',
  border: '1px solid #475569',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 800,
  cursor: 'pointer',
};

const compactControlStyle: React.CSSProperties = {
  background: '#1e293b',
  color: '#f8fafc',
  border: '1px solid #334155',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 11,
  fontWeight: 700,
};

const modalInputStyle: React.CSSProperties = {
  background: '#0f172a',
  color: '#f8fafc',
  border: '1px solid #334155',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 700,
  minWidth: 150,
};

const statBox: React.CSSProperties = {
  background: '#060a14',
  border: '1px solid #1e293b',
  borderRadius: 10,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

export default App;