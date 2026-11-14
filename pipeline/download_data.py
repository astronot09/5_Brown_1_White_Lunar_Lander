import json
from pathlib import Path
import requests

ROOT_DIR = Path(__file__).resolve().parent.parent
KERNELS_DIR = ROOT_DIR / "data" / "kernels"
HORIZONS_DIR = ROOT_DIR / "data" / "horizons-ref"

NAIF_KERNELS = {
    "naif0012.tls": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls",
    "pck00011.tpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc",
    "moon_pa_de421_1900-2050.bpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de421_1900-2050.bpc",
    "moon_080317.tf": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_080317.tf",
}

def download_kernels() -> None:
    KERNELS_DIR.mkdir(parents=True, exist_ok=True)
    for filename, url in NAIF_KERNELS.items():
        dest = KERNELS_DIR / filename
        if dest.exists():
            print(f"[SKIP] {filename} already exists.")
            continue
        print(f"[DOWNLOADING] {url} -> {dest}")
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        print(f"[OK] Saved {filename} ({dest.stat().st_size} bytes)")

def cache_horizons_baseline() -> None:
    HORIZONS_DIR.mkdir(parents=True, exist_ok=True)
    out_file = HORIZONS_DIR / "shackleton_rim_de441_ref.json"
    if out_file.exists():
        print("[SKIP] Horizons baseline already cached.")
        return

    params = {
        "format": "json",
        "COMMAND": "'10'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": "'129.20,-89.68,1.9452'",
        "START_TIME": "'2026-11-14 00:00'",
        "STOP_TIME": "'2026-11-15 00:00'",
        "STEP_SIZE": "'1 h'",
        "QUANTITIES": "'4'",
    }
    print("[DOWNLOADING] JPL Horizons DE441 reference baseline...")
    resp = requests.get("https://ssd.jpl.nasa.gov/api/horizons.api", params=params, timeout=60)
    resp.raise_for_status()
    out_file.write_text(json.dumps(resp.json(), indent=2), encoding="utf-8")
    print(f"[OK] Saved {out_file}")

if __name__ == "__main__":
    download_kernels()
    cache_horizons_baseline()