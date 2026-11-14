import type {
  EphemerisPoint,
  SiteHorizonProfile,
  VisibilityAnalysis,
  VisibilityEventKind,
  VisibilityOptions,
  VisibilityState,
  VisibilityWindow,
} from "./types.js";
import {
  ASTRONOMICAL_UNIT_KM,
  SOLAR_CONSTANT_WM2,
  getHorizonElevationDeg,
  parseUtcTimestamp,
  toUtcIsoString,
  validateSiteHorizonProfile,
} from "./geometry.js";

/** Fraction of a circular apparent disc above a locally straight skyline. */
export function visibleDiscFraction(
  centreElevationDeg: number,
  horizonElevationDeg: number,
  angularRadiusDeg: number,
): number {
  if (![centreElevationDeg, horizonElevationDeg, angularRadiusDeg].every(Number.isFinite)) {
    throw new TypeError("Disc elevation, horizon elevation, and angular radius must be finite");
  }
  if (angularRadiusDeg < 0 || angularRadiusDeg >= 90) {
    throw new RangeError("angularRadiusDeg must be in [0, 90)");
  }
  if (angularRadiusDeg === 0) {
    return centreElevationDeg >= horizonElevationDeg ? 1 : 0;
  }

  const x = Math.max(-1, Math.min(1, (centreElevationDeg - horizonElevationDeg) / angularRadiusDeg));
  const fraction = (Math.acos(-x) + x * Math.sqrt(Math.max(0, 1 - x * x))) / Math.PI;
  return Math.max(0, Math.min(1, fraction));
}

function validateEphemerisSeries(points: readonly EphemerisPoint[]): void {
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.frame !== "MEAN_ME" || point.correctionModel !== "LT+S") {
      throw new RangeError("Visibility requires apparent ephemeris points in MEAN_ME with LT+S corrections");
    }
    const currentTimestamp = parseUtcTimestamp(point.timestamp);
    if (currentTimestamp <= previousTimestamp) {
      throw new RangeError("Ephemeris points must be strictly ordered by timestamp");
    }
    previousTimestamp = currentTimestamp;
    for (const [label, direction] of [["Sun", point.sun], ["Earth", point.earth]] as const) {
      if (
        !Number.isFinite(direction.azimuthDeg) ||
        direction.azimuthDeg < 0 || direction.azimuthDeg >= 360 ||
        !Number.isFinite(direction.elevationDeg) ||
        !Number.isFinite(direction.angularRadiusDeg) ||
        !Number.isFinite(direction.distanceKm) ||
        direction.elevationDeg < -90 ||
        direction.elevationDeg > 90 ||
        direction.angularRadiusDeg < 0 ||
        direction.distanceKm <= 0
      ) {
        throw new TypeError(`${label} ephemeris direction contains invalid values`);
      }
    }
  }
}

function activeForKind(state: VisibilityState, kind: VisibilityEventKind): boolean {
  switch (kind) {
    case "SUN_ILLUMINATION":
      return state.sunLimbClearanceDeg > 0;
    case "SUN_SHADOW":
      return state.sunLimbClearanceDeg <= 0;
    case "EARTH_COMMS":
      return state.earthCommsClearanceDeg >= 0;
  }
}

function boundaryTimeMilliseconds(
  leftTime: number,
  rightTime: number,
  leftMetric: number,
  rightMetric: number,
): number {
  const denominator = rightMetric - leftMetric;
  if (denominator === 0) return leftTime;
  const fraction = Math.max(0, Math.min(1, -leftMetric / denominator));
  return leftTime + fraction * (rightTime - leftTime);
}

function metricForKind(state: VisibilityState, kind: VisibilityEventKind): number {
  switch (kind) {
    case "SUN_ILLUMINATION":
      return state.sunLimbClearanceDeg;
    case "SUN_SHADOW":
      return -state.sunLimbClearanceDeg;
    case "EARTH_COMMS":
      return state.earthCommsClearanceDeg;
  }
}

/**
 * Find contiguous event intervals. Event boundaries are linearly interpolated
 * between adjacent samples using the relevant limb/clearance metric.
 */
