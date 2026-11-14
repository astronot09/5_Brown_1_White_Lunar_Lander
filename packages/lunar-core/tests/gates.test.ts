import { describe, expect, it } from "vitest";
import { parseHorizonsObserverTable, validateAgainstHorizons } from "../src/gates.js";
import southPoleHorizons from "../../../data/horizons-ref/south_pole_season.json";
import change4Horizons from "../../../data/horizons-ref/change4_farside.json";
import type { EphemerisPoint, HorizonsReferencePoint } from "../src/types.js";

function point(timestamp: string, sunAzimuthDeg = 359.98): EphemerisPoint {
  return {
    timestamp,
    frame: "MEAN_ME",
    correctionModel: "LT+S",
    sun: { azimuthDeg: sunAzimuthDeg, elevationDeg: 30, angularRadiusDeg: 0.26, distanceKm: 149597870 },
    earth: { azimuthDeg: 120, elevationDeg: 5, angularRadiusDeg: 0.95, distanceKm: 384400 },
  };
}

describe("Horizons validation gate", () => {
  it("parses the repository's cached South Pole Sun baseline", () => {
    const resultText = (southPoleHorizons as { result: string }).result;
    const rows = parseHorizonsObserverTable(resultText, "sun");
    expect(rows[0]?.timestamp).toBe("2025-01-01T00:00:00.000Z");
    expect(rows[0]?.sun?.azimuthDeg).toBeCloseTo(162.188972, 6);
    expect(rows[0]?.sun?.elevationDeg).toBeCloseTo(1.519737, 6);
  });

  it("parses the repository's cached Chang'e 4 Earth baseline", () => {
    const resultText = (change4Horizons as { result: string }).result;
    const rows = parseHorizonsObserverTable(resultText, "earth");
    expect(rows[0]?.timestamp).toBe("2025-01-01T00:00:00.000Z");
    expect(rows[0]?.earth?.azimuthDeg).toBeCloseTo(176.513126, 6);
    expect(rows[0]?.earth?.elevationDeg).toBeCloseTo(-50.723980, 6);
  });

  it("passes when all supplied direction comparisons are within 0.05 degrees", () => {
    const actual = [point("2026-11-14T00:00:00Z")];
    const references: HorizonsReferencePoint[] = [{
      timestamp: "2026-11-14T00:00:00Z",
      sun: { azimuthDeg: 0.02, elevationDeg: 30 },
      earth: { azimuthDeg: 120.01, elevationDeg: 5 },
    }];
    const result = validateAgainstHorizons(actual, references);
    expect(result.passed).toBe(true);
    expect(result.maxAngularErrorDeg).toBeLessThan(0.05);
    expect(result.comparedBodyCount).toBe(2);
  });

  it("fails when a direction error exceeds the configured tolerance", () => {
    const result = validateAgainstHorizons(
      [point("2026-11-14T00:00:00Z", 10)],
      [{ timestamp: "2026-11-14T00:00:00Z", sun: { azimuthDeg: 10.1, elevationDeg: 30 } }],
    );
    expect(result.passed).toBe(false);
    expect(result.failedComparisons).toHaveLength(1);
  });

  it("reports unmatched timestamps and refuses to pass an empty comparison", () => {
    const result = validateAgainstHorizons(
      [point("2026-11-14T00:00:00Z")],
      [{ timestamp: "2026-11-14T01:00:00Z", sun: { azimuthDeg: 0, elevationDeg: 30 } }],
    );
    expect(result.passed).toBe(false);
    expect(result.missingReferenceTimestamps).toEqual(["2026-11-14T00:00:00.000Z"]);
    expect(result.comparedBodyCount).toBe(0);
  });

  it("allows a Horizons row to contain only the target queried by that baseline", () => {
    const result = validateAgainstHorizons(
      [point("2026-11-14T00:00:00Z")],
      [{ timestamp: "2026-11-14T00:00:00Z", earth: { azimuthDeg: 120, elevationDeg: 5 } }],
    );
    expect(result.passed).toBe(true);
    expect(result.comparedBodyCount).toBe(1);
  });
});
