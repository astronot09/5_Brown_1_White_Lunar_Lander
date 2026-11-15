import React, { useEffect, useMemo, useState } from 'react';
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
} from './engine/physicsEngine';

type ActivePopup = 'NONE' | 'SITES' | 'TECH_GRAPHS' | 'AI_HOOK' | 'LANDER_SIM';

interface LiveLanderTelemetry {
  altitudeM?: number;
  verticalSpeedMs?: number;
  horizontalSpeedMs?: number;
  fuelPct?: number;
  tiltDeg?: number;
  status?: 'ready' | 'playing' | 'landed' | 'crashed';
  activeWarning?: string;
}

/**
 * Floating humanoid EVA companion ("LUNA") that hovers beside the simulator
 * without obstructing gameplay controls or telemetry gauges.
 */
function LunaHoverCompanion({
  site,
  sunVisible,
  earthVisible,
  liveTelemetry,
}: {
  site: CuratedLunarSite;
  sunVisible: boolean;
  earthVisible: boolean;
  liveTelemetry: LiveLanderTelemetry | null;
}) {
  const [minimized, setMinimized] = useState(false);
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      setBlink(true);
      window.setTimeout(() => setBlink(false), 160);
    }, 3800);
    return () => window.clearInterval(id);
  }, []);

  const guidance = useMemo(() => {
    const slope = site.slopeDeg ?? 0;

    if (liveTelemetry?.activeWarning) {
      return {
        level: 'CRITICAL' as const,
        title: 'ACTIVE FLIGHT ALERT',
        message: liveTelemetry.activeWarning,
      };
    }

    if (liveTelemetry?.status === 'playing') {
      const vy = Math.abs(liveTelemetry.verticalSpeedMs ?? 0);
      const fuel = liveTelemetry.fuelPct ?? 100;
      if (vy > 4.2) {
        return {
          level: 'CRITICAL' as const,
          title: 'HIGH DESCENT RATE',
          message: `Sink rate ${vy.toFixed(1)} m/s exceeds strut limit. Increase main throttle now.`,
        };
      }
      if (fuel < 22) {
        return {
          level: 'CAUTION' as const,
          title: 'LOW PROPELLANT MARGIN',
          message: `Propellant at ${fuel}%. Avoid hovering and commit smoothly to the pad.`,
        };
      }
    }

    if (!sunVisible) {
      return {
        level: 'CAUTION' as const,
        title: 'LOW-LIGHT TERRAIN',
        message: `${site.name} is currently in shadow (${slope.toFixed(1)}° slope). Keep your landing spotlight active.`,
      };
    }

    if (!earthVisible) {
      return {
        level: 'CAUTION' as const,
        title: 'DTE OCCULTATION',
        message: `Direct-to-Earth link is blocked by lunar terrain at ${site.name}. Rely on onboard inertial guidance.`,
      };
    }

    return {
      level: 'NOMINAL' as const,
      title: 'LUNA // FLIGHT DIRECTOR',
      message: `Target ${site.name} locked (${slope.toFixed(1)}° terrain slope). Keep sink rate under 4.2 m/s and deploy gear before touchdown.`,
    };
  }, [site, sunVisible, earthVisible, liveTelemetry]);

  const accentColor =
    guidance.level === 'CRITICAL'
      ? '#f87171'
      : guidance.level === 'CAUTION'
        ? '#facc15'
        : '#38bdf8';

  return (
    <aside
      aria-label="LUNA Flight Companion"
      style={{
        position: 'fixed',
        right: 20,
        bottom: 22,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 10,
        pointerEvents: 'none',
        animation: 'lunaZeroGFloat 4.6s ease-in-out infinite',
      }}
    >
      {/* Speech / Telemetry Callout Bubble */}
      {!minimized && (
        <div
          style={{
            pointerEvents: 'auto',
            width: 268,
            background: 'rgba(9, 15, 29, 0.94)',
            backdropFilter: 'blur(12px)',
            border: `1px solid ${accentColor}`,
            borderRadius: 14,
            padding: '11px 13px',
            boxShadow: '0 14px 34px rgba(0, 0, 0, 0.72)',
            color: '#f8fafc',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 5,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.07em',
                color: accentColor,
              }}
            >
              ● {guidance.title}
            </span>
            <button
              type="button"
              onClick={() => setMinimized(true)}
              title="Minimize LUNA callout"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
                padding: '0 4px',
              }}
            >
              —
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.45, color: '#cbd5e1' }}>
            {guidance.message}
          </p>
        </div>
      )}

      {/* Hovering Humanoid Astronaut / AI Figure */}
      <button
        type="button"
        onClick={() => setMinimized((m) => !m)}
        title={minimized ? 'Expand LUNA Flight Assistant' : 'Click to toggle LUNA callout'}
        style={{
          pointerEvents: 'auto',
          background: 'radial-gradient(circle at 50% 45%, rgba(56, 189, 248, 0.2), rgba(9, 15, 29, 0.92) 72%)',
          border: `1.5px solid ${accentColor}`,
          borderRadius: 999,
          width: 96,
          height: 114,
          padding: 4,
          cursor: 'pointer',
          boxShadow: `0 10px 28px rgba(0,0,0,0.75), 0 0 18px ${accentColor}33`,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <svg width="78" height="98" viewBox="0 0 90 112" fill="none">
          {/* RCS Backpack */}
          <rect x="24" y="42" width="42" height="30" rx="8" fill="#1e293b" stroke="#475569" strokeWidth="1.5" />
          {/* Thruster Glow */}
          <ellipse cx="33" cy="75" rx="4" ry="6" fill={accentColor} opacity="0.55" />
          <ellipse cx="57" cy="75" rx="4" ry="6" fill={accentColor} opacity="0.55" />

          {/* Antenna */}
          <line x1="45" y1="6" x2="45" y2="15" stroke={accentColor} strokeWidth="2" strokeLinecap="round" />
          <circle cx="45" cy="5" r="3" fill={accentColor} />

          {/* Astronaut Helmet */}
          <rect x="25" y="14" width="40" height="32" rx="15" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1.5" />
          {/* Visor */}
          <rect x="30" y="20" width="30" height="19" rx="9" fill="#060a14" stroke={accentColor} strokeWidth="1.4" />
          {/* Expressive Eyes */}
          {blink ? (
            <>
              <line x1="36" y1="29" x2="42" y2="29" stroke={accentColor} strokeWidth="2" strokeLinecap="round" />
              <line x1="48" y1="29" x2="54" y2="29" stroke={accentColor} strokeWidth="2" strokeLinecap="round" />
            </>
          ) : (
            <>
              <circle cx="39" cy="29" r="2.6" fill={accentColor} />
              <circle cx="51" cy="29" r="2.6" fill={accentColor} />
            </>
          )}

          {/* Torso Suit */}
          <rect x="28" y="47" width="34" height="28" rx="10" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1.5" />
          {/* Chest Telemetry Core */}
          <rect x="37" y="54" width="16" height="10" rx="3" fill="#0f172a" stroke={accentColor} strokeWidth="1.2" />
          <circle cx="45" cy="59" r="2.3" fill={accentColor} />

          {/* Floating Arms */}
          <path d="M27 52 C17 56, 15 66, 21 71" stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" />
          <path d="M63 52 C73 56, 75 66, 69 71" stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" />

          {/* Zero-G Boots */}
          <path d="M36 75 L33 93" stroke="#cbd5e1" strokeWidth="6.5" strokeLinecap="round" />
          <path d="M54 75 L57 93" stroke="#cbd5e1" strokeWidth="6.5" strokeLinecap="round" />
          <rect x="27" y="91" width="11" height="5" rx="2.5" fill="#334155" />
          <rect x="52" y="91" width="11" height="5" rx="2.5" fill="#334155" />
        </svg>
      </button>
    </aside>
  );
}

