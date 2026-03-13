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

STEP_MINUTES = 5
GPS_EPOCH = datetime(1980, 1, 6, tzinfo=timezone.utc)

BDT_WEEK_OFFSET = 1356
GAL_WEEK_OFFSET = 1024

# GLONASS orbital propagation constants (PZ-90)
_GLO_MU = 3.9860044e14        # m^3/s^2
_GLO_AE = 6378136.0           # m
_GLO_J2 = 1082625.75e-9
_GLO_OMEGA_E = 7.2921151467e-5  # rad/s
_GLO_STEP = 60.0              # integration step (seconds)


def make_sv_key(gnss_id, sv_num):
    prefix = GNSS_ID_PREFIX.get(gnss_id, "?")
    return f"{prefix}{int(sv_num):02d}"


def datetime_to_gps_millis(dt):
    delta = dt - GPS_EPOCH
    return delta.total_seconds() * 1000


def _glonass_deriv(state, ax_ls, ay_ls, az_ls):
    """Equations of motion for GLONASS (PZ-90 ECEF frame)."""
    x, y, z, vx, vy, vz = state
    r2 = x * x + y * y + z * z
    r = np.sqrt(r2)
    r3 = r * r2
    r5 = r3 * r2
    c = 1.5 * _GLO_J2 * _GLO_MU * _GLO_AE ** 2
    z2_r2 = z * z / r2

    ax = (-_GLO_MU * x / r3
          + c * x / r5 * (1 - 5 * z2_r2)
          + _GLO_OMEGA_E ** 2 * x + 2 * _GLO_OMEGA_E * vy + ax_ls)
    ay = (-_GLO_MU * y / r3
          + c * y / r5 * (1 - 5 * z2_r2)
          + _GLO_OMEGA_E ** 2 * y - 2 * _GLO_OMEGA_E * vx + ay_ls)
    az = (-_GLO_MU * z / r3
          + c * z / r5 * (3 - 5 * z2_r2)
          + az_ls)
    return np.array([vx, vy, vz, ax, ay, az])


def glonass_propagate(x0, y0, z0, vx0, vy0, vz0, ax0, ay0, az0, dt):
    """
    Propagate GLONASS satellite state by dt seconds using RK4.
    Inputs in meters, m/s, m/s². Returns (x, y, z) in meters.
    """
    if abs(dt) < 1e-3:
        return x0, y0, z0

    state = np.array([x0, y0, z0, vx0, vy0, vz0], dtype=np.float64)
    sign = 1.0 if dt >= 0 else -1.0
    remaining = abs(dt)

    while remaining > 1e-3:
        h = sign * min(_GLO_STEP, remaining)
        k1 = _glonass_deriv(state, ax0, ay0, az0)
        k2 = _glonass_deriv(state + h / 2 * k1, ax0, ay0, az0)
        k3 = _glonass_deriv(state + h / 2 * k2, ax0, ay0, az0)
        k4 = _glonass_deriv(state + h * k3, ax0, ay0, az0)
        state += h / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
        remaining -= abs(h)

    return state[0], state[1], state[2]


SYS_NAMES = {"G": "GPS", "E": "Galileo", "R": "GLONASS", "C": "BeiDou", "J": "QZSS", "S": "SBAS"}


def parse_obs_header(f):
    obs_types = {}
    rx_ecef = None
    meta = {
        "marker": None,
        "receiver": None,
        "antenna": None,
        "interval": None,
        "constellations": [],
    }
    current_sys = None
    for line in f:
        label = line[60:].strip()
        if label == "END OF HEADER":
            break
        if label == "APPROX POSITION XYZ":
            parts = line[:60].split()
            rx_ecef = np.array([float(parts[0]), float(parts[1]), float(parts[2])])
        if label == "MARKER NAME":
            meta["marker"] = line[:60].strip() or None
        if label == "REC # / TYPE / VERS":
            meta["receiver"] = line[20:40].strip() or None
        if label == "ANT # / TYPE":
            meta["antenna"] = line[20:40].strip() or None
        if label == "INTERVAL":
            try:
                meta["interval"] = float(line[:60].split()[0])
            except (ValueError, IndexError):
                pass
        if label == "SYS / # / OBS TYPES":
            if line[0] != " ":
                current_sys = line[0]
                obs_types[current_sys] = line[7:60].split()
            else:
                obs_types[current_sys].extend(line[7:60].split())
    meta["constellations"] = [SYS_NAMES.get(s, s) for s in sorted(obs_types.keys())]
    return obs_types, rx_ecef, meta


