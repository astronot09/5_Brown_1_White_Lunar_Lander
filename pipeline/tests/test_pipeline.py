from pipeline.generate_horizon import build_site_profile
from pipeline.update_manifest import build_manifest

def test_site_profile_schema():
    profile = build_site_profile(
        site_id="malapert_massif_01",
        name="Malapert Massif Peak",
        lat_deg=-85.98,
        lon_deg=-2.20,
        elevation_m=4820.0,
        step_deg=1.0,
    )
    assert profile["siteId"] == "malapert_massif_01"
    assert len(profile["horizonMaskDeg"]) == 360
    assert len(profile["inputSha256"]) == 64
    assert set(profile["coordinates"].keys()) == {"latDeg", "lonDeg", "elevationM"}

def test_manifest_schema():
    manifest = build_manifest()
    assert manifest["schemaVersion"] == "1.0.0"
    assert isinstance(manifest["entries"], list)