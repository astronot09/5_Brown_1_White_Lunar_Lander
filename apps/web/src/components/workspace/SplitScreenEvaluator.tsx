import React, { useMemo, useState } from 'react';
import type { CuratedLunarSite } from '../../data/siteCatalogue';
import { computeNextEventCountdowns, runSiteSimulation } from '../../engine/physicsEngine';
import { LunarSiteMap, type MapPerspective } from '../map/LunarSiteMap';

interface TradeScenarioRow {
  id: string;
  label: string;
  siteId: string;
  dateStr: string;
  mastHeightM: number;
}

type SortKey = 'JOINT_OPS' | 'ILLUMINATION' | 'DTE' | 'LOW_DARKNESS';

function shiftIsoDate(dateStr: string, deltaDays: number): string {
  const baseMs = Date.parse(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(baseMs)) return dateStr;
  const shifted = new Date(baseMs + deltaDays * 86400 * 1000);
  return shifted.toISOString().slice(0, 10);
}

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

  const [windowDays, setWindowDays] = useState<number>(29.53);

  // Up-to-6 Scenario Trade Matrix State
  const [tradeRows, setTradeRows] = useState<TradeScenarioRow[]>(() => {
    const s0 = sites[0] ?? initialSiteA;
    const s1 = sites[1] ?? initialSiteB;
    const s2 = sites[2] ?? s0;
    const s3 = sites[3] ?? s1;
    return [
      { id: 'sc_1', label: 'Baseline (Nominal)', siteId: initialSiteA.siteId, dateStr: '2026-11-14', mastHeightM: 2 },
      { id: 'sc_2', label: '+21d Slip (Primary)', siteId: initialSiteA.siteId, dateStr: '2026-12-05', mastHeightM: 2 },
      { id: 'sc_3', label: '+21d Slip (Alt Site)', siteId: initialSiteB.siteId, dateStr: '2026-12-05', mastHeightM: 2 },
      { id: 'sc_4', label: 'Region Candidate 4', siteId: s2.siteId, dateStr: '2026-11-14', mastHeightM: 2 },
      { id: 'sc_5', label: '10m Tower Mast Trade', siteId: s3.siteId, dateStr: '2026-11-14', mastHeightM: 10 },
    ];
  });

  // Constraint Filters & Ranking Mode
  const [minSunlitPct, setMinSunlitPct] = useState<number>(50);
  const [minDtePct, setMinDtePct] = useState<number>(40);
  const [maxDarknessHrs, setMaxDarknessHrs] = useState<number>(180);
  const [maxSlopeDeg, setMaxSlopeDeg] = useState<number>(10);
  const [sortBy, setSortBy] = useState<SortKey>('JOINT_OPS');

  const siteA = sites.find((s) => s.siteId === siteIdA) ?? sites[0]!;
  const siteB = sites.find((s) => s.siteId === siteIdB) ?? sites[1] ?? sites[0]!;

  const stepHours = windowDays > 90 ? 24 : 3;

  const reportA = useMemo(
    () => runSiteSimulation(siteA, `${dateA}T00:00:00Z`, windowDays, stepHours, 2, siteA.defaultPanelPreset),
    [siteA, dateA, windowDays, stepHours],
  );
  const reportB = useMemo(
    () => runSiteSimulation(siteB, `${dateB}T00:00:00Z`, windowDays, stepHours, 2, siteB.defaultPanelPreset),
    [siteB, dateB, windowDays, stepHours],
  );

  const curA = reportA.states[Math.min(stepIdxA, Math.max(0, reportA.states.length - 1))] ?? reportA.states[0]!;
  const curB = reportB.states[Math.min(stepIdxB, Math.max(0, reportB.states.length - 1))] ?? reportB.states[0]!;

  const countA = computeNextEventCountdowns(reportA.states, stepIdxA, stepHours);
  const countB = computeNextEventCountdowns(reportB.states, stepIdxB, stepHours);

  const slipDaysB = useMemo(() => {
    const msA = Date.parse(`${dateA}T00:00:00Z`);
    const msB = Date.parse(`${dateB}T00:00:00Z`);
    if (!Number.isFinite(msA) || !Number.isFinite(msB)) return 0;
    return Math.round((msB - msA) / 86400000);
  }, [dateA, dateB]);

  // Evaluate and rank all up-to-6 trade scenarios
  const evaluatedTradeRows = useMemo(() => {
    const computed = tradeRows.map((row) => {
      const site = sites.find((s) => s.siteId === row.siteId) ?? sites[0]!;
      const sim = runSiteSimulation(
        site,
        `${row.dateStr}T00:00:00Z`,
        windowDays,
        Math.max(4, stepHours),
        row.mastHeightM,
        site.defaultPanelPreset,
      );
      const slopeDeg = site.slopeDeg ?? 4.5;
      const jointOpsPct = sim.metrics.jointOpsPct ?? Math.min(sim.metrics.illuminationPct, sim.metrics.dteAvailabilityPct);
      const jointOpsHours = Math.round((jointOpsPct / 100) * windowDays * 24);

      const passSun = sim.metrics.illuminationPct >= minSunlitPct;
      const passDte = sim.metrics.dteAvailabilityPct >= minDtePct;
      const passDark = sim.metrics.longestDarknessHours <= maxDarknessHrs;
      const passSlope = slopeDeg <= maxSlopeDeg;
      const passesAll = passSun && passDte && passDark && passSlope;

      return {
        ...row,
        site,
        metrics: sim.metrics,
        slopeDeg,
        jointOpsPct,
        jointOpsHours,
        passSun,
        passDte,
        passDark,
        passSlope,
        passesAll,
      };
    });

    return computed.sort((a, b) => {
      if (a.passesAll !== b.passesAll) return a.passesAll ? -1 : 1;
      if (sortBy === 'ILLUMINATION') return b.metrics.illuminationPct - a.metrics.illuminationPct;
      if (sortBy === 'DTE') return b.metrics.dteAvailabilityPct - a.metrics.dteAvailabilityPct;
      if (sortBy === 'LOW_DARKNESS') return a.metrics.longestDarknessHours - b.metrics.longestDarknessHours;
      return b.jointOpsPct - a.jointOpsPct;
    });
  }, [tradeRows, sites, windowDays, stepHours, minSunlitPct, minDtePct, maxDarknessHrs, maxSlopeDeg, sortBy]);

  const handleAddScenario = () => {
    if (tradeRows.length >= 6) return;
    const nextSite = sites[tradeRows.length % sites.length] ?? siteB;
    setTradeRows((prev) => [
      ...prev,
      {
        id: `sc_${Date.now()}`,
        label: `Scenario ${prev.length + 1}`,
        siteId: nextSite.siteId,
        dateStr: dateB,
        mastHeightM: 2,
      },
    ]);
  };

  const handleUpdateScenario = (id: string, patch: Partial<TradeScenarioRow>) => {
    setTradeRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const handleRemoveScenario = (id: string) => {
    if (tradeRows.length <= 2) return;
    setTradeRows((prev) => prev.filter((r) => r.id !== id));
  };

  const applySlipToAllTradeRows = (deltaDays: number) => {
    setTradeRows((prev) =>
      prev.map((r, idx) => (idx === 0 ? r : { ...r, dateStr: shiftIsoDate(r.dateStr, deltaDays) })),
    );
  };

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
        <span
          style={{
            background: accent,
            color: '#020617',
            fontSize: 11,
            fontWeight: 900,
            padding: '3px 9px',
            borderRadius: 6,
          }}
        >
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
      <div style={{ height: 295, borderRadius: 10, overflow: 'hidden', border: '1px solid #1e293b', background: '#03050a' }}>
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

  const deltaSun = reportB.metrics.illuminationPct - reportA.metrics.illuminationPct;
  const deltaDte = reportB.metrics.dteAvailabilityPct - reportA.metrics.dteAvailabilityPct;
  const deltaOps = reportB.metrics.jointOpsPct - reportA.metrics.jointOpsPct;
  const deltaDark = reportB.metrics.longestDarknessHours - reportA.metrics.longestDarknessHours;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: '#050811',
        padding: '16px 22px 28px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {/* Top Bar + Launch Slip Stepper */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <span
            style={{
              background: '#0284c7',
              color: '#fff',
              fontSize: 10,
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: 4,
            }}
          >
            MULTI-SCENARIO &amp; LAUNCH-SLIP EVALUATOR
          </span>
          <h2 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 800 }}>
            Side-by-Side &amp; 6-Scenario Trade-Off Analysis
          </h2>
        </div>

        {/* Launch Slip & Window Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: '#94a3b8' }}>SLIP B:</span>
          {[-7, 7, 14, 21].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDateB((prev) => shiftIsoDate(prev, d))}
              style={slipChipBtnStyle}
            >
              {d > 0 ? `+${d}d` : `${d}d`}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDateB(shiftIsoDate(dateA, 21))}
            style={{ ...slipChipBtnStyle, borderColor: '#facc15', color: '#fde047' }}
            title="Set Scenario B to exactly +21 days after Scenario A"
          >
            A +21d
          </button>

          <select
            value={windowDays}
            onChange={(e) => {
              setWindowDays(Number(e.target.value));
              setStepIdxA(0);
              setStepIdxB(0);
            }}
            style={compactSelectStyle}
          >
            <option value={6.5}>6.5d Artemis Stay</option>
            <option value={14.77}>14.77d Half Cycle</option>
            <option value={29.53}>29.53d Lunar Cycle</option>
            <option value={346.6}>346.6d Season</option>
          </select>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              marginLeft: 4,
            }}
          >
            ✕ Exit Split-Screen
          </button>
        </div>
      </div>

      {/* Highlighted Trade-Off Delta Strip (Scenario B vs Scenario A) */}
      <div
        style={{
          background: '#090f1d',
          border: '1px solid #1e293b',
          borderRadius: 10,
          padding: '8px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          fontSize: 11.5,
        }}
      >
        <span style={{ fontWeight: 800, color: '#cbd5e1' }}>
          📊 SCENARIO B vs. A DELTA ({slipDaysB >= 0 ? `+${slipDaysB}d` : `${slipDaysB}d`} offset):
        </span>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>
            Sunlit:{' '}
            <strong style={{ color: deltaSun >= 0 ? '#4ade80' : '#f87171' }}>
              {deltaSun >= 0 ? '+' : ''}
              {deltaSun.toFixed(1)}%
            </strong>
          </span>
          <span>
            Earth DTE:{' '}
            <strong style={{ color: deltaDte >= 0 ? '#38bdf8' : '#f87171' }}>
              {deltaDte >= 0 ? '+' : ''}
              {deltaDte.toFixed(1)}%
            </strong>
          </span>
          <span>
            Joint Ops:{' '}
            <strong style={{ color: deltaOps >= 0 ? '#c084fc' : '#f87171' }}>
              {deltaOps >= 0 ? '+' : ''}
              {deltaOps.toFixed(1)}%
            </strong>
          </span>
          <span>
            Max Darkness:{' '}
            <strong style={{ color: deltaDark <= 0 ? '#4ade80' : '#f87171' }}>
              {deltaDark >= 0 ? '+' : ''}
              {deltaDark}h
            </strong>
          </span>
        </div>
      </div>

      {/* Primary Side-by-Side 3D Viewports */}
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
          `SCENARIO B (${slipDaysB >= 0 ? `+${slipDaysB}D SLIP` : `${slipDaysB}D`})`,
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

      {/* UP-TO-6 SCENARIO CONSTRAINT-BASED TRADE MATRIX */}
      <div
        style={{
          background: '#090f1d',
          border: '1px solid #334155',
          borderRadius: 14,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: '#38bdf8', letterSpacing: '0.06em' }}>
              UP TO 6 SCENARIOS · CONSTRAINT-BASED RANKING
            </span>
            <h3 style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 800 }}>
              Multi-Site &amp; Launch-Slip Trade Matrix ({tradeRows.length}/6 Active)
            </h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => applySlipToAllTradeRows(21)}
              style={slipChipBtnStyle}
              title="Shift all non-baseline rows forward by +21 days"
            >
              ⏩ Slip Rows +21d
            </button>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              style={compactSelectStyle}
              title="Rank scenarios by objective"
            >
              <option value="JOINT_OPS">Rank: Joint Ops (Power + DTE)</option>
              <option value="ILLUMINATION">Rank: Solar Illumination %</option>
              <option value="DTE">Rank: Earth DTE %</option>
              <option value="LOW_DARKNESS">Rank: Shortest Darkness</option>
            </select>

            <button
              type="button"
              disabled={tradeRows.length >= 6}
              onClick={handleAddScenario}
              style={{
                background: tradeRows.length >= 6 ? '#1e293b' : '#0284c7',
                color: tradeRows.length >= 6 ? '#64748b' : '#fff',
                border: 'none',
                borderRadius: 7,
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 800,
                cursor: tradeRows.length >= 6 ? 'not-allowed' : 'pointer',
              }}
            >
              + Add Scenario ({tradeRows.length}/6)
            </button>
          </div>
        </div>

        {/* Mission Constraint Threshold Controls */}
        <div
          style={{
            background: '#060a14',
            border: '1px solid #1e293b',
            borderRadius: 10,
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
            fontSize: 11,
          }}
        >
          <span style={{ fontWeight: 800, color: '#94a3b8' }}>MISSION CONSTRAINTS:</span>
          <label style={constraintLabelStyle}>
            Min Sunlit %:
            <input
              type="number"
              min={0}
              max={100}
              value={minSunlitPct}
              onChange={(e) => setMinSunlitPct(Number(e.target.value))}
              style={constraintInputStyle}
            />
          </label>
          <label style={constraintLabelStyle}>
            Min Earth DTE %:
            <input
              type="number"
              min={0}
              max={100}
              value={minDtePct}
              onChange={(e) => setMinDtePct(Number(e.target.value))}
              style={constraintInputStyle}
            />
          </label>
          <label style={constraintLabelStyle}>
            Max Darkness (h):
            <input
              type="number"
              min={0}
              max={800}
              value={maxDarknessHrs}
              onChange={(e) => setMaxDarknessHrs(Number(e.target.value))}
              style={constraintInputStyle}
            />
          </label>
          <label style={constraintLabelStyle}>
            Max Slope (°):
            <input
              type="number"
              min={1}
              max={30}
              step={0.5}
              value={maxSlopeDeg}
              onChange={(e) => setMaxSlopeDeg(Number(e.target.value))}
              style={constraintInputStyle}
            />
          </label>
        </div>

        {/* Ranked 6-Scenario Comparison Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e293b', color: '#94a3b8', fontSize: 10 }}>
                <th style={thStyle}>RANK</th>
                <th style={thStyle}>SCENARIO LABEL</th>
                <th style={thStyle}>TARGET SITE</th>
                <th style={thStyle}>START DATE</th>
                <th style={thStyle}>MAST</th>
                <th style={thStyle}>SUNLIT %</th>
                <th style={thStyle}>EARTH DTE</th>
                <th style={thStyle}>JOINT OPS</th>
                <th style={thStyle}>MAX DARK</th>
                <th style={thStyle}>SLOPE</th>
                <th style={thStyle}>STATUS</th>
                <th style={thStyle}>INSPECT</th>
              </tr>
            </thead>
            <tbody>
              {evaluatedTradeRows.map((row, rankIdx) => (
                <tr
                  key={row.id}
                  style={{
                    borderBottom: '1px solid #1e293b',
                    background: rankIdx === 0 && row.passesAll ? 'rgba(74, 222, 128, 0.06)' : 'transparent',
                  }}
                >
                  <td style={tdStyle}>
                    <strong style={{ color: rankIdx === 0 ? '#facc15' : '#94a3b8' }}>#{rankIdx + 1}</strong>
                  </td>

                  <td style={tdStyle}>
                    <input
                      type="text"
                      value={row.label}
                      onChange={(e) => handleUpdateScenario(row.id, { label: e.target.value })}
                      style={{
                        background: '#0f172a',
                        color: '#f8fafc',
                        border: '1px solid #334155',
                        borderRadius: 5,
                        padding: '4px 7px',
                        fontSize: 11,
                        fontWeight: 700,
                        width: 130,
                      }}
                    />
                  </td>

                  <td style={tdStyle}>
                    <select
                      value={row.siteId}
                      onChange={(e) => handleUpdateScenario(row.id, { siteId: e.target.value })}
                      style={{
                        background: '#0f172a',
                        color: '#f8fafc',
                        border: '1px solid #334155',
                        borderRadius: 5,
                        padding: '4px 6px',
                        fontSize: 11,
                        fontWeight: 700,
                        maxWidth: 195,
                      }}
                    >
                      {sites.map((s) => (
                        <option key={s.siteId} value={s.siteId}>
                          [{s.program}] {s.name}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td style={tdStyle}>
                    <input
                      type="date"
                      value={row.dateStr}
                      onChange={(e) => {
                        if (e.target.value) handleUpdateScenario(row.id, { dateStr: e.target.value });
                      }}
                      style={{
                        background: '#0f172a',
                        color: '#f8fafc',
                        border: '1px solid #334155',
                        borderRadius: 5,
                        padding: '3px 6px',
                        fontSize: 11,
                      }}
                    />
                  </td>

                  <td style={tdStyle}>
                    <select
                      value={row.mastHeightM}
                      onChange={(e) => handleUpdateScenario(row.id, { mastHeightM: Number(e.target.value) })}
                      style={{
                        background: '#0f172a',
                        color: '#f8fafc',
                        border: '1px solid #334155',
                        borderRadius: 5,
                        padding: '3px 5px',
                        fontSize: 11,
                      }}
                    >
                      <option value={0}>0m</option>
                      <option value={2}>2m</option>
                      <option value={10}>10m</option>
                    </select>
                  </td>

                  <td style={tdStyle}>
                    <strong style={{ color: row.passSun ? '#facc15' : '#f87171' }}>
                      {row.metrics.illuminationPct.toFixed(1)}%
                    </strong>
                  </td>

                  <td style={tdStyle}>
                    <strong style={{ color: row.passDte ? '#38bdf8' : '#f87171' }}>
                      {row.metrics.dteAvailabilityPct.toFixed(1)}%
                    </strong>
                  </td>

                  <td style={tdStyle}>
                    <strong style={{ color: '#c084fc' }}>{row.jointOpsPct.toFixed(1)}%</strong>
                    <span style={{ color: '#64748b', fontSize: 10, marginLeft: 4 }}>({row.jointOpsHours}h)</span>
                  </td>

                  <td style={tdStyle}>
                    <span style={{ color: row.passDark ? '#cbd5e1' : '#f87171', fontWeight: 700 }}>
                      {row.metrics.longestDarknessHours}h
                    </span>
                  </td>

                  <td style={tdStyle}>
                    <span style={{ color: row.passSlope ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                      {row.slopeDeg.toFixed(1)}°
                    </span>
                  </td>

                  <td style={tdStyle}>
                    <span
                      style={{
                        background: row.passesAll ? 'rgba(74, 222, 128, 0.16)' : 'rgba(248, 113, 113, 0.16)',
                        color: row.passesAll ? '#4ade80' : '#fca5a5',
                        border: `1px solid ${row.passesAll ? '#4ade80' : '#f87171'}`,
                        borderRadius: 5,
                        padding: '2px 7px',
                        fontSize: 10,
                        fontWeight: 800,
                      }}
                    >
                      {row.passesAll ? '✓ GO' : '⚠ CONSTRAINT'}
                    </span>
                  </td>

                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setSiteIdA(row.siteId);
                          setDateA(row.dateStr);
                          setStepIdxA(0);
                        }}
                        style={miniLoadBtnStyle}
                        title="Load into Scenario A pane"
                      >
                        → A
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSiteIdB(row.siteId);
                          setDateB(row.dateStr);
                          setStepIdxB(0);
                        }}
                        style={{ ...miniLoadBtnStyle, color: '#fde047', borderColor: '#facc15' }}
                        title="Load into Scenario B pane"
                      >
                        → B
                      </button>
                      {tradeRows.length > 2 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveScenario(row.id)}
                          style={{ ...miniLoadBtnStyle, color: '#fca5a5', borderColor: '#7f1d1d' }}
                          title="Remove scenario row"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

const slipChipBtnStyle: React.CSSProperties = {
  background: '#0f172a',
  color: '#38bdf8',
  border: '1px solid #334155',
  borderRadius: 6,
  padding: '5px 9px',
  fontSize: 11,
  fontWeight: 800,
  cursor: 'pointer',
};

const compactSelectStyle: React.CSSProperties = {
  background: '#1e293b',
  color: '#f8fafc',
  border: '1px solid #334155',
  borderRadius: 7,
  padding: '6px 9px',
  fontSize: 11,
  fontWeight: 700,
};

const constraintLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: '#cbd5e1',
  fontWeight: 700,
};

const constraintInputStyle: React.CSSProperties = {
  width: 54,
  background: '#0f172a',
  color: '#f8fafc',
  border: '1px solid #334155',
  borderRadius: 5,
  padding: '3px 6px',
  fontSize: 11,
  fontWeight: 800,
};

const thStyle: React.CSSProperties = {
  padding: '7px 8px',
  fontWeight: 800,
  letterSpacing: '0.04em',
};

const tdStyle: React.CSSProperties = {
  padding: '7px 8px',
  verticalAlign: 'middle',
};

const miniLoadBtnStyle: React.CSSProperties = {
  background: '#0f172a',
  color: '#38bdf8',
  border: '1px solid #334155',
  borderRadius: 5,
  padding: '3px 6px',
  fontSize: 10,
  fontWeight: 800,
  cursor: 'pointer',
};