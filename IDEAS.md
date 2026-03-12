# Ideas for Future Implementation

**Scope:** This is a visual site inspection tool for ocular control — see what the antenna sees, identify obstacles, correlate with signal quality. Not a scientific GNSS analysis suite.

---

## Visualization

### 2D Skyplot View
Classic polar skyplot (north up, zenith at center, horizon on outer ring). Toggle alongside the 3D sphere. Easier to compare against reference tools and quickly read el/az. Color by constellation or SNR.

### SNR Heat Map
Aggregate SNR over the full observation window by direction (az/el bins). Overlay on the 360 photo or skyplot to highlight persistent weak signal zones — reveals trees, buildings, reflectors that degrade signal. The core use case: see the obstacle, see the signal impact.

### DOP Over Time
Simple time series of PDOP across the observation window. Identify problem periods. Pair with satellite count.

---

## Features

### Multipath Indication
Extract multipath estimates from the observation data using the classic code-minus-carrier (CMC) combination: `MP1 = C1 - L1·λ1 - 2·L2·λ2·(f1²/(f1²-f2²))`. High MP values at a given direction mean reflections from nearby surfaces. Color-code satellite tags or track segments by multipath severity — see the reflecting surface in the photo and the multipath value on the satellite behind it.

Could also aggregate multipath by azimuth/elevation bin to build a directional multipath map overlaid on the 360 photo.

### Map Link from Pseudorange
Compute a rough receiver position from pseudoranges (SPP). Generate a link to Google Maps / OpenStreetMap centered on the position. Quick way to orient yourself — "where was this antenna?"

### Aggregated Quality Summary
Keep it simple and site-focused:
- Satellite availability (% of time with good coverage)
- Mean/min PDOP
- Per-constellation satellite count over time
- Overall SNR distribution

### Export
- CSV of satellite el/az/SNR per epoch (for comparison with RTKLIB etc.)
- Screenshot / snapshot of current view

---

## Architecture

### Session Persistence
Avoid re-processing on page reload:
- **IndexedDB (client-side)**: Store parsed JSON in browser. No server infra, survives reloads. Simplest.
- **Server file cache**: Save JSON keyed by input file hash. Lightweight server-side option.

### Client-Side Obs Parsing
Obs file parsing is pure text processing — could run in JavaScript. Avoids uploading the large obs file to the server. Nav computation stays server-side.

---

## Validation

### RTKLIB Cross-Reference
Compare computed el/az against RTKLIB skyplot for same data. Trusted reference.

### Photo-Based Validation
The core strength of this tool: physical obstructions visible in the 360 photo should correlate with low SNR / untracked satellites. If a satellite tag sits behind a tree and shows red SNR — the tool is working.
