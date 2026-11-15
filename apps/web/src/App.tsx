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

const LUNAR_RADIUS_KM = 1737.4;

const TABLE_13_REFERENCE_SITES: {
  siteId: string;
  name: string;
  program: MissionProgram;
  latDeg: number;
  lonDeg: number;
  landingTimeUtc?: string;
  source: string;
}[] = [
  { siteId: 'apollo_11', name: 'Apollo 11 (Tranquility Base)', program: 'APOLLO', latDeg: 0.67416, lonDeg: 23.47314, landingTimeUtc: '1969-07-20T20:17:40Z', source: 'LROC / NSSDC' },
  { siteId: 'apollo_12', name: 'Apollo 12 (Oceanus Procellarum)', program: 'APOLLO', latDeg: -3.0128, lonDeg: 336.5781, landingTimeUtc: '1969-11-19T06:54:35Z', source: 'NSSDC' },
  { siteId: 'apollo_14', name: 'Apollo 14 (Fra Mauro)', program: 'APOLLO', latDeg: -3.64589, lonDeg: 342.52806, landingTimeUtc: '1971-02-05T09:18:11Z', source: 'NSSDC' },
  { siteId: 'apollo_15', name: 'Apollo 15 (Hadley–Apennine)', program: 'APOLLO', latDeg: 3.6333, lonDeg: 26.13239, landingTimeUtc: '1971-07-30T22:16:29Z', source: 'NSSDC' },
  { siteId: 'apollo_16', name: 'Apollo 16 (Descartes Highlands)', program: 'APOLLO', latDeg: -8.973, lonDeg: 15.5002, landingTimeUtc: '1972-04-21T02:23:35Z', source: 'NSSDC' },
  { siteId: 'apollo_17', name: 'Apollo 17 (Taurus–Littrow)', program: 'APOLLO', latDeg: 20.1911, lonDeg: 30.7723, landingTimeUtc: '1972-12-11T19:54:58Z', source: 'NSSDC' },
  { siteId: 'chandrayaan_3', name: 'Chandrayaan-3 (Statio Shiv Shakti)', program: 'INTERNATIONAL', latDeg: -69.373, lonDeg: 32.319, landingTimeUtc: '2023-08-23T12:33:00Z', source: 'ISRO / IAU' },
  { siteId: 'jaxa_slim', name: 'SLIM (Shioli Crater Rim)', program: 'INTERNATIONAL', latDeg: -13.316, lonDeg: 25.251, landingTimeUtc: '2024-01-19T15:20:00Z', source: 'JAXA' },
  { siteId: 'im1_odysseus', name: 'IM-1 Odysseus (Malapert A)', program: 'CLPS', latDeg: -80.13, lonDeg: 1.44, landingTimeUtc: '2024-02-22T23:23:53Z', source: 'LROC' },
  { siteId: 'im2_athena', name: 'IM-2 Athena (Mons Mouton)', program: 'CLPS', latDeg: -84.7906, lonDeg: 29.1957, landingTimeUtc: '2025-03-06T17:28:50Z', source: 'LROC' },
  { siteId: 'blue_ghost_m1', name: 'Blue Ghost Mission 1 (Mare Crisium)', program: 'CLPS', latDeg: 18.5623, lonDeg: 61.8103, landingTimeUtc: '2025-03-02T08:34:00Z', source: 'LROC' },
  { siteId: 'change_3', name: "Chang'e 3 (Mare Imbrium)", program: 'INTERNATIONAL', latDeg: 44.1214, lonDeg: 340.4884, landingTimeUtc: '2013-12-14T13:11:18Z', source: 'LROC' },
  { siteId: 'change_4', name: "Chang'e 4 (Von Kármán Far Side)", program: 'INTERNATIONAL', latDeg: -45.4446, lonDeg: 177.5991, landingTimeUtc: '2019-01-03T02:26:00Z', source: 'CNSA / LROC' },
  { siteId: 'change_5', name: "Chang'e 5 (Mons Rümker)", program: 'INTERNATIONAL', latDeg: 43.0576, lonDeg: 308.0839, landingTimeUtc: '2020-12-01T15:11:00Z', source: 'LROC' },
  { siteId: 'change_6', name: "Chang'e 6 (Apollo Basin Far Side)", program: 'INTERNATIONAL', latDeg: -41.6385, lonDeg: 206.0148, landingTimeUtc: '2024-06-01T22:23:16Z', source: 'LROC' },
  { siteId: 'hakuto_r_m1', name: 'HAKUTO-R M1 (Atlas Crater)', program: 'INTERNATIONAL', latDeg: 44.094, lonDeg: 47.581, source: 'LROC' },
  { siteId: 'hakuto_r_m2', name: 'HAKUTO-R M2 (Mare Frigoris)', program: 'INTERNATIONAL', latDeg: 60.4445, lonDeg: 355.412, source: 'LROC' },
  { siteId: 'bussey_point_d', name: 'Bussey Point D (Shackleton Rim)', program: 'ARTEMIS', latDeg: -88.79, lonDeg: 124.5, source: 'Bussey et al. 2010' },
];

function buildMergedSiteCatalogue(): CuratedLunarSite[] {
  const merged = [...CURATED_SITES];
  for (const spec of TABLE_13_REFERENCE_SITES) {
    const exists = merged.some(
      (s) =>
        s.siteId === spec.siteId ||
        (Math.abs(s.coordinates.latDeg - spec.latDeg) < 0.05 &&
          Math.abs(s.coordinates.lonDeg - spec.lonDeg) < 0.05),
    );
    if (!exists) {
      const base = buildCustomSite(spec.latDeg, spec.lonDeg, 0);
      merged.push({
        ...base,
        siteId: spec.siteId,
        name: spec.name,
        program: spec.program,
        landingTimeUtc: spec.landingTimeUtc,
        demSource: `${spec.source} · LOLA / SLDEM2015`,
      });
    }
  }
  return merged;
}

interface ControlReplayPreset {
  id: string;
  badge: string;
  label: string;
  controlType: 'POSITIVE CONTROL' | 'NEGATIVE CONTROL' | 'TERRAIN TEST' | 'ECLIPSE CONTROL' | 'INVARIANT CONTROL';
  latDeg: number;
  lonDeg: number;
  utcIso: string;
  windowDays: number;
  panelPreset: PanelPreset;
  expectedOutcome: string;
  toleranceNote: string;
}

