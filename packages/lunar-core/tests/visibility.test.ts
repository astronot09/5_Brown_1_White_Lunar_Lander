import { describe, expect, it } from "vitest";
import syntheticSouthPoleSite from "./fixtures/synthetic_south_pole_site.json";
import { calculateVisibility, findVisibilityWindows, visibleDiscFraction } from "../src/visibility.js";
import type { EphemerisPoint, SiteHorizonProfile, VisibilityState } from "../src/types.js";

const site = syntheticSouthPoleSite as SiteHorizonProfile;

function point(
  timestamp: string,
  sunElevationDeg: number,
  earthElevationDeg: number,
): EphemerisPoint {
  return {
    timestamp,
    frame: "MEAN_ME",
    correctionModel: "LT+S",
    sun: {
      azimuthDeg: 0,
      elevationDeg: sunElevationDeg,
      angularRadiusDeg: 0.25,
      distanceKm: 149597870.7,
    },
    earth: {
      azimuthDeg: 90,
      elevationDeg: earthElevationDeg,
      angularRadiusDeg: 1,
      distanceKm: 384400,
    },
  };
}

describe("terrain-aware visibility", () => {
  it("calculates the exact circular-disc segment fraction at key boundaries", () => {
    expect(visibleDiscFraction(0, 0, 0.25)).toBeCloseTo(0.5, 12);
    expect(visibleDiscFraction(0.25, 0, 0.25)).toBeCloseTo(1, 12);
    expect(visibleDiscFraction(-0.25, 0, 0.25)).toBeCloseTo(0, 12);
  });

  it("preserves partial solar-disc illumination in the irradiance value", () => {
    const analysis = calculateVisibility(site, [point("2026-11-14T00:00:00Z", 0, 4)]);
    const state = analysis.states[0];
    expect(state).toBeDefined();
    expect(state!.sunVisibleFraction).toBeCloseTo(0.5, 10);
    expect(state!.solarIrradianceWm2).toBeCloseTo(680.5, 5);
    expect(state!.sunIlluminated).toBe(true);
    expect(state!.inShadow).toBe(false);
    expect(state!.earthCommsAvailable).toBe(true);
  });

  it("marks fully occulted Sun as shadow and blocks Earth comms when its full disc is not clear", () => {
    const analysis = calculateVisibility(site, [point("2026-11-14T00:00:00Z", -1, 1.5)]);
    const state = analysis.states[0];
    expect(state!.sunVisibleFraction).toBe(0);
    expect(state!.solarIrradianceWm2).toBe(0);
    expect(state!.inShadow).toBe(true);
    expect(state!.earthCommsAvailable).toBe(false);
  });

  it("interpolates the skyline circularly across the 360/0-degree boundary", () => {
    const unevenSite: SiteHorizonProfile = {
      ...site,
      horizonAzimuthStepDeg: 90,
      horizonElevationDeg: [10, 20, 30, 40],
    };
    const analysis = calculateVisibility(unevenSite, [
      {
        ...point("2026-11-14T00:00:00Z", 50, 50),
        sun: { ...point("2026-11-14T00:00:00Z", 50, 50).sun, azimuthDeg: 315 },
      },
    ]);
    expect(analysis.states[0]!.sunHorizonElevationDeg).toBeCloseTo(25, 10);
  });

  it("creates contiguous windows with linearly interpolated crossing times", () => {
    const analysis = calculateVisibility(site, [
      point("2026-11-14T00:00:00Z", -1, 0),
      point("2026-11-14T00:00:10Z", 1, 0),
      point("2026-11-14T00:00:20Z", 1, 3),
    ]);

    const illumination = analysis.windows.find((window) => window.kind === "SUN_ILLUMINATION");
    const shadow = analysis.windows.find((window) => window.kind === "SUN_SHADOW");
    const comms = analysis.windows.find((window) => window.kind === "EARTH_COMMS");

    expect(illumination?.startTimeUtc).toBe("2026-11-14T00:00:03.750Z");
    expect(illumination?.clippedAtEnd).toBe(true);
    expect(shadow?.startTimeUtc).toBe("2026-11-14T00:00:00.000Z");
    expect(shadow?.endTimeUtc).toBe("2026-11-14T00:00:03.750Z");
    expect(comms?.startTimeUtc).toBe("2026-11-14T00:00:16.666Z");
  });

  it("returns no windows for an empty input and rejects unordered samples", () => {
    expect(findVisibilityWindows([])).toEqual([]);
    expect(() => calculateVisibility(site, [
      point("2026-11-14T00:00:10Z", 1, 3),
      point("2026-11-14T00:00:00Z", 1, 3),
    ])).toThrow(/ordered/i);
  });
});
