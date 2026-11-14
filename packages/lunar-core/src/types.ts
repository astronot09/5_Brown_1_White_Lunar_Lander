/**
 * Public data contracts for the browser-side lunar visibility engine.
 *
 * All angular quantities are degrees, distances are kilometres, altitudes are
 * metres, and timestamps are ISO-8601 UTC strings (normally ending in `Z`).
 */

export type LunarReferenceFrame = "MEAN_ME";
export type ApparentCorrectionModel = "LT+S";

export interface Vector3Km {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A geocentric (Moon-centred), apparent target state in the lunar MEAN_ME frame. */
export interface EphemerisVectorSample {
  readonly timestamp: string;
  readonly frame: LunarReferenceFrame;
  /** Light-time and stellar-aberration corrected apparent positions. */
  readonly correctionModel: ApparentCorrectionModel;
  /** Vector from the Moon's centre to the Sun's centre, in km. */
  readonly sunPositionKm: Vector3Km;
  /** Vector from the Moon's centre to the Earth's centre, in km. */
  readonly earthPositionKm: Vector3Km;
  /** Optional velocities used for cubic-Hermite interpolation, in km/s. */
  readonly sunVelocityKmPerSecond?: Vector3Km;
  readonly earthVelocityKmPerSecond?: Vector3Km;
}

/**
 * Site-specific terrain skyline. `horizonElevationDeg[i]` is the skyline
 * elevation at azimuth `i * horizonAzimuthStepDeg`, clockwise from local north.
 * Samples must cover a full 360 degrees uniformly.
 */
export interface SiteHorizonProfile {
  readonly siteId: string;
  readonly name: string;
  readonly latitudeDeg: number;
  /** East-positive selenographic longitude. */
  readonly longitudeDeg: number;
  /** Height above the reference lunar radius, in metres. */
  readonly siteElevationM: number;
  /** Optional antenna/panel mast height above the site, in metres. */
  readonly mastHeightM?: number;
  readonly horizonAzimuthStepDeg: number;
  readonly horizonElevationDeg: readonly number[];
  /**
   * Reference meridian for local north at an exact pole. The project convention
   * is 0 degrees by default, including at the lunar south pole.
   */
  readonly northReferenceLongitudeDeg?: number;
}

export interface EphemerisDirection {
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
  readonly angularRadiusDeg: number;
  /** Topocentric observer-to-target-centre distance. */
  readonly distanceKm: number;
}

/** Topocentric Sun and Earth directions for one site and one UTC instant. */
export interface EphemerisPoint {
  readonly timestamp: string;
  readonly frame: LunarReferenceFrame;
  readonly correctionModel: ApparentCorrectionModel;
  readonly sun: EphemerisDirection;
  readonly earth: EphemerisDirection;
}

export type VisibilityEventKind =
  | "SUN_ILLUMINATION"
  | "SUN_SHADOW"
  | "EARTH_COMMS";

export interface VisibilityState {
  readonly timestamp: string;
  readonly sunHorizonElevationDeg: number;
  readonly earthHorizonElevationDeg: number;
  /** Geometric fraction of the solar disc above the local terrain skyline. */
  readonly sunVisibleFraction: number;
  /** Geometric fraction of Earth's apparent disc above the local skyline. */
  readonly earthVisibleFraction: number;
  /** Direct-normal solar irradiance after terrain occultation; not panel output. */
  readonly solarIrradianceWm2: number;
  /** Positive when any part of the solar disc clears terrain. */
  readonly sunLimbClearanceDeg: number;
  /** Positive when the full Earth disc clears terrain plus the comms margin. */
  readonly earthCommsClearanceDeg: number;
  readonly sunIlluminated: boolean;
  readonly inShadow: boolean;
  readonly earthCommsAvailable: boolean;
  readonly activeEvents: readonly VisibilityEventKind[];
}

export interface VisibilityWindow {
  readonly kind: VisibilityEventKind;
  readonly startTimeUtc: string;
  readonly endTimeUtc: string;
  readonly durationSeconds: number;
  /** True when the window was already active at the first input sample. */
  readonly clippedAtStart: boolean;
  /** True when the window was still active at the final input sample. */
  readonly clippedAtEnd: boolean;
}

/** The part of a Horizons row needed for a direction-validation comparison. */
export interface HorizonsDirection {
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
}

/**
 * A reference row can contain Sun, Earth, or both. The supplied cache files
 * contain separate target queries, so requiring both on every row would be
 * unnecessarily restrictive.
 */
export interface HorizonsReferencePoint {
  readonly timestamp: string;
  readonly sun?: HorizonsDirection;
  readonly earth?: HorizonsDirection;
}

export interface HorizonsAngularComparison {
  readonly timestamp: string;
  readonly body: "SUN" | "EARTH";
  readonly angularErrorDeg: number;
  readonly withinTolerance: boolean;
}

export interface ValidationGateResult {
  readonly passed: boolean;
  readonly toleranceDeg: number;
  readonly sampleCount: number;
  readonly comparedBodyCount: number;
  readonly maxAngularErrorDeg: number;
  readonly meanAngularErrorDeg: number;
  readonly comparisons: readonly HorizonsAngularComparison[];
  readonly failedComparisons: readonly HorizonsAngularComparison[];
  readonly missingReferenceTimestamps: readonly string[];
}

export interface VisibilityOptions {
  /** Solar irradiance at 1 AU; default 1361 W/m². */
  readonly solarConstantWm2?: number;
  /** Earth-disc clearance margin above terrain; default 1 degree. */
  readonly earthCommsMarginDeg?: number;
}

export interface VisibilityAnalysis {
  readonly states: readonly VisibilityState[];
  readonly windows: readonly VisibilityWindow[];
}