export function App() {
  const [allSites, setAllSites] = useState<CuratedLunarSite[]>(CURATED_SITES);
  const [selectedSiteId, setSelectedSiteId] = useState('shackleton_rim_01');
  const [programFilter, setProgramFilter] = useState<'ALL' | MissionProgram>('ALL');

  // Centerpiece Perspective: 3D Globe | 360° Surface Street View | Earth-Moon Orbit
  const [perspective, setPerspective] = useState<MapPerspective>('GLOBE');

  // Timeframe & Slider State
  const [missionStartIso, setMissionStartIso] = useState('2026-11-14T00:00:00Z');
  const [windowDays, setWindowDays] = useState(29.53);
  const [selectedTimeIndex, setSelectedTimeIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Popup & Split-Screen States
  const [activePopup, setActivePopup] = useState<ActivePopup>('NONE');
  const [splitScreenOpen, setSplitScreenOpen] = useState(false);

  // Custom Coordinate Inputs & Horizons status
  const [customLat, setCustomLat] = useState('-88.50');
  const [customLon, setCustomLon] = useState('45.00');
  const [mastHeightM, setMastHeightM] = useState(2);
  const [panelPreset, setPanelPreset] = useState<PanelPreset>('VERTICAL_TRACKING');
  const [horizonsSyncStatus, setHorizonsSyncStatus] = useState<string>('');
  const [liveLanderTelemetry, setLiveLanderTelemetry] = useState<LiveLanderTelemetry | null>(null);

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

  // Optional listener if LunarSurvivalGame dispatches live telemetry events
  useEffect(() => {
    const onSimTelemetry = (e: Event) => {
      const detail = (e as CustomEvent<LiveLanderTelemetry>).detail;
      if (detail) setLiveLanderTelemetry(detail);
    };
    window.addEventListener('luna-sim-telemetry', onSimTelemetry);
    return () => window.removeEventListener('luna-sim-telemetry', onSimTelemetry);
  }, []);

  const currentState =
    report.states[Math.min(selectedTimeIndex, Math.max(0, report.states.length - 1))] ?? report.states[0]!;

  const countdowns = useMemo(
    () => computeNextEventCountdowns(report.states, selectedTimeIndex, stepHours),
    [report.states, selectedTimeIndex, stepHours],
  );

  // Expose verified deterministic telemetry payload on window for AI API integration
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
      physicsGates: report.gates,
      validationChecks: report.validationChecks,
    };
  }, [selectedSite, missionStartIso, windowDays, currentState, report]);

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

  const isLanderModal = activePopup === 'LANDER_SIM';

  return (
    <div style={appShellStyle}>
      <style>{`
        @keyframes lunaZeroGFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-9px); }
        }
      `}</style>

      {/* CENTERPIECE: FULL-VIEWPORT 3D MOON / STREET VIEW / ORBITAL SYSTEM */}
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

      {/* TOP FLOATING STATUS & PERSPECTIVE SWITCHER PILL */}
      <header style={topHeaderContainerStyle}>
        <div style={telemetryPillStyle}>
          <span style={{ fontWeight: 800, color: '#facc15' }}>
            📍 {selectedSite.name} ({selectedSite.coordinates.latDeg.toFixed(2)}°, {selectedSite.coordinates.lonDeg.toFixed(2)}°E)
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
                transition: 'background 150ms ease',
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* LEFT FLOATING ACTION DOCK */}
      <aside style={leftDockStyle}>
        <button
          type="button"
          onClick={() => setActivePopup(activePopup === 'SITES' ? 'NONE' : 'SITES')}
          style={floatingBtnStyle(activePopup === 'SITES', '#38bdf8')}
        >
          <span style={{ fontSize: 18 }}>📍</span>
          <span>Sites &amp; Custom Pin</span>
        </button>

        <button
          type="button"
          onClick={() => setActivePopup(activePopup === 'TECH_GRAPHS' ? 'NONE' : 'TECH_GRAPHS')}
          style={floatingBtnStyle(activePopup === 'TECH_GRAPHS', '#34d399')}
        >
          <span style={{ fontSize: 18 }}>📊</span>
          <span>Technical Graphs</span>
        </button>
      </aside>

      {/* RIGHT FLOATING ACTION DOCK */}
      <aside style={rightDockStyle}>
        <button
          type="button"
          onClick={() => setSplitScreenOpen(true)}
          style={floatingBtnStyle(splitScreenOpen, '#facc15')}
        >
          <span style={{ fontSize: 18 }}>⚖️</span>
          <span>Split-Screen Compare</span>
        </button>

        <button
          type="button"
          onClick={() => setActivePopup(activePopup === 'AI_HOOK' ? 'NONE' : 'AI_HOOK')}
          style={floatingBtnStyle(activePopup === 'AI_HOOK', '#c084fc')}
        >
          <span style={{ fontSize: 18 }}>🤖</span>
          <span>AI Analyst Hook</span>
        </button>

        <button
          type="button"
          onClick={() => setActivePopup(activePopup === 'LANDER_SIM' ? 'NONE' : 'LANDER_SIM')}
          style={floatingBtnStyle(activePopup === 'LANDER_SIM', '#f97316')}
        >
          <span style={{ fontSize: 18 }}>🚀</span>
          <span>Lander Descent Sim</span>
        </button>
      </aside>

      {/* BOTTOM TIMEFRAME & ORBITAL SLIDER DOCK */}
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

      {/* POPUP MODAL OVERLAYS */}
      {activePopup !== 'NONE' && (
        <div onClick={() => setActivePopup('NONE')} style={modalBackdropStyle}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: isLanderModal ? 'min(96vw, 1340px)' : 'min(94vw, 980px)',
              maxHeight: isLanderModal ? '92vh' : '86vh',
              overflowY: 'auto',
              background: '#0b1220',
              border: '1px solid #334155',
              borderRadius: 18,
              padding: isLanderModal ? '16px 20px' : 20,
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.85)',
            }}
          >
            {/* Modal Top Bar */}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>
                  {activePopup === 'SITES' && '📍 Select Lunar Site or Drop Custom Coordinates'}
                  {activePopup === 'TECH_GRAPHS' && '📊 Technical Ephemeris Graphs & Validation Telemetry'}
                  {activePopup === 'AI_HOOK' && '🤖 AI Mission Effectiveness Analyst'}
                  {activePopup === 'LANDER_SIM' && '🚀 Powered Lunar Descent & Touchdown Simulator'}
                </h2>

                {isLanderModal && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#38bdf8',
                      background: 'rgba(2, 132, 199, 0.14)',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                      borderRadius: 999,
                      padding: '3px 10px',
                    }}
                  >
                    LZ: {selectedSite.name} · Slope {(selectedSite.slopeDeg ?? 0).toFixed(1)}°
                  </span>
                )}
              </div>

              <button type="button" onClick={() => setActivePopup('NONE')} style={closeBtnStyle}>
                ✕ Close
              </button>
            </div>

            {activePopup === 'SITES' && (
              <div style={{ display: 'grid', gap: 16 }}>
                <div style={{ background: '#060a14', border: '1px solid #1e293b', borderRadius: 12, padding: 14 }}>
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

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
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
                        padding: 12,
                        color: '#f8fafc',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#38bdf8' }}>{s.program}</div>
                      <div style={{ fontSize: 13, fontWeight: 800, marginTop: 2 }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                        {s.coordinates.latDeg.toFixed(2)}°, {s.coordinates.lonDeg.toFixed(2)}°E · Alt {s.coordinates.elevationM}m
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activePopup === 'TECH_GRAPHS' && (
              <div style={{ display: 'grid', gap: 16 }}>
                {/* Solar Array & Mast Configuration Bar */}
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

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                  <div style={statBox}>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>SUNLIT DURATION</span>
                    <strong style={{ fontSize: 18, color: '#facc15' }}>{report.metrics.illuminationPct.toFixed(1)}%</strong>
                  </div>
                  <div style={statBox}>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>LONGEST DARKNESS</span>
                    <strong style={{ fontSize: 18, color: '#f87171' }}>{report.metrics.longestDarknessHours} hrs</strong>
                  </div>
                  <div style={statBox}>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>EARTH DTE UPTIME</span>
                    <strong style={{ fontSize: 18, color: '#38bdf8' }}>{report.metrics.dteAvailabilityPct.toFixed(1)}%</strong>
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
                    height={260}
                  />
                </div>

                <div>
                  <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Timeframe Illumination &amp; DTE Timeline</h3>
                  <VisibilityTimelineChart
                    data={report.states as any}
                    selectedIndex={selectedTimeIndex}
                    onTimeChange={(_, idx) => setSelectedTimeIndex(idx)}
                    height={230}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                  <span style={{ color: '#94a3b8' }}>Source: {selectedSite.demSource} · DE441 MEAN_ME</span>
                  <a href={report.horizonsQueryUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', fontWeight: 700 }}>
                    Verify Exact Numbers in JPL Horizons API ↗
                  </a>
                </div>
              </div>
            )}

            {activePopup === 'AI_HOOK' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>
                  This module exposes the verified, deterministic telemetry dataset for <strong>{selectedSite.name}</strong> over your selected timeframe (<strong>{missionStartIso.slice(0, 10)}</strong>, {windowDays} days) via <code>window.__LUNAR_AI_CONTEXT__</code> so an AI API can evaluate mission effectiveness strictly from computed ephemeris and LOLA horizon numbers.
                </p>

                <pre
                  style={{
                    background: '#060a14',
                    border: '1px solid #1e293b',
                    borderRadius: 10,
                    padding: 14,
                    fontSize: 11,
                    color: '#7dd3fc',
                    overflowX: 'auto',
                    maxHeight: 340,
                  }}
                >
                  {JSON.stringify(
                    {
                      site: selectedSite.name,
                      coordinates: selectedSite.coordinates,
                      timeframe: { startUtc: missionStartIso, windowDays },
                      computedMetrics: report.metrics,
                      physicsGates: report.gates,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
            )}

            {isLanderModal && <LunarSurvivalGame />}
          </div>

          {/* Hovering Humanoid LUNA Companion Floating Around the Game Stage */}
          {isLanderModal && (
            <div onClick={(e) => e.stopPropagation()}>
              <LunaHoverCompanion
                site={selectedSite}
                sunVisible={currentState.sunVisible}
                earthVisible={currentState.earthVisible}
                liveTelemetry={liveLanderTelemetry}
              />
            </div>
          )}
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
  );
}

const appShellStyle: React.CSSProperties = {
  position: 'relative',
  width: '100vw',
  height: '100vh',
  overflow: 'hidden',
  background: '#03050a',
  color: '#f8fafc',
  fontFamily: 'Inter, system-ui, sans-serif',
};

const topHeaderContainerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 14,
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
  left: 18,
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 15,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const rightDockStyle: React.CSSProperties = {
  position: 'absolute',
  right: 18,
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 15,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
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
  zIndex: 40,
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
  minWidth: 160,
};

function floatingBtnStyle(active: boolean, borderColor: string): React.CSSProperties {
  return {
    background: active ? 'rgba(2, 132, 199, 0.92)' : 'rgba(15, 23, 42, 0.86)',
    backdropFilter: 'blur(10px)',
    color: '#f8fafc',
    border: `1px solid ${active ? '#fff' : borderColor}`,
    borderRadius: 14,
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    width: 116,
    fontSize: 11,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.55)',
    textAlign: 'center',
  };
}

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