import { describe, expect, it } from "vitest";
import syntheticSouthPoleSite from "./fixtures/synthetic_south_pole_site.json";
import {
  computeEphemerisPoint,
  getEphemerisPoint,
  interpolateEphemerisVectors,
} from "../src/ephemeris.js";
import type { EphemerisVectorSample, SiteHorizonProfile, Vector3Km } from "../src/types.js";

const site = syntheticSouthPoleSite as SiteHorizonProfile;

function sample(
  timestamp: string,
  sunPositionKm: Vector3Km = { x: 149597870.7, y: 0, z: 0 },
  earthPositionKm: Vector3Km = { x: 0, y: 384400, z: 0 },
): EphemerisVectorSample {
  return {
    timestamp,
    frame: "MEAN_ME",
    correctionModel: "LT+S",
    sunPositionKm,
    earthPositionKm,
  };
}

describe("ephemeris geometry", () => {
  it("resolves lunar south-pole local north from the zero-degree reference meridian", () => {
    const point = computeEphemerisPoint(site, sample("2026-11-14T00:00:00Z", { x: 1e8, y: 0, z: -1e8 }));
    expect(point.sun.azimuthDeg).toBeCloseTo(0, 5);
    expect(point.sun.elevationDeg).toBeGreaterThan(40);
    expect(point.correctionModel).toBe("LT+S");
  });

  it("includes site position when calculating Earth parallax and angular radius", () => {
    const equatorialSite: SiteHorizonProfile = {
      ...site,
      latitudeDeg: 0,
      longitudeDeg: 0,
      northReferenceLongitudeDeg: 0,
    };
    const point = computeEphemerisPoint(
      equatorialSite,
      sample("2026-11-14T00:00:00Z", { x: 149597870.7, y: 0, z: 0 }, { x: 0, y: 384400, z: 0 }),
    );
    expect(point.earth.azimuthDeg).toBeCloseTo(90, 2);
    expect(point.earth.elevationDeg).toBeLessThan(0);
    expect(point.earth.elevationDeg).toBeCloseTo(-0.259, 2);
    expect(point.earth.angularRadiusDeg).toBeGreaterThan(0.9);
    expect(point.earth.angularRadiusDeg).toBeLessThan(1.1);
  });

  it("interpolates in Cartesian space and returns a normalized UTC timestamp", () => {
    const samples = [
      sample("2026-11-14T00:00:00Z", { x: 100, y: 0, z: 0 }, { x: 0, y: 100, z: 0 }),
      sample("2026-11-14T00:00:10Z", { x: 200, y: 20, z: 0 }, { x: 0, y: 200, z: 0 }),
    ];
    const result = interpolateEphemerisVectors(samples, "2026-11-14T00:00:05+00:00");
    expect(result.timestamp).toBe("2026-11-14T00:00:05.000Z");
    expect(result.sunPositionKm.x).toBeCloseTo(150, 8);
    expect(result.sunPositionKm.y).toBeCloseTo(10, 8);
    expect(result.earthPositionKm.y).toBeCloseTo(150, 8);
  });

  it("uses cubic Hermite interpolation when both endpoint velocities are present", () => {
    const samples: EphemerisVectorSample[] = [
      {
        ...sample("2026-11-14T00:00:00Z", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
        sunVelocityKmPerSecond: { x: 1, y: 0, z: 0 },
        earthVelocityKmPerSecond: { x: 0, y: 0, z: 0 },
      },
      {
        ...sample("2026-11-14T00:00:10Z", { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
        sunVelocityKmPerSecond: { x: 1, y: 0, z: 0 },
        earthVelocityKmPerSecond: { x: 0, y: 0, z: 0 },
      },
    ];
    const result = interpolateEphemerisVectors(samples, "2026-11-14T00:00:04Z");
    expect(result.sunPositionKm.x).toBeCloseTo(4, 8);
  });

  it("rejects extrapolation, unsorted samples, and uncorrected or mismatched frame data", () => {
    const samples = [
      sample("2026-11-14T00:00:00Z"),
      sample("2026-11-14T00:00:10Z"),
    ];
    expect(() => getEphemerisPoint(site, "2026-11-13T23:59:59Z", samples)).toThrow(/outside/i);
    expect(() => interpolateEphemerisVectors([...samples].reverse(), "2026-11-14T00:00:05Z")).toThrow(/increasing/i);
    const wrongFrame = { ...samples[0]!, frame: "PA" } as unknown as EphemerisVectorSample;
    const wrongCorrection = { ...samples[0]!, correctionModel: "GEOMETRIC" } as unknown as EphemerisVectorSample;
    expect(() => computeEphemerisPoint(site, wrongFrame)).toThrow(/frame/i);
    expect(() => computeEphemerisPoint(site, wrongCorrection)).toThrow(/light-time/i);
  });
});
