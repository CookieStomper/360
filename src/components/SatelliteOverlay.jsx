import React, { useMemo, useRef } from 'react';
import { Line, Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const RADIUS = 485;

const CONSTELLATION_COLORS = {
    GPS: '#1e90ff',
    Galileo: '#ff8c00',
    GLONASS: '#ff3333',
    BeiDou: '#32cd32',
};

function elAzToPosition(el, az) {
    const phi = THREE.MathUtils.degToRad(90 - el);
    const theta = THREE.MathUtils.degToRad(az);
    return new THREE.Vector3(
        RADIUS * Math.sin(phi) * Math.sin(theta),
        RADIUS * Math.cos(phi),
        -RADIUS * Math.sin(phi) * Math.cos(theta)
    );
}

function valueToColor(value, min, max, invert) {
    const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const ratio = invert ? 1 - t : t;
    const r = ratio < 0.5 ? 1 : 1 - 2 * (ratio - 0.5);
    const g = ratio < 0.5 ? 2 * ratio : 1;
    return new THREE.Color(r, g, 0.15);
}

function getTrackVertexColors(track, observed, colorMode, constellation) {
    if (colorMode === 'constellation') return null;

    const obsMap = new Map();
    if (observed) {
        for (const point of observed) {
            obsMap.set(point[0], { snr: point[1], mp: point[2] ?? null });
        }
    }

    const colors = [];
    for (const [epochIdx, el] of track) {
        if (el <= 0) continue;
        const obs = obsMap.get(epochIdx);
        let color;
        if (colorMode === 'snr') {
            const snr = obs?.snr;
            color = snr != null ? valueToColor(snr, 15, 50, false) : new THREE.Color(0.3, 0.3, 0.3);
        } else {
            const mp = obs?.mp;
            color = mp != null ? valueToColor(mp, 0, 3, true) : new THREE.Color(0.3, 0.3, 0.3);
        }
        colors.push(color);
    }
    return colors;
}

function clipSegmentToRange(seg, segColors, segEpochs, obsStartIdx, obsEndIdx) {
    const keep = segEpochs.map((e) => e >= obsStartIdx && e <= obsEndIdx);
    const clippedSeg = seg.filter((_, i) => keep[i]);
    const clippedColors = segColors?.filter((_, i) => keep[i]);
    return clippedSeg.length >= 2 ? { seg: clippedSeg, colors: clippedColors } : null;
}

function SatelliteTrack({ svId, track, color, observed, colorMode, constellation, obsStartIdx, obsEndIdx, epochIndex }) {
    const { segments, segColors } = useMemo(() => {
        const observedEpochs = new Set(observed?.map((p) => p[0]) ?? []);
        const segs = [];
        const sColors = [];
        let currentSeg = [];
        let currentColors = [];
        let currentEpochs = [];
        const vertexColors = getTrackVertexColors(track, observed, colorMode, constellation);
        let colorIdx = 0;
        const obsStart = obsStartIdx ?? 0;
        const obsEnd = obsEndIdx ?? 0;

        const pushSegment = () => {
            if (currentSeg.length < 2) return;
            const hasObs = currentEpochs.some((e) => observedEpochs.has(e));
            if (!hasObs) return;
            const segMin = Math.min(...currentEpochs);
            const segMax = Math.max(...currentEpochs);
            if (epochIndex < segMin - 1 || epochIndex > segMax + 1) return;
            const clipped = clipSegmentToRange(currentSeg, currentColors, currentEpochs, obsStart, obsEnd);
            if (clipped) {
                segs.push(clipped.seg);
                sColors.push(clipped.colors);
            }
        };

        for (let i = 0; i < track.length; i++) {
            const [t, el, az] = track[i];
            if (el <= 0) {
                pushSegment();
                currentSeg = [];
                currentColors = [];
                currentEpochs = [];
                continue;
            }
            const pos = elAzToPosition(el, az);
            currentSeg.push(pos);
            currentEpochs.push(t);
            if (vertexColors) currentColors.push(vertexColors[colorIdx]);
            colorIdx++;

            const nextT = i < track.length - 1 ? track[i + 1][0] : null;
            if (nextT !== null && nextT - t > 3) {
                pushSegment();
                currentSeg = [];
                currentColors = [];
                currentEpochs = [];
            }
        }
        pushSegment();
        return { segments: segs, segColors: sColors };
    }, [track, colorMode, observed, constellation, obsStartIdx, obsEndIdx, epochIndex]);

    const useVertexColors = colorMode !== 'constellation';

    return segments.map((seg, i) => (
        <Line
            key={`${svId}-seg-${i}`}
            points={seg}
            color={useVertexColors ? 'white' : color}
            vertexColors={useVertexColors && segColors[i]?.length === seg.length
                ? segColors[i].map(c => [c.r, c.g, c.b])
                : undefined}
            opacity={0.45}
            transparent
            lineWidth={2.5}
        />
    ));
}

const _camDir = new THREE.Vector3();
const _satDir = new THREE.Vector3();

function snrColor(snr) {
    if (snr == null) return '#888';
    if (snr >= 40) return '#4ade80';
    if (snr >= 25) return '#facc15';
    return '#f87171';
}

function mpColor(mp) {
    if (mp == null) return '#888';
    if (mp < 0.5) return '#4ade80';
    if (mp < 2) return '#facc15';
    return '#f87171';
}

function SatelliteMarker({ svId, el, az, color, snr, mp, trackColorMode }) {
    const posVec = useMemo(() => elAzToPosition(el, az), [el, az]);
    const position = useMemo(() => [posVec.x, posVec.y, posVec.z], [posVec]);
    const wrapperRef = useRef();

    useFrame(({ camera }) => {
        if (!wrapperRef.current) return;
        camera.getWorldDirection(_camDir);
        _satDir.copy(posVec).normalize();
        const facing = _camDir.dot(_satDir) > 0;
        wrapperRef.current.style.display = facing ? '' : 'none';
    });

    const showValue = trackColorMode === 'multipath' ? mp : snr;
    const valueColor = trackColorMode === 'multipath' ? mpColor(mp) : snrColor(snr);
    const valueLabel = trackColorMode === 'multipath'
        ? (mp != null ? mp.toFixed(1) : null)
        : (snr != null ? snr.toFixed(0) : null);

    return (
        <Html position={position} center style={{ pointerEvents: 'none' }}>
            <div ref={wrapperRef} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                background: 'rgba(0,0,0,0.5)',
                border: `1px solid ${color}`,
                borderRadius: 4,
                padding: '1px 5px',
                color,
                fontSize: 11,
                fontFamily: 'monospace',
                fontWeight: 600,
                whiteSpace: 'nowrap',
            }}>
                <span>{svId}</span>
                {valueLabel != null && (
                    <span style={{ color: valueColor, fontSize: 9 }}>
                        {valueLabel}
                    </span>
                )}
            </div>
        </Html>
    );
}

