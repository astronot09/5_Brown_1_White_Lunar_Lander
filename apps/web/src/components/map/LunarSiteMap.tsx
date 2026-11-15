import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { CuratedLunarSite } from '../../data/siteCatalogue';
import type { SimulationStepState } from '../../engine/physicsEngine';

export type MapPerspective = 'GLOBE' | 'STREET_VIEW' | 'ORBITAL_SYSTEM';
export type StationId = 'ISS' | 'TIANGONG' | 'STARSHIP_DEPOT' | 'AXIOM' | 'HAVEN_1' | 'GATEWAY';
export type TransferFilter = 'ALL' | 'SHORTEST' | 'HOHMANN' | 'FREE_RETURN' | 'WSB';

export interface LunarSiteMapProps {
  sites: CuratedLunarSite[];
  selectedSite: CuratedLunarSite;
  currentState: SimulationStepState;
  perspective: MapPerspective;
  onSelectSite: (site: CuratedLunarSite) => void;
  onDropCustomPin: (latDeg: number, lonDeg: number) => void;
  compact?: boolean;
}

const MU_EARTH_KM3_S2 = 398600.4418;
const R_EARTH_KM = 6371.0;
const A_MOON_KM = 384400.0;
const MOON_INCLINATION_DEG = 28.58;

interface SpaceStationSpec {
  id: StationId;
  shortLabel: string;
  name: string;
  agency: string;
  altitudeKm: number;
  inclinationDeg: number;
  periodMinutes: number;
  speedKmS: number;
  raanRad: number;
  colorHex: number;
  colorCss: string;
  sceneRadius: number;
}

const SPACE_STATIONS: Record<StationId, SpaceStationSpec> = {
  ISS: {
    id: 'ISS',
    shortLabel: 'ISS',
    name: 'International Space Station',
    agency: 'NASA / Roscosmos / ESA / JAXA / CSA',
    altitudeKm: 418,
    inclinationDeg: 51.64,
    periodMinutes: 92.9,
    speedKmS: 7.66,
    raanRad: 0.35,
    colorHex: 0x38bdf8,
    colorCss: '#38bdf8',
    sceneRadius: 0.72,
  },
  TIANGONG: {
    id: 'TIANGONG',
    shortLabel: 'Tiangong',
    name: 'Tiangong Space Station',
    agency: 'CMSA',
    altitudeKm: 389,
    inclinationDeg: 41.47,
    periodMinutes: 92.3,
    speedKmS: 7.68,
    raanRad: -0.65,
    colorHex: 0xfb923c,
    colorCss: '#fb923c',
    sceneRadius: 0.67,
  },
  STARSHIP_DEPOT: {
    id: 'STARSHIP_DEPOT',
    shortLabel: 'HLS Depot',
    name: 'Starship LEO Propellant Depot',
    agency: 'SpaceX / NASA Artemis HLS',
    altitudeKm: 500,
    inclinationDeg: 28.5,
    periodMinutes: 94.6,
    speedKmS: 7.61,
    raanRad: 0.05,
    colorHex: 0x4ade80,
    colorCss: '#4ade80',
    sceneRadius: 0.78,
  },
  AXIOM: {
    id: 'AXIOM',
    shortLabel: 'Axiom',
    name: 'Axiom Commercial Station',
    agency: 'Axiom Space',
    altitudeKm: 420,
    inclinationDeg: 51.64,
    periodMinutes: 93.0,
    speedKmS: 7.66,
    raanRad: 1.15,
    colorHex: 0x2dd4bf,
    colorCss: '#2dd4bf',
    sceneRadius: 0.74,
  },
  HAVEN_1: {
    id: 'HAVEN_1',
    shortLabel: 'Haven-1',
    name: 'VAST Haven-1 Outpost',
    agency: 'VAST Space',
    altitudeKm: 510,
    inclinationDeg: 51.6,
    periodMinutes: 94.8,
    speedKmS: 7.61,
    raanRad: -1.35,
    colorHex: 0xf43f5e,
    colorCss: '#f43f5e',
    sceneRadius: 0.81,
  },
  GATEWAY: {
    id: 'GATEWAY',
    shortLabel: 'Gateway',
    name: 'Lunar Gateway (9:2 L2 NRHO)',
    agency: 'NASA / ESA / JAXA / CSA / MBRSC',
    altitudeKm: 3250,
    inclinationDeg: 90.0,
    periodMinutes: 6.56 * 24 * 60,
    speedKmS: 1.48,
    raanRad: 0,
    colorHex: 0xe879f9,
    colorCss: '#e879f9',
    sceneRadius: 2.55,
  },
};

interface TransferSolution {
  id: Exclude<TransferFilter, 'ALL'>;
  label: string;
  tofDays: number;
  durationLabel: string;
  departureUtcLabel: string;
  arrivalUtcLabel: string;
  tliDeltaVKms: number;
  captureDeltaVKms: number;
  totalDeltaVKms: number;
  planeChangeDeg: number;
  colorHex: number;
  colorCss: string;
  summary: string;
}