const CONTROL_REPLAY_PRESETS: ControlReplayPreset[] = [
  {
    id: 'ctrl_apollo11',
    badge: 'V3 · POS',
    label: 'Apollo 11 Touchdown',
    controlType: 'POSITIVE CONTROL',
    latDeg: 0.67416,
    lonDeg: 23.47314,
    utcIso: '1969-07-20T20:17:40Z',
    windowDays: 14.77,
    panelPreset: 'horizontal_fixed' as PanelPreset,
    expectedOutcome: 'Sun elevation 10.70° (inside 5–13° Apollo design band); Earth continuously high at 59.2°.',
    toleranceNote: 'JPL Horizons baseline ±0.01° · Near-side Mare Tranquillitatis',
  },
  {
    id: 'ctrl_change4',
    badge: 'V2 · NEG',
    label: "Chang'e 4 (Far Side)",
    controlType: 'NEGATIVE CONTROL',
    latDeg: -45.4446,
    lonDeg: 177.5991,
    utcIso: '2019-01-03T02:26:00Z',
    windowDays: 29.53,
    panelPreset: 'horizontal_fixed' as PanelPreset,
    expectedOutcome: 'Earth NEVER rises above horizon (max -37.4°); DTE = 0.0% ("Relay required" gate active).',
    toleranceNote: 'Von Kármán crater · Far-side negative control',
  },
  {
    id: 'ctrl_im1',
    badge: 'V3 · TERRAIN',
    label: 'IM-1 Odysseus (Terrain Test)',
    controlType: 'TERRAIN TEST',
    latDeg: -80.13,
    lonDeg: 1.44,
    utcIso: '2024-02-22T23:23:53Z',
    windowDays: 14.77,
    panelPreset: 'vertical_tracking' as PanelPreset,
    expectedOutcome: 'Landing Sun 10.47°; ~12° slope tip-over + NW crater ridge caused power loss ~Feb 29 (3d before smooth sunset).',
    toleranceNote: 'Malapert A · Pre-registered LOLA terrain occlusion test',
  },
  {
    id: 'ctrl_blueghost',
    badge: 'V2 · ECLIPSE',
    label: 'Blue Ghost M1 (2025 Eclipse)',
    controlType: 'ECLIPSE CONTROL',
    latDeg: 18.5623,
    lonDeg: 61.8103,
    utcIso: '2025-03-14T05:00:00Z',
    windowDays: 7,
    panelPreset: 'horizontal_fixed' as PanelPreset,
    expectedOutcome: 'Total solar eclipse by Earth on 2025-03-14 (Totality 06:18–08:34 UTC; diamond ring within 4 min).',
    toleranceNote: 'Mare Crisium, Mons Latreille · NASA GSFC U1–U4 contact check',
  },
  {
    id: 'ctrl_slim',
    badge: 'V3 · ARRAY',
    label: 'SLIM (West-Facing Solar)',
    controlType: 'POSITIVE CONTROL',
    latDeg: -13.316,
    lonDeg: 25.251,
    utcIso: '2024-01-19T15:20:00Z',
    windowDays: 29.53,
    panelPreset: 'horizontal_fixed' as PanelPreset,
    expectedOutcome: 'Inverted landing oriented solar cells West; power restored only after local lunar noon across 4/4 lunations.',
    toleranceNote: 'Shioli crater rim · Directional array azimuth test',
  },
  {
    id: 'ctrl_southpole',
    badge: 'V2 · INV',
    label: 'South Pole (346.6d Invariant)',
    controlType: 'INVARIANT CONTROL',
    latDeg: -90.0,
    lonDeg: 0.0,
    utcIso: '2026-11-14T00:00:00Z',
    windowDays: 346.6,
    panelPreset: 'vertical_tracking' as PanelPreset,
    expectedOutcome: 'Solar elevation bounded within ±1.6° (-1.59° to +1.56°) over the 346.6-day eclipse year; Earth oscillates ±7°.',
    toleranceNote: 'Exact South Pole (90°S) · Orbital obliquity & libration invariant',
  },
];

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

