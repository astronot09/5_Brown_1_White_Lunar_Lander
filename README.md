# Lunar Skyline (`5_Brown_1_White_Lunar_Lander`)

**NASA Space Apps Challenge 2026 — Lunar Landing Site Navigator**

A physics-informed, static-first pipeline for terrain-aware Sun and Earth visibility analysis at lunar landing sites with rigorous control validation.

---

## Architecture & Repository Layout

```text
5_Brown_1_White_Lunar_Lander/
├── pipeline/                 # Python 3.11+ offline SPICE & LOLA DEM ray-casting pipeline
├── packages/
│   └── lunar-core/           # TypeScript browser engine (transforms, visibility, events, gates)
├── apps/
│   └── web/                  # React + Vite + OpenLayers + D3 dashboard & educational games
├── data/
│   ├── kernels/              # NAIF SPICE kernels (~45 MB, gitignored, SHA-256 tracked)
│   ├── dem/                  # PGDA Product 90 & Product 78 LOLA DEM tiles (gitignored)
│   ├── horizons-ref/         # Cached JPL Horizons DE441 baselines for offline CI
│   └── manifest.json         # SHA-256 checksums for all inputs & derived artefacts
└── docs/                     # DATA.md, METHODOLOGY.md, VALIDATION.md, LIMITATIONS.md, AI-USE.md