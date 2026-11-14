import { useEffect, useMemo, useRef, useState } from 'react';
import {
  calculateVisibility,
  getEphemerisSeries,
  type EphemerisVectorSample,
  type SiteHorizonProfile,
} from '../../../packages/lunar-core/src/index';
import {
  HorizonSkylineChart,
  VisibilityTimelineChart,
  type SkyTrackPoint,
} from './components/charts';
import { LunarSiteMap, useLunarSites, type LunarSite, type VisibilityState } from './components/map';

/**
 * Generates a realistic 29.5-day (708-hour) Moon-centered MEAN_ME ephemeris
 * series for the Lunar South Pole so the browser engine computes full synodic
 * illumination and Earth libration cycles without needing external servers.
 */
function buildSynodicSamples(startIso: string, hours = 708, stepHours = 3): EphemerisVectorSample[] {
  const startMs = Date.parse(startIso);
  const synodicPeriodSec = 29.53059 * 86400;
  const anomalisticPeriodSec = 27.55455 * 86400;
  const samples: EphemerisVectorSample[] = [];

  for (let h = 0; h <= hours; h += stepHours) {
    const tSec = h * 3600;
    const sunAngle = (2 * Math.PI * tSec) / synodicPeriodSec;
    // Solar declination oscillates +/- 1.54 deg relative to lunar equator
    const sunDeclRad = ((1.48 * Math.sin(sunAngle * 0.5 + 0.4)) * Math.PI) / 180;
    const sunDistKm = 149_597_870.7;

    // Earth stays roughly near 0 deg longitude with optical libration in lat/lon
    const libLonRad = ((6.8 * Math.sin((2 * Math.PI * tSec) / anomalisticPeriodSec)) * Math.PI) / 180;
    const libLatRad = ((6.5 * Math.cos((2 * Math.PI * tSec) / anomalisticPeriodSec + 0.3)) * Math.PI) / 180;
    const earthDistKm = 384_400;

    samples.push({
      timestamp: new Date(startMs + tSec * 1000).toISOString(),
      frame: 'MEAN_ME',
      correctionModel: 'LT+S',
      sunPositionKm: {
        x: sunDistKm * Math.cos(sunDeclRad) * Math.cos(sunAngle),
        y: sunDistKm * Math.cos(sunDeclRad) * Math.sin(sunAngle),
        z: sunDistKm * Math.sin(sunDeclRad),
      },
      earthPositionKm: {
        x: earthDistKm * Math.cos(libLatRad) * Math.cos(libLonRad),
        y: earthDistKm * Math.cos(libLatRad) * Math.sin(libLonRad),
        z: earthDistKm * Math.sin(libLatRad),
      },
    });
  }
  return samples;
}

/**
 * Interactive 3D Isometric Terrain Bowl & Sun-Ray Renderer built from the
 * site's 360-degree horizon elevation mask.
 */