SPEED_OF_LIGHT = 299792458.0
L1_WAVELENGTHS = {
    "G": SPEED_OF_LIGHT / 1575.42e6,   # GPS L1
    "E": SPEED_OF_LIGHT / 1575.42e6,   # Galileo E1
    "R": SPEED_OF_LIGHT / 1602.0e6,    # GLONASS L1 (nominal center)
    "C": SPEED_OF_LIGHT / 1561.098e6,  # BeiDou B1
}


def _find_column(obs_type_list, prefix):
    """Find the first column index whose type starts with the given prefix."""
    for i, ot in enumerate(obs_type_list):
        if ot.startswith(prefix):
            return i
    return None


def _read_obs_value(line, col_idx):
    val_start = 3 + col_idx * 16
    val_end = val_start + 14
    if val_end > len(line):
        return None
    raw = line[val_start:val_end].strip()
    try:
        return float(raw) if raw else None
    except ValueError:
        return None


def parse_obs_file(filepath):
    epochs = {}
    rx_ecef = None

    with open(filepath, "r") as f:
        obs_types, rx_ecef, meta = parse_obs_header(f)

        columns = {}
        for sys_char, types in obs_types.items():
            columns[sys_char] = {
                "snr": _find_column(types, "S"),
                "code": _find_column(types, "C1") if _find_column(types, "C1") is not None else _find_column(types, "C"),
                "phase": _find_column(types, "L1") if _find_column(types, "L1") is not None else _find_column(types, "L"),
            }

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
            cols = columns.get(sys_char)
            if not cols or cols["snr"] is None:
                continue

            snr = _read_obs_value(line, cols["snr"])
            code = _read_obs_value(line, cols["code"]) if cols["code"] is not None else None
            phase = _read_obs_value(line, cols["phase"]) if cols["phase"] is not None else None

            epochs[current_epoch_ms][sv_id] = (snr, code, phase)

    obs_sorted = sorted(epochs.keys())
    if obs_sorted:
        gps_epoch_dt = datetime(1980, 1, 6, tzinfo=timezone.utc)
        from datetime import timedelta
        start_dt = gps_epoch_dt + timedelta(milliseconds=obs_sorted[0])
        end_dt = gps_epoch_dt + timedelta(milliseconds=obs_sorted[-1])
        meta["obsStart"] = start_dt.strftime("%Y-%m-%d %H:%M:%S UTC")
        meta["obsEnd"] = end_dt.strftime("%Y-%m-%d %H:%M:%S UTC")
        duration_h = (obs_sorted[-1] - obs_sorted[0]) / 3_600_000
        meta["duration"] = f"{duration_h:.1f}h"
        meta["obsEpochs"] = len(obs_sorted)

    all_svs = set()
    for epoch_svs in epochs.values():
        all_svs.update(epoch_svs.keys())
    meta["totalSatellites"] = len(all_svs)

    return epochs, rx_ecef, meta