function interpolatePosition(track, epochIndex) {
    let best = null;
    let bestDist = Infinity;
    for (const point of track) {
        const d = Math.abs(point[0] - epochIndex);
        if (d < bestDist) {
            bestDist = d;
            best = point;
        }
    }
    if (!best || bestDist > 1 || best[1] <= 0) return null;
    return { el: best[1], az: best[2] };
}

function HeatmapCell({ pos, width, height, color }) {
    const meshRef = useRef();
    const origin = useMemo(() => new THREE.Vector3(0, 0, 0), []);

    useFrame(() => {
        if (meshRef.current) {
            meshRef.current.lookAt(origin);
        }
    });

    return (
        <mesh ref={meshRef} position={[pos.x, pos.y, pos.z]}>
            <planeGeometry args={[width, height]} />
            <meshBasicMaterial
                color={color}
                transparent
                opacity={0.25}
                side={THREE.DoubleSide}
                depthWrite={false}
            />
        </mesh>
    );
}

function HeatmapOverlayOptimized({ heatmapData }) {
    const cells = useMemo(() => {
        if (!heatmapData?.bins?.length) return [];
        const { azStep, elStep, bins } = heatmapData;
        const azRad = THREE.MathUtils.degToRad(azStep);
        const elRad = THREE.MathUtils.degToRad(elStep);

        return bins.map(([azCenter, elCenter, snr]) => {
            const pos = elAzToPosition(elCenter, azCenter);
            const phi = THREE.MathUtils.degToRad(90 - elCenter);
            const widthAtEl = Math.max(5, RADIUS * Math.sin(phi) * azRad);
            const height = RADIUS * elRad;
            const color = valueToColor(snr, 15, 50, false);
            return { pos, width: widthAtEl, height, color };
        });
    }, [heatmapData]);

    return (
        <group>
            {cells.map((cell, i) => (
                <HeatmapCell
                    key={i}
                    pos={cell.pos}
                    width={cell.width}
                    height={cell.height}
                    color={cell.color}
                />
            ))}
        </group>
    );
}

