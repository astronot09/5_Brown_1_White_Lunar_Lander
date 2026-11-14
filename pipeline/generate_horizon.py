import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
import numpy as np

try:
    import rasterio
    from rasterio.transform import rowcol
    HAS_RASTERIO = True
except ImportError:
    HAS_RASTERIO = False

ROOT_DIR = Path(__file__).resolve().parent.parent
LUNAR_RADIUS_M = 1737400.0

def compute_file_sha256(filepath: Path) -> str:
    h = hashlib.sha256()
    with filepath.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def generate_synthetic_horizon(lat_deg: float, lon_deg: float, step_deg: float) -> list[float]:
    num_steps = int(round(360.0 / step_deg))
    azimuths_rad = np.deg2rad(np.arange(num_steps) * step_deg)
    phase = math.radians((lon_deg % 360.0))
    mask = 1.8 + 4.8 * np.cos(azimuths_rad - 0.35 + phase * 0.1) + 0.6 * np.sin(3.0 * azimuths_rad)
    return [round(float(val), 3) for val in mask]

def raycast_dem_horizon(
    dem_path: Path,
    lat_deg: float,
    lon_deg: float,
    observer_elev_m: float,
    step_deg: float = 1.0,
    max_dist_m: float = 50000.0,
    radial_step_m: float = 50.0,
) -> list[float]:
    if not HAS_RASTERIO:
        raise RuntimeError("rasterio is required to read GeoTIFF DEM files.")

    num_steps = int(round(360.0 / step_deg))
    distances = np.arange(radial_step_m, max_dist_m + radial_step_m, radial_step_m)
    horizon_mask = []

    with rasterio.open(dem_path) as src:
        band = src.read(1)
        colat_rad = math.radians(90.0 + lat_deg) if lat_deg < 0 else math.radians(90.0 - lat_deg)
        r0 = 2.0 * LUNAR_RADIUS_M * math.tan(colat_rad / 2.0)
        lon_rad = math.radians(lon_deg)
        x0 = r0 * math.sin(lon_rad)
        y0 = r0 * math.cos(lon_rad) if lat_deg < 0 else -r0 * math.cos(lon_rad)

        for i in range(num_steps):
            az_rad = math.radians(i * step_deg)
            xs = x0 + distances * math.sin(az_rad)
            ys = y0 + distances * math.cos(az_rad)
            rows, cols = rowcol(src.transform, xs, ys)
            rows = np.clip(rows, 0, band.shape[0] - 1)
            cols = np.clip(cols, 0, band.shape[1] - 1)

            terrain_elevs = band[rows, cols].astype(np.float64)
            curvature_drop = (distances ** 2) / (2.0 * LUNAR_RADIUS_M)
            apparent_dz = (terrain_elevs - observer_elev_m) - curvature_drop
            angles_deg = np.rad2deg(np.arctan2(apparent_dz, distances))
            horizon_mask.append(round(float(np.max(angles_deg)), 3))

    return horizon_mask

def build_site_profile(
    site_id: str,
    name: str,
    lat_deg: float,
    lon_deg: float,
    elevation_m: float,
    dem_path: Path | None = None,
    step_deg: float = 1.0,
) -> dict:
    if dem_path and dem_path.exists():
        mask = raycast_dem_horizon(dem_path, lat_deg, lon_deg, elevation_m, step_deg=step_deg)
        dem_source = dem_path.stem
        sha = compute_file_sha256(dem_path)
    else:
        mask = generate_synthetic_horizon(lat_deg, lon_deg, step_deg)
        dem_source = "SYNTHETIC_LOLA_PRODUCT_90_FALLBACK"
        sha = hashlib.sha256(f"{site_id}:{lat_deg}:{lon_deg}".encode("utf-8")).hexdigest()

    return {
        "siteId": site_id,
        "name": name,
        "coordinates": {
            "latDeg": lat_deg,
            "lonDeg": lon_deg,
            "elevationM": elevation_m,
        },
        "demSource": dem_source,
        "azimuthStepDeg": step_deg,
        "horizonMaskDeg": mask,
        "generatedAtUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "inputSha256": sha,
    }

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate SiteHorizonProfile JSON for lunar landing sites.")
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--elev", type=float, required=True)
    parser.add_argument("--dem", type=Path, default=None, help="Optional path to LOLA DEM GeoTIFF")
    parser.add_argument("--step", type=float, default=1.0)
    args = parser.parse_args()

    profile = build_site_profile(
        site_id=args.site_id,
        name=args.name,
        lat_deg=args.lat,
        lon_deg=args.lon,
        elevation_m=args.elev,
        dem_path=args.dem,
        step_deg=args.step,
    )

    out_dir = ROOT_DIR / "apps" / "web" / "public" / "data" / "sites"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{args.site_id}.json"
    out_path.write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(f"[OK] Wrote {out_path} ({len(profile['horizonMaskDeg'])} azimuth points)")

if __name__ == "__main__":
    main()