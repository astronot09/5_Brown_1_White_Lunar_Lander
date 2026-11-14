import hashlib, json, os, urllib.request

BASE = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"
KERNELS = [
    "spk/planets/de440s.bsp",
    "pck/moon_pa_de440_200625.bpc",
    "fk/satellites/moon_de440_250416.tf",
    "fk/satellites/moon_assoc_me.tf",
    "pck/pck00011.tpc",
    "lsk/naif0012.tls",
]

manifest = {"kernels": {}}
os.makedirs("data/kernels", exist_ok=True)
for rel in KERNELS:
    fname = os.path.basename(rel)
    dest = os.path.join("data/kernels", fname)
    if not os.path.exists(dest):
        print(f"Downloading {fname}...")
        urllib.request.urlretrieve(BASE + rel, dest)
    h = hashlib.sha256(open(dest, "rb").read()).hexdigest()
    manifest["kernels"][fname] = {"url": BASE + rel, "sha256": h}

with open("data/manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)
print("Kernels verified and manifest written.")