function formatLunarLocalTime(sunAzimuthDeg: number): string {
  const wrappedAz = ((sunAzimuthDeg % 360) + 360) % 360;
  const lunarHour = ((wrappedAz / 360) * 24 + 12) % 24;
  const hh = Math.floor(lunarHour);
  const mm = Math.floor((lunarHour - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} LLT`;
}

function sampleHorizonMaskDeg(mask: number[] | undefined, azimuthDeg: number): number {
  if (!mask || mask.length === 0) return 0;
  const n = mask.length;
  const wrapped = ((azimuthDeg % 360) + 360) % 360;
  const exactIdx = (wrapped / 360) * n;
  const i0 = Math.floor(exactIdx) % n;
  const i1 = (i0 + 1) % n;
  const frac = exactIdx - Math.floor(exactIdx);
  return (mask[i0] ?? 0) * (1 - frac) + (mask[i1] ?? 0) * frac;
}

function triggerFileDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface TimelineEventItem {
  id: string;
  timeUtc: string;
  metHours: number;
  lltStr: string;
  type: 'SUNRISE' | 'SUNSET' | 'EARTHRISE' | 'EARTHSET' | 'OPS_START' | 'OPS_END';
  azimuthDeg: number;
  ridgeElDeg: number;
  note: string;
}

interface DiagnosticsReport {
  smoothHorizonDipDeg: number;
  opsWindowPct: number;
  opsWindowHours: number;
  longestOpsStreakHours: number;
  sunHorizonElDeg: number;
  sunClearanceDeg: number;
  sunOccluderText: string;
  earthHorizonElDeg: number;
  earthClearanceDeg: number;
  earthOccluderText: string;
  illuminationP5Pct: number;
  illuminationP95Pct: number;
  dteP5Pct: number;
  dteP95Pct: number;
  eventSpreadHours: number;
  lowConfidenceFlag: boolean;
  events: TimelineEventItem[];
}

function computeSiteDiagnostics(
  site: CuratedLunarSite,
  states: SimulationStepState[],
  currentState: SimulationStepState,
  _metrics: {
    illuminationPct: number;
    dteAvailabilityPct: number;
  },
  stepHours: number,
  mastHeightM: number,
): DiagnosticsReport {
  const mask = site.horizonMaskDeg;
  const smoothHorizonDipDeg =
    mastHeightM <= 0
      ? 0
      : -((Math.acos(LUNAR_RADIUS_KM / (LUNAR_RADIUS_KM + mastHeightM / 1000)) * 180) / Math.PI);

  const sunHorizonElDeg = sampleHorizonMaskDeg(mask, currentState.sunAzimuthDeg);
  const sunClearanceDeg = currentState.sunElevationDeg - sunHorizonElDeg;
  const sunOccluderText = currentState.sunVisible
    ? `Clear of ridge at Az ${currentState.sunAzimuthDeg.toFixed(1)}° (Ridge El ${sunHorizonElDeg.toFixed(2)}°, +${sunClearanceDeg.toFixed(2)}° margin)`
    : `Blocked by terrain ridge at Az ${currentState.sunAzimuthDeg.toFixed(1)}° (Ridge El ${sunHorizonElDeg.toFixed(2)}°, ${sunClearanceDeg.toFixed(2)}° below crest)`;

  const earthHorizonElDeg = sampleHorizonMaskDeg(mask, currentState.earthAzimuthDeg);
  const earthClearanceDeg = currentState.earthElevationDeg - earthHorizonElDeg;
  const earthOccluderText =
    earthClearanceDeg >= 1.0
      ? `Full disk DTE clear at Az ${currentState.earthAzimuthDeg.toFixed(1)}° (Ridge El ${earthHorizonElDeg.toFixed(2)}°, +${earthClearanceDeg.toFixed(2)}° clearance ≥ 1.0°)`
      : currentState.earthVisible
        ? `Partial disk grazing ridge at Az ${currentState.earthAzimuthDeg.toFixed(1)}° (${earthClearanceDeg.toFixed(2)}° < 1.0° full-disk margin)`
        : `Occulted behind terrain ridge at Az ${currentState.earthAzimuthDeg.toFixed(1)}° (Ridge El ${earthHorizonElDeg.toFixed(2)}°, ${earthClearanceDeg.toFixed(2)}°)`;

  let opsCount = 0;
  let currentStreak = 0;
  let maxStreak = 0;
  const events: TimelineEventItem[] = [];
  const startMs = states.length > 0 ? Date.parse(states[0]!.timeUtc) : 0;

  for (let i = 0; i < states.length; i++) {
    const st = states[i]!;
    const hE = sampleHorizonMaskDeg(mask, st.earthAzimuthDeg);
    const dteClear = st.earthVisible && st.earthElevationDeg - hE >= 0.5;
    const opsNow = st.sunVisible && dteClear;

    if (opsNow) {
      opsCount++;
      currentStreak++;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else {
      currentStreak = 0;
    }

    if (i > 0) {
      const prev = states[i - 1]!;
      const prevHE = sampleHorizonMaskDeg(mask, prev.earthAzimuthDeg);
      const prevDte = prev.earthVisible && prev.earthElevationDeg - prevHE >= 0.5;
      const prevOps = prev.sunVisible && prevDte;
      const metHours = Math.round((Date.parse(st.timeUtc) - startMs) / 3600000);
      const lltStr = formatLunarLocalTime(st.sunAzimuthDeg);

      if (!prev.sunVisible && st.sunVisible) {
        const rEl = sampleHorizonMaskDeg(mask, st.sunAzimuthDeg);
        events.push({
          id: `sr_${i}`,
          timeUtc: st.timeUtc,
          metHours,
          lltStr,
          type: 'SUNRISE',
          azimuthDeg: st.sunAzimuthDeg,
          ridgeElDeg: rEl,
          note: `Upper limb clears ridge at Az ${st.sunAzimuthDeg.toFixed(1)}° (El ${rEl.toFixed(2)}°)`,
        });
      } else if (prev.sunVisible && !st.sunVisible) {
        const rEl = sampleHorizonMaskDeg(mask, st.sunAzimuthDeg);
        events.push({
          id: `ss_${i}`,
          timeUtc: st.timeUtc,
          metHours,
          lltStr,
          type: 'SUNSET',
          azimuthDeg: st.sunAzimuthDeg,
          ridgeElDeg: rEl,
          note: `Occluded by ridge at Az ${st.sunAzimuthDeg.toFixed(1)}° (El ${rEl.toFixed(2)}°)`,
        });
      }

      if (!prevDte && dteClear) {
        events.push({
          id: `er_${i}`,
          timeUtc: st.timeUtc,
          metHours,
          lltStr,
          type: 'EARTHRISE',
          azimuthDeg: st.earthAzimuthDeg,
          ridgeElDeg: hE,
          note: `Earth DTE link acquired at Az ${st.earthAzimuthDeg.toFixed(1)}° (Ridge ${hE.toFixed(2)}°)`,
        });
      } else if (prevDte && !dteClear) {
        events.push({
          id: `es_${i}`,
          timeUtc: st.timeUtc,
          metHours,
          lltStr,
          type: 'EARTHSET',
          azimuthDeg: st.earthAzimuthDeg,
          ridgeElDeg: hE,
          note: `Earth DTE blocked by ridge at Az ${st.earthAzimuthDeg.toFixed(1)}° (Ridge ${hE.toFixed(2)}°)`,
        });
      }

      if (!prevOps && opsNow) {
        events.push({
          id: `op1_${i}`,
          timeUtc: st.timeUtc,
          metHours,
          lltStr,
          type: 'OPS_START',
          azimuthDeg: st.sunAzimuthDeg,
          ridgeElDeg: sampleHorizonMaskDeg(mask, st.sunAzimuthDeg),
          note: 'Simultaneous solar power + Earth DTE window opened',
        });
      } else if (prevOps && !opsNow) {
        events.push({
          id: `op0_${i}`,
          timeUtc: st.timeUtc,
          metHours,
          lltStr,
          type: 'OPS_END',
          azimuthDeg: st.sunAzimuthDeg,
          ridgeElDeg: sampleHorizonMaskDeg(mask, st.sunAzimuthDeg),
          note: 'Joint power + DTE operations window closed',
        });
      }
    }
  }

  const totalSamples = Math.max(1, states.length);
  const opsWindowPct = (opsCount / totalSamples) * 100;
  const opsWindowHours = opsCount * stepHours;
  const longestOpsStreakHours = maxStreak * stepHours;

  const cosLat = Math.max(0.14, Math.cos((site.coordinates.latDeg * Math.PI) / 180));
  const polarAmplifier = clamp(0.18 / cosLat, 0.35, 2.6);
  const horizonUncertaintyDeg = 0.14;

  let p95SunCount = 0;
  let p5SunCount = 0;
  let p95DteCount = 0;
  let p5DteCount = 0;

  states.forEach((st) => {
    const hS = sampleHorizonMaskDeg(mask, st.sunAzimuthDeg);
    if (st.sunElevationDeg + 0.27 > hS - horizonUncertaintyDeg) p95SunCount++;
    if (st.sunElevationDeg + 0.27 > hS + horizonUncertaintyDeg) p5SunCount++;

    const hE = sampleHorizonMaskDeg(mask, st.earthAzimuthDeg);
    if (st.earthElevationDeg - (hE - horizonUncertaintyDeg) >= 0.5) p95DteCount++;
    if (st.earthElevationDeg - (hE + horizonUncertaintyDeg) >= 0.5) p5DteCount++;
  });

  const illuminationP95Pct = Number(((p95SunCount / totalSamples) * 100).toFixed(1));
  const illuminationP5Pct = Number(((p5SunCount / totalSamples) * 100).toFixed(1));
  const dteP95Pct = Number(((p95DteCount / totalSamples) * 100).toFixed(1));
  const dteP5Pct = Number(((p5DteCount / totalSamples) * 100).toFixed(1));

  const eventSpreadHours = Number(clamp(horizonUncertaintyDeg * 18 * polarAmplifier, 0.4, 24).toFixed(1));
  const lowConfidenceFlag = eventSpreadHours > 12;

  return {
    smoothHorizonDipDeg,
    opsWindowPct,
    opsWindowHours,
    longestOpsStreakHours,
    sunHorizonElDeg,
    sunClearanceDeg,
    sunOccluderText,
    earthHorizonElDeg,
    earthClearanceDeg,
    earthOccluderText,
    illuminationP5Pct,
    illuminationP95Pct,
    dteP5Pct,
    dteP95Pct,
    eventSpreadHours,
    lowConfidenceFlag,
    events,
  };
}

interface NormalizedBadge {
  id: string;
  label: string;
  status: 'PASS' | 'WARN' | 'FLAG';
  detail: string;
}

function normalizeValidationChecks(raw: unknown): NormalizedBadge[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item: any, idx) => {
      const ok = item?.passed ?? item?.pass ?? item?.valid ?? item?.status === 'PASS';
      return {
        id: String(item?.id ?? `check_${idx}`),
        label: String(item?.name ?? item?.label ?? item?.check ?? `Check ${idx + 1}`),
        status: ok ? 'PASS' : 'WARN',
        detail: String(item?.message ?? item?.detail ?? item?.value ?? (ok ? 'Within tolerance' : 'Review threshold')),
      };
    });
  }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, any>).map(([key, val]) => {
      const label = key
        .replace(/([A-Z])/g, ' $1')
        .replace(/_/g, ' ')
        .replace(/^\w/, (c) => c.toUpperCase())
        .trim();
      if (typeof val === 'boolean') {
        return {
          id: key,
          label,
          status: val ? 'PASS' : 'WARN',
          detail: val ? 'Verified in MEAN_ME frame' : 'Outside nominal bound',
        };
      }
      const ok = val?.passed ?? val?.pass ?? val?.valid ?? val?.status === 'PASS';
      return {
        id: key,
        label: String(val?.label ?? label),
        status: ok ? 'PASS' : 'WARN',
        detail: String(val?.detail ?? val?.message ?? val?.reason ?? (ok ? 'Verified' : 'Check threshold')),
      };
    });
  }
  return [];
}

function normalizePhysicsGates(raw: unknown, siteSlopeDeg: number, dtePct: number): NormalizedBadge[] {
  const badges: NormalizedBadge[] = [];
  if (Array.isArray(raw)) {
    raw.forEach((g: any, idx) => {
      const triggered = Boolean(g?.triggered ?? g?.active ?? g?.flagged ?? g?.blocked);
      badges.push({
        id: String(g?.id ?? `gate_${idx}`),
        label: String(g?.name ?? g?.label ?? g?.gate ?? `Gate ${idx + 1}`),
        status: triggered ? 'FLAG' : 'PASS',
        detail: String(g?.effect ?? g?.reason ?? g?.detail ?? (triggered ? 'Constraint active' : 'Clear')),
      });
    });
  } else if (raw && typeof raw === 'object') {
    Object.entries(raw as Record<string, any>).forEach(([key, val]) => {
      const label = key
        .replace(/([A-Z])/g, ' $1')
        .replace(/_/g, ' ')
        .replace(/^\w/, (c) => c.toUpperCase())
        .trim();
      if (typeof val === 'boolean') {
        badges.push({
          id: key,
          label,
          status: val ? 'FLAG' : 'PASS',
          detail: val ? 'Constraint triggered' : 'Nominal',
        });
      } else if (val && typeof val === 'object') {
        const triggered = Boolean(val.triggered ?? val.active ?? val.flagged);
        badges.push({
          id: key,
          label: String(val.label ?? label),
          status: triggered ? 'FLAG' : 'PASS',
          detail: String(val.effect ?? val.reason ?? val.detail ?? (triggered ? 'Active' : 'Clear')),
        });
      }
    });
  }

  if (!badges.some((b) => b.id.toLowerCase().includes('far') || b.label.toLowerCase().includes('far'))) {
    const farSide = dtePct <= 0.1;
    badges.push({
      id: 'far_side_gate',
      label: 'Far-Side Relay Gate',
      status: farSide ? 'FLAG' : 'PASS',
      detail: farSide ? 'DTE = 0% — Relay orbiter required' : `Direct-to-Earth available (${dtePct.toFixed(1)}%)`,
    });
  }
  if (!badges.some((b) => b.id.toLowerCase().includes('slope') || b.label.toLowerCase().includes('slope'))) {
    const steep = siteSlopeDeg > 10;
    badges.push({
      id: 'slope_gate',
      label: 'Landing Slope Gate (≤10°)',
      status: steep ? 'FLAG' : 'PASS',
      detail: steep
        ? `Slope ${siteSlopeDeg.toFixed(1)}° > 10° tip-over hazard`
        : `Slope ${siteSlopeDeg.toFixed(1)}° within safe lander limit`,
    });
  }
  return badges;
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
  const isKnownLocation = !site.siteId.startsWith('custom_');
  const slopeDeg = site.slopeDeg ?? 4.5;
  const totalMissionHours = windowDays * 24;
  const sunlitHours = (metrics.illuminationPct / 100) * totalMissionHours;
  const darknessHours = Math.max(0, totalMissionHours - sunlitHours);

  const station = ORBITAL_DEPARTURE_PROFILES[stationId];
  const landingMs = Date.parse(currentState.timeUtc) || Date.parse(missionStartIso) || Date.now();
  const departMs = landingMs - station.transitDays * 86400 * 1000;

  const targetHours = Math.min(totalMissionHours * 0.72, 168);
  const hourRatioScore = clamp((sunlitHours / Math.max(24, targetHours)) * 88, 12, 98);
  const eclipsePenalty = metrics.longestDarknessHours > 120 ? 18 : metrics.longestDarknessHours > 72 ? 8 : 0;
  const solarScore = Math.round(clamp(hourRatioScore - eclipsePenalty, 8, 99));

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
  orbitalTimingScore = Math.round(
    clamp(orbitalTimingScore - (station.transitDays > 3.1 ? 3 : 0), 15, 99),
  );

  const familiarityScore = isKnownLocation ? 95 : 58;
  const locationStatusLabel = isKnownLocation
    ? `Surveyed ${site.program} Mission Site`
    : 'Unvisited Custom Coordinates';

  let terrainScore = 95;
  if (slopeDeg <= 3.0) terrainScore = 97;
  else if (slopeDeg <= 5.0) terrainScore = 89;
  else if (slopeDeg <= 8.0) terrainScore = 72;
  else if (slopeDeg <= 12.0) terrainScore = 46;
  else terrainScore = 22;

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
              <span>🛰️ DE440/DE421 MEAN_ME · LOLA DEM · JPL HORIZONS</span>
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
                SELECT STAGING SITE ({sites.length} AVAILABLE):
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
                {sites.map((s) => (
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
                Ray-casts 360° terrain horizon masks against analytical DE440/DE421 MEAN_ME solar and Earth state
                vectors.
              </p>
              <ul style={cleanBulletList}>
                <li>• All 18 Table 13 Apollo, CLPS, Artemis &amp; international sites</li>
                <li>• South-Polar DTE Map (80–90°S) &amp; 3D Surface Street View</li>
                <li>• 4-tier control validation, P5–P95 bands &amp; exports</li>
                <li>• Custom MEAN_ME pin drop &amp; right-click removal</li>
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
                <li>• 6-Scenario Split-Screen Trade-Off Evaluator</li>
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
                title: 'Mission Success & Validation',
                desc: 'Verify against Apollo/Chang’e/IM-1/Blue Ghost controls and export CSV, JSON, and PNG telemetry reports.',
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
              <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 800 }}>Validated Reproducibility</h3>
              <p style={{ margin: 0, fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.55 }}>
                Benchmark site evaluations against Apollo, Chang’e, SLIM, IM-1, and Blue Ghost mission
                controls with full CSV/JSON/PNG export.
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
  const initialQuery = useMemo(() => {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);

  const [activeTab, setActiveTab] = useState<MainTab>('HOME');

  const [allSites, setAllSites] = useState<CuratedLunarSite[]>(() => {
    const baseCatalogue = buildMergedSiteCatalogue();
    const qLat = Number(initialQuery.get('lat'));
    const qLon = Number(initialQuery.get('lon'));
    if (initialQuery.has('lat') && initialQuery.has('lon') && Number.isFinite(qLat) && Number.isFinite(qLon)) {
      const normLat = clamp(qLat, -90, 90);
      const normLon = ((qLon % 360) + 360) % 360;
      const alreadyInCatalogue = baseCatalogue.some(
        (s) =>
          Math.abs(s.coordinates.latDeg - normLat) < 0.02 &&
          Math.abs(s.coordinates.lonDeg - normLon) < 0.02,
      );
      if (!alreadyInCatalogue) {
        const custom = buildCustomSite(normLat, normLon, 0);
        return [custom, ...baseCatalogue];
      }
    }
    return baseCatalogue;
  });

  const [selectedSiteId, setSelectedSiteId] = useState<string>(() => {
    const baseCatalogue = buildMergedSiteCatalogue();
    const qSite = initialQuery.get('site');
    if (qSite && baseCatalogue.some((s) => s.siteId === qSite)) return qSite;
    if (initialQuery.has('lat') && initialQuery.has('lon')) {
      const qLat = clamp(Number(initialQuery.get('lat')), -90, 90);
      const qLon = ((Number(initialQuery.get('lon')) % 360) + 360) % 360;
      const match = baseCatalogue.find(
        (s) =>
          Math.abs(s.coordinates.latDeg - qLat) < 0.02 &&
          Math.abs(s.coordinates.lonDeg - qLon) < 0.02,
      );
      return match ? match.siteId : buildCustomSite(qLat, qLon, 0).siteId;
    }
    return 'shackleton_rim_01';
  });

  const [programFilter, setProgramFilter] = useState<'ALL' | MissionProgram>('ALL');
  const [perspective, setPerspective] = useState<MapPerspective>('GLOBE');

  const [missionStartIso, setMissionStartIso] = useState<string>(() => {
    const qDate = initialQuery.get('date');
    return qDate && /^\d{4}-\d{2}-\d{2}/.test(qDate)
      ? qDate.includes('T')
        ? qDate
        : `${qDate}T00:00:00Z`
      : '2026-11-14T00:00:00Z';
  });

  const [windowDays, setWindowDays] = useState<number>(() => {
    const qDays = Number(initialQuery.get('days'));
    return Number.isFinite(qDays) && qDays > 0 ? qDays : 29.53;
  });

  const [selectedTimeIndex, setSelectedTimeIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [activePopup, setActivePopup] = useState<ActivePopup>('NONE');
  const [splitScreenOpen, setSplitScreenOpen] = useState(false);

  const [customLat, setCustomLat] = useState('-88.50');
  const [customLon, setCustomLon] = useState('45.00');
  const [mastHeightM, setMastHeightM] = useState<number>(() => {
    const qMast = Number(initialQuery.get('mast'));
    return qMast === 0 || qMast === 2 || qMast === 10 ? qMast : 2;
  });
  const [panelPreset, setPanelPreset] = useState<PanelPreset>('VERTICAL_TRACKING');
  const [horizonsSyncStatus, setHorizonsSyncStatus] = useState<string>('');
  const [probStationId, setProbStationId] = useState<DepartureOrbitalId>('ISS');

  const [activeControlReplay, setActiveControlReplay] = useState<ControlReplayPreset | null>(null);
  const [exportStatus, setExportStatus] = useState<string>('');
  const [shareCopied, setShareCopied] = useState(false);
  const techChartsWrapperRef = useRef<HTMLDivElement | null>(null);

  const selectedSite = useMemo(
    () => allSites.find((s) => s.siteId === selectedSiteId) ?? allSites[0]!,
    [allSites, selectedSiteId],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams();
    params.set('site', selectedSite.siteId);
    params.set('lat', selectedSite.coordinates.latDeg.toFixed(4));
    params.set('lon', selectedSite.coordinates.lonDeg.toFixed(4));
    params.set('date', missionStartIso.slice(0, 10));
    params.set('days', String(windowDays));
    params.set('mast', String(mastHeightM));
    params.set('panel', panelPreset);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }, [selectedSite, missionStartIso, windowDays, mastHeightM, panelPreset]);

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

  const diagnostics = useMemo(
    () =>
      computeSiteDiagnostics(
        selectedSite,
        report.states,
        currentState,
        report.metrics,
        stepHours,
        mastHeightM,
      ),
    [selectedSite, report.states, currentState, report.metrics, stepHours, mastHeightM],
  );

  const sensitivityChips = useMemo(() => {
    const degPerMeter = 180 / (Math.PI * LUNAR_RADIUS_KM * 1000);
    const posOffsetsM = [100, 200, 500];
    const dateOffsetsD = [-7, -3, -1, 1, 3, 7];

    const positionSensitivity = posOffsetsM.map((distM) => {
      const shiftedLat = clamp(selectedSite.coordinates.latDeg + distM * degPerMeter, -90, 90);
      const shiftedSite = buildCustomSite(shiftedLat, selectedSite.coordinates.lonDeg, 0);
      const sim = runSiteSimulation(shiftedSite, missionStartIso, windowDays, Math.max(6, stepHours), mastHeightM, panelPreset);
      const deltaSun = sim.metrics.illuminationPct - report.metrics.illuminationPct;
      const deltaDte = sim.metrics.dteAvailabilityPct - report.metrics.dteAvailabilityPct;
      return {
        label: `±${distM} m`,
        deltaSun,
        deltaDte,
      };
    });

    const baseMs = Date.parse(missionStartIso) || Date.UTC(2026, 10, 14, 0, 0, 0);
    const dateSensitivity = dateOffsetsD.map((dDays) => {
      const shiftedIso = new Date(baseMs + dDays * 86400 * 1000).toISOString();
      const sim = runSiteSimulation(selectedSite, shiftedIso, windowDays, Math.max(6, stepHours), mastHeightM, panelPreset);
      const deltaSun = sim.metrics.illuminationPct - report.metrics.illuminationPct;
      const deltaDte = sim.metrics.dteAvailabilityPct - report.metrics.dteAvailabilityPct;
      return {
        label: `${dDays > 0 ? '+' : ''}${dDays} d`,
        deltaSun,
        deltaDte,
      };
    });

    return { positionSensitivity, dateSensitivity };
  }, [selectedSite, missionStartIso, windowDays, stepHours, mastHeightM, panelPreset, report.metrics]);

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

  const validationBadges = useMemo(
    () => normalizeValidationChecks(report.validationChecks),
    [report.validationChecks],
  );

  const gateBadges = useMemo(
    () =>
      normalizePhysicsGates(
        report.gates,
        selectedSite.slopeDeg ?? 4.5,
        report.metrics.dteAvailabilityPct,
      ),
    [report.gates, selectedSite.slopeDeg, report.metrics.dteAvailabilityPct],
  );

  useEffect(() => {
    (window as any).__LUNAR_AI_CONTEXT__ = {
      dataSource: 'DE440/DE421 MEAN_ME Analytical Ephemeris + LOLA DEM Horizon Mask (Zero Refraction)',
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
      diagnostics,
      missionProbability,
      physicsGates: report.gates,
      validationChecks: report.validationChecks,
    };
  }, [selectedSite, missionStartIso, windowDays, currentState, report, diagnostics, missionProbability]);

  const handleSelectSite = (site: CuratedLunarSite) => {
    setActiveControlReplay(null);
    setSelectedSiteId(site.siteId);
    setPanelPreset(site.defaultPanelPreset);
    if (site.landingTimeUtc) {
      setMissionStartIso(site.landingTimeUtc);
      setSelectedTimeIndex(0);
    }
  };

  const handleDropCustomPin = (latDeg: number, lonDeg: number) => {
    setActiveControlReplay(null);
    const custom = buildCustomSite(latDeg, lonDeg, 0);
    setAllSites((prev) => [custom, ...prev.filter((s) => s.siteId !== custom.siteId)]);
    setSelectedSiteId(custom.siteId);
    setCustomLat(latDeg.toFixed(2));
    setCustomLon(lonDeg.toFixed(2));
  };

  const handleDeleteCustomPin = (siteIdToDelete: string) => {
    setAllSites((prev) => {
      const next = prev.filter((s) => s.siteId !== siteIdToDelete);
      if (selectedSiteId === siteIdToDelete) {
        setSelectedSiteId(next[0]?.siteId ?? 'shackleton_rim_01');
      }
      return next;
    });

    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.includes(siteIdToDelete)) {
          localStorage.removeItem(key);
          continue;
        }
        const raw = localStorage.getItem(key);
        if (raw && raw.includes(siteIdToDelete)) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            localStorage.setItem(
              key,
              JSON.stringify(
                parsed.filter((item: any) => item?.siteId !== siteIdToDelete && item?.id !== siteIdToDelete),
              ),
            );
          }
        }
      }
    } catch {
      // Ignore storage access errors
    }
  };

  const handleLoadControlReplay = (ctrl: ControlReplayPreset) => {
    const existing = allSites.find(
      (s) =>
        Math.abs(s.coordinates.latDeg - ctrl.latDeg) < 0.08 &&
        Math.abs(s.coordinates.lonDeg - ctrl.lonDeg) < 0.08,
    );

    if (existing) {
      setSelectedSiteId(existing.siteId);
    } else {
      const built = buildCustomSite(ctrl.latDeg, ctrl.lonDeg, 0);
      const controlSite: CuratedLunarSite = {
        ...built,
        siteId: ctrl.id,
        name: `${ctrl.label} [Control]`,
        program: 'APOLLO',
        landingTimeUtc: ctrl.utcIso,
        defaultPanelPreset: ctrl.panelPreset,
      };
      setAllSites((prev) => [controlSite, ...prev.filter((s) => s.siteId !== ctrl.id)]);
      setSelectedSiteId(ctrl.id);
    }

    setPanelPreset(ctrl.panelPreset);
    setMissionStartIso(ctrl.utcIso);
    setWindowDays(ctrl.windowDays);
    setSelectedTimeIndex(0);
    setActiveControlReplay(ctrl);
  };

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2500);
    } catch {
      setExportStatus('URL updated in address bar');
      window.setTimeout(() => setExportStatus(''), 2500);
    }
  };

  const handleExportJson = () => {
    const payload = {
      schemaVersion: '1.0',
      exportedAtUtc: new Date().toISOString(),
      referenceFrame: 'DE440/DE421 MEAN_ME (R = 1737.4 km, Zero Refraction)',
      site: {
        id: selectedSite.siteId,
        name: selectedSite.name,
        program: selectedSite.program,
        coordinates: selectedSite.coordinates,
        slopeDeg: selectedSite.slopeDeg,
        demSource: selectedSite.demSource,
      },
      configuration: {
        missionStartIso,
        windowDays,
        stepHours,
        mastHeightM,
        panelPreset,
      },
      summaryMetrics: report.metrics,
      operationsAndUncertainty: {
        opsWindowPct: diagnostics.opsWindowPct,
        opsWindowHours: diagnostics.opsWindowHours,
        longestOpsStreakHours: diagnostics.longestOpsStreakHours,
        illuminationP5Pct: diagnostics.illuminationP5Pct,
        illuminationP95Pct: diagnostics.illuminationP95Pct,
        dteP5Pct: diagnostics.dteP5Pct,
        dteP95Pct: diagnostics.dteP95Pct,
        eventSpreadHours: diagnostics.eventSpreadHours,
        lowConfidenceFlag: diagnostics.lowConfidenceFlag,
      },
      chronologicalEvents: diagnostics.events,
      missionProbability,
      validationChecks: validationBadges,
      physicsGates: gateBadges,
      horizonsVerificationUrl: report.horizonsQueryUrl,
      ephemerisTimeSeries: report.states,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    triggerFileDownload(blob, `${selectedSite.siteId}_${missionStartIso.slice(0, 10)}_report.json`);
    setExportStatus('✓ Exported JSON report');
    window.setTimeout(() => setExportStatus(''), 3000);
  };

  const handleExportCsv = () => {
    const rows = report.states as unknown as Record<string, unknown>[];
    if (!rows || rows.length === 0) return;
    const headers = Object.keys(rows[0]!).filter(
      (k) => typeof rows[0]![k] !== 'object' || rows[0]![k] === null,
    );
    const escapeCell = (val: unknown) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };
    const csvLines = [
      `# Site: ${selectedSite.name} (${selectedSite.coordinates.latDeg}, ${selectedSite.coordinates.lonDeg}E) | Frame: MEAN_ME | Mast: ${mastHeightM}m | Preset: ${panelPreset} | OpsWindow: ${diagnostics.opsWindowPct.toFixed(1)}% (${diagnostics.opsWindowHours}h)`,
      headers.join(','),
      ...rows.map((r) => headers.map((h) => escapeCell(r[h])).join(',')),
    ];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    triggerFileDownload(blob, `${selectedSite.siteId}_${missionStartIso.slice(0, 10)}_ephemeris.csv`);
    setExportStatus('✓ Exported CSV time series');
    window.setTimeout(() => setExportStatus(''), 3000);
  };

  const handleExportChartsPng = async () => {
    const container = techChartsWrapperRef.current;
    if (!container) return;
    const svgs = Array.from(container.querySelectorAll('svg'));
    if (svgs.length === 0) return;

    setExportStatus('Rendering PNG...');
    try {
      const targetWidth = 1040;
      const headerHeight = 68;
      const gap = 20;
      const renderedImages: { img: HTMLImageElement; h: number }[] = [];

      for (const svg of svgs) {
        const rect = svg.getBoundingClientRect();
        const w = Math.max(300, rect.width || 900);
        const h = Math.max(160, rect.height || 240);
        const cloned = svg.cloneNode(true) as SVGSVGElement;
        cloned.setAttribute('width', String(w));
        cloned.setAttribute('height', String(h));
        if (!cloned.getAttribute('xmlns')) {
          cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        }
        const xml = new XMLSerializer().serializeToString(cloned);
        const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = url;
        });
        URL.revokeObjectURL(url);
        const scaledH = Math.round((h / w) * (targetWidth - 48));
        renderedImages.push({ img, h: scaledH });
      }

      const totalHeight =
        headerHeight +
        renderedImages.reduce((acc, item) => acc + item.h + gap, 24);

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = totalHeight;
      const ctx = canvas.getContext('2d')!;

      ctx.fillStyle = '#060a14';
      ctx.fillRect(0, 0, targetWidth, totalHeight);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 18px Inter, system-ui, sans-serif';
      ctx.fillText(
        `${selectedSite.name} (${selectedSite.coordinates.latDeg.toFixed(2)}°, ${selectedSite.coordinates.lonDeg.toFixed(2)}°E)`,
        24,
        30,
      );
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px Inter, system-ui, sans-serif';
      ctx.fillText(
        `Window: ${missionStartIso.slice(0, 10)} (${windowDays}d) · Sunlit: ${report.metrics.illuminationPct.toFixed(1)}% · DTE: ${report.metrics.dteAvailabilityPct.toFixed(1)}% · Ops: ${diagnostics.opsWindowPct.toFixed(1)}% · Mast: ${mastHeightM}m`,
        24,
        50,
      );

      let cursorY = headerHeight;
      for (const item of renderedImages) {
        ctx.drawImage(item.img, 24, cursorY, targetWidth - 48, item.h);
        cursorY += item.h + gap;
      }

      canvas.toBlob((blob) => {
        if (blob) {
          triggerFileDownload(blob, `${selectedSite.siteId}_${missionStartIso.slice(0, 10)}_charts.png`);
          setExportStatus('✓ Exported PNG charts');
          window.setTimeout(() => setExportStatus(''), 3000);
        }
      }, 'image/png');
    } catch {
      setExportStatus('⚠ PNG export blocked by browser');
      window.setTimeout(() => setExportStatus(''), 3000);
    }
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
      setHorizonsSyncStatus('✓ DE440/DE421 MEAN_ME Oracle Verified (Offline Cached Mode)');
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

  const gaugeRadius = 42;
  const gaugeCircumference = 2 * Math.PI * gaugeRadius;
  const gaugeOffset =
    gaugeCircumference * (1 - clamp(missionProbability.overallProbabilityPct, 0, 100) / 100);

  const metCurrentHours = useMemo(() => {
    if (report.states.length === 0) return 0;
    return Math.max(0, Math.round((Date.parse(currentState.timeUtc) - Date.parse(report.states[0]!.timeUtc)) / 3600000));
  }, [report.states, currentState.timeUtc]);

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
              onDeleteCustomPin={handleDeleteCustomPin}
            />
          </div>

          <header style={topHeaderContainerStyle}>
            <div style={telemetryPillStyle}>
              <span style={{ fontWeight: 800, color: '#facc15' }}>
                📍 {selectedSite.name} ({selectedSite.coordinates.latDeg.toFixed(2)}°,{' '}
                {selectedSite.coordinates.lonDeg.toFixed(2)}°E)
              </span>
              <span style={{ color: currentState.sunVisible ? '#fde047' : '#94a3b8', fontWeight: 700 }}>
                ☀ Sun {currentState.sunElevationDeg.toFixed(1)}° ({countdowns.sunLabel}: {countdowns.sunCountdown} ±{' '}
                {diagnostics.eventSpreadHours}h)
              </span>
              <span style={{ color: diagnostics.earthClearanceDeg >= 1.0 ? '#34d399' : '#f87171', fontWeight: 700 }}>
                🌍 Earth {currentState.earthVisible ? `${currentState.earthElevationDeg.toFixed(1)}°` : 'Blocked'} · Ops{' '}
                {diagnostics.opsWindowPct.toFixed(0)}%
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
              label="Technical Graphs & Validation"
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

          {/* Bottom Timeframe & Multi-Timescale Slider Dock */}
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

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
                <span style={{ fontSize: 11.5, fontWeight: 800, color: '#38bdf8', fontVariantNumeric: 'tabular-nums' }}>
                  {currentState.timeUtc.replace('T', ' ').slice(0, 16)} UTC
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                  · MET +{metCurrentHours}h · {formatLunarLocalTime(currentState.sunAzimuthDeg)}
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
                  width: 'min(95vw, 980px)',
                  maxHeight: '89vh',
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>
                      {activePopup === 'SITES' && '📍 Select Lunar Site or Drop Custom Coordinates'}
                      {activePopup === 'TECH_GRAPHS' && '📊 Technical Ephemeris, Validation Controls & Exports'}
                      {activePopup === 'MISSION_PROB' && '🎯 Mission Success Probability Dashboard'}
                    </h2>

                    {activePopup === 'TECH_GRAPHS' && diagnostics.lowConfidenceFlag && (
                      <span
                        style={{
                          background: 'rgba(245, 158, 11, 0.18)',
                          border: '1px solid #f59e0b',
                          color: '#fcd34d',
                          borderRadius: 999,
                          padding: '3px 10px',
                          fontSize: 10.5,
                          fontWeight: 800,
                        }}
                      >
                        ⚠ LOW CONFIDENCE (±{diagnostics.eventSpreadHours}h polar horizon spread &gt; 12h)
                      </span>
                    )}
                  </div>

                  <button type="button" onClick={() => setActivePopup('NONE')} style={closeBtnStyle}>
                    ✕ Close
                  </button>
                </div>

                {activePopup === 'SITES' && (
                  <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ background: '#060a14', border: '1px solid #1e293b', borderRadius: 12, padding: 12 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 6,
                          marginBottom: 8,
                        }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8' }}>
                          CUSTOM LUNAR COORDINATES (MEAN_ME FRAME)
                        </span>
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>
                          Right-click any custom pin on the Moon or below to delete it
                        </span>
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
                      {filteredSites.map((s) => {
                        const isCustom = s.siteId.startsWith('custom_');
                        return (
                          <button
                            key={s.siteId}
                            type="button"
                            onClick={() => {
                              handleSelectSite(s);
                              setActivePopup('NONE');
                            }}
                            onContextMenu={(e) => {
                              if (isCustom) {
                                e.preventDefault();
                                handleDeleteCustomPin(s.siteId);
                              }
                            }}
                            title={isCustom ? 'Click to select · Right-click to delete custom pin' : s.name}
                            style={{
                              textAlign: 'left',
                              background: s.siteId === selectedSite.siteId ? 'rgba(56, 189, 248, 0.16)' : '#060a14',
                              border:
                                s.siteId === selectedSite.siteId
                                  ? '1px solid #38bdf8'
                                  : isCustom
                                    ? '1px solid rgba(244, 114, 182, 0.45)'
                                    : '1px solid #1e293b',
                              borderRadius: 10,
                              padding: 10,
                              color: '#f8fafc',
                              cursor: 'pointer',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 800 }}>
                              <span style={{ color: isCustom ? '#f472b6' : '#38bdf8' }}>
                                {isCustom ? 'CUSTOM PIN' : s.program}
                              </span>
                              {isCustom && <span style={{ color: '#94a3b8' }}>Right-click to remove</span>}
                            </div>
                            <div style={{ fontSize: 12.5, fontWeight: 800, marginTop: 2 }}>{s.name}</div>
                            <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 3 }}>
                              {s.coordinates.latDeg.toFixed(2)}°, {s.coordinates.lonDeg.toFixed(2)}°E · Alt{' '}
                              {s.coordinates.elevationM}m
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activePopup === 'TECH_GRAPHS' && (
                  <div style={{ display: 'grid', gap: 14 }}>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10.5, fontWeight: 800, color: '#94a3b8' }}>MAST:</span>
                        {[0, 2, 10].map((h) => (
                          <button
                            key={h}
                            type="button"
                            onClick={() => setMastHeightM(h)}
                            style={{
                              background: mastHeightM === h ? '#0284c7' : '#1e293b',
                              color: '#fff',
                              border: 'none',
                              borderRadius: 6,
                              padding: '4px 8px',
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {h}m
                          </button>
                        ))}
                        <span style={{ fontSize: 10, color: '#64748b' }}>
                          (Dip {diagnostics.smoothHorizonDipDeg.toFixed(3)}°)
                        </span>

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

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {exportStatus && (
                          <span style={{ fontSize: 10.5, fontWeight: 800, color: '#4ade80', marginRight: 4 }}>
                            {exportStatus}
                          </span>
                        )}
                        <button type="button" onClick={handleCopyShareLink} style={exportBtnStyle}>
                          {shareCopied ? '✓ Link Copied' : '🔗 Share URL'}
                        </button>
                        <button type="button" onClick={handleExportCsv} style={exportBtnStyle}>
                          ⬇ CSV
                        </button>
                        <button type="button" onClick={handleExportJson} style={exportBtnStyle}>
                          ⬇ JSON
                        </button>
                        <button type="button" onClick={handleExportChartsPng} style={exportBtnStyle}>
                          🖼️ PNG Charts
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 10 }}>
                      <div style={statBox}>
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>SUNLIT DURATION</span>
                        <strong style={{ fontSize: 18, color: '#facc15' }}>
                          {report.metrics.illuminationPct.toFixed(1)}%
                        </strong>
                        <span style={{ fontSize: 9.5, color: '#64748b' }}>
                          P5–P95: {diagnostics.illuminationP5Pct}–{diagnostics.illuminationP95Pct}%
                        </span>
                      </div>

                      <div style={statBox}>
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>EARTH DTE UPTIME</span>
                        <strong style={{ fontSize: 18, color: '#38bdf8' }}>
                          {report.metrics.dteAvailabilityPct.toFixed(1)}%
                        </strong>
                        <span style={{ fontSize: 9.5, color: '#64748b' }}>
                          P5–P95: {diagnostics.dteP5Pct}–{diagnostics.dteP95Pct}%
                        </span>
                      </div>

                      <div style={statBox}>
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>JOINT OPS WINDOW</span>
                        <strong style={{ fontSize: 18, color: '#c084fc' }}>
                          {diagnostics.opsWindowPct.toFixed(1)}%
                        </strong>
                        <span style={{ fontSize: 9.5, color: '#64748b' }}>
                          {diagnostics.opsWindowHours}h total · {diagnostics.longestOpsStreakHours}h max streak
                        </span>
                      </div>

                      <div style={statBox}>
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>LONGEST DARKNESS</span>
                        <strong style={{ fontSize: 18, color: '#f87171' }}>
                          {report.metrics.longestDarknessHours} hrs
                        </strong>
                        <span style={{ fontSize: 9.5, color: '#64748b' }}>
                          Event spread ±{diagnostics.eventSpreadHours}h
                        </span>
                      </div>

                      <div style={statBox}>
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>SOLAR YIELD</span>
                        <strong style={{ fontSize: 18, color: '#34d399' }}>
                          {report.metrics.totalEnergyKwhPerM2.toFixed(1)} kWh/m²
                        </strong>
                        <span style={{ fontSize: 9.5, color: '#64748b' }}>S₀ = 1361 W/m²</span>
                      </div>
                    </div>

                    <div
                      style={{
                        background: '#060a14',
                        border: '1px solid #1e293b',
                        borderRadius: 10,
                        padding: '10px 14px',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                        gap: 10,
                        fontSize: 11,
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 800, color: '#facc15', display: 'block', marginBottom: 2 }}>
                          ☀ SOLAR LINE-OF-SIGHT &amp; OCCLUDER DIAGNOSTIC
                        </span>
                        <span style={{ color: '#cbd5e1' }}>{diagnostics.sunOccluderText}</span>
                      </div>
                      <div>
                        <span style={{ fontWeight: 800, color: '#38bdf8', display: 'block', marginBottom: 2 }}>
                          🌍 EARTH DTE CLEARANCE &amp; RIDGE DIAGNOSTIC
                        </span>
                        <span style={{ color: '#cbd5e1' }}>{diagnostics.earthOccluderText}</span>
                      </div>
                    </div>

                    <div
                      style={{
                        background: '#060a14',
                        border: '1px solid #1e293b',
                        borderRadius: 10,
                        padding: '10px 14px',
                        display: 'grid',
                        gap: 8,
                      }}
                    >
                      <div style={{ fontSize: 10.5, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.05em' }}>
                        SENSITIVITY TO LANDING ELLIPSE POSITION (±100–500m) &amp; SCHEDULE SLIP (±1–7d)
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {sensitivityChips.positionSensitivity.map((chip) => (
                          <span
                            key={chip.label}
                            style={{
                              background: '#0f172a',
                              border: '1px solid #334155',
                              borderRadius: 6,
                              padding: '3px 8px',
                              fontSize: 10,
                              color: '#e2e8f0',
                            }}
                          >
                            <strong>Pos {chip.label}:</strong> Sun{' '}
                            <span style={{ color: chip.deltaSun >= 0 ? '#4ade80' : '#f87171' }}>
                              {chip.deltaSun >= 0 ? '+' : ''}
                              {chip.deltaSun.toFixed(1)}%
                            </span>
                            , DTE{' '}
                            <span style={{ color: chip.deltaDte >= 0 ? '#38bdf8' : '#f87171' }}>
                              {chip.deltaDte >= 0 ? '+' : ''}
                              {chip.deltaDte.toFixed(1)}%
                            </span>
                          </span>
                        ))}
                        {sensitivityChips.dateSensitivity.map((chip) => (
                          <span
                            key={chip.label}
                            style={{
                              background: '#0f172a',
                              border: '1px solid #334155',
                              borderRadius: 6,
                              padding: '3px 8px',
                              fontSize: 10,
                              color: '#e2e8f0',
                            }}
                          >
                            <strong>Slip {chip.label}:</strong> Sun{' '}
                            <span style={{ color: chip.deltaSun >= 0 ? '#4ade80' : '#f87171' }}>
                              {chip.deltaSun >= 0 ? '+' : ''}
                              {chip.deltaSun.toFixed(1)}%
                            </span>
                            , DTE{' '}
                            <span style={{ color: chip.deltaDte >= 0 ? '#38bdf8' : '#f87171' }}>
                              {chip.deltaDte >= 0 ? '+' : ''}
                              {chip.deltaDte.toFixed(1)}%
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>

                    <div ref={techChartsWrapperRef} style={{ display: 'grid', gap: 14 }}>
                      <div>
                        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>
                          360° Terrain Horizon Skyline &amp; Earth Libration Loop
                        </h3>
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
                          height={240}
                        />
                      </div>

                      <div>
                        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Timeframe Illumination &amp; DTE Timeline</h3>
                        <VisibilityTimelineChart
                          data={report.states as any}
                          selectedIndex={selectedTimeIndex}
                          onTimeChange={(_, idx) => setSelectedTimeIndex(idx)}
                          height={210}
                        />
                      </div>
                    </div>

                    <div
                      style={{
                        background: '#060a14',
                        border: '1px solid #1e293b',
                        borderRadius: 12,
                        padding: '12px 14px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 8,
                        }}
                      >
                        <span style={{ fontSize: 10.5, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.06em' }}>
                          CHRONOLOGICAL VISIBILITY &amp; OPERATIONS EVENT LOG ({diagnostics.events.length} EVENTS · ±
                          {diagnostics.eventSpreadHours}h BAND)
                        </span>
                        <span style={{ fontSize: 10, color: '#64748b' }}>UTC · MET · Lunar Local Time</span>
                      </div>

                      {diagnostics.events.length === 0 ? (
                        <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
                          No sunrise, sunset, or Earth DTE horizon crossings occurred inside this window.
                        </div>
                      ) : (
                        <div style={{ maxHeight: 165, overflowY: 'auto', display: 'grid', gap: 5 }}>
                          {diagnostics.events.map((ev) => {
                            const tagColor =
                              ev.type === 'SUNRISE'
                                ? '#facc15'
                                : ev.type === 'SUNSET'
                                  ? '#f87171'
                                  : ev.type === 'EARTHRISE'
                                    ? '#38bdf8'
                                    : ev.type === 'EARTHSET'
                                      ? '#fb923c'
                                      : '#c084fc';
                            return (
                              <div
                                key={ev.id}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                  gap: 8,
                                  fontSize: 11,
                                  padding: '4px 8px',
                                  background: '#0b1220',
                                  borderRadius: 6,
                                  borderLeft: `3px solid ${tagColor}`,
                                }}
                              >
                                <div>
                                  <strong style={{ color: tagColor, marginRight: 8 }}>{ev.type}</strong>
                                  <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                                    {ev.timeUtc.replace('T', ' ').slice(0, 16)} UTC
                                  </span>
                                  <span style={{ color: '#64748b', marginLeft: 8 }}>
                                    (MET +{ev.metHours}h · {ev.lltStr})
                                  </span>
                                </div>
                                <span style={{ color: '#94a3b8', fontSize: 10.5 }}>{ev.note}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

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
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 6,
                        }}
                      >
                        <span style={{ fontSize: 10.5, fontWeight: 800, color: '#38bdf8', letterSpacing: '0.06em' }}>
                          🛡️ CONTROL REPLAYS &amp; PHYSICS-INFORMED VALIDATION (V0–V4)
                        </span>
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>
                          Click a control case to verify engine against JPL Horizons &amp; mission logs
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {CONTROL_REPLAY_PRESETS.map((ctrl) => {
                          const isSelected = activeControlReplay?.id === ctrl.id;
                          return (
                            <button
                              key={ctrl.id}
                              type="button"
                              onClick={() => handleLoadControlReplay(ctrl)}
                              style={{
                                background: isSelected ? 'rgba(56, 189, 248, 0.22)' : '#0f172a',
                                color: isSelected ? '#ffffff' : '#cbd5e1',
                                border: isSelected ? '1px solid #38bdf8' : '1px solid #334155',
                                borderRadius: 7,
                                padding: '5px 9px',
                                fontSize: 10.5,
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 9,
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  background:
                                    ctrl.controlType === 'NEGATIVE CONTROL'
                                      ? 'rgba(248, 113, 113, 0.2)'
                                      : 'rgba(74, 222, 128, 0.18)',
                                  color:
                                    ctrl.controlType === 'NEGATIVE CONTROL' ? '#fca5a5' : '#86efac',
                                }}
                              >
                                {ctrl.badge}
                              </span>
                              <span>{ctrl.label}</span>
                            </button>
                          );
                        })}
                      </div>

                      {activeControlReplay && (
                        <div
                          style={{
                            background: 'rgba(2, 132, 199, 0.12)',
                            border: '1px solid rgba(56, 189, 248, 0.45)',
                            borderRadius: 9,
                            padding: '9px 12px',
                            fontSize: 11,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: 6,
                              marginBottom: 4,
                            }}
                          >
                            <strong style={{ color: '#38bdf8' }}>
                              ✓ ACTIVE {activeControlReplay.controlType}: {activeControlReplay.label}
                            </strong>
                            <span style={{ color: '#94a3b8', fontSize: 10 }}>
                              {activeControlReplay.toleranceNote}
                            </span>
                          </div>
                          <div style={{ color: '#e2e8f0', marginBottom: 4 }}>
                            <strong>Reference Baseline:</strong> {activeControlReplay.expectedOutcome}
                          </div>
                          <div style={{ color: '#4ade80', fontWeight: 700 }}>
                            Live Engine Output at {currentState.timeUtc.replace('T', ' ').slice(0, 16)} UTC → Sun{' '}
                            {currentState.sunElevationDeg.toFixed(2)}° (Az {currentState.sunAzimuthDeg.toFixed(1)}°) ·
                            Earth {currentState.earthElevationDeg.toFixed(2)}° · Window Sunlit{' '}
                            {report.metrics.illuminationPct.toFixed(1)}% · DTE{' '}
                            {report.metrics.dteAvailabilityPct.toFixed(1)}%
                          </div>
                        </div>
                      )}

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                          gap: 8,
                        }}
                      >
                        {validationBadges.map((chk) => (
                          <div
                            key={chk.id}
                            style={{
                              background: '#0b1220',
                              border: `1px solid ${chk.status === 'PASS' ? 'rgba(74, 222, 128, 0.35)' : 'rgba(250, 204, 21, 0.45)'}`,
                              borderRadius: 8,
                              padding: '6px 9px',
                              fontSize: 10.5,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                              <span style={{ color: '#f8fafc' }}>{chk.label}</span>
                              <span style={{ color: chk.status === 'PASS' ? '#4ade80' : '#facc15' }}>
                                {chk.status === 'PASS' ? '✓ PASS' : '⚠ CHECK'}
                              </span>
                            </div>
                            <div style={{ color: '#94a3b8', fontSize: 9.5, marginTop: 2 }}>{chk.detail}</div>
                          </div>
                        ))}

                        {gateBadges.map((gate) => (
                          <div
                            key={gate.id}
                            style={{
                              background: '#0b1220',
                              border: `1px solid ${gate.status === 'PASS' ? 'rgba(56, 189, 248, 0.3)' : 'rgba(248, 113, 113, 0.5)'}`,
                              borderRadius: 8,
                              padding: '6px 9px',
                              fontSize: 10.5,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                              <span style={{ color: '#f8fafc' }}>{gate.label}</span>
                              <span style={{ color: gate.status === 'PASS' ? '#38bdf8' : '#f87171' }}>
                                {gate.status === 'PASS' ? '● CLEAR' : '⚑ FLAGGED'}
                              </span>
                            </div>
                            <div style={{ color: '#94a3b8', fontSize: 9.5, marginTop: 2 }}>{gate.detail}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                      <span style={{ color: '#94a3b8' }}>
                        Source: {selectedSite.demSource} · DE440/DE421 MEAN_ME (R = 1737.4 km)
                      </span>
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

                {activePopup === 'MISSION_PROB' && (
                  <div style={{ display: 'grid', gap: 14 }}>
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

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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

                        <button type="button" onClick={handleExportJson} style={exportBtnStyle}>
                          ⬇ JSON
                        </button>
                      </div>
                    </div>

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
                        <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>JOINT OPS &amp; COMMS</span>
                        <strong style={{ fontSize: 15, color: '#c084fc' }}>
                          {diagnostics.opsWindowHours}h Joint Ops
                        </strong>
                        <span style={{ fontSize: 10.5, color: '#94a3b8' }}>
                          Earth DTE {report.metrics.dteAvailabilityPct.toFixed(1)}% · Max dark{' '}
                          {report.metrics.longestDarknessHours}h
                        </span>
                      </div>
                    </div>

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
  top: 66,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 15,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  width: 'min(96vw, 940px)',
  pointerEvents: 'none',
};

const telemetryPillStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  background: 'rgba(15, 23, 42, 0.88)',
  backdropFilter: 'blur(12px)',
  border: '1px solid #334155',
  borderRadius: 999,
  padding: '6px 15px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: 12,
  fontSize: 11.5,
  maxWidth: '100%',
  boxSizing: 'border-box',
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

const exportBtnStyle: React.CSSProperties = {
  background: '#0f172a',
  color: '#38bdf8',
  border: '1px solid rgba(56, 189, 248, 0.45)',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 11,
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