def compute_cmc(obs_epochs):
    """
    Compute detrended code-minus-carrier (CMC) multipath indicator per SV.
    Returns {sv_id: {epoch_ms: mp_value}} where mp_value is in meters.
    """
    raw_cmc = {}
    for epoch_ms, svs in obs_epochs.items():
        for sv_id, (snr, code, phase) in svs.items():
            if code is None or phase is None:
                continue
            wl = L1_WAVELENGTHS.get(sv_id[0])
            if wl is None:
                continue
            cmc = code - phase * wl
            raw_cmc.setdefault(sv_id, []).append((epoch_ms, cmc))

    for sv_id in raw_cmc:
        raw_cmc[sv_id].sort(key=lambda x: x[0])

    mp_result = {}
    WINDOW = 5
    for sv_id, series in raw_cmc.items():
        if len(series) < 3:
            continue
        values = np.array([v for _, v in series])
        smoothed = np.convolve(values, np.ones(WINDOW) / WINDOW, mode="same")
        detrended = np.abs(values - smoothed)
        mp_result[sv_id] = {}
        for i, (epoch_ms, _) in enumerate(series):
            mp_result[sv_id][epoch_ms] = round(float(detrended[i]), 3)

    return mp_result


def _fix_constellation_gps_weeks(nav_data):
    """Populate gps_week from constellation-specific week fields."""
    gps_weeks = nav_data["gps_week"].astype(float)

    beidou_mask = nav_data["gnss_id"] == "beidou"
    if np.any(beidou_mask):
        bdt_weeks = nav_data["BDTWeek"].astype(float)
        gps_weeks[beidou_mask] = bdt_weeks[beidou_mask] + BDT_WEEK_OFFSET

    galileo_mask = nav_data["gnss_id"] == "galileo"
    if np.any(galileo_mask):
        gal_weeks = nav_data["GALWeek"].astype(float)
        gps_weeks[galileo_mask] = gal_weeks[galileo_mask] + GAL_WEEK_OFFSET

    nav_data["gps_week"] = gps_weeks
    return nav_data


def _build_glonass_ephem_index(glo_nav):
    """
    Group GLONASS ephemeris by SV and sort by reference time.
    Returns {sv_id: [(gps_millis, record_index), ...]}
    """
    index = {}
    for j in range(len(glo_nav)):
        sv = int(glo_nav["sv_id", j])
        ms = float(glo_nav["gps_millis", j])
        if np.isnan(ms):
            continue
        index.setdefault(sv, []).append((ms, j))
    for sv in index:
        index[sv].sort()
    return index


def _glonass_positions_at_epoch(glo_nav, glo_index, epoch_ms):
    """
    Compute GLONASS satellite ECEF positions at a given epoch
    by propagating from the closest ephemeris using RK4.
    Returns list of (sv_id, x, y, z).
    """
    MAX_DT = 16200  # max ~4.5 hours from reference epoch (handles sparse ephemeris)
    results = []

    for sv, records in glo_index.items():
        best_j = None
        best_dt = float("inf")
        for ref_ms, j in records:
            dt = abs(epoch_ms - ref_ms)
            if dt < best_dt:
                best_dt = dt
                best_j = j
        if best_j is None or best_dt / 1000 > MAX_DT:
            continue

        dt_sec = (epoch_ms - float(glo_nav["gps_millis", best_j])) / 1000.0
        x0 = float(glo_nav["X", best_j])
        y0 = float(glo_nav["Y", best_j])
        z0 = float(glo_nav["Z", best_j])
        vx0 = float(glo_nav["dX", best_j])
        vy0 = float(glo_nav["dY", best_j])
        vz0 = float(glo_nav["dZ", best_j])
        ax0 = float(glo_nav["dX2", best_j])
        ay0 = float(glo_nav["dY2", best_j])
        az0 = float(glo_nav["dZ2", best_j])

        if any(np.isnan(v) for v in [x0, y0, z0, vx0, vy0, vz0]):
            continue

        x, y, z = glonass_propagate(x0, y0, z0, vx0, vy0, vz0, ax0, ay0, az0, dt_sec)
        results.append((sv, x, y, z))

    return results


SUPPORTED_SYS = {"G", "E", "R", "C"}
NAV_RECORD_LINES = {"G": 8, "E": 8, "R": 4, "C": 8, "J": 8, "I": 8, "S": 4}


