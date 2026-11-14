# Lunar Skyline (`5_Brown_1_White_Lunar_Lander`)

**NASA Space Apps Challenge 2026 — Lunar Landing Site Navigator**

A physics-informed, static-first pipeline for terrain-aware Sun and Earth visibility analysis at lunar landing sites with rigorous control validation.

---

## Architecture & Repository Layout

```text
5_Brown_1_White_Lunar_Lander/
├── pipeline/                 # Python 3.11+ offline SPICE & LOLA DEM ray-casting pipeline
│   ├── download_data.py      # Fetches NAIF SPICE kernels & JPL Horizons DE441 baselines
│   ├── generate_horizon.py   # 360° terrain ray-caster outputting SiteHorizonProfile JSONs
│   ├── update_manifest.py    # Generates SHA-256 checksums for data/manifest.json
│   └── tests/                # Pytest suite verifying schemas and manifest integrity
├── packages/
│   └── lunar-core/           # TypeScript browser astronomy & visibility engine
│       ├── src/
│       │   ├── types.ts      # Shared data contracts
│       │   ├── ephemeris.ts  # Topocentric Sun & Earth azimuth/elevation calculations
│       │   ├── geometry.ts   # Spherical & horizon occultation geometry helpers
│       │   ├── visibility.ts # Partial solar disc occultation & visibility windows
│       │   ├── gates.ts      # 0.05° control validation gates against JPL Horizons
│       │   └── index.ts      # Public package exports
│       └── tests/            # Vitest unit test suite (ephemeris, visibility, gates)
├── apps/
│   └── web/                  # React + Vite + OpenLayers + D3 dashboard & educational games
│       └── public/data/sites/# Pre-computed landing site horizon profiles & index.json
├── data/
│   ├── kernels/              # NAIF SPICE kernels (gitignored, SHA-256 tracked)
│   ├── dem/                  # PGDA Product 90 & Product 78 LOLA DEM tiles (gitignored)
│   ├── horizons-ref/         # Cached JPL Horizons DE441 baselines for offline CI
│   └── manifest.json         # SHA-256 checksums for all inputs & derived artefacts
└── docs/                     # DATA.md, METHODOLOGY.md, VALIDATION.md, LIMITATIONS.md, AI-USE.md