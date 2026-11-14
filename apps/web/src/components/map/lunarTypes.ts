/** Shared browser-side contracts for the static lunar data products. */
export interface LunarCoordinates {
  latDeg: number;
  lonDeg: number;
  elevationM?: number;
}

export interface LunarSite {
  siteId: string;
  name: string;
  coordinates: LunarCoordinates;
  demSource?: string;
  azimuthStepDeg?: number;
  horizonMaskDeg?: number[];
  horizonMaskP5Deg?: number[];
  horizonMaskP95Deg?: number[];
  generatedAtUtc?: string;
  inputSha256?: string;
}

export interface SkyPosition {
  azimuthDeg: number;
  elevationDeg: number;
  /** Optional apparent angular radius supplied by the ephemeris engine. */
  angularRadiusDeg?: number;
}

/**
 * A single evaluated instant. The shape is deliberately local to the web app
 * until lunar-core publishes its stable public contract.
 */
export interface VisibilityState {
  timeUtc: string;
  solarIrradianceWm2: number;
  sunlitFraction: number;
  earthClearanceDeg: number;
  sunVisible: boolean;
  earthVisible: boolean;
  sunAzimuthDeg?: number;
  sunElevationDeg?: number;
  earthAzimuthDeg?: number;
  earthElevationDeg?: number;
  powerIndex?: number;
  operationsWindow?: boolean;
}

export interface SiteIndexEntry {
  siteId: string;
  name: string;
}
