import json, os, time, requests

URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
QUERIES = [
    {"name": "apollo11_td", "COMMAND": "'10'", "SITE_COORD": "'23.47314,0.67416,0'", "START_TIME": "'1969-07-20 20:17'", "STOP_TIME": "'1969-07-20 20:19'", "STEP_SIZE": "'1 min'", "QUANTITIES": "'4'"},
    {"name": "south_pole_season", "COMMAND": "'10'", "SITE_COORD": "'0,-90,0'", "START_TIME": "'2025-01-01'", "STOP_TIME": "'2028-06-01'", "STEP_SIZE": "'12 h'", "QUANTITIES": "'4'"},
    {"name": "change4_farside", "COMMAND": "'399'", "SITE_COORD": "'177.5991,-45.4446,0'", "START_TIME": "'2025-01-01'", "STOP_TIME": "'2026-01-01'", "STEP_SIZE": "'6 h'", "QUANTITIES": "'4'"},
    {"name": "change6_farside", "COMMAND": "'399'", "SITE_COORD": "'206.0148,-41.6385,0'", "START_TIME": "'2025-01-01'", "STOP_TIME": "'2026-01-01'", "STEP_SIZE": "'6 h'", "QUANTITIES": "'4'"},
    {"name": "eclipse_2025_03_14", "COMMAND": "'399'", "SITE_COORD": "'61.8103,18.5623,0'", "START_TIME": "'2025-03-14 04:00'", "STOP_TIME": "'2025-03-14 10:00'", "STEP_SIZE": "'1 min'", "QUANTITIES": "'4,20,23'"},
    {"name": "im1_libration", "COMMAND": "'399'", "SITE_COORD": "'1.44,-80.13,0'", "START_TIME": "'2024-02-01'", "STOP_TIME": "'2024-04-01'", "STEP_SIZE": "'2 h'", "QUANTITIES": "'4'"},
]

os.makedirs("data/horizons-ref", exist_ok=True)
for q in QUERIES:
    params = {"format": "json", "EPHEM_TYPE": "'OBSERVER'", "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'", "ANG_FORMAT": "'DEG'", "CSV_FORMAT": "'YES'"}
    params.update({k: v for k, v in q.items() if k != "name"})
    print(f"Fetching {q['name']}...")
    r = requests.get(URL, params=params, timeout=60).json()
    res = r.get("result", "")
    assert "MEAN_ME (high precision)" in res and "1737.4" in res, f"Frame check failed on {q['name']}"
    with open(f"data/horizons-ref/{q['name']}.json", "w") as f:
        json.dump(r, f, indent=2)
    time.sleep(1)
print("Horizons baseline cached and verified.")
