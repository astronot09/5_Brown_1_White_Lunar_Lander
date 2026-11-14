import { angularSeparationDeg } from "./ephemeris.js";
import { parseUtcTimestamp, toUtcIsoString } from "./geometry.js";
import type {
  EphemerisPoint,
  HorizonsAngularComparison,
  HorizonsReferencePoint,
  ValidationGateResult,
} from "./types.js";

/**
 * Compare computed topocentric directions with cached JPL Horizons direction
 * samples. Angular separation, rather than independent azimuth subtraction,
 * gives a physically meaningful error at all elevations and across 0/360°.
 */
export function validateAgainstHorizons(
  actualPoints: readonly EphemerisPoint[],
  referencePoints: readonly HorizonsReferencePoint[],
  toleranceDeg = 0.05,
): ValidationGateResult {
  if (!Number.isFinite(toleranceDeg) || toleranceDeg <= 0 || toleranceDeg > 10) {
    throw new RangeError("toleranceDeg must be positive and no greater than 10 degrees");
  }

  const referenceByTime = new Map<number, HorizonsReferencePoint>();
  for (const reference of referencePoints) {
    const timestampMs = parseUtcTimestamp(reference.timestamp);
    if (referenceByTime.has(timestampMs)) {
      throw new RangeError(`Duplicate Horizons reference timestamp: ${reference.timestamp}`);
    }
    referenceByTime.set(timestampMs, reference);
  }

  const comparisons: HorizonsAngularComparison[] = [];
  const missingReferenceTimestamps: string[] = [];
  const seenActualTimes = new Set<number>();
  const matchedTimes = new Set<number>();

  for (const actual of actualPoints) {
    const timestampMs = parseUtcTimestamp(actual.timestamp);
    if (seenActualTimes.has(timestampMs)) {
      throw new RangeError(`Duplicate actual ephemeris timestamp: ${actual.timestamp}`);
    }
    seenActualTimes.add(timestampMs);

    const reference = referenceByTime.get(timestampMs);
    if (reference === undefined) {
      missingReferenceTimestamps.push(toUtcIsoString(actual.timestamp));
      continue;
    }
    matchedTimes.add(timestampMs);

    if (reference.sun !== undefined) {
      const angularErrorDeg = angularSeparationDeg(actual.sun, reference.sun);
      comparisons.push({
        timestamp: toUtcIsoString(actual.timestamp),
        body: "SUN",
        angularErrorDeg,
        withinTolerance: angularErrorDeg <= toleranceDeg,
      });
    }
    if (reference.earth !== undefined) {
      const angularErrorDeg = angularSeparationDeg(actual.earth, reference.earth);
      comparisons.push({
        timestamp: toUtcIsoString(actual.timestamp),
        body: "EARTH",
        angularErrorDeg,
        withinTolerance: angularErrorDeg <= toleranceDeg,
      });
    }
  }

  const failedComparisons = comparisons.filter((comparison) => !comparison.withinTolerance);
  const maxAngularErrorDeg = comparisons.reduce(
    (maximum, comparison) => Math.max(maximum, comparison.angularErrorDeg),
    0,
  );
  const meanAngularErrorDeg = comparisons.length === 0
    ? 0
    : comparisons.reduce((sum, comparison) => sum + comparison.angularErrorDeg, 0) / comparisons.length;

  return {
    passed:
      comparisons.length > 0 &&
      failedComparisons.length === 0 &&
      missingReferenceTimestamps.length === 0,
    toleranceDeg,
    sampleCount: matchedTimes.size,
    comparedBodyCount: comparisons.length,
    maxAngularErrorDeg,
    meanAngularErrorDeg,
    comparisons,
    failedComparisons,
    missingReferenceTimestamps,
  };
}


/**
 * Parse the `result` text returned by the JPL Horizons API in CSV observer
 * mode. Pass the queried body explicitly because the repository cache stores
 * Sun and Earth observations in separate files.
 */
