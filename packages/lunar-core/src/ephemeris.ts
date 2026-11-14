import type {
  EphemerisDirection,
  EphemerisPoint,
  EphemerisVectorSample,
  SiteHorizonProfile,
  Vector3Km,
} from "./types.js";
import {
  EARTH_EQUATORIAL_RADIUS_KM,
  SUN_MEAN_RADIUS_KM,
  buildLocalLunarFrame,
  degreesToRadians,
  parseUtcTimestamp,
  radiansToDegrees,
  subtractVectors,
  toUtcIsoString,
  vectorMagnitude,
  dotProduct,
} from "./geometry.js";

function validateVector(vector: Vector3Km, label: string): void {
  if (!vector || !Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z)) {
    throw new TypeError(`${label} must be a finite three-dimensional vector`);
  }
}

function validateVectorSample(sample: EphemerisVectorSample): number {
  if (sample.frame !== "MEAN_ME") {
    throw new RangeError(`Unsupported ephemeris frame: ${String(sample.frame)}`);
  }
  if (sample.correctionModel !== "LT+S") {
    throw new RangeError("Ephemeris vectors must be apparent and include light-time plus stellar-aberration corrections");
  }
  validateVector(sample.sunPositionKm, "sunPositionKm");
  validateVector(sample.earthPositionKm, "earthPositionKm");
  if (sample.sunVelocityKmPerSecond !== undefined) {
    validateVector(sample.sunVelocityKmPerSecond, "sunVelocityKmPerSecond");
  }
  if (sample.earthVelocityKmPerSecond !== undefined) {
    validateVector(sample.earthVelocityKmPerSecond, "earthVelocityKmPerSecond");
  }
  return parseUtcTimestamp(sample.timestamp);
}

function interpolateVector(
  leftPosition: Vector3Km,
  rightPosition: Vector3Km,
  leftVelocity: Vector3Km | undefined,
  rightVelocity: Vector3Km | undefined,
  intervalSeconds: number,
  fraction: number,
): Vector3Km {
  if (leftVelocity === undefined || rightVelocity === undefined) {
    return {
      x: leftPosition.x + (rightPosition.x - leftPosition.x) * fraction,
      y: leftPosition.y + (rightPosition.y - leftPosition.y) * fraction,
      z: leftPosition.z + (rightPosition.z - leftPosition.z) * fraction,
    };
  }

  const t2 = fraction * fraction;
  const t3 = t2 * fraction;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + fraction;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  const component = (axis: "x" | "y" | "z"): number =>
    h00 * leftPosition[axis] +
    h10 * intervalSeconds * leftVelocity[axis] +
    h01 * rightPosition[axis] +
    h11 * intervalSeconds * rightVelocity[axis];

  return { x: component("x"), y: component("y"), z: component("z") };
}

/**
 * Interpolate a Moon-centred state vector at a UTC instant.
 *
 * State samples must be ordered by time and cover the requested instant. Linear
 * interpolation is used unless both bracketing samples contain velocity vectors,
 * in which case cubic-Hermite interpolation is used. Extrapolation is rejected.
 */
export function interpolateEphemerisVectors(
  samples: readonly EphemerisVectorSample[],
  timestamp: string,
): EphemerisVectorSample {
  if (samples.length < 2) {
    throw new RangeError("At least two ephemeris vector samples are required for interpolation");
  }

  const targetMilliseconds = parseUtcTimestamp(timestamp);
  const sampleTimes = samples.map(validateVectorSample);
  for (let index = 1; index < sampleTimes.length; index += 1) {
    const previous = sampleTimes[index - 1];
    const current = sampleTimes[index];
    if (previous === undefined || current === undefined || current <= previous) {
      throw new RangeError("Ephemeris vector samples must have strictly increasing timestamps");
    }
  }

  const firstTime = sampleTimes[0];
  const lastTime = sampleTimes[sampleTimes.length - 1];
  if (firstTime === undefined || lastTime === undefined) {
    throw new RangeError("Ephemeris samples are empty");
  }
  if (targetMilliseconds < firstTime || targetMilliseconds > lastTime) {
    throw new RangeError("Requested timestamp is outside the ephemeris sample coverage; extrapolation is not supported");
  }

  // Exact sample hits avoid needless numerical interpolation.
  const exactIndex = sampleTimes.indexOf(targetMilliseconds);
  if (exactIndex >= 0) {
    const exactSample = samples[exactIndex];
    if (exactSample === undefined) throw new RangeError("Missing exact ephemeris sample");
    return { ...exactSample, timestamp: toUtcIsoString(timestamp) };
  }

  let rightIndex = 1;
  while (rightIndex < sampleTimes.length && (sampleTimes[rightIndex] ?? Infinity) < targetMilliseconds) {
    rightIndex += 1;
  }
  const leftIndex = rightIndex - 1;
  const leftSample = samples[leftIndex];
  const rightSample = samples[rightIndex];
  const leftTime = sampleTimes[leftIndex];
  const rightTime = sampleTimes[rightIndex];
  if (leftSample === undefined || rightSample === undefined || leftTime === undefined || rightTime === undefined) {
    throw new RangeError("Unable to bracket requested ephemeris timestamp");
  }

  const intervalSeconds = (rightTime - leftTime) / 1000;
  const fraction = (targetMilliseconds - leftTime) / (rightTime - leftTime);

  const sunPositionKm = interpolateVector(
    leftSample.sunPositionKm,
    rightSample.sunPositionKm,
    leftSample.sunVelocityKmPerSecond,
    rightSample.sunVelocityKmPerSecond,
    intervalSeconds,
    fraction,
  );
  const earthPositionKm = interpolateVector(
    leftSample.earthPositionKm,
    rightSample.earthPositionKm,
    leftSample.earthVelocityKmPerSecond,
    rightSample.earthVelocityKmPerSecond,
    intervalSeconds,
    fraction,
  );

  return {
    timestamp: toUtcIsoString(timestamp),
    frame: "MEAN_ME",
    correctionModel: "LT+S",
    sunPositionKm,
    earthPositionKm,
  };
}

