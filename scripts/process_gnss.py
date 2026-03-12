#!/usr/bin/env python3
"""
Process RINEX navigation file to compute satellite elevation/azimuth
and export as JSON for the 360 viewer overlay.

Uses find_sv_states to compute positions directly from broadcast
ephemeris — no observation file needed.
"""

import json
import os
import warnings
import numpy as np
import gnss_lib_py as glp

warnings.filterwarnings("ignore")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

NAV_FILE = os.path.join(PROJECT_DIR, "Input", "REC500SWE_R_20253021421_01D_MN.rnx")
OUTPUT_FILE = os.path.join(PROJECT_DIR, "public", "satellite_data.json")

RX_ECEF = np.array([3003886.7332, 877841.8022, 5539159.0243])

CONSTELLATION_MAP = {
    "gps": "GPS",
    "galileo": "Galileo",
    "beidou": "BeiDou",
    "glonass": "GLONASS",
}

# GLONASS uses state vectors rather than Keplerian elements,
# so find_sv_states won't work for it.
KEPLERIAN_CONSTELLATIONS = {"gps", "galileo", "beidou"}

STEP_MINUTES = 5


def main():
    print("Loading RINEX navigation file...")
    rinex_nav = glp.RinexNav(NAV_FILE)
    print(f"  Nav records: {len(rinex_nav)}")

    nav_gnss_ids = set(rinex_nav["gnss_id"])
    print(f"  Constellations in nav: {nav_gnss_ids}")

    keplerian_nav = rinex_nav.where(
        "gnss_id", list(KEPLERIAN_CONSTELLATIONS & nav_gnss_ids)
    )
    print(f"  Keplerian nav records: {len(keplerian_nav)}")

    nav_millis = keplerian_nav["gps_millis"]
    t_start = float(np.min(nav_millis))
    t_end = float(np.max(nav_millis))
    step_ms = STEP_MINUTES * 60 * 1000
    epoch_millis_list = np.arange(t_start, t_end, step_ms).tolist()
    print(f"  Time range: {(t_end - t_start) / 3600000:.1f} hours")
    print(f"  Epochs to compute: {len(epoch_millis_list)} (every {STEP_MINUTES} min)")

    print("Computing satellite positions and el/az...")
    satellites = {}
    for epoch_idx, ms in enumerate(epoch_millis_list):
        if epoch_idx % 50 == 0:
            print(f"  Epoch {epoch_idx}/{len(epoch_millis_list)}...")

        try:
            sv_states = glp.find_sv_states(int(ms), keplerian_nav)
        except Exception:
            continue

        if len(sv_states) == 0:
            continue

        sv_ecef = np.array([
            sv_states["x_sv_m"],
            sv_states["y_sv_m"],
            sv_states["z_sv_m"],
        ]).astype(float)

        el_az = glp.ecef_to_el_az(RX_ECEF, sv_ecef)

        for j in range(len(sv_states)):
            el = float(el_az[0, j])
            az = float(el_az[1, j])
            if np.isnan(el) or np.isnan(az) or el <= 0:
                continue

            sv_id = str(sv_states["sv_id", j])
            gnss_id = str(sv_states["gnss_id", j])
            constellation = CONSTELLATION_MAP.get(gnss_id, gnss_id)

            if sv_id not in satellites:
                satellites[sv_id] = {
                    "constellation": constellation,
                    "track": [],
                    "_seen_epochs": set(),
                }

            if epoch_idx not in satellites[sv_id]["_seen_epochs"]:
                satellites[sv_id]["_seen_epochs"].add(epoch_idx)
                satellites[sv_id]["track"].append(
                    [epoch_idx, round(el, 1), round(az, 1)]
                )

    for sv_data in satellites.values():
        sv_data["track"].sort(key=lambda p: p[0])
        del sv_data["_seen_epochs"]

    rx_lla = glp.ecef_to_geodetic(RX_ECEF.reshape(3, 1))
    output = {
        "receiver": {
            "lat": float(rx_lla[0, 0]),
            "lon": float(rx_lla[1, 0]),
            "height": float(rx_lla[2, 0]),
        },
        "epochs": epoch_millis_list,
        "satellites": satellites,
    }

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f)

    total_points = sum(len(s["track"]) for s in satellites.values())
    print(f"\nDone! Output: {OUTPUT_FILE}")
    print(f"  Satellites: {len(satellites)}")
    print(f"  Epochs: {len(epoch_millis_list)}")
    print(f"  Total track points: {total_points}")
    file_size_mb = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print(f"  File size: {file_size_mb:.1f} MB")


if __name__ == "__main__":
    main()
