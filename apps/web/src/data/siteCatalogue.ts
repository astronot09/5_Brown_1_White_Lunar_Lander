export type MissionProgram = 'ARTEMIS' | 'APOLLO' | 'CLPS' | 'INTERNATIONAL' | 'CSA';

export interface CuratedLunarSite {
  siteId: string;
  name: string;
  program: MissionProgram;
  coordinates: {
    latDeg: number;
    lonDeg: number;
    elevationM: number;
  };
  slopeDeg: number;
  isPsr?: boolean;
  defaultPanelPreset: 'HORIZONTAL' | 'VERTICAL_TRACKING' | 'TWO_AXIS' | 'WEST_FACING' | 'TIPPED_30';
  landingTimeUtc?: string;
  demSource: string;
  provenanceNote: string;
  azimuthStepDeg: number;
  horizonMaskDeg: number[];
}

function generateProceduralMask(latDeg: number, lonDeg: number, seedOffset: number, isPsr = false): number[] {
  const mask: number[] = [];
  const isPolar = Math.abs(latDeg) > 78;
  const baseRidge = isPsr ? 11.5 : isPolar ? 2.4 : 0.8;
  const amplitude = isPsr ? 4.5 : isPolar ? 2.8 : 1.4;

  for (let az = 0; az < 360; az++) {
    const rad = ((az + seedOffset) * Math.PI) / 180;
    const ridge =
      baseRidge +
      Math.sin(rad * 2 + lonDeg * 0.05) * amplitude * 0.65 +
      Math.cos(rad * 5 - latDeg * 0.08) * amplitude * 0.35 +
      Math.sin(rad * 11 + seedOffset) * 0.45;
    mask.push(Number(Math.max(-0.2, ridge).toFixed(2)));
  }
  return mask;
}

export const CURATED_SITES: CuratedLunarSite[] = [
  {
    siteId: 'csa_rover_south_pole',
    name: 'CSA Lunar Rover Prospector (Leibnitz Beta)',
    program: 'CSA',
    coordinates: { latDeg: -84.42, lonDeg: 31.25, elevationM: 2850 },
    slopeDeg: 4.2,
    defaultPanelPreset: 'VERTICAL_TRACKING',
    demSource: 'CSA Moon Exploration Portal + LOLA 5 m[cite: 9, 21]',
    provenanceNote: 'Canadian Space Agency water-ice prospecting rover target; optimized for grazing solar illumination and teleoperation DTE windows[cite: 9, 21].',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(-84.42, 31.25, 30, false),
  },
  {
    siteId: 'shackleton_rim_01',
    name: 'Shackleton Crater Rim (Artemis IV)',
    program: 'ARTEMIS',
    coordinates: { latDeg: -89.54, lonDeg: 129.78, elevationM: 1980 },
    slopeDeg: 4.8,
    defaultPanelPreset: 'VERTICAL_TRACKING',
    demSource: 'LOLA PGDA Product 78 (5 m DEM)[cite: 9, 21]',
    provenanceNote: 'Artemis IV candidate region; high-illumination rim crest overlooking Shackleton PSR[cite: 8].',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(-89.54, 129.78, 15, false),
  },
  {
    siteId: 'malapert_massif_01',
    name: 'Malapert Massif Peak (Artemis IV)',
    program: 'ARTEMIS',
    coordinates: { latDeg: -85.98, lonDeg: -1.35, elevationM: 4820 },
    slopeDeg: 6.2,
    defaultPanelPreset: 'VERTICAL_TRACKING',
    demSource: 'LOLA PGDA Product 90 (20 m DEM)[cite: 9, 21]',
    provenanceNote: 'Prominent south-polar massif with unobstructed near-side Earth DTE geometry[cite: 8].',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(-85.98, -1.35, 65, false),
  },
  {
    siteId: 'im1_odysseus',
    name: 'IM-1 Odysseus (Malapert A)',
    program: 'CLPS',
    coordinates: { latDeg: -80.13, lonDeg: 1.44, elevationM: 1120 },
    slopeDeg: 12.0,
    defaultPanelPreset: 'TIPPED_30',
    landingTimeUtc: '2024-02-22T23:23:53Z',
    demSource: 'LROC NAC + LOLA 5 m Tile[cite: 9, 21]',
    provenanceNote: 'Primary terrain & 30° tipped-attitude validation test; lost power ~3 days before smooth-sphere sunset[cite: 8, 14].',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(-80.13, 1.44, 145, false),
  },
  {
    siteId: 'apollo_11',
    name: 'Apollo 11 (Mare Tranquillitatis)',
    program: 'APOLLO',
    coordinates: { latDeg: 0.67416, lonDeg: 23.47314, elevationM: -1890 },
    slopeDeg: 1.8,
    defaultPanelPreset: 'HORIZONTAL',
    landingTimeUtc: '1969-07-20T20:17:40Z',
    demSource: 'LROC / NSSDC Registered[cite: 9, 14, 21]',
    provenanceNote: 'Positive near-side control; touchdown solar elevation 10.70°, Earth continuously high[cite: 14, 17].',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(0.67416, 23.47314, 10, false),
  },
  {
    siteId: 'change_4_farside',
    name: "Chang'e 4 (Von Kármán Far Side)",
    program: 'INTERNATIONAL',
    coordinates: { latDeg: -45.4446, lonDeg: 177.5991, elevationM: -5920 },
    slopeDeg: 2.3,
    defaultPanelPreset: 'HORIZONTAL',
    landingTimeUtc: '2019-01-03T02:26:00Z',
    demSource: 'CNSA / LROC (2020)[cite: 9, 17, 21]',
    provenanceNote: 'Mandatory Negative Control #1: Far-side basin; Earth max elevation -37.4° (Relay Required)[cite: 15, 17].',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(-45.4446, 177.5991, 160, false),
  },
];

export function buildCustomSite(latDeg: number, lonDeg: number, elevationM = 0, label?: string): CuratedLunarSite {
  const clampedLat = Math.max(-90, Math.min(90, latDeg));
  const normLon = ((lonDeg % 360) + 360) % 360;
  return {
    siteId: `custom_${clampedLat.toFixed(2)}_${normLon.toFixed(2)}`,
    name: label || `Custom Pin (${clampedLat.toFixed(2)}°, ${normLon > 180 ? (normLon - 360).toFixed(2) : normLon.toFixed(2)}°)`,
    program: 'ARTEMIS',
    coordinates: { latDeg: clampedLat, lonDeg: normLon, elevationM },
    slopeDeg: Math.abs(clampedLat) > 80 ? 6.5 : 3.2,
    defaultPanelPreset: Math.abs(clampedLat) > 70 ? 'VERTICAL_TRACKING' : 'HORIZONTAL',
    demSource: 'Moon Trek Global LOLA/SLDEM2015 Synthesis[cite: 9, 21]',
    provenanceNote: 'User-selected custom lunar coordinates in MEAN_ME frame[cite: 8, 9].',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(clampedLat, normLon, Math.round(Math.abs(clampedLat * 7 + normLon)), false),
  };
}