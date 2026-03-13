#!/usr/bin/env python3
"""Quick diagnostic: compare track/observed structure for GPS vs non-GPS."""
import sys
sys.path.insert(0, 'scripts')
from process_gnss import *

NAV = 'Input/REC500SWE_R_20253021421_01D_MN.rnx'
OBS = 'Input/REC500SWE_R_20253021422_01D_30S_MO.rnx'

OUT = 'diagnose_output.txt'
out = open(OUT, 'w')
def p(*a): out.write(' '.join(str(x) for x in a) + '\n'); out.flush()

p("Loading...")
obs_epochs, rx_ecef, obs_meta = parse_obs_file(OBS)
el_az_data, nav_epoch_millis = compute_nav_el_az(NAV, rx_ecef)
mp_data = compute_cmc(obs_epochs)
satellites, obs_start_idx, obs_end_idx = merge_nav_obs(el_az_data, nav_epoch_millis, obs_epochs, mp_data)

p(f"Obs range: {obs_start_idx} - {obs_end_idx}\n")

# Compare one from each constellation
for sv_id in ['G04', 'G05', 'G06']:
    if sv_id not in satellites:
        p(f"{sv_id}: NOT IN SATELLITES")
        continue
    sv = satellites[sv_id]
    track = sv['track']
    obs = sv['observed']
    obs_epochs_set = set(pt[0] for pt in obs)

    p(f"=== {sv_id} ===")
    p(f"  track: {len(track)} pts")
    p(f"  observed: {len(obs)} pts, epochs {min(obs_epochs_set)}-{max(obs_epochs_set)}" if obs else "  observed: NONE")

    if not track:
        p("")
        continue

    # Count track points that have observed data
    track_with_obs = sum(1 for pt in track if pt[0] in obs_epochs_set)
    p(f"  track pts with obs: {track_with_obs} / {len(track)}")

    # Find segments (consecutive runs) and check which have obs - same logic as frontend
    segments = []
    seg = [track[0]] if track[0][1] > 0 else []
    for i in range(1, len(track)):
        t, el, az = track[i]
        if el <= 0:
            if len(seg) >= 2:
                seg_epochs = [pt[0] for pt in seg]
                has_obs = any(e in obs_epochs_set for e in seg_epochs)
                segments.append((seg_epochs[0], seg_epochs[-1], len(seg), has_obs))
            seg = []
            continue
        prev_t = track[i-1][0]
        if seg and t - prev_t > 3:
            if len(seg) >= 2:
                seg_epochs = [pt[0] for pt in seg]
                has_obs = any(e in obs_epochs_set for e in seg_epochs)
                segments.append((seg_epochs[0], seg_epochs[-1], len(seg), has_obs))
            seg = []
        seg.append(track[i])
    if len(seg) >= 2:
        seg_epochs = [pt[0] for pt in seg]
        has_obs = any(e in obs_epochs_set for e in seg_epochs)
        segments.append((seg_epochs[0], seg_epochs[-1], len(seg), has_obs))

    p(f"  segments: {len(segments)}, would_render: {sum(1 for s in segments if s[3])}")
    for i, (start, end, n, has_obs) in enumerate(segments[:8]):
        # Get el/az range for this segment
        seg_pts = [pt for pt in track if start <= pt[0] <= end and pt[1] > 0]
        if seg_pts:
            els = [pt[1] for pt in seg_pts]
            azs = [pt[2] for pt in seg_pts]
            p(f"    seg {i}: epochs {start}-{end} ({n} pts), el={min(els):.0f}-{max(els):.0f}, az={min(azs):.0f}-{max(azs):.0f}, has_obs={has_obs}")
        else:
            p(f"    seg {i}: epochs {start}-{end} ({n} pts), has_obs={has_obs}")
    if len(segments) > 8:
        p(f"    ... and {len(segments)-8} more")
    p("")

out.close()
print("Done - see diagnose_output.txt")
