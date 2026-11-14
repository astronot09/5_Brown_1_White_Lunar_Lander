import { useMemo, useState } from 'react';
import type { CuratedLunarSite } from '../../data/siteCatalogue';
import { computeNextEventCountdowns, runSiteSimulation } from '../../engine/physicsEngine';
import { LunarSiteMap, type MapPerspective } from '../map/LunarSiteMap';

export function SplitScreenEvaluator({
  sites,
  initialSiteA,
  initialSiteB,
  onDropCustomPin,
  onClose,
}: {
  sites: CuratedLunarSite[];
  initialSiteA: CuratedLunarSite;
  initialSiteB: CuratedLunarSite;
  onDropCustomPin: (lat: number, lon: number) => void;
  onClose: () => void;
}) {
  const [siteIdA, setSiteIdA] = useState(initialSiteA.siteId);
  const [dateA, setDateA] = useState('2026-11-14');
  const [stepIdxA, setStepIdxA] = useState(0);
  const [viewA, setViewA] = useState<MapPerspective>('STREET_VIEW');

  const [siteIdB, setSiteIdB] = useState(initialSiteB.siteId);
  const [dateB, setDateB] = useState('2026-12-05'); // +21 day launch slip comparison
  const [stepIdxB, setStepIdxB] = useState(0);
  const [viewB, setViewB] = useState<MapPerspective>('STREET_VIEW');

  const siteA = sites.find((s) => s.siteId === siteIdA) ?? sites[0]!;
  const siteB = sites.find((s) => s.siteId === siteIdB) ?? sites[1] ?? sites[0]!;

  const reportA = useMemo(
    () => runSiteSimulation(siteA, `${dateA}T00:00:00Z`, 29.53, 3, 2, siteA.defaultPanelPreset),
    [siteA, dateA],
  );
  const reportB = useMemo(
    () => runSiteSimulation(siteB, `${dateB}T00:00:00Z`, 29.53, 3, 2, siteB.defaultPanelPreset),
    [siteB, dateB],
  );

  const curA = reportA.states[Math.min(stepIdxA, reportA.states.length - 1)] ?? reportA.states[0]!;
  const curB = reportB.states[Math.min(stepIdxB, reportB.states.length - 1)] ?? reportB.states[0]!;

  const countA = computeNextEventCountdowns(reportA.states, stepIdxA, 3);
  const countB = computeNextEventCountdowns(reportB.states, stepIdxB, 3);

  const renderPane = (
    label: string,
    accent: string,
    site: CuratedLunarSite,
    setSiteId: (id: string) => void,
    dateStr: string,
    setDateStr: (d: string) => void,
    stepIdx: number,
    setStepIdx: (idx: number) => void,
    viewMode: MapPerspective,
    setViewMode: (v: MapPerspective) => void,
    report: typeof reportA,
    cur: typeof curA,
    countdown: typeof countA,
  ) => (
    <div
      style={{
        background: '#090f1d',
        border: `1px solid ${accent}`,
        borderRadius: 14,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Pane Header Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ background: accent, color: '#020617', fontSize: 11, fontWeight: 900, padding: '3px 9px', borderRadius: 6 }}>
          {label}
        </span>

        <div style={{ display: 'flex', gap: 4 }}>
          {(['GLOBE', 'STREET_VIEW', 'ORBITAL_SYSTEM'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setViewMode(m)}
              style={{
                background: viewMode === m ? '#0284c7' : '#1e293b',
                color: '#fff',
                border: 'none',
                borderRadius: 5,
                padding: '4px 8px',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {m === 'GLOBE' ? '🌕 Globe' : m === 'STREET_VIEW' ? '👁️ Street View' : '🪐 Orbit'}
            </button>
          ))}
        </div>
      </div>

      {/* Site & Independent Date Picker */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8 }}>
        <select
          value={site.siteId}
          onChange={(e) => setSiteId(e.target.value)}
          style={{
            background: '#1e293b',
            color: '#f8fafc',
            border: '1px solid #334155',
            borderRadius: 7,
            padding: '7px 9px',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {sites.map((s) => (
            <option key={s.siteId} value={s.siteId}>
              [{s.program}] {s.name}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={dateStr}
          onChange={(e) => {
            if (e.target.value) setDateStr(e.target.value);
          }}
          style={{
            background: '#1e293b',
            color: '#f8fafc',
            border: '1px solid #334155',
            borderRadius: 7,
            padding: '7px 9px',
            fontSize: 12,
            fontWeight: 700,
          }}
        />
      </div>

      {/* Interactive 3D Viewport */}
      <div style={{ height: 310, borderRadius: 10, overflow: 'hidden', border: '1px solid #1e293b', background: '#03050a' }}>
        <LunarSiteMap
          sites={sites}
          selectedSite={site}
          currentState={cur}
          perspective={viewMode}
          onSelectSite={(s) => setSiteId(s.siteId)}
          onDropCustomPin={onDropCustomPin}
          compact
        />
      </div>

      {/* Independent Time Slider */}
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '8px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
          <span style={{ color: '#94a3b8', fontWeight: 700 }}>EPOCH TIMESTAMP (UTC)</span>
          <strong style={{ color: '#38bdf8' }}>{cur.timeUtc.replace('T', ' ').slice(0, 16)} UTC</strong>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0, report.states.length - 1)}
          value={stepIdx}
          onChange={(e) => setStepIdx(Number(e.target.value))}
          style={{ width: '100%', accentColor: accent, cursor: 'pointer' }}
        />
      </div>

      {/* Deterministic Telemetry Readouts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        <div style={metricBox}>
          <span style={metricLbl}>SUNLIT WINDOW</span>
          <strong style={{ color: '#facc15', fontSize: 15 }}>{report.metrics.illuminationPct.toFixed(1)}%</strong>
          <span style={metricSub}>Max Dark: {report.metrics.longestDarknessHours}h</span>
        </div>
        <div style={metricBox}>
          <span style={metricLbl}>EARTH DTE</span>
          <strong style={{ color: '#38bdf8', fontSize: 15 }}>{report.metrics.dteAvailabilityPct.toFixed(1)}%</strong>
          <span style={metricSub}>El: {cur.earthElevationDeg.toFixed(1)}°</span>
        </div>
        <div style={metricBox}>
          <span style={metricLbl}>{countdown.sunLabel}</span>
          <strong style={{ color: '#fde047', fontSize: 14 }}>{countdown.sunCountdown}</strong>
          <span style={metricSub}>Sun El: {cur.sunElevationDeg.toFixed(1)}°</span>
        </div>
        <div style={metricBox}>
          <span style={metricLbl}>{countdown.earthLabel}</span>
          <strong style={{ color: '#34d399', fontSize: 14 }}>{countdown.earthCountdown}</strong>
          <span style={metricSub}>Joint Ops: {report.metrics.jointOpsPct.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: '#050811',
        padding: '16px 22px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <span style={{ background: '#0284c7', color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4 }}>
            SPLIT-SCREEN SCENARIO EVALUATOR
          </span>
          <h2 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 800 }}>
            Side-by-Side Site &amp; Timeframe Trade-Off Analysis
          </h2>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            background: '#dc2626',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 16px',
            fontSize: 12,
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          ✕ Exit Split-Screen
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: 16 }}>
        {renderPane(
          'SCENARIO A (PRIMARY)',
          '#38bdf8',
          siteA,
          setSiteIdA,
          dateA,
          setDateA,
          stepIdxA,
          setStepIdxA,
          viewA,
          setViewA,
          reportA,
          curA,
          countA,
        )}
        {renderPane(
          'SCENARIO B (ALTERNATE / SLIP)',
          '#facc15',
          siteB,
          setSiteIdB,
          dateB,
          setDateB,
          stepIdxB,
          setStepIdxB,
          viewB,
          setViewB,
          reportB,
          curB,
          countB,
        )}
      </div>
    </div>
  );
}

const metricBox: React.CSSProperties = {
  background: '#060a14',
  border: '1px solid #1e293b',
  borderRadius: 8,
  padding: '8px 6px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
};

const metricLbl: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 800,
  color: '#94a3b8',
  marginBottom: 2,
};

const metricSub: React.CSSProperties = {
  fontSize: 10,
  color: '#64748b',
  marginTop: 2,
};