#!/usr/bin/env python3
"""
GNSS processing functions shared between CLI and API server.
Computes satellite el/az from nav file, extracts visibility + SNR from obs file.
"""

import json
import warnings
from datetime import datetime, timezone
import numpy as np
import gnss_lib_py as glp

warnings.filterwarnings("ignore")

CONSTELLATION_MAP = {
    "gps": "GPS",
    "galileo": "Galileo",
    "beidou": "BeiDou",
    "glonass": "GLONASS",
}

GNSS_ID_PREFIX = {
    "gps": "G",
    "galileo": "E",
    "beidou": "C",
    "glonass": "R",
}

KEPLERIAN_CONSTELLATIONS = {"gps", "galileo", "beidou"}
STEP_MINUTES = 5
GPS_EPOCH = datetime(1980, 1, 6, tzinfo=timezone.utc)


def make_sv_key(gnss_id, sv_num):
    prefix = GNSS_ID_PREFIX.get(gnss_id, "?")
    return f"{prefix}{int(sv_num):02d}"


def datetime_to_gps_millis(dt):
    delta = dt - GPS_EPOCH
    return delta.total_seconds() * 1000


def parse_obs_header(f):
    obs_types = {}
    rx_ecef = None
    current_sys = None
    for line in f:
        label = line[60:].strip()
        if label == "END OF HEADER":
            break
        if label == "APPROX POSITION XYZ":
            parts = line[:60].split()
            rx_ecef = np.array([float(parts[0]), float(parts[1]), float(parts[2])])
        if label == "SYS / # / OBS TYPES":
            if line[0] != " ":
                current_sys = line[0]
                obs_types[current_sys] = line[7:60].split()
            else:
                obs_types[current_sys].extend(line[7:60].split())
    return obs_types, rx_ecef


def find_snr_column(obs_type_list):
    for i, ot in enumerate(obs_type_list):
        if ot.startswith("S"):
            return i
    return None


def parse_obs_file(filepath):
    epochs = {}
    rx_ecef = None

    with open(filepath, "r") as f:
        obs_types, rx_ecef = parse_obs_header(f)

        snr_col = {}
        for sys_char, types in obs_types.items():
            idx = find_snr_column(types)
            if idx is not None:
                snr_col[sys_char] = idx

        current_epoch_ms = None

        for line in f:
            if line.startswith(">"):
                parts = line[2:].split()
                y, m, d, h, mi = int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3]), int(parts[4])
                s = float(parts[5])
                sec = int(s)
                usec = int((s - sec) * 1e6)
                dt = datetime(y, m, d, h, mi, sec, usec, tzinfo=timezone.utc)
                current_epoch_ms = datetime_to_gps_millis(dt)
                if current_epoch_ms not in epochs:
                    epochs[current_epoch_ms] = {}
                continue

            if current_epoch_ms is None:
                continue

            sv_id = line[0:3].strip()
            if not sv_id or len(sv_id) < 2:
                continue

            sys_char = sv_id[0]
            if sys_char not in snr_col:
                continue

            col_idx = snr_col[sys_char]
            val_start = 3 + col_idx * 16
            val_end = val_start + 14
            if val_end > len(line):
                snr = None
            else:
                raw = line[val_start:val_end].strip()
                try:
                    snr = float(raw) if raw else None
                except ValueError:
                    snr = None

            epochs[current_epoch_ms][sv_id] = snr

    return epochs, rx_ecef


