import type { SiteHorizonProfile, Vector3Km } from "./types.js";

export const MOON_MEAN_RADIUS_KM = 1737.4;
export const SUN_MEAN_RADIUS_KM = 695700.0;
export const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;
export const ASTRONOMICAL_UNIT_KM = 149597870.7;
export const SOLAR_CONSTANT_WM2 = 1361.0;

export interface LocalLunarFrame {
  readonly up: Vector3Km;
  readonly east: Vector3Km;
  readonly north: Vector3Km;
  readonly sitePositionKm: Vector3Km;
}

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normaliseAzimuthDeg(azimuthDeg: number): number {
  return ((azimuthDeg % 360) + 360) % 360;
}

export function parseUtcTimestamp(timestamp: string): number {
  if (typeof timestamp !== "string" || !/(Z|[+-]\d{2}:?\d{2})$/i.test(timestamp)) {
    throw new TypeError(`Timestamp must include a UTC designator or explicit offset: ${String(timestamp)}`);
  }

  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`Invalid timestamp: ${timestamp}`);
  }
  return milliseconds;
}

export function toUtcIsoString(timestamp: string): string {
  return new Date(parseUtcTimestamp(timestamp)).toISOString();
}

export function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

export function validateSiteHorizonProfile(profile: SiteHorizonProfile): void {
  if (!profile || typeof profile !== "object") {
    throw new TypeError("A site horizon profile is required");
  }
  if (!profile.siteId || !profile.name) {
    throw new TypeError("Site horizon profile must include siteId and name");
  }

  assertFiniteNumber(profile.latitudeDeg, "latitudeDeg");
  assertFiniteNumber(profile.longitudeDeg, "longitudeDeg");
  assertFiniteNumber(profile.siteElevationM, "siteElevationM");
  assertFiniteNumber(profile.horizonAzimuthStepDeg, "horizonAzimuthStepDeg");

  if (profile.latitudeDeg < -90 || profile.latitudeDeg > 90) {
    throw new RangeError("latitudeDeg must be between -90 and +90 degrees");
  }
  if (profile.longitudeDeg < -360 || profile.longitudeDeg > 360) {
    throw new RangeError("longitudeDeg must be between -360 and +360 degrees");
  }
  if (profile.siteElevationM < -10000 || profile.siteElevationM > 100000) {
    throw new RangeError("siteElevationM is outside the supported range [-10000, 100000] m");
  }
  if (profile.mastHeightM !== undefined) {
    assertFiniteNumber(profile.mastHeightM, "mastHeightM");
    if (profile.mastHeightM < 0 || profile.mastHeightM > 10000) {
      throw new RangeError("mastHeightM must be between 0 and 10000 m");
    }
  }
  if (profile.northReferenceLongitudeDeg !== undefined) {
    assertFiniteNumber(profile.northReferenceLongitudeDeg, "northReferenceLongitudeDeg");
  }

  if (!Array.isArray(profile.horizonElevationDeg) || profile.horizonElevationDeg.length < 4) {
    throw new TypeError("horizonElevationDeg must contain at least four uniformly spaced samples");
  }
  if (profile.horizonAzimuthStepDeg <= 0 || profile.horizonAzimuthStepDeg > 90) {
    throw new RangeError("horizonAzimuthStepDeg must be greater than 0 and no more than 90 degrees");
  }
  const coverage = profile.horizonAzimuthStepDeg * profile.horizonElevationDeg.length;
  if (Math.abs(coverage - 360) > 1e-6) {
    throw new RangeError(
      `Horizon samples must cover exactly 360 degrees (step × count is ${coverage})`,
    );
  }
  for (let index = 0; index < profile.horizonElevationDeg.length; index += 1) {
    const elevation = profile.horizonElevationDeg[index];
    if (elevation === undefined || !Number.isFinite(elevation) || elevation < -90 || elevation > 90) {
      throw new RangeError(`Invalid horizon elevation at sample ${index}`);
    }
  }
}

export function buildLocalLunarFrame(profile: SiteHorizonProfile): LocalLunarFrame {
  validateSiteHorizonProfile(profile);

  const latitudeRad = degreesToRadians(profile.latitudeDeg);
  const isAtPole = Math.abs(Math.abs(profile.latitudeDeg) - 90) < 1e-10;
  const longitudeForAxesDeg = isAtPole
    ? (profile.northReferenceLongitudeDeg ?? 0)
    : profile.longitudeDeg;
  const longitudeRad = degreesToRadians(longitudeForAxesDeg);

  const cosLatitude = Math.cos(latitudeRad);
  const sinLatitude = Math.sin(latitudeRad);
  const cosLongitude = Math.cos(longitudeRad);
  const sinLongitude = Math.sin(longitudeRad);

  const up: Vector3Km = {
    x: cosLatitude * cosLongitude,
    y: cosLatitude * sinLongitude,
    z: sinLatitude,
  };
  const east: Vector3Km = {
    x: -sinLongitude,
    y: cosLongitude,
    z: 0,
  };
  const north: Vector3Km = {
    x: -sinLatitude * cosLongitude,
    y: -sinLatitude * sinLongitude,
    z: cosLatitude,
  };

  const siteRadiusKm =
    MOON_MEAN_RADIUS_KM + (profile.siteElevationM + (profile.mastHeightM ?? 0)) / 1000;
  const sitePositionKm: Vector3Km = {
    x: up.x * siteRadiusKm,
    y: up.y * siteRadiusKm,
    z: up.z * siteRadiusKm,
  };

  return { up, east, north, sitePositionKm };
}

export function getHorizonElevationDeg(profile: SiteHorizonProfile, azimuthDeg: number): number {
  const azimuth = normaliseAzimuthDeg(azimuthDeg);
  const fractionalIndex = azimuth / profile.horizonAzimuthStepDeg;
  const lowerIndex = Math.floor(fractionalIndex) % profile.horizonElevationDeg.length;
  const upperIndex = (lowerIndex + 1) % profile.horizonElevationDeg.length;
  const fraction = fractionalIndex - Math.floor(fractionalIndex);
  const lower = profile.horizonElevationDeg[lowerIndex];
  const upper = profile.horizonElevationDeg[upperIndex];

  if (lower === undefined || upper === undefined) {
    throw new RangeError("Horizon profile is missing an expected azimuth sample");
  }
  return lower + (upper - lower) * fraction;
}

export function subtractVectors(left: Vector3Km, right: Vector3Km): Vector3Km {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

export function vectorMagnitude(vector: Vector3Km): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

export function dotProduct(left: Vector3Km, right: Vector3Km): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}