function formatShortUtc(ms: number): string {
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

function formatDurationDays(days: number): string {
  const totalHours = Math.round(days * 24);
  const d = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  return h > 0 ? `${d}d ${h}h (${days.toFixed(1)}d)` : `${d}d (${days.toFixed(1)}d)`;
}

function computeTransferSolutions(
  station: SpaceStationSpec,
  siteLatDeg: number,
  departureIso: string,
): TransferSolution[] {
  const departMs = Date.parse(departureIso) || Date.UTC(2026, 10, 14, 0, 0, 0);
  const departLabel = formatShortUtc(departMs);

  const r1 = R_EARTH_KM + station.altitudeKm;
  const r2 = A_MOON_KM;
  const vCircularLeo = Math.sqrt(MU_EARTH_KM3_S2 / r1);

  const planeChangeDeg = Math.abs(station.inclinationDeg - MOON_INCLINATION_DEG);
  const planePenaltyKms = Number(((planeChangeDeg / 23.0) * 0.14).toFixed(2));
  const polarSitePenaltyKms = Math.abs(siteLatDeg) > 75 ? 0.08 : 0.0;

  // 1. Shortest Direct Fast-TLI (~3.2 days)
  const aFast = 216000;
  const vPerigeeFast = Math.sqrt(MU_EARTH_KM3_S2 * (2 / r1 - 1 / aFast));
  const dvTliFast = vPerigeeFast - vCircularLeo + planePenaltyKms;
  const tofFastDays = 3.2;
  const dvLoiFast = 0.96 + polarSitePenaltyKms;

  // 2. Cotangential Hohmann Transfer Ellipse (~5.0 days)
  const aHohmann = (r1 + r2) / 2;
  const vPerigeeHohmann = Math.sqrt(MU_EARTH_KM3_S2 * (2 / r1 - 1 / aHohmann));
  const dvTliHohmann = vPerigeeHohmann - vCircularLeo + planePenaltyKms;
  const tofHohmannDays = (Math.PI * Math.sqrt(Math.pow(aHohmann, 3) / MU_EARTH_KM3_S2)) / 86400;
  const dvLoiHohmann = 0.84 + polarSitePenaltyKms;

  // 3. Circumlunar Free-Return Figure-8 (~6.0 days round-trip)
  const dvTliFreeReturn = dvTliHohmann + 0.03;
  const tofFreeReturnDays = 6.0;

  // 4. Ballistic Lunar Transfer / Weak Stability Boundary (~95 days)
  const dvTliWsb = dvTliHohmann + 0.05;
  const dvCaptureWsb = 0.65 + polarSitePenaltyKms * 0.5;
  const tofWsbDays = 95.0;

  if (station.id === 'GATEWAY') {
    const tof1 = 0.5;
    const tof2 = 6.56;
    return [
      {
        id: 'SHORTEST',
        label: 'NRHO → Polar LLO Descent',
        tofDays: tof1,
        durationLabel: formatDurationDays(tof1),
        departureUtcLabel: departLabel,
        arrivalUtcLabel: formatShortUtc(departMs + tof1 * 86400 * 1000),
        tliDeltaVKms: 0.45,
        captureDeltaVKms: Number((0.28 + polarSitePenaltyKms).toFixed(2)),
        totalDeltaVKms: Number((0.73 + polarSitePenaltyKms).toFixed(2)),
        planeChangeDeg: 0,
        colorHex: 0x4ade80,
        colorCss: '#4ade80',
        summary: 'Direct perilune departure from 9:2 NRHO to 100 km polar staging orbit',
      },
      {
        id: 'HOHMANN',
        label: 'NRHO 1-Rev Phasing Transfer',
        tofDays: tof2,
        durationLabel: formatDurationDays(tof2),
        departureUtcLabel: departLabel,
        arrivalUtcLabel: formatShortUtc(departMs + tof2 * 86400 * 1000),
        tliDeltaVKms: 0.39,
        captureDeltaVKms: 0.25,
        totalDeltaVKms: 0.64,
        planeChangeDeg: 0,
        colorHex: 0x38bdf8,
        colorCss: '#38bdf8',
        summary: 'Minimum-propellant 1-revolution apolune plane alignment',
      },
    ];
  }

  return [
    {
      id: 'SHORTEST',
      label: 'Shortest Direct TLI',
      tofDays: tofFastDays,
      durationLabel: formatDurationDays(tofFastDays),
      departureUtcLabel: departLabel,
      arrivalUtcLabel: formatShortUtc(departMs + tofFastDays * 86400 * 1000),
      tliDeltaVKms: Number(dvTliFast.toFixed(2)),
      captureDeltaVKms: Number(dvLoiFast.toFixed(2)),
      totalDeltaVKms: Number((dvTliFast + dvLoiFast).toFixed(2)),
      planeChangeDeg: Number(planeChangeDeg.toFixed(1)),
      colorHex: 0x4ade80,
      colorCss: '#4ade80',
      summary: 'Fastest crewed transit directly to Moon arrival node',
    },
    {
      id: 'HOHMANN',
      label: 'Hohmann Minimum-Energy',
      tofDays: Number(tofHohmannDays.toFixed(1)),
      durationLabel: formatDurationDays(tofHohmannDays),
      departureUtcLabel: departLabel,
      arrivalUtcLabel: formatShortUtc(departMs + tofHohmannDays * 86400 * 1000),
      tliDeltaVKms: Number(dvTliHohmann.toFixed(2)),
      captureDeltaVKms: Number(dvLoiHohmann.toFixed(2)),
      totalDeltaVKms: Number((dvTliHohmann + dvLoiHohmann).toFixed(2)),
      planeChangeDeg: Number(planeChangeDeg.toFixed(1)),
      colorHex: 0x38bdf8,
      colorCss: '#38bdf8',
      summary: '180° cotangential Keplerian ellipse minimizing TLI burn energy',
    },
    {
      id: 'FREE_RETURN',
      label: 'Circumlunar Free-Return',
      tofDays: tofFreeReturnDays,
      durationLabel: formatDurationDays(tofFreeReturnDays),
      departureUtcLabel: departLabel,
      arrivalUtcLabel: formatShortUtc(departMs + tofFreeReturnDays * 86400 * 1000),
      tliDeltaVKms: Number(dvTliFreeReturn.toFixed(2)),
      captureDeltaVKms: 0.0,
      totalDeltaVKms: Number(dvTliFreeReturn.toFixed(2)),
      planeChangeDeg: Number(planeChangeDeg.toFixed(1)),
      colorHex: 0xfacc15,
      colorCss: '#facc15',
      summary: 'Apollo-style figure-8 loop behind Moon back to Earth entry corridor',
    },
    {
      id: 'WSB',
      label: 'Ballistic Lunar Transfer (WSB)',
      tofDays: tofWsbDays,
      durationLabel: formatDurationDays(tofWsbDays),
      departureUtcLabel: departLabel,
      arrivalUtcLabel: formatShortUtc(departMs + tofWsbDays * 86400 * 1000),
      tliDeltaVKms: Number(dvTliWsb.toFixed(2)),
      captureDeltaVKms: Number(dvCaptureWsb.toFixed(2)),
      totalDeltaVKms: Number((dvTliWsb + dvCaptureWsb).toFixed(2)),
      planeChangeDeg: 0.4,
      colorHex: 0xc084fc,
      colorCss: '#c084fc',
      summary: 'Sun-Earth Weak Stability Boundary deep-space arc; lowest capture Δv',
    },
  ];
}

function latLonToVector3(latDeg: number, lonDeg: number, radius: number): THREE.Vector3 {
  const phi = ((90 - latDeg) * Math.PI) / 180;
  const theta = ((lonDeg + 180) * Math.PI) / 180;
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

function sampleHorizonDeg(mask: number[], azimuthDeg: number): number {
  if (!mask || mask.length === 0) return 2.0;
  const n = mask.length;
  const wrapped = ((azimuthDeg % 360) + 360) % 360;
  const exactIdx = (wrapped / 360) * n;
  const i0 = Math.floor(exactIdx) % n;
  const i1 = (i0 + 1) % n;
  const frac = exactIdx - Math.floor(exactIdx);
  return mask[i0]! * (1 - frac) + mask[i1]! * frac;
}

function buildTerrainGeometry(mask: number[]): THREE.RingGeometry {
  const maxR = 6.0;
  const terrainGeo = new THREE.RingGeometry(0.01, maxR, 180, 64);
  terrainGeo.rotateX(-Math.PI / 2);
  const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const r = Math.hypot(x, z);
    const azRad = Math.atan2(x, -z);
    const azDeg = ((azRad * 180) / Math.PI + 360) % 360;
    const maskDeg = sampleHorizonDeg(mask, azDeg);

    const t = Math.max(0, Math.min(1, (r - 0.35) / (maxR - 0.35)));
    const smooth = t * t * (3 - 2 * t);
    const ridgeY = Math.tan((Math.max(0, maskDeg) * Math.PI) / 180) * r * 2.4 * smooth;
    const microBump = Math.sin(x * 7) * Math.cos(z * 7) * 0.012 * (1 - smooth);
    posAttr.setY(i, ridgeY + microBump);
  }
  terrainGeo.computeVertexNormals();
  return terrainGeo;
}

function createEarthTexture(): THREE.CanvasTexture {
  const width = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0b4f9f';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#2e7d32';
  const landmasses = [
    [125, 75, 42, 32],
    [145, 115, 22, 18],
    [168, 155, 28, 45],
    [275, 68, 35, 22],
    [282, 122, 34, 48],
    [355, 78, 65, 38],
    [405, 165, 26, 20],
  ];
  landmasses.forEach(([x, y, rx, ry]) => {
    ctx.beginPath();
    ctx.ellipse(x!, y!, rx!, ry!, 0.15, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, 16);
  ctx.fillRect(0, height - 16, width, 16);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  for (let i = 0; i < 38; i++) {
    const cx = (i * 73) % width;
    const cy = 28 + ((i * 41) % (height - 56));
    const cw = 26 + (i % 5) * 14;
    ctx.beginPath();
    ctx.ellipse(cx, cy, cw, 4.5, -0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function getStationOrbitPoint(radius: number, inclDeg: number, trueAnomalyRad: number, raanRad = 0.4): THREE.Vector3 {
  const inc = (inclDeg * Math.PI) / 180;
  const xOrb = radius * Math.cos(trueAnomalyRad);
  const zOrb = radius * Math.sin(trueAnomalyRad);

  const yIncl = zOrb * Math.sin(inc);
  const zIncl = zOrb * Math.cos(inc);

  const x = xOrb * Math.cos(raanRad) - zIncl * Math.sin(raanRad);
  const z = xOrb * Math.sin(raanRad) + zIncl * Math.cos(raanRad);
  return new THREE.Vector3(x, yIncl, z);
}

function getStationPointAtWorldAzimuth(spec: SpaceStationSpec, desiredWorldAzimuthRad: number): THREE.Vector3 {
  const inc = (spec.inclinationDeg * Math.PI) / 180;
  const psi = desiredWorldAzimuthRad - spec.raanRad;
  const uOrb = Math.atan2(Math.sin(psi), Math.cos(psi) * Math.cos(inc));
  return getStationOrbitPoint(spec.sceneRadius, spec.inclinationDeg, uOrb, spec.raanRad);
}

export function LunarSiteMap({
  sites,
  selectedSite,
  currentState,
  perspective,
  onSelectSite,
  onDropCustomPin,
  compact = false,
}: LunarSiteMapProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [skyBadges, setSkyBadges] = useState({
    sun: { x: 0, y: 0, visible: false },
    earth: { x: 0, y: 0, visible: false },
    headingDeg: 0,
  });

  const [selectedStation, setSelectedStation] = useState<StationId>('ISS');
  const [transferFilter, setTransferFilter] = useState<TransferFilter>('ALL');
  const [hudExpanded, setHudExpanded] = useState<boolean>(!compact);
  const [hoveredPathId, setHoveredPathId] = useState<Exclude<TransferFilter, 'ALL'> | null>(null);
  const [hoverTooltip, setHoverTooltip] = useState<{
    x: number;
    y: number;
    pathId: Exclude<TransferFilter, 'ALL'>;
  } | null>(null);

  useEffect(() => {
    setHudExpanded(!compact);
  }, [compact]);

  const stationRef = useRef<StationId>(selectedStation);
  stationRef.current = selectedStation;

  const transferFilterRef = useRef<TransferFilter>(transferFilter);
  transferFilterRef.current = transferFilter;

  const hoveredPathRef = useRef<Exclude<TransferFilter, 'ALL'> | null>(hoveredPathId);
  hoveredPathRef.current = hoveredPathId;

  const transferSolutions = useMemo(
    () =>
      computeTransferSolutions(
        SPACE_STATIONS[selectedStation],
        selectedSite.coordinates.latDeg,
        currentState.timeUtc,
      ),
    [selectedStation, selectedSite.coordinates.latDeg, currentState.timeUtc],
  );

  const dragRef = useRef({ isDragging: false, lastX: 0, lastY: 0, moved: false });
  const skipAutoFocusRef = useRef(false);

  const cameraCtrlRef = useRef({
    globeRotX: -1.15,
    globeRotY: -((0 + 90) * Math.PI) / 180,
    targetGlobeRotX: -1.15,
    targetGlobeRotY: -((0 + 90) * Math.PI) / 180,
    globeZoom: 2.35,
    targetGlobeZoom: 2.35,
    streetYaw: 0,
    streetPitch: 0.08,
  });

  const stateRef = useRef(currentState);
  stateRef.current = currentState;

  const siteRef = useRef(selectedSite);
  siteRef.current = selectedSite;

  const onSelectSiteRef = useRef(onSelectSite);
  onSelectSiteRef.current = onSelectSite;

  const onDropCustomPinRef = useRef(onDropCustomPin);
  onDropCustomPinRef.current = onDropCustomPin;

  const sceneObjectsRef = useRef<{
    pinsGroup: THREE.Group | null;
    pinMeshes: { mesh: THREE.Mesh; site: CuratedLunarSite }[];
    beaconRing: THREE.Mesh | null;
    surfaceTerrain: THREE.Mesh | null;
  }>({
    pinsGroup: null,
    pinMeshes: [],
    beaconRing: null,
    surfaceTerrain: null,
  });

  useEffect(() => {
    cameraCtrlRef.current.streetYaw = (stateRef.current.sunAzimuthDeg * Math.PI) / 180;

    if (skipAutoFocusRef.current) {
      skipAutoFocusRef.current = false;
      return;
    }

    const latRad = (selectedSite.coordinates.latDeg * Math.PI) / 180;
    const rawTargetY = -((selectedSite.coordinates.lonDeg + 90) * Math.PI) / 180;
    const currentY = cameraCtrlRef.current.globeRotY;
    const shortestDeltaY = Math.atan2(Math.sin(rawTargetY - currentY), Math.cos(rawTargetY - currentY));

    cameraCtrlRef.current.targetGlobeRotX = Math.max(-1.48, Math.min(1.48, latRad));
    cameraCtrlRef.current.targetGlobeRotY = currentY + shortestDeltaY;
  }, [selectedSite.siteId, selectedSite.coordinates.latDeg, selectedSite.coordinates.lonDeg]);

  useEffect(() => {
    const { pinsGroup, surfaceTerrain } = sceneObjectsRef.current;

    if (pinsGroup) {
      while (pinsGroup.children.length > 0) {
        const child = pinsGroup.children[0] as THREE.Mesh;
        pinsGroup.remove(child);
        child.geometry?.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material?.dispose();
      }

      const nextPinMeshes: { mesh: THREE.Mesh; site: CuratedLunarSite }[] = [];
      let nextBeacon: THREE.Mesh | null = null;

      sites.forEach((s) => {
        const isSel = s.siteId === selectedSite.siteId;
        const color = isSel
          ? 0xfacc15
          : s.program === 'APOLLO'
            ? 0x38bdf8
            : s.program === 'CLPS'
              ? 0xf97316
              : s.program === 'CSA'
                ? 0xf43f5e
                : s.program === 'INTERNATIONAL'
                  ? 0xc084fc
                  : 0x34d399;

        const pin = new THREE.Mesh(
          new THREE.SphereGeometry(isSel ? 0.026 : 0.016, 16, 16),
          new THREE.MeshBasicMaterial({ color }),
        );
        const pos = latLonToVector3(s.coordinates.latDeg, s.coordinates.lonDeg, 1.012);
        pin.position.copy(pos);
        pinsGroup.add(pin);
        nextPinMeshes.push({ mesh: pin, site: s });

        if (isSel) {
          nextBeacon = new THREE.Mesh(
            new THREE.RingGeometry(0.036, 0.052, 32),
            new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide }),
          );
          nextBeacon.position.copy(latLonToVector3(s.coordinates.latDeg, s.coordinates.lonDeg, 1.014));
          nextBeacon.lookAt(pos.clone().multiplyScalar(2));
          pinsGroup.add(nextBeacon);
        }
      });

      sceneObjectsRef.current.pinMeshes = nextPinMeshes;
      sceneObjectsRef.current.beaconRing = nextBeacon;
    }

    if (surfaceTerrain) {
      const oldGeo = surfaceTerrain.geometry;
      surfaceTerrain.geometry = buildTerrainGeometry(selectedSite.horizonMaskDeg);
      oldGeo.dispose();
    }
  }, [sites, selectedSite.siteId, selectedSite.horizonMaskDeg, perspective]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || (compact ? 340 : 680);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.05, 150);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.38;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const starGeo = new THREE.BufferGeometry();
    const starCount = compact ? 600 : 1600;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i += 3) {
      const r = 28 + Math.random() * 25;
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(2 * Math.random() - 1);
      starPos[i] = r * Math.sin(v) * Math.cos(u);
      starPos[i + 1] = r * Math.sin(v) * Math.sin(u);
      starPos[i + 2] = r * Math.cos(v);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(
      new THREE.Points(
        starGeo,
        new THREE.PointsMaterial({ color: 0xf8fafc, size: 0.08, transparent: true, opacity: 0.78 }),
      ),
    );

    const texLoader = new THREE.TextureLoader();
    const moonTex = texLoader.load('/textures/lroc_color_poles_1k.jpg');
    moonTex.colorSpace = THREE.SRGBColorSpace;

    // 1. GLOBE PERSPECTIVE
    const globeGroup = new THREE.Group();
    const moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 80, 80),
      new THREE.MeshStandardMaterial({
        map: moonTex,
        bumpMap: moonTex,
        bumpScale: 0.018,
        roughness: 0.86,
        metalness: 0.02,
      }),
    );
    globeGroup.add(moonMesh);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.028, 48, 48),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.11, side: THREE.BackSide }),
    );
    globeGroup.add(halo);

    const gridMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.22 });
    [-60, -30, 0, 30, 60].forEach((lat) => {
      const pts: THREE.Vector3[] = [];
      for (let lon = 0; lon <= 360; lon += 5) pts.push(latLonToVector3(lat, lon, 1.002));
      globeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    });

    const pinsGroup = new THREE.Group();
    globeGroup.add(pinsGroup);
    sceneObjectsRef.current.pinsGroup = pinsGroup;

    const initialPinMeshes: { mesh: THREE.Mesh; site: CuratedLunarSite }[] = [];
    let initialBeacon: THREE.Mesh | null = null;
    sites.forEach((s) => {
      const isSel = s.siteId === siteRef.current.siteId;
      const color = isSel
        ? 0xfacc15
        : s.program === 'APOLLO'
          ? 0x38bdf8
          : s.program === 'CLPS'
            ? 0xf97316
            : s.program === 'CSA'
              ? 0xf43f5e
              : s.program === 'INTERNATIONAL'
                ? 0xc084fc
                : 0x34d399;

      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(isSel ? 0.026 : 0.016, 16, 16),
        new THREE.MeshBasicMaterial({ color }),
      );
      const pos = latLonToVector3(s.coordinates.latDeg, s.coordinates.lonDeg, 1.012);
      pin.position.copy(pos);
      pinsGroup.add(pin);
      initialPinMeshes.push({ mesh: pin, site: s });

      if (isSel) {
        initialBeacon = new THREE.Mesh(
          new THREE.RingGeometry(0.036, 0.052, 32),
          new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide }),
        );
        initialBeacon.position.copy(latLonToVector3(s.coordinates.latDeg, s.coordinates.lonDeg, 1.014));
        initialBeacon.lookAt(pos.clone().multiplyScalar(2));
        pinsGroup.add(initialBeacon);
      }
    });
    sceneObjectsRef.current.pinMeshes = initialPinMeshes;
    sceneObjectsRef.current.beaconRing = initialBeacon;

    // 2. STREET VIEW PERSPECTIVE
    const streetGroup = new THREE.Group();
    const regolithRepeat = moonTex.clone();
    regolithRepeat.wrapS = THREE.RepeatWrapping;
    regolithRepeat.wrapT = THREE.RepeatWrapping;
    regolithRepeat.repeat.set(8, 8);
    regolithRepeat.needsUpdate = true;

    const surfaceTerrain = new THREE.Mesh(
      buildTerrainGeometry(siteRef.current.horizonMaskDeg),
      new THREE.MeshStandardMaterial({
        map: regolithRepeat,
        bumpMap: regolithRepeat,
        bumpScale: 0.02,
        roughness: 0.95,
        side: THREE.DoubleSide,
      }),
    );
    surfaceTerrain.receiveShadow = true;
    streetGroup.add(surfaceTerrain);
    sceneObjectsRef.current.surfaceTerrain = surfaceTerrain;

    const skySun = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xfef08a }),
    );
    streetGroup.add(skySun);

    const earthTex = createEarthTexture();
    const skyEarth = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 32, 32),
      new THREE.MeshBasicMaterial({ map: earthTex }),
    );
    streetGroup.add(skyEarth);

    // 3. EARTH–MOON ORBITAL SYSTEM + 6 SPACE STATIONS + DIRECT-TO-MOON TRAJECTORIES
    const orbitSystemGroup = new THREE.Group();
    const centralEarth = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 40, 40),
      new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.6 }),
    );
    orbitSystemGroup.add(centralEarth);

    orbitSystemGroup.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.525, 32, 32),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.14, side: THREE.BackSide }),
      ),
    );

    const orbitRingPts: THREE.Vector3[] = [];
    const orbitRadius = 2.55;
    for (let deg = 0; deg <= 360; deg += 3) {
      const rad = (deg * Math.PI) / 180;
      orbitRingPts.push(new THREE.Vector3(Math.cos(rad) * orbitRadius, 0, Math.sin(rad) * orbitRadius));
    }
    orbitSystemGroup.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(orbitRingPts),
        new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.45 }),
      ),
    );

    const leoStationIds: Exclude<StationId, 'GATEWAY'>[] = [
      'ISS',
      'TIANGONG',
      'STARSHIP_DEPOT',
      'AXIOM',
      'HAVEN_1',
    ];
    const stationVisuals: Record<
      Exclude<StationId, 'GATEWAY'>,
      { line: THREE.Line; marker: THREE.Mesh }
    > = {} as any;

    leoStationIds.forEach((stId) => {
      const spec = SPACE_STATIONS[stId];
      const pts: THREE.Vector3[] = [];
      for (let deg = 0; deg <= 360; deg += 4) {
        pts.push(getStationOrbitPoint(spec.sceneRadius, spec.inclinationDeg, (deg * Math.PI) / 180, spec.raanRad));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: spec.colorHex, transparent: true, opacity: 0.35 }),
      );
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.032, 14, 14),
        new THREE.MeshBasicMaterial({ color: spec.colorHex }),
      );
      orbitSystemGroup.add(line, marker);
      stationVisuals[stId] = { line, marker };
    });

    const orbitingMoon = new THREE.Mesh(
      new THREE.SphereGeometry(0.21, 36, 36),
      new THREE.MeshStandardMaterial({ map: moonTex, roughness: 0.85 }),
    );
    orbitSystemGroup.add(orbitingMoon);

    const siteMarkerOnOrbitMoon = new THREE.Mesh(
      new THREE.SphereGeometry(0.034, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 }),
    );
    orbitingMoon.add(siteMarkerOnOrbitMoon);

    const gatewayNrhoPts: THREE.Vector3[] = [];
    for (let deg = 0; deg <= 360; deg += 5) {
      const rad = (deg * Math.PI) / 180;
      const gy = -0.19 + 0.45 * Math.cos(rad);
      const gx = 0.14 * Math.sin(rad);
      const gz = 0.11 * Math.sin(rad);
      gatewayNrhoPts.push(new THREE.Vector3(gx, gy, gz));
    }
    const gatewayOrbitLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(gatewayNrhoPts),
      new THREE.LineBasicMaterial({ color: SPACE_STATIONS.GATEWAY.colorHex, transparent: true, opacity: 0.78 }),
    );
    orbitingMoon.add(gatewayOrbitLine);

    const gatewayMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 12, 12),
      new THREE.MeshBasicMaterial({ color: SPACE_STATIONS.GATEWAY.colorHex }),
    );
    orbitingMoon.add(gatewayMarker);

    const makeDashedTrajectory = (
      pathId: Exclude<TransferFilter, 'ALL'>,
      colorHex: number,
      dashSize = 0.08,
      gapSize = 0.045,
    ) => {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.LineDashedMaterial({
        color: colorHex,
        dashSize,
        gapSize,
        transparent: true,
        opacity: 0.94,
      });
      const line = new THREE.Line(geo, mat);
      line.userData = { pathId };
      line.frustumCulled = false;
      return line;
    };

    const shortestLine = makeDashedTrajectory('SHORTEST', 0x4ade80, 0.085, 0.045);
    const hohmannLine = makeDashedTrajectory('HOHMANN', 0x38bdf8, 0.07, 0.048);
    const freeReturnLine = makeDashedTrajectory('FREE_RETURN', 0xfacc15, 0.07, 0.048);
    const wsbLine = makeDashedTrajectory('WSB', 0xc084fc, 0.06, 0.052);
    const trajectoryLines = [shortestLine, hohmannLine, freeReturnLine, wsbLine];

    // Animated spacecraft pulse dots traveling from station -> Moon along each path
    const shortPulse = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x4ade80 }),
    );
    const hohPulse = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
    );
    const frPulse = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 }),
    );
    const wsbPulse = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xc084fc }),
    );

    const tliBurnMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );

    orbitSystemGroup.add(
      shortestLine,
      hohmannLine,
      freeReturnLine,
      wsbLine,
      shortPulse,
      hohPulse,
      frPulse,
      wsbPulse,
      tliBurnMarker,
    );

    if (perspective === 'GLOBE') scene.add(globeGroup);
    else if (perspective === 'STREET_VIEW') scene.add(streetGroup);
    else scene.add(orbitSystemGroup);

    const sunDirLight = new THREE.DirectionalLight(0xffffff, perspective === 'GLOBE' ? 1.8 : 2.8);
    sunDirLight.position.set(4, 3, 5);
    scene.add(sunDirLight);

    const fillHemi = new THREE.HemisphereLight(
      0xffffff,
      0x475569,
      perspective === 'GLOBE' ? 1.55 : perspective === 'ORBITAL_SYSTEM' ? 1.25 : 0.75,
    );
    scene.add(fillHemi);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.1 };
    const pointer = new THREE.Vector2();

    const onPointerDown = (e: PointerEvent) => {
      dragRef.current = { isDragging: true, lastX: e.clientX, lastY: e.clientY, moved: false };
      cameraCtrlRef.current.targetGlobeRotX = cameraCtrlRef.current.globeRotX;
      cameraCtrlRef.current.targetGlobeRotY = cameraCtrlRef.current.globeRotY;
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();

      if (dragRef.current.isDragging) {
        const dx = e.clientX - dragRef.current.lastX;
        const dy = e.clientY - dragRef.current.lastY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.moved = true;

        const ctrl = cameraCtrlRef.current;
        if (perspective === 'STREET_VIEW') {
          ctrl.streetYaw -= dx * 0.005;
          ctrl.streetPitch = Math.max(-0.18, Math.min(0.85, ctrl.streetPitch + dy * 0.004));
        } else {
          ctrl.targetGlobeRotY += dx * 0.007;
          ctrl.targetGlobeRotX = Math.max(-1.55, Math.min(1.55, ctrl.targetGlobeRotX + dy * 0.008));
        }

        dragRef.current.lastX = e.clientX;
        dragRef.current.lastY = e.clientY;
        setHoverTooltip(null);
        return;
      }

      if (perspective === 'ORBITAL_SYSTEM') {
        const inside =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        if (!inside) {
          setHoveredPathId(null);
          setHoverTooltip(null);
          return;
        }
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);

        const visibleLines = trajectoryLines.filter((l) => l.visible);
        const hits = raycaster.intersectObjects(visibleLines, false);
        if (hits.length > 0) {
          const hitId = hits[0]!.object.userData.pathId as Exclude<TransferFilter, 'ALL'>;
          dom.style.cursor = 'pointer';
          setHoveredPathId(hitId);
          setHoverTooltip({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            pathId: hitId,
          });
        } else {
          dom.style.cursor = 'grab';
          setHoveredPathId(null);
          setHoverTooltip(null);
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const wasClick = dragRef.current.isDragging && !dragRef.current.moved;
      dragRef.current.isDragging = false;
      if (!wasClick || perspective !== 'GLOBE') return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const currentPins = sceneObjectsRef.current.pinMeshes;
      const hitPins = raycaster.intersectObjects(currentPins.map((p) => p.mesh));
      if (hitPins.length > 0) {
        const found = currentPins.find((p) => p.mesh === hitPins[0]!.object);
        if (found) {
          skipAutoFocusRef.current = true;
          onSelectSiteRef.current(found.site);
          return;
        }
      }

      const hitMoon = raycaster.intersectObject(moonMesh);
      if (hitMoon.length > 0) {
        const localPt = globeGroup.worldToLocal(hitMoon[0]!.point.clone()).normalize();
        const latDeg = (Math.asin(Math.max(-1, Math.min(1, localPt.y))) * 180) / Math.PI;
        const lonDeg = (((Math.atan2(localPt.z, -localPt.x) * 180) / Math.PI - 180) % 360 + 360) % 360;
        skipAutoFocusRef.current = true;
        onDropCustomPinRef.current(Number(latDeg.toFixed(2)), Number(lonDeg.toFixed(2)));
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (perspective !== 'STREET_VIEW') {
        cameraCtrlRef.current.targetGlobeZoom = Math.max(
          1.38,
          Math.min(4.4, cameraCtrlRef.current.targetGlobeZoom + e.deltaY * 0.0018),
        );
      }
    };

    const dom = renderer.domElement;
    dom.style.cursor = perspective === 'STREET_VIEW' ? 'move' : 'grab';
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || (compact ? 340 : 680);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    let frameId = 0;
    let lastSync = 0;
    const clock = new THREE.Clock();

    const updateLinePoints = (line: THREE.Line, pts: THREE.Vector3[]) => {
      line.geometry.setFromPoints(pts);
      line.computeLineDistances();
      line.geometry.computeBoundingSphere();
    };

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const ctrl = cameraCtrlRef.current;
      const st = stateRef.current;

      ctrl.globeRotX += (ctrl.targetGlobeRotX - ctrl.globeRotX) * 0.14;
      ctrl.globeRotY += (ctrl.targetGlobeRotY - ctrl.globeRotY) * 0.14;
      ctrl.globeZoom += (ctrl.targetGlobeZoom - ctrl.globeZoom) * 0.14;

      if (perspective === 'GLOBE') {
        globeGroup.rotation.x = ctrl.globeRotX;
        globeGroup.rotation.y = ctrl.globeRotY;
        camera.position.set(0, 0, ctrl.globeZoom);
        camera.lookAt(0, 0, 0);

        const sunAzRad = (st.sunAzimuthDeg * Math.PI) / 180;
        sunDirLight.position.set(Math.sin(sunAzRad) * 6, 0.4, Math.cos(sunAzRad) * 6);

        const activeBeacon = sceneObjectsRef.current.beaconRing;
        if (activeBeacon) {
          const pulse = 1 + 0.18 * Math.sin(t * 4);
          activeBeacon.scale.set(pulse, pulse, 1);
        }
      } else if (perspective === 'STREET_VIEW') {
        camera.position.set(0, 0.22, 0);
        const lookDist = 5;
        const lookX = Math.sin(ctrl.streetYaw) * Math.cos(ctrl.streetPitch) * lookDist;
        const lookY = 0.22 + Math.sin(ctrl.streetPitch) * lookDist;
        const lookZ = -Math.cos(ctrl.streetYaw) * Math.cos(ctrl.streetPitch) * lookDist;
        camera.lookAt(lookX, lookY, lookZ);

        const skyR = 7.2;
        const sAz = (st.sunAzimuthDeg * Math.PI) / 180;
        const sEl = Math.atan(Math.tan((st.sunElevationDeg * Math.PI) / 180) * 2.4);
        const sunPos = new THREE.Vector3(
          Math.sin(sAz) * Math.cos(sEl) * skyR,
          0.22 + Math.sin(sEl) * skyR,
          -Math.cos(sAz) * Math.cos(sEl) * skyR,
        );
        skySun.position.copy(sunPos);
        sunDirLight.position.copy(sunPos);
        sunDirLight.intensity = st.sunVisible ? 2.8 : 0.25;

        const eAz = (st.earthAzimuthDeg * Math.PI) / 180;
        const eEl = Math.atan(Math.tan((st.earthElevationDeg * Math.PI) / 180) * 2.4);
        const earthPos = new THREE.Vector3(
          Math.sin(eAz) * Math.cos(eEl) * skyR,
          0.22 + Math.sin(eEl) * skyR,
          -Math.cos(eAz) * Math.cos(eEl) * skyR,
        );
        skyEarth.position.copy(earthPos);
        skyEarth.rotation.y = t * 0.2;

        if (t - lastSync > 0.06) {
          lastSync = t;
          const w = renderer.domElement.clientWidth || width;
          const h = renderer.domElement.clientHeight || height;
          const sv = sunPos.clone().project(camera);
          const ev = earthPos.clone().project(camera);
          const headingDeg = (((ctrl.streetYaw * 180) / Math.PI) % 360 + 360) % 360;
          setSkyBadges({
            sun: { x: (sv.x * 0.5 + 0.5) * w, y: (-sv.y * 0.5 + 0.5) * h - 22, visible: sv.z < 1 },
            earth: { x: (ev.x * 0.5 + 0.5) * w, y: (-ev.y * 0.5 + 0.5) * h - 26, visible: ev.z < 1 },
            headingDeg,
          });
        }
      } else {
        // ORBITAL_SYSTEM: Every transfer trajectory terminates directly AT the Moon
        const epochMs = Date.parse(st.timeUtc) || 0;
        const elapsedMinutes = epochMs / 60000;
        const activeSt = stationRef.current;
        const filter = transferFilterRef.current;
        const hovered = hoveredPathRef.current;

        // Current Moon position on its orbit ring
        const phaseRad = ((st.sunAzimuthDeg + siteRef.current.coordinates.lonDeg) * Math.PI) / 180;
        const moonPos = new THREE.Vector3(
          Math.cos(phaseRad) * orbitRadius,
          0.11 * Math.sin(phaseRad),
          Math.sin(phaseRad) * orbitRadius,
        );
        orbitingMoon.position.copy(moonPos);
        orbitingMoon.lookAt(0, 0, 0);

        const siteWorldOffset = latLonToVector3(
          siteRef.current.coordinates.latDeg,
          siteRef.current.coordinates.lonDeg,
          0.216,
        );
        siteMarkerOnOrbitMoon.position.copy(siteWorldOffset);

        leoStationIds.forEach((stId, idx) => {
          const spec = SPACE_STATIONS[stId];
          const angle = (elapsedMinutes / spec.periodMinutes) * Math.PI * 2 + t * (0.55 + idx * 0.04);
          const pos = getStationOrbitPoint(spec.sceneRadius, spec.inclinationDeg, angle, spec.raanRad);
          const vis = stationVisuals[stId];
          vis.marker.position.copy(pos);
          const isSelected = activeSt === stId;
          (vis.line.material as THREE.LineBasicMaterial).opacity = isSelected ? 0.95 : 0.24;
          vis.marker.scale.setScalar(isSelected ? 1.35 : 0.85);
        });

        const gwAngle = (elapsedMinutes / SPACE_STATIONS.GATEWAY.periodMinutes) * Math.PI * 2 + t * 0.45;
        const gwLocalPos = new THREE.Vector3(
          0.14 * Math.sin(gwAngle),
          -0.19 + 0.45 * Math.cos(gwAngle),
          0.11 * Math.sin(gwAngle),
        );
        gatewayMarker.position.copy(gwLocalPos);
        (gatewayOrbitLine.material as THREE.LineBasicMaterial).opacity = activeSt === 'GATEWAY' ? 1.0 : 0.45;

        const targetMoonSurfaceWorld = moonPos
          .clone()
          .add(siteWorldOffset.clone().applyQuaternion(orbitingMoon.quaternion));

        trajectoryLines.forEach((line) => {
          const pid = line.userData.pathId as Exclude<TransferFilter, 'ALL'>;
          const mat = line.material as THREE.LineDashedMaterial;
          mat.opacity = hovered ? (hovered === pid ? 1.0 : 0.22) : 0.94;
        });

        if (activeSt === 'GATEWAY') {
          const gwWorldPos = moonPos.clone().add(gwLocalPos);
          tliBurnMarker.position.copy(gwWorldPos);

          const shortPts: THREE.Vector3[] = [];
          const hohPts: THREE.Vector3[] = [];
          for (let i = 0; i <= 48; i++) {
            const u = i / 48;
            const p1 = new THREE.Vector3().lerpVectors(gwWorldPos, targetMoonSurfaceWorld, u);
            p1.x += Math.sin(u * Math.PI) * 0.14;
            shortPts.push(p1);

            const p2 = new THREE.Vector3().lerpVectors(gwWorldPos, targetMoonSurfaceWorld, u);
            p2.z -= Math.sin(u * Math.PI) * 0.24;
            p2.y -= Math.sin(u * Math.PI) * 0.12;
            hohPts.push(p2);
          }
          updateLinePoints(shortestLine, shortPts);
          updateLinePoints(hohmannLine, hohPts);

          shortestLine.visible = filter === 'ALL' || filter === 'SHORTEST';
          hohmannLine.visible = filter === 'ALL' || filter === 'HOHMANN';
          freeReturnLine.visible = false;
          wsbLine.visible = false;

          shortPulse.visible = shortestLine.visible;
          hohPulse.visible = hohmannLine.visible;
          frPulse.visible = false;
          wsbPulse.visible = false;

          if (shortPts.length > 0) shortPulse.position.copy(shortPts[Math.floor(((t * 0.45) % 1) * (shortPts.length - 1))]!);
          if (hohPts.length > 0) hohPulse.position.copy(hohPts[Math.floor(((t * 0.28) % 1) * (hohPts.length - 1))]!);
        } else {
          const spec = SPACE_STATIONS[activeSt];
          const departR = spec.sceneRadius;
          const moonArrivalAngle = phaseRad; // Exact angle of the Moon!

          // 1. SHORTEST DIRECT TLI (3d 5h): 115° fast prograde arc ending AT the Moon (moonPos)
          const shortSweep = (115 * Math.PI) / 180;
          const shortDepartAz = moonArrivalAngle - shortSweep;
          const shortStart3D = getStationPointAtWorldAzimuth(spec, shortDepartAz);
          tliBurnMarker.position.copy(shortStart3D);

          const shortPts: THREE.Vector3[] = [];
          for (let i = 0; i <= 72; i++) {
            const u = i / 72;
            const ang = shortDepartAz + shortSweep * u;
            const ease = Math.sin((Math.PI / 2) * u);
            const r = departR + (orbitRadius - departR) * (ease * ease);
            const y = shortStart3D.y * (1 - u) + moonPos.y * u;
            shortPts.push(new THREE.Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r));
          }
          updateLinePoints(shortestLine, shortPts);

          // 2. HOHMANN MINIMUM-ENERGY (5d 0h): Exact 180° cotangential Keplerian ellipse ending AT the Moon (moonPos)
          const hohSweep = Math.PI;
          const hohDepartAz = moonArrivalAngle - hohSweep;
          const hohStart3D = getStationPointAtWorldAzimuth(spec, hohDepartAz);

          const aHoh = (departR + orbitRadius) / 2;
          const eHoh = (orbitRadius - departR) / (orbitRadius + departR);
          const hohPts: THREE.Vector3[] = [];
          for (let i = 0; i <= 84; i++) {
            const u = i / 84;
            const nu = u * Math.PI; // 0 (perigee on station orbit) -> pi (apogee directly at Moon)
            const ang = hohDepartAz + nu;
            const r = (aHoh * (1 - eHoh * eHoh)) / (1 + eHoh * Math.cos(nu));
            const y = hohStart3D.y * (1 - u) + moonPos.y * (u * u);
            hohPts.push(new THREE.Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r));
          }
          updateLinePoints(hohmannLine, hohPts);

          // 3. CIRCUMLUNAR FREE-RETURN (6d 0h): Loops behind the Moon at u=0.5 (moonArrivalAngle) and returns to Earth
          const frHalfSweep = (155 * Math.PI) / 180;
          const frDepartAz = moonArrivalAngle - frHalfSweep;
          const frStart3D = getStationPointAtWorldAzimuth(spec, frDepartAz);
          const frReturn3D = getStationPointAtWorldAzimuth(spec, moonArrivalAngle + frHalfSweep);

          const frPts: THREE.Vector3[] = [];
          for (let i = 0; i <= 104; i++) {
            const u = i / 104; // u=0.5 passes directly behind the Moon's far side!
            const halfSin = Math.sin(Math.PI * u);
            const r = departR + (orbitRadius + 0.34 - departR) * (halfSin * halfSin);
            const ang =
              frDepartAz +
              frHalfSweep * 2 * u +
              Math.sin(Math.PI * 2 * u) * 0.14;
            const yBase = frStart3D.y * (1 - u) + frReturn3D.y * u;
            const y = yBase + (moonPos.y - yBase) * halfSin;
            frPts.push(new THREE.Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r));
          }
          updateLinePoints(freeReturnLine, frPts);

          // 4. BALLISTIC LUNAR TRANSFER / WSB (95d 0h): Deep cislunar arc out to 1.45x Moon radius, capturing AT the Moon
          const wsbSweep = (235 * Math.PI) / 180;
          const wsbDepartAz = moonArrivalAngle - wsbSweep;
          const wsbStart3D = getStationPointAtWorldAzimuth(spec, wsbDepartAz);

          const wsbPeakR = orbitRadius * 1.45;
          const wsbPts: THREE.Vector3[] = [];
          for (let i = 0; i <= 104; i++) {
            const u = i / 104;
            const ang = wsbDepartAz + wsbSweep * u;
            const r =
              u <= 0.62
                ? departR + (wsbPeakR - departR) * Math.pow(Math.sin(((u / 0.62) * Math.PI) / 2), 2)
                : wsbPeakR + (orbitRadius - wsbPeakR) * Math.pow(Math.sin((((u - 0.62) / 0.38) * Math.PI) / 2), 2);
            const y = wsbStart3D.y * (1 - u) + moonPos.y * u - Math.sin(Math.PI * u) * 0.26;
            wsbPts.push(new THREE.Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r));
          }
          updateLinePoints(wsbLine, wsbPts);

          shortestLine.visible = filter === 'ALL' || filter === 'SHORTEST';
          hohmannLine.visible = filter === 'ALL' || filter === 'HOHMANN';
          freeReturnLine.visible = filter === 'ALL' || filter === 'FREE_RETURN';
          wsbLine.visible = filter === 'ALL' || filter === 'WSB';

          shortPulse.visible = shortestLine.visible;
          hohPulse.visible = hohmannLine.visible;
          frPulse.visible = freeReturnLine.visible;
          wsbPulse.visible = wsbLine.visible;

          shortPulse.position.copy(shortPts[Math.floor(((t * 0.36) % 1) * (shortPts.length - 1))]!);
          hohPulse.position.copy(hohPts[Math.floor(((t * 0.25) % 1) * (hohPts.length - 1))]!);
          frPulse.position.copy(frPts[Math.floor(((t * 0.21) % 1) * (frPts.length - 1))]!);
          wsbPulse.position.copy(wsbPts[Math.floor(((t * 0.14) % 1) * (wsbPts.length - 1))]!);
        }

        centralEarth.rotation.y = t * 0.25;
        sunDirLight.position.set(8, 1.5, 0);

        const camDist = ctrl.globeZoom * 2.15;
        camera.position.set(
          camDist * Math.sin(ctrl.globeRotY) * Math.cos(ctrl.globeRotX * 0.5),
          camDist * Math.max(0.28, Math.sin(ctrl.globeRotX * 0.7)),
          camDist * Math.cos(ctrl.globeRotY) * Math.cos(ctrl.globeRotX * 0.5),
        );
        camera.lookAt(0, 0, 0);
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      sceneObjectsRef.current.pinsGroup = null;
      sceneObjectsRef.current.surfaceTerrain = null;
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perspective, compact]);

  const activeStationSpec = SPACE_STATIONS[selectedStation];
  const hoveredSolution = hoverTooltip
    ? transferSolutions.find((s) => s.id === hoverTooltip.pathId) ?? null
    : null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* ASU Quickmap Link Overlay */}
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 15, display: 'flex', gap: 6 }}>
        <a
          href={`https://quickmap.lroc.asu.edu/?lat=${selectedSite.coordinates.latDeg}&lon=${selectedSite.coordinates.lonDeg}&zoom=9`}
          target="_blank"
          rel="noreferrer"
          style={{
            background: 'rgba(15, 23, 42, 0.9)',
            color: '#38bdf8',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: '4px 9px',
            fontSize: 10,
            fontWeight: 800,
            textDecoration: 'none',
          }}
        >
          🔍 Quickmap ↗
        </a>
      </div>

      {/* STREET VIEW OVERLAY */}
      {perspective === 'STREET_VIEW' && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              top: compact ? 10 : 104,
              left: compact ? 10 : '50%',
              transform: compact ? 'none' : 'translateX(-50%)',
              background: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid #334155',
              borderRadius: 20,
              padding: compact ? '4px 10px' : '4px 14px',
              fontSize: compact ? 10 : 11,
              fontWeight: 800,
              color: '#38bdf8',
            }}
          >
            🧭 {Math.round(skyBadges.headingDeg)}° {compact ? '' : '· Drag to look 360° around horizon'}
          </div>

          {skyBadges.sun.visible && (
            <div
              style={{
                position: 'absolute',
                left: skyBadges.sun.x,
                top: skyBadges.sun.y,
                transform: 'translate(-50%, -50%)',
                background: 'rgba(15, 23, 42, 0.9)',
                border: `1px solid ${currentState.sunVisible ? '#facc15' : '#ef4444'}`,
                color: currentState.sunVisible ? '#fde047' : '#fca5a5',
                padding: '2px 8px',
                borderRadius: 5,
                fontSize: 10.5,
                fontWeight: 800,
                whiteSpace: 'nowrap',
              }}
            >
              ☀ SUN ({currentState.sunElevationDeg.toFixed(1)}°) {currentState.sunVisible ? '' : '[HIDDEN]'}
            </div>
          )}

          {skyBadges.earth.visible && (
            <div
              style={{
                position: 'absolute',
                left: skyBadges.earth.x,
                top: skyBadges.earth.y,
                transform: 'translate(-50%, -50%)',
                background: 'rgba(15, 23, 42, 0.9)',
                border: `1px solid ${currentState.earthVisible ? '#38bdf8' : '#f43f5e'}`,
                color: currentState.earthVisible ? '#7dd3fc' : '#fda4af',
                padding: '2px 8px',
                borderRadius: 5,
                fontSize: 10.5,
                fontWeight: 800,
                whiteSpace: 'nowrap',
              }}
            >
              🌍 EARTH ({currentState.earthElevationDeg.toFixed(1)}°)
            </div>
          )}
        </div>
      )}

      {/* ORBITAL SYSTEM: Hover Tooltip + Clean Collapsible Trajectory HUD */}
      {perspective === 'ORBITAL_SYSTEM' && (
        <>
          {hoverTooltip && hoveredSolution && (
            <div
              style={{
                position: 'absolute',
                left: Math.min(hoverTooltip.x + 14, (mountRef.current?.clientWidth || 600) - 245),
                top: Math.max(12, hoverTooltip.y - 12),
                zIndex: 25,
                width: 232,
                pointerEvents: 'none',
                background: 'rgba(6, 10, 20, 0.95)',
                backdropFilter: 'blur(10px)',
                border: `1px solid ${hoveredSolution.colorCss}`,
                borderRadius: 10,
                padding: '8px 10px',
                boxShadow: '0 10px 26px rgba(0,0,0,0.8)',
                color: '#f8fafc',
                fontSize: 10.5,
              }}
            >
              <div style={{ fontWeight: 800, color: hoveredSolution.colorCss, marginBottom: 4 }}>
                ┄ {hoveredSolution.label}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ color: '#94a3b8' }}>Time Taken:</span>
                <strong style={{ color: '#4ade80' }}>{hoveredSolution.durationLabel}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ color: '#94a3b8' }}>Depart:</span>
                <strong>{hoveredSolution.departureUtcLabel}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ color: '#94a3b8' }}>Arrive Moon:</span>
                <strong style={{ color: '#facc15' }}>{hoveredSolution.arrivalUtcLabel}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>Total Δv:</span>
                <strong>{hoveredSolution.totalDeltaVKms} km/s</strong>
              </div>
            </div>
          )}

          <div
            style={{
              position: 'absolute',
              left: compact ? 8 : 56,
              bottom: compact ? 8 : 96,
              zIndex: 16,
              width: hudExpanded ? (compact ? 268 : 316) : 'auto',
              background: 'rgba(9, 15, 29, 0.92)',
              backdropFilter: 'blur(10px)',
              border: '1px solid #334155',
              borderRadius: 12,
              padding: hudExpanded ? '8px 10px' : '6px 11px',
              color: '#f8fafc',
              boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={() => setHudExpanded((v) => !v)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#f8fafc',
                  padding: 0,
                  fontSize: 10.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ color: activeStationSpec.colorCss }}>🛰️ {activeStationSpec.shortLabel}</span>
                <span style={{ color: '#94a3b8' }}>→</span>
                <span style={{ color: '#facc15' }}>{selectedSite.name.split('(')[0]!.trim()}</span>
                <span style={{ color: '#38bdf8', marginLeft: 2 }}>{hudExpanded ? '▼' : '▲'}</span>
              </button>

              {!hudExpanded && (
                <span style={{ fontSize: 9.5, color: '#94a3b8' }}>
                  Hover paths for dates
                </span>
              )}
            </div>

            {hudExpanded && (
              <div style={{ marginTop: 7 }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                  {(Object.keys(SPACE_STATIONS) as StationId[]).map((stId) => {
                    const st = SPACE_STATIONS[stId];
                    const active = selectedStation === stId;
                    return (
                      <button
                        key={stId}
                        type="button"
                        onClick={() => {
                          setSelectedStation(stId);
                          if (stId === 'GATEWAY' && (transferFilter === 'FREE_RETURN' || transferFilter === 'WSB')) {
                            setTransferFilter('ALL');
                          }
                        }}
                        style={{
                          background: active ? st.colorCss : '#1e293b',
                          color: active ? '#060a14' : '#cbd5e1',
                          border: `1px solid ${active ? '#fff' : '#334155'}`,
                          borderRadius: 5,
                          padding: '2px 6px',
                          fontSize: 9.5,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        {st.shortLabel}
                      </button>
                    );
                  })}
                </div>

                <div
                  style={{
                    background: '#060a14',
                    border: '1px solid #1e293b',
                    borderRadius: 7,
                    padding: '4px 7px',
                    fontSize: 10,
                    color: '#cbd5e1',
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 6,
                  }}
                >
                  <strong style={{ color: activeStationSpec.colorCss }}>{activeStationSpec.name}</strong>
                  <span>
                    {activeStationSpec.altitudeKm}km · {activeStationSpec.inclinationDeg}°
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                  {(
                    [
                      { id: 'ALL', label: 'All' },
                      { id: 'SHORTEST', label: 'Shortest' },
                      { id: 'HOHMANN', label: 'Hohmann' },
                      ...(selectedStation !== 'GATEWAY'
                        ? [
                            { id: 'FREE_RETURN', label: 'Free-Return' },
                            { id: 'WSB', label: 'WSB' },
                          ]
                        : []),
                    ] as { id: TransferFilter; label: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setTransferFilter(opt.id)}
                      style={{
                        background: transferFilter === opt.id ? '#0284c7' : '#1e293b',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 5,
                        padding: '2px 6px',
                        fontSize: 9.5,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'grid', gap: 4, maxHeight: compact ? 92 : 148, overflowY: 'auto' }}>
                  {transferSolutions
                    .filter((sol) => transferFilter === 'ALL' || transferFilter === sol.id)
                    .map((sol) => (
                      <div
                        key={sol.id}
                        onMouseEnter={() => setHoveredPathId(sol.id)}
                        onMouseLeave={() => setHoveredPathId(null)}
                        style={{
                          background: hoveredPathId === sol.id ? '#0f172a' : '#060a14',
                          borderLeft: `3px solid ${sol.colorCss}`,
                          borderRadius: 6,
                          padding: '4px 7px',
                          fontSize: 9.5,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                          <span style={{ color: sol.colorCss }}>┄ {sol.label}</span>
                          <span style={{ color: '#f8fafc', fontVariantNumeric: 'tabular-nums' }}>
                            {sol.durationLabel} · Δv {sol.totalDeltaVKms}
                          </span>
                        </div>
                        <div style={{ color: '#94a3b8', marginTop: 2 }}>
                          Arrive: <strong style={{ color: '#fde047' }}>{sol.arrivalUtcLabel}</strong>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}