function Terrain3DViewport({
  site,
  sunAzimuthDeg,
  sunElevationDeg,
  sunVisible,
}: {
  site: LunarSite;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  sunVisible: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [yawDeg, setYawDeg] = useState(35);
  const [pitchDeg, setPitchDeg] = useState(28);
  const draggingRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Space backdrop gradient
    const bg = ctx.createRadialGradient(width * 0.5, height * 0.35, 20, width * 0.5, height * 0.5, width * 0.7);
    bg.addColorStop(0, '#111c33');
    bg.addColorStop(1, '#050811');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const mask = site.horizonMaskDeg ?? new Array(360).fill(0);
    const step = site.azimuthStepDeg ?? 1;
    const cx = width * 0.5;
    const cy = height * 0.6;
    const yaw = (yawDeg * Math.PI) / 180;
    const pitch = (pitchDeg * Math.PI) / 180;

    const project = (x: number, y: number, z: number): [number, number, number] => {
      const rx = x * Math.cos(yaw) - y * Math.sin(yaw);
      const ry = x * Math.sin(yaw) + y * Math.cos(yaw);
      const py = ry * Math.sin(pitch) - z * Math.cos(pitch);
      const depth = ry * Math.cos(pitch) + z * Math.sin(pitch);
      return [cx + rx, cy + py, depth];
    };

    // Draw concentric lunar terrain rings out to the crater rim
    const rings = [28, 56, 84, 115, 148];
    rings.forEach((radius, rIdx) => {
      const ringWeight = (rIdx + 1) / rings.length;
      ctx.beginPath();
      for (let az = 0; az <= 360; az += 4) {
        const idx = Math.floor((az % 360) / step) % mask.length;
        const elevDeg = mask[idx] ?? 0;
        const rad = (az * Math.PI) / 180;
        const x = radius * Math.sin(rad);
        const y = -radius * Math.cos(rad);
        const z = Math.max(-8, elevDeg * 5.2 * Math.pow(ringWeight, 1.35));
        const [px, py] = project(x, y, z);
        if (az === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = rIdx === rings.length - 1 ? 'rgba(56, 189, 248, 0.85)' : 'rgba(148, 163, 184, 0.25)';
      ctx.lineWidth = rIdx === rings.length - 1 ? 2 : 1;
      ctx.stroke();
    });

    // Draw radial terrain spokes & directional shading from Sun azimuth
    for (let az = 0; az < 360; az += 10) {
      const idx = Math.floor(az / step) % mask.length;
      const elevDeg = mask[idx] ?? 0;
      const rad = (az * Math.PI) / 180;
      const zRim = Math.max(-8, elevDeg * 5.2);
      const [x0, y0] = project(0, 0, 0);
      const [x1, y1] = project(148 * Math.sin(rad), -148 * Math.cos(rad), zRim);

      const angleDiff = Math.cos(((az - sunAzimuthDeg) * Math.PI) / 180);
      const lit = sunVisible && angleDiff > -0.2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = lit ? 'rgba(250, 204, 21, 0.22)' : 'rgba(71, 85, 105, 0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw Sun vector beam into the landing site
    const sunRad = (sunAzimuthDeg * Math.PI) / 180;
    const sunElevRad = (Math.max(-5, sunElevationDeg) * Math.PI) / 180;
    const sunDist = 175;
    const sx = sunDist * Math.cos(sunElevRad) * Math.sin(sunRad);
    const sy = -sunDist * Math.cos(sunElevRad) * Math.cos(sunRad);
    const sz = Math.max(6, 22 + sunElevationDeg * 7);
    const [sunX, sunY] = project(sx, sy, sz);
    const [landerX, landerY] = project(0, 0, 2);

    ctx.beginPath();
    ctx.moveTo(sunX, sunY);
    ctx.lineTo(landerX, landerY);
    ctx.strokeStyle = sunVisible ? 'rgba(250, 204, 21, 0.7)' : 'rgba(248, 113, 113, 0.45)';
    ctx.setLineDash(sunVisible ? [] : [5, 5]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    // Sun orb
    ctx.beginPath();
    ctx.arc(sunX, sunY, 8, 0, Math.PI * 2);
    ctx.fillStyle = sunVisible ? '#facc15' : '#64748b';
    ctx.fill();

    // Lander beacon at center
    ctx.beginPath();
    ctx.arc(landerX, landerY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [site, sunAzimuthDeg, sunElevationDeg, sunVisible, yawDeg, pitchDeg]);

  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid #1e293b', background: '#050811' }}>
      <canvas
        ref={canvasRef}
        width={520}
        height={290}
        onMouseDown={(e) => {
          draggingRef.current = { x: e.clientX, y: e.clientY, yaw: yawDeg, pitch: pitchDeg };
        }}
        onMouseMove={(e) => {
          if (!draggingRef.current) return;
          const dx = e.clientX - draggingRef.current.x;
          const dy = e.clientY - draggingRef.current.y;
          setYawDeg(draggingRef.current.yaw + dx * 0.5);
          setPitchDeg(Math.max(10, Math.min(75, draggingRef.current.pitch + dy * 0.35)));
        }}
        onMouseUp={() => {
          draggingRef.current = null;
        }}
        onMouseLeave={() => {
          draggingRef.current = null;
        }}
        style={{ width: '100%', height: 290, display: 'block', cursor: 'grab' }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 10,
          left: 12,
          right: 12,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: '#94a3b8',
          pointerEvents: 'none',
        }}
      >
        <span>3D Terrain Rim &amp; Solar Ray Model (Drag to orbit)</span>
        <span>Yaw {Math.round(yawDeg)}° · Pitch {Math.round(pitchDeg)}°</span>
      </div>
    </div>
  );
}

export function App() {
  const { sites, loading, error } = useLunarSites();
  const [selectedSiteId, setSelectedSiteId] = useState<string>('malapert_massif_01');
  const [selectedTimeIndex, setSelectedTimeIndex] = useState<number>(0);

  const selectedSite: LunarSite | null = useMemo(() => {
    if (sites.length === 0) return null;
    return sites.find((s) => s.siteId === selectedSiteId) ?? sites[0] ?? null;
  }, [sites, selectedSiteId]);

  const samples = useMemo(() => buildSynodicSamples('2026-11-14T00:00:00Z', 708, 3), []);

  // Bridge Stage 1 site JSON -> Stage 2 lunar-core engine -> Stage 3 UI VisibilityState
  const { timelineStates, sunTrack, earthTrack } = useMemo(() => {
    if (!selectedSite || !selectedSite.horizonMaskDeg?.length) {
      return {
        timelineStates: [] as VisibilityState[],
        sunTrack: [] as SkyTrackPoint[],
        earthTrack: [] as SkyTrackPoint[],
      };
    }

    const coreProfile: SiteHorizonProfile = {
      siteId: selectedSite.siteId,
      name: selectedSite.name,
      latitudeDeg: selectedSite.coordinates.latDeg,
      longitudeDeg: selectedSite.coordinates.lonDeg,
      siteElevationM: selectedSite.coordinates.elevationM ?? 0,
      horizonAzimuthStepDeg: selectedSite.azimuthStepDeg ?? 1,
      horizonElevationDeg: selectedSite.horizonMaskDeg,
    };

    const ephemeris = getEphemerisSeries(coreProfile, samples);
    const analysis = calculateVisibility(coreProfile, ephemeris);

    const mappedStates: VisibilityState[] = analysis.states.map((st, idx) => {
      const ep = ephemeris[idx]!;
      return {
        timeUtc: st.timestamp,
        solarIrradianceWm2: st.solarIrradianceWm2,
        sunlitFraction: st.sunVisibleFraction,
        earthClearanceDeg: st.earthCommsClearanceDeg,
        sunVisible: st.sunIlluminated,
        earthVisible: st.earthCommsAvailable,
        sunAzimuthDeg: ep.sun.azimuthDeg,
        sunElevationDeg: ep.sun.elevationDeg,
        earthAzimuthDeg: ep.earth.azimuthDeg,
        earthElevationDeg: ep.earth.elevationDeg,
        powerIndex: st.sunVisibleFraction,
        operationsWindow: st.sunIlluminated && st.earthCommsAvailable,
      };
    });

    const sunPts: SkyTrackPoint[] = ephemeris.slice(0, 80).map((ep) => ({
      timeUtc: ep.timestamp,
      position: {
        azimuthDeg: ep.sun.azimuthDeg,
        elevationDeg: ep.sun.elevationDeg,
        angularRadiusDeg: ep.sun.angularRadiusDeg,
      },
    }));

    const earthPts: SkyTrackPoint[] = ephemeris.slice(0, 80).map((ep) => ({
      timeUtc: ep.timestamp,
      position: {
        azimuthDeg: ep.earth.azimuthDeg,
        elevationDeg: ep.earth.elevationDeg,
        angularRadiusDeg: ep.earth.angularRadiusDeg,
      },
    }));

    return { timelineStates: mappedStates, sunTrack: sunPts, earthTrack: earthPts };
  }, [selectedSite, samples]);

  const currentState = timelineStates[Math.min(selectedTimeIndex, Math.max(0, timelineStates.length - 1))] ?? null;

  const summaryStats = useMemo(() => {
    if (timelineStates.length === 0) return { sunPct: 0, commsPct: 0, peakWm2: 0 };
    const sunCount = timelineStates.filter((s) => s.sunVisible).length;
    const commsCount = timelineStates.filter((s) => s.earthVisible).length;
    const peakWm2 = Math.max(...timelineStates.map((s) => s.solarIrradianceWm2));
    return {
      sunPct: (sunCount / timelineStates.length) * 100,
      commsPct: (commsCount / timelineStates.length) * 100,
      peakWm2,
    };
  }, [timelineStates]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#060a14', color: '#e2e8f0', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif' }}>
        Initializing Lunar South Pole Ephemeris &amp; DEM Telemetry...
      </div>
    );
  }

  if (error || !selectedSite) {
    return (
      <div style={{ minHeight: '100vh', background: '#060a14', color: '#f87171', padding: 32, fontFamily: 'system-ui, sans-serif' }}>
        Failed to load lunar site profiles: {error ?? 'No sites available'}
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#060a14', color: '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Top NASA Mission Control Header */}
      <header
        style={{
          borderBottom: '1px solid #1e293b',
          background: 'linear-gradient(90deg, #0b1222 0%, #0f172a 100%)',
          padding: '14px 28px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ background: '#0284c7', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.06em' }}>
              ARTEMIS SOUTH POLE
            </span>
            <span style={{ background: '#065f46', color: '#6ee7b7', fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4 }}>
              DE441 GATE &lt; 0.05°
            </span>
          </div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
            Lunar Skyline — Terrain-Aware Landing Site Navigator
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label htmlFor="site-select" style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>
            Candidate Landing Zone:
          </label>
          <select
            id="site-select"
            value={selectedSite.siteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            style={{
              background: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {sites.map((s) => (
              <option key={s.siteId} value={s.siteId}>
                {s.name} ({s.coordinates.latDeg.toFixed(2)}°, {s.coordinates.lonDeg.toFixed(2)}°)
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Main Telemetry Grid */}
      <main style={{ maxWidth: 1440, margin: '0 auto', padding: '20px 28px', display: 'grid', gap: 20 }}>
        {/* KPI Telemetry Strip */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Site Coordinates &amp; Altitude</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
              {selectedSite.coordinates.latDeg.toFixed(2)}°, {selectedSite.coordinates.lonDeg.toFixed(2)}°
            </div>
            <div style={{ fontSize: 12, color: '#38bdf8', marginTop: 2 }}>
              Elevation: {(selectedSite.coordinates.elevationM ?? 0).toFixed(1)} m
            </div>
          </div>

          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Instant Solar Power</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: currentState?.sunVisible ? '#facc15' : '#94a3b8' }}>
              {(currentState?.solarIrradianceWm2 ?? 0).toFixed(0)} W/m²
            </div>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>
              Disc Visible: {((currentState?.sunlitFraction ?? 0) * 100).toFixed(1)}% · Synodic Sun: {summaryStats.sunPct.toFixed(1)}%
            </div>
          </div>

          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Direct-To-Earth (DTE) Link</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: currentState?.earthVisible ? '#34d399' : '#f87171' }}>
              {currentState?.earthVisible ? 'LINE-OF-SIGHT ACTIVE' : 'OCCULTED BY RIDGE'}
            </div>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>
              Clearance: {(currentState?.earthClearanceDeg ?? 0).toFixed(2)}° · Cycle Comms: {summaryStats.commsPct.toFixed(1)}%
            </div>
          </div>

          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Simulation Timestamp (UTC)</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 6 }}>
              {currentState ? currentState.timeUtc.replace('T', ' ').slice(0, 16) + ' UTC' : '—'}
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, timelineStates.length - 1)}
              value={selectedTimeIndex}
              onChange={(e) => setSelectedTimeIndex(Number(e.target.value))}
              style={{ width: '100%', marginTop: 6, accentColor: '#38bdf8' }}
            />
          </div>
        </section>

        {/* Middle Row: South Polar OpenLayers Map + 3D Terrain Rim Viewport */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: 20 }}>
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>South Polar Stereographic Landing Map</h2>
              <span style={{ fontSize: 11, color: '#38bdf8' }}>Sun Azimuth Ray: {(currentState?.sunAzimuthDeg ?? 0).toFixed(1)}°</span>
            </div>
            <LunarSiteMap
              selectedSiteId={selectedSite.siteId}
              onSiteSelect={(site) => setSelectedSiteId(site.siteId)}
              azimuthDeg={currentState?.sunAzimuthDeg}
            />
          </div>

          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>3D Horizon Rim &amp; Solar Illumination Geometry</h2>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{selectedSite.demSource ?? 'LOLA DEM'}</span>
            </div>
            <Terrain3DViewport
              site={selectedSite}
              sunAzimuthDeg={currentState?.sunAzimuthDeg ?? 0}
              sunElevationDeg={currentState?.sunElevationDeg ?? 0}
              sunVisible={currentState?.sunVisible ?? false}
            />
          </div>
        </section>

        {/* Bottom Row: D3 360° Horizon Skyline Chart + D3 Multi-Day Visibility Timeline */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: 20 }}>
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 600 }}>360° Terrain Skyline &amp; Sun/Earth Ephemeris</h2>
            <HorizonSkylineChart
              site={selectedSite}
              sunPosition={
                currentState
                  ? { azimuthDeg: currentState.sunAzimuthDeg ?? 0, elevationDeg: currentState.sunElevationDeg ?? 0, angularRadiusDeg: 0.266 }
                  : null
              }
              earthPosition={
                currentState
                  ? { azimuthDeg: currentState.earthAzimuthDeg ?? 0, elevationDeg: currentState.earthElevationDeg ?? 0, angularRadiusDeg: 0.95 }
                  : null
              }
              currentVisibility={currentState}
              sunPath={sunTrack}
              earthPath={earthTrack}
              height={310}
            />
          </div>

          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 600 }}>29.5-Day Synodic Illumination &amp; Comms Windows</h2>
            <VisibilityTimelineChart
              data={timelineStates}
              selectedIndex={selectedTimeIndex}
              onTimeChange={(_, idx) => setSelectedTimeIndex(idx)}
              height={310}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;