export function findVisibilityWindows(states: readonly VisibilityState[]): VisibilityWindow[] {
  if (states.length === 0) return [];

  const times = states.map((state) => parseUtcTimestamp(state.timestamp));
  for (let index = 1; index < times.length; index += 1) {
    if ((times[index] ?? -Infinity) <= (times[index - 1] ?? Infinity)) {
      throw new RangeError("Visibility states must be strictly ordered by timestamp");
    }
  }

  const kinds: readonly VisibilityEventKind[] = ["SUN_ILLUMINATION", "SUN_SHADOW", "EARTH_COMMS"];
  const windows: VisibilityWindow[] = [];

  for (const kind of kinds) {
    let windowStartMs: number | undefined;
    let clippedAtStart = false;

    for (let index = 0; index < states.length; index += 1) {
      const state = states[index];
      const time = times[index];
      if (state === undefined || time === undefined) continue;

      const currentActive = activeForKind(state, kind);
      const previousState = index > 0 ? states[index - 1] : undefined;
      const previousTime = index > 0 ? times[index - 1] : undefined;

      if (index === 0 && currentActive) {
        windowStartMs = time;
        clippedAtStart = true;
        continue;
      }

      if (previousState === undefined || previousTime === undefined) continue;
      const previousActive = activeForKind(previousState, kind);

      if (!previousActive && currentActive) {
        windowStartMs = boundaryTimeMilliseconds(
          previousTime,
          time,
          metricForKind(previousState, kind),
          metricForKind(state, kind),
        );
        clippedAtStart = false;
      } else if (previousActive && !currentActive && windowStartMs !== undefined) {
        const endTimeMs = boundaryTimeMilliseconds(
          previousTime,
          time,
          metricForKind(previousState, kind),
          metricForKind(state, kind),
        );
        windows.push({
          kind,
          startTimeUtc: new Date(windowStartMs).toISOString(),
          endTimeUtc: new Date(endTimeMs).toISOString(),
          durationSeconds: Math.max(0, (endTimeMs - windowStartMs) / 1000),
          clippedAtStart,
          clippedAtEnd: false,
        });
        windowStartMs = undefined;
        clippedAtStart = false;
      }
    }

    if (windowStartMs !== undefined) {
      const finalTime = times[times.length - 1];
      if (finalTime !== undefined) {
        windows.push({
          kind,
          startTimeUtc: new Date(windowStartMs).toISOString(),
          endTimeUtc: new Date(finalTime).toISOString(),
          durationSeconds: Math.max(0, (finalTime - windowStartMs) / 1000),
          clippedAtStart,
          clippedAtEnd: true,
        });
      }
    }
  }

  return windows.sort((left, right) => {
    const timeDifference = parseUtcTimestamp(left.startTimeUtc) - parseUtcTimestamp(right.startTimeUtc);
    return timeDifference !== 0 ? timeDifference : kinds.indexOf(left.kind) - kinds.indexOf(right.kind);
  });
}

/** Calculate per-sample illumination/comms state and contiguous event windows. */
export function calculateVisibility(
  site: SiteHorizonProfile,
  points: readonly EphemerisPoint[],
  options: VisibilityOptions = {},
): VisibilityAnalysis {
  validateSiteHorizonProfile(site);
  validateEphemerisSeries(points);

  const solarConstantWm2 = options.solarConstantWm2 ?? SOLAR_CONSTANT_WM2;
  const earthCommsMarginDeg = options.earthCommsMarginDeg ?? 1.0;
  if (!Number.isFinite(solarConstantWm2) || solarConstantWm2 <= 0) {
    throw new RangeError("solarConstantWm2 must be a positive finite number");
  }
  if (!Number.isFinite(earthCommsMarginDeg) || earthCommsMarginDeg < 0 || earthCommsMarginDeg > 30) {
    throw new RangeError("earthCommsMarginDeg must be between 0 and 30 degrees");
  }

  const states = points.map((point): VisibilityState => {
    const sunHorizonElevationDeg = getHorizonElevationDeg(site, point.sun.azimuthDeg);
    const earthHorizonElevationDeg = getHorizonElevationDeg(site, point.earth.azimuthDeg);
    const sunVisibleFraction = visibleDiscFraction(
      point.sun.elevationDeg,
      sunHorizonElevationDeg,
      point.sun.angularRadiusDeg,
    );
    const earthVisibleFraction = visibleDiscFraction(
      point.earth.elevationDeg,
      earthHorizonElevationDeg,
      point.earth.angularRadiusDeg,
    );
    const sunLimbClearanceDeg =
      point.sun.elevationDeg + point.sun.angularRadiusDeg - sunHorizonElevationDeg;
    const earthCommsClearanceDeg =
      point.earth.elevationDeg - point.earth.angularRadiusDeg - earthHorizonElevationDeg - earthCommsMarginDeg;
    const sunIlluminated = sunVisibleFraction > 0;
    const inShadow = !sunIlluminated;
    const earthCommsAvailable = earthCommsClearanceDeg >= 0;
    const irradianceDistanceScale = (ASTRONOMICAL_UNIT_KM / point.sun.distanceKm) ** 2;
    const solarIrradianceWm2 = solarConstantWm2 * irradianceDistanceScale * sunVisibleFraction;
    const activeEvents: VisibilityEventKind[] = [];

    if (sunIlluminated) activeEvents.push("SUN_ILLUMINATION");
    if (inShadow) activeEvents.push("SUN_SHADOW");
    if (earthCommsAvailable) activeEvents.push("EARTH_COMMS");

    return {
      timestamp: toUtcIsoString(point.timestamp),
      sunHorizonElevationDeg,
      earthHorizonElevationDeg,
      sunVisibleFraction,
      earthVisibleFraction,
      solarIrradianceWm2,
      sunLimbClearanceDeg,
      earthCommsClearanceDeg,
      sunIlluminated,
      inShadow,
      earthCommsAvailable,
      activeEvents,
    };
  });

  return { states, windows: findVisibilityWindows(states) };
}
