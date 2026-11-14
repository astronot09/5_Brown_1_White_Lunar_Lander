import type { CuratedLunarSite } from '../../data/siteCatalogue';
import type { SiteSimulationReport, SimulationStepState } from '../../engine/physicsEngine';

export function LunarVsEarthContrastCard({
  site,
  currentState,
  report,
  explorerMode,
}: {
  site: CuratedLunarSite;
  currentState: SimulationStepState;
  report: SiteSimulationReport;
  explorerMode: boolean;
}) {
  const isPolar = Math.abs(site.coordinates.latDeg) > 75;

  const rows = [
    {
      factor: 'Day / Night Cycle',
      moon: '708.7 hrs (29.53 Earth days)',
      earth: '24.0 hrs',
      why: isPolar
        ? 'At the Lunar South Pole, the Sun skims the horizon all month instead of rising high overhead.'
        : 'Mid-latitude sites endure ~14.8 Earth days of continuous freezing night.',
    },
    {
      factor: 'Atmosphere & Twilight',
      moon: 'Airless (0.00° refraction)',
      earth: 'Dense air (+0.57° lift + twilight)',
      why: 'With zero air to scatter light, shadows are pitch-black and sunset is instantaneous.',
    },
    {
      factor: 'Peak Sun Elevation',
      moon: `${report.metrics.maxSunElevationDeg.toFixed(1)}° (Current: ${currentState.sunElevationDeg.toFixed(1)}°)`,
      earth: '~38° – 85° overhead',
      why: 'Low grazing angles mean even a 50 m ridge casts a shadow kilometers long.',
    },
    {
      factor: 'Earth in the Sky',
      moon:
        report.metrics.maxEarthElevationDeg < 0
          ? 'Never visible (Far Side)'
          : `Wobbles ±7° (El: ${currentState.earthElevationDeg.toFixed(1)}°)`,
      earth: 'Ground is beneath you',
      why: 'Lunar libration makes Earth trace a figure-8 wobble that can dip behind crater rims.',
    },
  ];

  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#f8fafc' }}>
          🌍 Why the Moon Is Extreme (Moon vs. Earth)
        </h3>
        <span style={{ fontSize: 10, color: '#38bdf8', fontWeight: 700 }}>
          {explorerMode ? 'PLAIN-LANGUAGE GUIDE' : 'ENVIRONMENT DELTA'}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 7 }}>
        {rows.map((r) => (
          <div
            key={r.factor}
            style={{
              background: '#060a14',
              border: '1px solid #1e293b',
              borderRadius: 8,
              padding: '7px 10px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700 }}>
              <span style={{ color: '#cbd5e1' }}>{r.factor}</span>
              <span style={{ color: '#facc15' }}>🌑 {r.moon}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b', marginTop: 2 }}>
              <span>{explorerMode ? r.why : `Earth baseline: ${r.earth}`}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ComparisonAndValidationSection({
  selectedSite,
  comparisonReports,
  onSelectSite,
  onAddCurrentToCompare,
  onRemoveFromCompare,
  primaryReport,
}: {
  selectedSite: CuratedLunarSite;
  comparisonReports: SiteSimulationReport[];
  onSelectSite: (site: CuratedLunarSite) => void;
  onAddCurrentToCompare: () => void;
  onRemoveFromCompare: (siteId: string) => void;
  primaryReport: SiteSimulationReport;
}) {
  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: 16 }}>
      {/* Side-by-Side Rapid Scenario Comparison Table */}
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 15 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Side-by-Side Landing Site Comparison</h2>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              Click any row to focus that site on the central Moon · Evaluates identical date &amp; mast settings
            </div>
          </div>
          <button
            type="button"
            onClick={onAddCurrentToCompare}
            style={{
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '5px 10px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            + Pin Active Site
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8', textAlign: 'left' }}>
                <th style={{ padding: '6px 4px' }}>Site / Program</th>
                <th style={{ padding: '6px 4px' }}>Sunlit</th>
                <th style={{ padding: '6px 4px' }}>Max Dark</th>
                <th style={{ padding: '6px 4px' }}>Earth DTE</th>
                <th style={{ padding: '6px 4px' }}>Joint Ops</th>
                <th style={{ padding: '6px 4px' }}>Gate</th>
                <th style={{ padding: '6px 4px' }} />
              </tr>
            </thead>
            <tbody>
              {comparisonReports.map((rep) => {
                const hasCritical = rep.gates.some((g) => g.severity === 'critical');
                const isSel = rep.site.siteId === selectedSite.siteId;
                return (
                  <tr
                    key={rep.site.siteId}
                    onClick={() => onSelectSite(rep.site)}
                    style={{
                      borderBottom: '1px solid #1e293b',
                      cursor: 'pointer',
                      background: isSel ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '8px 4px' }}>
                      <div style={{ fontWeight: 700, color: isSel ? '#38bdf8' : '#f8fafc' }}>
                        {rep.site.name.split('(')[0]}
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b' }}>
                        {rep.site.program} · {rep.site.coordinates.latDeg.toFixed(1)}°, {rep.site.coordinates.lonDeg.toFixed(1)}°E
                      </div>
                    </td>
                    <td style={{ padding: '8px 4px', color: '#facc15', fontWeight: 700 }}>
                      {rep.metrics.illuminationPct.toFixed(1)}%
                    </td>
                    <td style={{ padding: '8px 4px' }}>{rep.metrics.longestDarknessHours}h</td>
                    <td style={{ padding: '8px 4px', color: '#38bdf8', fontWeight: 700 }}>
                      {rep.metrics.dteAvailabilityPct.toFixed(1)}%
                    </td>
                    <td style={{ padding: '8px 4px', color: '#34d399' }}>
                      {rep.metrics.jointOpsPct.toFixed(1)}%
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: hasCritical ? '#7f1d1d' : '#064e3b',
                          color: hasCritical ? '#fca5a5' : '#6ee7b7',
                        }}
                      >
                        {hasCritical ? 'GATED' : 'VIABLE'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      {comparisonReports.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveFromCompare(rep.site.siteId);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#64748b',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                          title="Remove from comparison"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4-Tier Physics Validation & JPL Horizons Oracle */}
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 15 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Physics Validation &amp; JPL Horizons Provenance</h2>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              Source: {selectedSite.demSource} · Frame: DE441 MEAN_ME (R = 1737.4 km)
            </div>
          </div>
          <a
            href={primaryReport.horizonsQueryUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              background: '#064e3b',
              color: '#6ee7b7',
              textDecoration: 'none',
              padding: '5px 9px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            JPL Horizons API ↗
          </a>
        </div>

        <div style={{ display: 'grid', gap: 7 }}>
          {primaryReport.validationChecks.map((chk) => (
            <div
              key={chk.id}
              style={{
                background: '#060a14',
                border: '1px solid #1e293b',
                borderRadius: 8,
                padding: '7px 10px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{chk.name}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>{chk.rationale}</div>
              </div>
              <span
                style={{
                  background: '#064e3b',
                  color: '#6ee7b7',
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '3px 7px',
                  borderRadius: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                PASS · {chk.metric}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}