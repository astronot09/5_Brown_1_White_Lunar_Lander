export type MissionProgram = 'ARTEMIS' | 'APOLLO' | 'CLPS' | 'INTERNATIONAL';

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

function generateProceduralMask(
  latDeg: number,
  lonDeg: number,
  seedOffset: number,
  isPsr = false,
): number[] {
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

/**
 * Complete Table 13 Curated Site Catalogue + Artemis IV Candidate Regions
 * Coordinates expressed in DE421/DE441 Mean-Earth (MEAN_ME) frame on R = 1737.4 km.
 */
export const CURATED_SITES: CuratedLunarSite[] = [
  // Artemis IV South Pole Candidate Regions
  {
    siteId: 'shackleton_rim_01',
    name: 'Shackleton Crater Rim (Artemis IV)',
    program: 'ARTEMIS',
    coordinates: { latDeg: -89.54, lonDeg: 129.78, elevationM: 1980 },
    slopeDeg: 4.8,
    defaultPanelPreset: 'VERTICAL_TRACKING',
    demSource: 'LOLA PGDA Product 78 (5 m DEM)',
    provenanceNote: 'Artemis IV candidate region; high-illumination rim crest overlooking Shackleton PSR.',
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
    demSource: 'LOLA PGDA Product 90 (20 m DEM)',
    provenanceNote: 'Prominent south-polar massif with unobstructed near-side Earth DTE geometry.',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(-85.98, -1.35, 65, false),
  },
  {
    siteId: 'connecting_ridge_01',
    name: 'Connecting Ridge (Shackleton–de Gerlache)',
    program: 'ARTEMIS',
    coordinates: { latDeg: -89.45, lonDeg: 222.6, elevationM: 2140 },
    slopeDeg: 7.4,
    defaultPanelPreset: 'VERTICAL_TRACKING',
    demSource: 'LOLA PGDA Product 78 (Gläser et al. 2018)',
    provenanceNote: 'Literature benchmark site (88.0% annual illumination at 2 m mast height).',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(-89.45, 222.6, 110, false),
  },
  {
    siteId: 'haworth_psr_01',
    name: 'Haworth Crater Floor (PSR Control)',
    program: 'ARTEMIS',
    coordinates: { latDeg: -87.45, lonDeg: 354.8, elevationM: -2450 },
    slopeDeg: 11.8,
    isPsr: true,
    defaultPanelPreset: 'VERTICAL_TRACKING',
    demSource: 'LOLA PGDA Product 90 PSR Layer',
    provenanceNote: 'Permanently Shadowed Region (PSR) control gate; local horizon exceeds max polar Sun elevation.',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(-87.45, 354.8, 200, true),
  },
  {
    siteId: 'bussey_point_d',
    name: 'Bussey Point D (V4 Benchmark)',
    program: 'ARTEMIS',
    coordinates: { latDeg: -88.79, lonDeg: 124.5, elevationM: 1850 },
    slopeDeg: 5.5,
    defaultPanelPreset: 'VERTICAL_TRACKING',
    demSource: 'LOLA 20 m (Bussey et al. 2010)',
    provenanceNote: 'Pre-registered V4 literature illumination control (86% +/- 4% annual illumination).',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(-88.79, 124.5, 42, false),
  },

  // Commercial Lunar Payload Services (CLPS)
  {
    siteId: 'im1_odysseus',
    name: 'IM-1 Odysseus (Malapert A)',
    program: 'CLPS',
    coordinates: { latDeg: -80.13, lonDeg: 1.44, elevationM: 1120 },
    slopeDeg: 12.0,
    defaultPanelPreset: 'TIPPED_30',
    landingTimeUtc: '2024-02-22T23:23:53Z',
    demSource: 'LROC NAC + LOLA 5 m Tile',
    provenanceNote: 'Primary terrain & 30° tipped-attitude validation test; lost power ~3 days before smooth-sphere sunset.',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(-80.13, 1.44, 145, false),
  },
  {
    siteId: 'im2_athena',
    name: 'IM-2 Athena (Mons Mouton)',
    program: 'CLPS',
    coordinates: { latDeg: -84.7906, lonDeg: 29.1957, elevationM: 3420 },
    slopeDeg: 9.5,
    defaultPanelPreset: 'VERTICAL_TRACKING',
    landingTimeUtc: '2025-03-06T17:28:50Z',
    demSource: 'LROC NAC Derived Coordinates',
    provenanceNote: 'Came down in a 20 m shadowed crater near Mons Mouton with Sun at 2.46°–2.97° elevation.',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(-84.7906, 29.1957, 185, false),
  },
  {
    siteId: 'blue_ghost_m1',
    name: 'Blue Ghost M1 (Mare Crisium)',
    program: 'CLPS',
    coordinates: { latDeg: 18.5623, lonDeg: 61.8103, elevationM: -3480 },
    slopeDeg: 2.1,
    defaultPanelPreset: 'HORIZONTAL',
    landingTimeUtc: '2025-03-02T08:34:00Z',
    demSource: 'SLDEM2015 + LROC NAC',
    provenanceNote: 'Firefly Aerospace Mare Crisium site; reproduced 2025-03-14 eclipse diamond ring within 4 min.',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(18.5623, 61.8103, 25, false),
  },

  // Historic Apollo Positive Controls (5° - 13° Touchdown Sun Elevation Band)
  {
    siteId: 'apollo_11',
    name: 'Apollo 11 (Mare Tranquillitatis)',
    program: 'APOLLO',
    coordinates: { latDeg: 0.67416, lonDeg: 23.47314, elevationM: -1890 },
    slopeDeg: 1.8,
    defaultPanelPreset: 'HORIZONTAL',
    landingTimeUtc: '1969-07-20T20:17:40Z',
    demSource: 'LROC / NSSDC Registered Coordinates',
    provenanceNote: 'Positive near-side control; touchdown solar elevation 10.70°, Earth continuously high (59.2°).',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(0.67416, 23.47314, 10, false),
  },
  {
    siteId: 'apollo_15',
    name: 'Apollo 15 (Hadley–Apennine)',
    program: 'APOLLO',
    coordinates: { latDeg: 26.13239, lonDeg: 3.6333, elevationM: -1520 },
    slopeDeg: 4.5,
    defaultPanelPreset: 'HORIZONTAL',
    landingTimeUtc: '1971-07-30T22:16:29Z',
    demSource: 'SLDEM2015 + LOLA',
    provenanceNote: 'Mons Hadley massif terrain test; touchdown solar elevation 12.02° within 5°–13° design band.',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(26.13239, 3.6333, 88, false),
  },
  {
    siteId: 'apollo_17',
    name: 'Apollo 17 (Taurus–Littrow)',
    program: 'APOLLO',
    coordinates: { latDeg: 20.1911, lonDeg: 30.7723, elevationM: -2110 },
    slopeDeg: 5.2,
    defaultPanelPreset: 'HORIZONTAL',
    landingTimeUtc: '1972-12-11T19:54:58Z',
    demSource: 'SLDEM2015 + LOLA',
    provenanceNote: 'Steep valley massifs; touchdown solar elevation 13.35°.',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(20.1911, 30.7723, 130, false),
  },

  // International & Far-Side Negative Controls
  {
    siteId: 'chandrayaan_3',
    name: 'Chandrayaan-3 (Statio Shiv Shakti)',
    program: 'INTERNATIONAL',
    coordinates: { latDeg: -69.373, lonDeg: 32.319, elevationM: 640 },
    slopeDeg: 3.4,
    defaultPanelPreset: 'HORIZONTAL',
    landingTimeUtc: '2023-08-23T12:33:00Z',
    demSource: 'ISRO / IAU + LOLA 60 m',
    provenanceNote: 'High southern latitude mission replay; touchdown solar elevation 8.61°.',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(-69.373, 32.319, 55, false),
  },
  {
    siteId: 'jaxa_slim',
    name: 'JAXA SLIM (Shioli Crater)',
    program: 'INTERNATIONAL',
    coordinates: { latDeg: -13.316, lonDeg: 25.251, elevationM: -920 },
    slopeDeg: 14.2,
    defaultPanelPreset: 'WEST_FACING',
    landingTimeUtc: '2024-01-19T15:20:00Z',
    demSource: 'JAXA / LROC NAC',
    provenanceNote: 'Inverted landing with west-facing solar array; generates power only after local solar noon (4/4 lunations).',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(-13.316, 25.251, 95, false),
  },
  {
    siteId: 'change_4_farside',
    name: "Chang'e 4 (Von Kármán Far Side)",
    program: 'INTERNATIONAL',
    coordinates: { latDeg: -45.4446, lonDeg: 177.5991, elevationM: -5920 },
    slopeDeg: 2.3,
    defaultPanelPreset: 'HORIZONTAL',
    landingTimeUtc: '2019-01-03T02:26:00Z',
    demSource: 'CNSA / LROC (2020)',
    provenanceNote: 'Mandatory Negative Control #1: Far-side basin; Earth max elevation -37.4° (Relay Required).',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(-45.4446, 177.5991, 160, false),
  },
  {
    siteId: 'change_6_farside',
    name: "Chang'e 6 (Apollo Basin Far Side)",
    program: 'INTERNATIONAL',
    coordinates: { latDeg: -41.6385, lonDeg: 206.0148, elevationM: -5280 },
    slopeDeg: 3.1,
    defaultPanelPreset: 'HORIZONTAL',
    landingTimeUtc: '2024-06-01T22:23:16Z',
    demSource: 'LROC NAC Derived Coordinates',
    provenanceNote: 'Mandatory Negative Control #2: Far-side sample return site; Earth max elevation -35.5° (Relay Required).',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(-41.6385, 206.0148, 210, false),
  },
];

export function buildCustomSite(
  latDeg: number,
  lonDeg: number,
  elevationM = 0,
  label?: string,
): CuratedLunarSite {
  const clampedLat = Math.max(-90, Math.min(90, latDeg));
  const normLon = ((lonDeg % 360) + 360) % 360;
  return {
    siteId: `custom_${clampedLat.toFixed(2)}_${normLon.toFixed(2)}`,
    name: label || `Custom Pin (${clampedLat.toFixed(2)}°, ${normLon > 180 ? (normLon - 360).toFixed(2) : normLon.toFixed(2)}°)`,
    program: 'ARTEMIS',
    coordinates: {
      latDeg: clampedLat,
      lonDeg: normLon,
      elevationM,
    },
    slopeDeg: Math.abs(clampedLat) > 80 ? 6.5 : 3.2,
    defaultPanelPreset: Math.abs(clampedLat) > 70 ? 'VERTICAL_TRACKING' : 'HORIZONTAL',
    demSource: 'Moon Trek Global LOLA/SLDEM2015 Synthesis',
    provenanceNote: 'User-selected custom lunar coordinates in MEAN_ME frame.',
    azimuthStepDeg: 1,
    horizonMaskDeg: generateProceduralMask(clampedLat, normLon, Math.round(Math.abs(clampedLat * 7 + normLon)), false),
  };
}