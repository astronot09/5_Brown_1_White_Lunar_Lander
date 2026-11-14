# lunar-core

Browser-side geometry, terrain visibility, event-window and Horizons-validation
functions for Lunar Skyline.

## Coordinate and input contract

`EphemerisVectorSample` is the boundary between an ephemeris producer and this
browser package. Positions are Moon-centred Cartesian vectors in kilometres in
the **MEAN_ME** frame. Samples must represent apparent target positions
at the reception epoch with light-time and stellar-aberration corrections
(`correctionModel: "LT+S"`). The offline SPICE pipeline is expected to produce
these vectors using the same DE441 realization as the cached Horizons baselines.
The DE realization is not encoded in the TypeScript type, so upstream data
provenance must be retained and checked separately. This package deliberately
does not manufacture an uncalibrated analytical orbit when those source vectors
are absent.

`interpolateEphemerisVectors` evaluates any UTC timestamp inside the supplied
sample coverage. It uses linear interpolation, or cubic-Hermite interpolation
when both bracketing samples include velocities. It rejects extrapolation.
`getEphemerisPoint` then subtracts the site position and resolves the apparent
Sun/Earth vectors into local east-north-up coordinates, returning clockwise
azimuth from local north, geometric elevation, topocentric range and angular
radius. No atmospheric refraction is applied.

At an exact lunar pole, local north uses `northReferenceLongitudeDeg` (default
0 degrees), matching the project's south-pole convention.

## Site horizon profile JSON

The repository archive did not include the planned
`apps/web/public/data/sites/shackleton_rim_01.json`. Until that file is
available, this package defines the following site profile contract:

```json
{
  "siteId": "example-site",
  "name": "Example site",
  "latitudeDeg": -89.9,
  "longitudeDeg": 0.0,
  "siteElevationM": 0,
  "mastHeightM": 0,
  "horizonAzimuthStepDeg": 90,
  "horizonElevationDeg": [0, 0, 0, 0]
}
```

`horizonElevationDeg` must contain exactly `360 / horizonAzimuthStepDeg`
finite samples, indexed from azimuth 0 degrees clockwise from local north. A
production 0.25-degree skyline therefore contains 1440 samples.
`siteElevationM` and `mastHeightM` are measured above the 1737.4 km reference
radius and converted to kilometres internally.

## Visibility model

`calculateVisibility` evaluates the local skyline separately at each target's
azimuth. It calculates circular-disc occultation using the analytic segment
area fraction, so a partially visible solar disc contributes proportionally to
`solarIrradianceWm2`. Irradiance is direct-normal top-of-atmosphere irradiance
scaled by the inverse-square Sun distance and the visible fraction; it is not
panel-plane power. Earth communications require the entire Earth disc to clear
the terrain by the configurable margin (default 1 degree).

`findVisibilityWindows` groups contiguous `SUN_ILLUMINATION`, `SUN_SHADOW`,
and `EARTH_COMMS` states. Window boundaries are linearly interpolated between
adjacent samples using the corresponding limb-clearance metric. The result
resolves crossings only to the sampling density supplied by the caller; sample
closely enough to capture short-lived windows and multiple crossings.

## Horizons gate

`parseHorizonsObserverTable` parses the CSV rows embedded in a Horizons API `result` string, retaining only apparent azimuth/elevation observations for the explicitly selected target. `validateAgainstHorizons` compares topocentric directions by spherical angular
separation and defaults to a 0.05-degree tolerance. The cached repository
Horizons files are raw API text responses and contain separate target/site
queries; they must be parsed and paired with the matching site's results before
being passed to this function. Passing this gate is evidence only for the
provided comparison samples, not a blanket accuracy guarantee for all dates.

## Commands

- `npm test` — run Vitest unit tests.
- `npm run typecheck` — type-check the package source.