def _filter_nav_file(nav_path):
    """
    Filter a RINEX 3 nav file to only keep supported constellations (G/E/R/C).
    Returns path to a filtered temp file, or the original if no filtering needed.
    """
    import tempfile

    with open(nav_path, "r") as f:
        lines = f.readlines()

    header_end = 0
    for i, line in enumerate(lines):
        if "END OF HEADER" in line:
            header_end = i + 1
            break

    unsupported = set()
    i = header_end
    while i < len(lines):
        line = lines[i]
        if len(line) >= 1 and line[0].isalpha() and line[0] not in SUPPORTED_SYS:
            unsupported.add(line[0])
        i += 1

    if not unsupported:
        return nav_path

    filtered = lines[:header_end]
    i = header_end
    while i < len(lines):
        line = lines[i]
        if len(line) >= 1 and line[0].isalpha():
            sys_char = line[0]
            n_lines = NAV_RECORD_LINES.get(sys_char, 8)
            if sys_char in SUPPORTED_SYS:
                filtered.extend(lines[i:i + n_lines])
            i += n_lines
        else:
            i += 1

    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".rnx", delete=False)
    tmp.writelines(filtered)
    tmp.close()
    return tmp.name


def compute_nav_el_az(nav_file, rx_ecef, on_progress=None):
    if on_progress:
        on_progress("Parsing navigation file...")
    filtered_path = _filter_nav_file(nav_file)
    try:
        rinex_nav = glp.RinexNav(filtered_path)
    finally:
        if filtered_path != nav_file:
            import os
            os.unlink(filtered_path)
    nav_gnss_ids = set(rinex_nav["gnss_id"])

    _fix_constellation_gps_weeks(rinex_nav)

    keplerian_ids = {"gps", "galileo", "beidou"} & nav_gnss_ids
    keplerian_nav = rinex_nav.where("gnss_id", list(keplerian_ids)) if keplerian_ids else None

    has_glonass = "glonass" in nav_gnss_ids
    glo_nav = rinex_nav.where("gnss_id", "glonass") if has_glonass else None
    glo_index = _build_glonass_ephem_index(glo_nav) if glo_nav else {}

    all_millis = rinex_nav["gps_millis"].astype(float)
    t_start = float(np.nanmin(all_millis))
    t_end = float(np.nanmax(all_millis))
    step_ms = STEP_MINUTES * 60 * 1000
    epoch_millis_list = np.arange(t_start, t_end, step_ms).tolist()
    total_epochs = len(epoch_millis_list)

    if on_progress:
        on_progress(f"Computing satellite positions ({total_epochs} epochs)...")

    el_az_data = {}

    for epoch_idx, ms in enumerate(epoch_millis_list):
        if on_progress and epoch_idx % 10 == 0:
            pct = int(epoch_idx / total_epochs * 100)
            on_progress(f"Computing epoch {epoch_idx}/{total_epochs} ({pct}%)", pct)

        positions = []

        if keplerian_nav is not None:
            try:
                sv_states = glp.find_sv_states(int(ms), keplerian_nav)
                for j in range(len(sv_states)):
                    x = float(sv_states["x_sv_m", j])
                    y = float(sv_states["y_sv_m", j])
                    z = float(sv_states["z_sv_m", j])
                    if np.isnan(x) or np.isnan(y) or np.isnan(z):
                        continue
                    gid = str(sv_states["gnss_id", j])
                    sv = sv_states["sv_id", j]
                    positions.append((gid, int(sv), x, y, z))
            except Exception:
                pass

        if glo_nav is not None:
            for sv, x, y, z in _glonass_positions_at_epoch(glo_nav, glo_index, ms):
                positions.append(("glonass", sv, x, y, z))

        if not positions:
            continue

        sv_ecef = np.array([[p[2], p[3], p[4]] for p in positions]).T
        el_az = glp.ecef_to_el_az(rx_ecef, sv_ecef)

        seen = set()
        for j, (gnss_id, sv_num, _, _, _) in enumerate(positions):
            el = float(el_az[0, j])
            az = float(el_az[1, j])
            if np.isnan(el) or np.isnan(az) or el <= 0:
                continue

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


