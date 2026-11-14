import hashlib
import json
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"

CATEGORY_MAP = {
    "kernels": "SPICE_KERNEL",
    "dem": "LOLA_DEM",
    "horizons-ref": "HORIZONS_BASELINE",
}

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def build_manifest() -> dict:
    entries = []
    if DATA_DIR.exists():
        for filepath in sorted(DATA_DIR.rglob("*")):
            if not filepath.is_file() or filepath.name == "manifest.json":
                continue
            rel_path = filepath.relative_to(ROOT_DIR).as_posix()
            subfolder = filepath.parent.name
            category = CATEGORY_MAP.get(subfolder, "OTHER")
            entries.append({
                "path": rel_path,
                "category": category,
                "sha256": sha256_file(filepath),
                "sizeBytes": filepath.stat().st_size,
            })

    return {
        "schemaVersion": "1.0.0",
        "entries": entries,
    }

def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    manifest = build_manifest()
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[OK] Updated {MANIFEST_PATH} with {len(manifest['entries'])} tracked files.")

if __name__ == "__main__":
    main()