export function parseHorizonsObserverTable(
  resultText: string,
  body: "sun" | "earth",
): HorizonsReferencePoint[] {
  if (typeof resultText !== "string") {
    throw new TypeError("Horizons result must be a string");
  }
  if (!resultText.includes("$$SOE") || !resultText.includes("$$EOE")) {
    throw new TypeError("Horizons result is missing the $$SOE/$$EOE data delimiters");
  }
  if (!/MEAN_ME\s*\(high precision\)/i.test(resultText) || !/1737\.4/.test(resultText)) {
    throw new RangeError("Horizons result is not identified as the 1737.4 km MEAN_ME high-precision frame");
  }
  if (!/Atmos refraction:\s*NO/i.test(resultText)) {
    throw new RangeError("Horizons result must use airless (no-refraction) observer coordinates");
  }

  const targetMatch = resultText.match(/Target body name:\s*(Sun|Earth)\b/i);
  if (targetMatch?.[1] !== undefined && targetMatch[1].toLowerCase() !== body) {
    throw new RangeError(`Horizons target is ${targetMatch[1]}, but parser was asked for ${body}`);
  }

  const header = resultText
    .slice(0, resultText.indexOf("$$SOE"))
    .split(/\r?\n/)
    .find((line) => line.includes("Date__(UT)") && line.includes("Azi_(a-app)") && line.includes("Elev_(a-app)"));
  if (header === undefined) {
    throw new TypeError("Horizons result is missing apparent azimuth/elevation CSV columns");
  }

  const columnNames = header.split(",").map((column) => column.trim());
  const dateColumn = columnNames.findIndex((column) => column.startsWith("Date__(UT)"));
  const azimuthColumn = columnNames.findIndex((column) => column.startsWith("Azi_(a-app)"));
  const elevationColumn = columnNames.findIndex((column) => column.startsWith("Elev_(a-app)"));
  if (dateColumn < 0 || azimuthColumn < 0 || elevationColumn < 0) {
    throw new TypeError("Horizons CSV columns do not contain date, apparent azimuth and apparent elevation");
  }

  const start = resultText.indexOf("$$SOE") + "$$SOE".length;
  const end = resultText.indexOf("$$EOE", start);
  const rows = resultText.slice(start, end).split(/\r?\n/);
  const points: HorizonsReferencePoint[] = [];
  const monthNumbers: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  for (const row of rows) {
    const trimmedRow = row.trim();
    if (!trimmedRow) continue;
    const columns = trimmedRow.split(",").map((column) => column.trim());
    const dateText = columns[dateColumn];
    const azimuthText = columns[azimuthColumn];
    const elevationText = columns[elevationColumn];
    if (dateText === undefined || azimuthText === undefined || elevationText === undefined) {
      throw new TypeError(`Malformed Horizons CSV row: ${trimmedRow}`);
    }

    const dateMatch = dateText.match(/^(\d{4})-([A-Za-z]{3})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/);
    if (dateMatch === null) {
      throw new TypeError(`Unsupported Horizons UTC date format: ${dateText}`);
    }
    const year = Number(dateMatch[1]);
    const month = monthNumbers[(dateMatch[2] ?? "").toLowerCase()];
    const day = Number(dateMatch[3]);
    const hour = Number(dateMatch[4]);
    const minute = Number(dateMatch[5]);
    const second = Number(dateMatch[6] ?? 0);
    if (month === undefined) throw new TypeError(`Unknown month in Horizons date: ${dateText}`);
    const timestampMs = Date.UTC(year, month, day, hour, minute, second);
    const date = new Date(timestampMs);
    if (
      date.getUTCFullYear() !== year || date.getUTCMonth() !== month ||
      date.getUTCDate() !== day || date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute
    ) {
      throw new TypeError(`Invalid calendar date in Horizons row: ${dateText}`);
    }

    if (azimuthText.length === 0 || elevationText.length === 0) continue;
    const azimuthDeg = Number(azimuthText);
    const elevationDeg = Number(elevationText);
    if (!Number.isFinite(azimuthDeg) || !Number.isFinite(elevationDeg)) {
      // Horizons uses non-numeric flags for a few unavailable rows; skip those
      // rather than inserting NaNs into a validation comparison.
      continue;
    }
    if (elevationDeg < -90 || elevationDeg > 90) {
      throw new RangeError(`Horizons elevation is outside [-90, 90] degrees: ${elevationText}`);
    }
    const direction = { azimuthDeg: ((azimuthDeg % 360) + 360) % 360, elevationDeg };
    points.push({
      timestamp: date.toISOString(),
      ...(body === "sun" ? { sun: direction } : { earth: direction }),
    });
  }

  if (points.length === 0) {
    throw new RangeError("Horizons table contained no usable apparent azimuth/elevation rows");
  }
  return points;
}