def merge_nav_obs(el_az_data, nav_epoch_millis, obs_epochs, mp_data=None):
    obs_by_nav_epoch = {}
    obs_millis_sorted = sorted(obs_epochs.keys())
    half_step = STEP_MINUTES * 60 * 1000 / 2

    obs_ms_by_nav_idx = {}

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
                obs_ms_by_nav_idx[best_nav_idx] = obs_ms

    tracked = {}
    for nav_idx, (epoch_obs, _) in obs_by_nav_epoch.items():
        obs_ms = obs_ms_by_nav_idx.get(nav_idx)
        for sv_id, (snr, _code, _phase) in epoch_obs.items():
            if sv_id not in tracked:
                tracked[sv_id] = []
            mp_val = None
            if mp_data and sv_id in mp_data and obs_ms in mp_data[sv_id]:
                mp_val = mp_data[sv_id][obs_ms]
            tracked[sv_id].append([
                nav_idx,
                round(snr, 1) if snr is not None else None,
                mp_val,
            ])

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

        track = nav_info["track"] if nav_info else []
        # Clip track to observation range so we don't render orphan segments
        track = [p for p in track if obs_start_idx <= p[0] <= obs_end_idx]

        satellites[sv_id] = {
            "constellation": constellation,
            "track": track,
            "observed": obs_info if obs_info else [],
        }

    return satellites, obs_start_idx, obs_end_idx


def compute_snr_heatmap(satellites, az_step=10, el_step=5):
    """
    Aggregate SNR by azimuth/elevation bins across all epochs.
    Returns dict with bin config and bin data.
    """
    bins = {}

    for sv_id, sv in satellites.items():
        if not sv["track"] or not sv["observed"]:
            continue

        track_by_epoch = {p[0]: (p[1], p[2]) for p in sv["track"]}

        for obs_point in sv["observed"]:
            epoch_idx = obs_point[0]
            snr = obs_point[1]
            if snr is None or epoch_idx not in track_by_epoch:
                continue
            el, az = track_by_epoch[epoch_idx]
            if el <= 0:
                continue

            az_bin = int(az // az_step) * az_step + az_step // 2
            el_bin = int(el // el_step) * el_step + el_step // 2
            key = (az_bin, el_bin)
            if key not in bins:
                bins[key] = []
            bins[key].append(snr)

    result = []
    for (az_c, el_c), values in bins.items():
        result.append([az_c, el_c, round(float(np.mean(values)), 1)])

    return {
        "azStep": az_step,
        "elStep": el_step,
        "bins": result,
    }


def process_files(nav_path, obs_path, on_progress=None):
    """Main entry point: process nav + obs files and return result dict."""
    if on_progress:
        on_progress("Parsing observation file...")
    obs_epochs, rx_ecef, obs_meta = parse_obs_file(obs_path)

    if rx_ecef is None:
        raise ValueError("No APPROX POSITION XYZ found in observation file header")

    if on_progress:
        on_progress("Computing multipath indicators...", 5)
    mp_data = compute_cmc(obs_epochs)

    el_az_data, nav_epoch_millis = compute_nav_el_az(nav_path, rx_ecef, on_progress)

    if on_progress:
        on_progress("Merging observation data...", 95)
    satellites, obs_start_idx, obs_end_idx = merge_nav_obs(
        el_az_data, nav_epoch_millis, obs_epochs, mp_data
    )

    if on_progress:
        on_progress("Computing SNR heatmap...", 98)
    snr_heatmap = compute_snr_heatmap(satellites)

    rx_lla = glp.ecef_to_geodetic(rx_ecef.reshape(3, 1))
    return {
        "receiver": {
            "lat": float(rx_lla[0, 0]),
            "lon": float(rx_lla[1, 0]),
            "height": float(rx_lla[2, 0]),
        },
        "observation": obs_meta,
        "epochs": nav_epoch_millis,
        "obsRange": {
            "startIndex": obs_start_idx,
            "endIndex": obs_end_idx,
        },
        "satellites": satellites,
        "snrHeatmap": snr_heatmap,
    }