function toTopocentricDirection(
  targetPositionKm: Vector3Km,
  sitePositionKm: Vector3Km,
  east: Vector3Km,
  north: Vector3Km,
  up: Vector3Km,
  targetRadiusKm: number,
): EphemerisDirection {
  const topocentricVector = subtractVectors(targetPositionKm, sitePositionKm);
  const distanceKm = vectorMagnitude(topocentricVector);
  if (!Number.isFinite(distanceKm) || distanceKm <= targetRadiusKm) {
    throw new RangeError("Observer-to-target distance is invalid or inside the target body");
  }

  const horizontalEast = dotProduct(topocentricVector, east);
  const horizontalNorth = dotProduct(topocentricVector, north);
  const vertical = dotProduct(topocentricVector, up);
  const elevationDeg = radiansToDegrees(Math.asin(Math.max(-1, Math.min(1, vertical / distanceKm))));
  const azimuthDeg = (radiansToDegrees(Math.atan2(horizontalEast, horizontalNorth)) + 360) % 360;
  const angularRadiusDeg = radiansToDegrees(Math.asin(targetRadiusKm / distanceKm));

  return { azimuthDeg, elevationDeg, angularRadiusDeg, distanceKm };
}

/** Convert a corrected Moon-centred MEAN_ME state into local topocentric directions. */
export function computeEphemerisPoint(
  site: SiteHorizonProfile,
  sample: EphemerisVectorSample,
): EphemerisPoint {
  validateVectorSample(sample);
  const localFrame = buildLocalLunarFrame(site);

  return {
    timestamp: toUtcIsoString(sample.timestamp),
    frame: "MEAN_ME",
    correctionModel: "LT+S",
    sun: toTopocentricDirection(
      sample.sunPositionKm,
      localFrame.sitePositionKm,
      localFrame.east,
      localFrame.north,
      localFrame.up,
      SUN_MEAN_RADIUS_KM,
    ),
    earth: toTopocentricDirection(
      sample.earthPositionKm,
      localFrame.sitePositionKm,
      localFrame.east,
      localFrame.north,
      localFrame.up,
      EARTH_EQUATORIAL_RADIUS_KM,
    ),
  };
}

/**
 * Calculate one topocentric point at any time covered by `samples`.
 * This is the normal browser entry point when consuming a tabulated SPICE/DE
 * ephemeris from the offline pipeline.
 */
export function getEphemerisPoint(
  site: SiteHorizonProfile,
  timestamp: string,
  samples: readonly EphemerisVectorSample[],
): EphemerisPoint {
  return computeEphemerisPoint(site, interpolateEphemerisVectors(samples, timestamp));
}

/** Convert a state-vector series without changing its time sampling. */
export function getEphemerisSeries(
  site: SiteHorizonProfile,
  samples: readonly EphemerisVectorSample[],
): EphemerisPoint[] {
  return samples.map((sample) => computeEphemerisPoint(site, sample));
}

/** Convenience helper for calculating the angular separation of two directions. */
export function angularSeparationDeg(
  left: Pick<EphemerisDirection, "azimuthDeg" | "elevationDeg">,
  right: Pick<EphemerisDirection, "azimuthDeg" | "elevationDeg">,
): number {
  const leftElevation = degreesToRadians(left.elevationDeg);
  const rightElevation = degreesToRadians(right.elevationDeg);
  const azimuthDifference = degreesToRadians(left.azimuthDeg - right.azimuthDeg);
  const cosine =
    Math.sin(leftElevation) * Math.sin(rightElevation) +
    Math.cos(leftElevation) * Math.cos(rightElevation) * Math.cos(azimuthDifference);
  return radiansToDegrees(Math.acos(Math.max(-1, Math.min(1, cosine))));
}