const SatelliteOverlay = ({ satelliteData, epochIndex, obsStartIdx, obsEndIdx, constellationFilter, trackMode, trackColorMode, showHeatmap }) => {
    if (!satelliteData) return null;

    const { satellites } = satelliteData;

    const trackedSvIds = useMemo(() => {
        const ids = new Set();
        for (const [svId, sv] of Object.entries(satellites)) {
            if (!constellationFilter[sv.constellation]) continue;
            if (!sv.observed || sv.observed.length === 0) continue;
            const pos = interpolatePosition(sv.track, epochIndex);
            if (!pos) continue;
            let bestObs = null, bestObsDist = Infinity;
            for (const point of sv.observed) {
                const d = Math.abs(point[0] - epochIndex);
                if (d < bestObsDist) { bestObsDist = d; bestObs = point; }
            }
            if (bestObs && bestObsDist <= 1) ids.add(svId);
        }
        return ids;
    }, [satellites, epochIndex, constellationFilter]);

    const trackedSatellites = useMemo(() => {
        const result = [];
        for (const [svId, sv] of Object.entries(satellites)) {
            if (!trackedSvIds.has(svId)) continue;
            const pos = interpolatePosition(sv.track, epochIndex);
            if (!pos) continue;
            let snr = null;
            let mp = null;
            if (sv.observed) {
                let bestObs = null, bestObsDist = Infinity;
                for (const point of sv.observed) {
                    const d = Math.abs(point[0] - epochIndex);
                    if (d < bestObsDist) { bestObsDist = d; bestObs = point; }
                }
                if (bestObs && bestObsDist <= 1) {
                    snr = bestObs[1];
                    mp = bestObs[2] ?? null;
                }
            }
            result.push({
                svId,
                constellation: sv.constellation,
                el: pos.el,
                az: pos.az,
                snr,
                mp,
                color: CONSTELLATION_COLORS[sv.constellation] || '#ffffff',
            });
        }
        return result;
    }, [satellites, epochIndex, trackedSvIds]);

    const tracksToRender = useMemo(() => {
        return Object.entries(satellites).filter(([svId, sv]) => {
            if (!constellationFilter[sv.constellation]) return false;
            if (!sv.observed || sv.observed.length === 0) return false;
            if (trackMode === 'active') return trackedSvIds.has(svId);
            return true;
        });
    }, [satellites, constellationFilter, trackMode, trackedSvIds]);

    return (
        <group>
            {tracksToRender.map(([svId, sv]) => (
                <SatelliteTrack
                    key={`track-${svId}-${trackColorMode}-${epochIndex}`}
                    svId={svId}
                    track={sv.track}
                    color={CONSTELLATION_COLORS[sv.constellation] || '#ffffff'}
                    observed={sv.observed}
                    colorMode={trackColorMode}
                    constellation={sv.constellation}
                    obsStartIdx={obsStartIdx ?? 0}
                    obsEndIdx={obsEndIdx ?? 0}
                    epochIndex={epochIndex}
                />
            ))}
            {trackedSatellites.map((sat) => (
                <SatelliteMarker
                    key={`marker-${sat.svId}`}
                    svId={sat.svId}
                    el={sat.el}
                    az={sat.az}
                    color={sat.color}
                    snr={sat.snr}
                    mp={sat.mp}
                    trackColorMode={trackColorMode}
                />
            ))}
            {showHeatmap && satelliteData.snrHeatmap && (
                <HeatmapOverlayOptimized heatmapData={satelliteData.snrHeatmap} />
            )}
        </group>
    );
};

export default SatelliteOverlay;