def compute_nav_el_az(nav_file, rx_ecef):
    rinex_nav = glp.RinexNav(nav_file)

    nav_gnss_ids = set(rinex_nav["gnss_id"])
    keplerian_nav = rinex_nav.where(
        "gnss_id", list(KEPLERIAN_CONSTELLATIONS & nav_gnss_ids)
    )

    nav_millis = keplerian_nav["gps_millis"]
    t_start = float(np.min(nav_millis))
    t_end = float(np.max(nav_millis))
    step_ms = STEP_MINUTES * 60 * 1000
    epoch_millis_list = np.arange(t_start, t_end, step_ms).tolist()

    el_az_data = {}
    for epoch_idx, ms in enumerate(epoch_millis_list):
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

        el_az = glp.ecef_to_el_az(rx_ecef, sv_ecef)

        seen = set()
        for j in range(len(sv_states)):
            el = float(el_az[0, j])
            az = float(el_az[1, j])
            if np.isnan(el) or np.isnan(az) or el <= 0:
                continue

            gnss_id = str(sv_states["gnss_id", j])
            sv_num = sv_states["sv_id", j]
            sv_key = make_sv_key(gnss_id, sv_num)
            constellation = CONSTELLATION_MAP.get(gnss_id, gnss_id)

            if sv_key in seen:
                continue
            seen.add(sv_key)

            if sv_key not in el_az_data:
                el_az_data[sv_key] = {"constellation": constellation, "track": []}

            el_az_data[sv_key]["track"].append(
                [epoch_idx, round(el, 1), round(az, 1)]
            )

    for sv_data in el_az_data.values():
        sv_data["track"].sort(key=lambda p: p[0])

    return el_az_data, epoch_millis_list


def merge_nav_obs(el_az_data, nav_epoch_millis, obs_epochs):
    obs_by_nav_epoch = {}
    obs_millis_sorted = sorted(obs_epochs.keys())
    half_step = STEP_MINUTES * 60 * 1000 / 2

    for obs_ms in obs_millis_sorted:
        best_nav_idx = None
        best_dist = float("inf")
        for i, nav_ms in enumerate(nav_epoch_millis):
            d = abs(nav_ms - obs_ms)
            if d < best_dist:
                best_dist = d
                best_nav_idx = i
        if best_dist <= half_step:
            if best_nav_idx not in obs_by_nav_epoch or best_dist < obs_by_nav_epoch[best_nav_idx][1]:
                obs_by_nav_epoch[best_nav_idx] = (obs_epochs[obs_ms], best_dist)

    tracked = {}
    for nav_idx, (epoch_obs, _) in obs_by_nav_epoch.items():
        for sv_id, snr in epoch_obs.items():
            if sv_id not in tracked:
                tracked[sv_id] = []
            tracked[sv_id].append([nav_idx, round(snr, 1) if snr is not None else None])

    for sv_data in tracked.values():
        sv_data.sort(key=lambda p: p[0])

    obs_nav_indices = sorted(obs_by_nav_epoch.keys())
    obs_start_idx = obs_nav_indices[0] if obs_nav_indices else 0
    obs_end_idx = obs_nav_indices[-1] if obs_nav_indices else 0

    satellites = {}
    all_sv_ids = set(el_az_data.keys()) | set(tracked.keys())
    for sv_id in sorted(all_sv_ids):
        nav_info = el_az_data.get(sv_id)
        obs_info = tracked.get(sv_id)

        if nav_info:
            constellation = nav_info["constellation"]
        else:
            prefix = sv_id[0]
            constellation = {"G": "GPS", "E": "Galileo", "R": "GLONASS", "C": "BeiDou"}.get(prefix, prefix)

        satellites[sv_id] = {
            "constellation": constellation,
            "track": nav_info["track"] if nav_info else [],
            "observed": obs_info if obs_info else [],
        }

    return satellites, obs_start_idx, obs_end_idx


def process_files(nav_path, obs_path):
    """Main entry point: process nav + obs files and return result dict."""
    obs_epochs, rx_ecef = parse_obs_file(obs_path)

    if rx_ecef is None:
        raise ValueError("No APPROX POSITION XYZ found in observation file header")

    el_az_data, nav_epoch_millis = compute_nav_el_az(nav_path, rx_ecef)

    satellites, obs_start_idx, obs_end_idx = merge_nav_obs(el_az_data, nav_epoch_millis, obs_epochs)

    rx_lla = glp.ecef_to_geodetic(rx_ecef.reshape(3, 1))
    return {
        "receiver": {
            "lat": float(rx_lla[0, 0]),
            "lon": float(rx_lla[1, 0]),
            "height": float(rx_lla[2, 0]),
        },
        "epochs": nav_epoch_millis,
        "obsRange": {
            "startIndex": obs_start_idx,
            "endIndex": obs_end_idx,
        },
        "satellites": satellites,
    }
