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

function SatelliteTrack({ svId, track, color }) {
    const points = useMemo(() => {
        const segments = [];
        let currentSegment = [];

        for (let i = 0; i < track.length; i++) {
            const [t, el, az] = track[i];
            if (el <= 0) {
                if (currentSegment.length >= 2) segments.push(currentSegment);
                currentSegment = [];
                continue;
            }
            const pos = elAzToPosition(el, az);
            currentSegment.push(pos);

            const nextT = i < track.length - 1 ? track[i + 1][0] : null;
            if (nextT !== null && nextT - t > 3) {
                if (currentSegment.length >= 2) segments.push(currentSegment);
                currentSegment = [];
            }
        }
        if (currentSegment.length >= 2) segments.push(currentSegment);
        return segments;
    }, [track]);

    return points.map((seg, i) => (
        <Line
            key={`${svId}-seg-${i}`}
            points={seg}
            color={color}
            opacity={0.25}
            transparent
            lineWidth={1}
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

function SatelliteMarker({ svId, el, az, color, snr, isTracked }) {
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

    const borderColor = isTracked ? color : '#666';
    const snrBadgeColor = snrColor(snr);

    return (
        <Html position={position} center style={{ pointerEvents: 'none' }}>
            <div ref={wrapperRef} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                background: 'rgba(0,0,0,0.5)',
                border: `1px solid ${borderColor}`,
                borderRadius: 4,
                padding: '1px 5px',
                color: isTracked ? color : '#666',
                fontSize: 11,
                fontFamily: 'monospace',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                opacity: isTracked ? 1 : 0.5,
            }}>
                <span>{svId}</span>
                {snr != null && (
                    <span style={{ color: snrBadgeColor, fontSize: 9 }}>
                        {snr.toFixed(0)}
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

const SatelliteOverlay = ({ satelliteData, epochIndex, constellationFilter, trackMode }) => {
    if (!satelliteData) return null;

    const { satellites } = satelliteData;

    const visibleSvIds = useMemo(() => {
        const ids = new Set();
        for (const [svId, sv] of Object.entries(satellites)) {
            if (!constellationFilter[sv.constellation]) continue;
            const pos = interpolatePosition(sv.track, epochIndex);
            if (pos) ids.add(svId);
        }
        return ids;
    }, [satellites, epochIndex, constellationFilter]);

    const visibleSatellites = useMemo(() => {
        const result = [];
        for (const [svId, sv] of Object.entries(satellites)) {
            if (!visibleSvIds.has(svId)) continue;
            const pos = interpolatePosition(sv.track, epochIndex);
            if (pos) {
                let snr = null;
                let isTracked = false;
                if (sv.observed) {
                    let bestObs = null, bestObsDist = Infinity;
                    for (const point of sv.observed) {
                        const d = Math.abs(point[0] - epochIndex);
                        if (d < bestObsDist) { bestObsDist = d; bestObs = point; }
                    }
                    if (bestObs && bestObsDist <= 1) {
                        isTracked = true;
                        snr = bestObs[1];
                    }
                }
                result.push({
                    svId,
                    constellation: sv.constellation,
                    el: pos.el,
                    az: pos.az,
                    snr,
                    isTracked,
                    color: CONSTELLATION_COLORS[sv.constellation] || '#ffffff',
                });
            }
        }
        return result;
    }, [satellites, epochIndex, visibleSvIds]);

    const tracksToRender = useMemo(() => {
        return Object.entries(satellites).filter(([svId, sv]) => {
            if (!constellationFilter[sv.constellation]) return false;
            if (trackMode === 'active') return visibleSvIds.has(svId);
            return true;
        });
    }, [satellites, constellationFilter, trackMode, visibleSvIds]);

    return (
        <group>
            {tracksToRender.map(([svId, sv]) => (
                <SatelliteTrack
                    key={`track-${svId}`}
                    svId={svId}
                    track={sv.track}
                    color={CONSTELLATION_COLORS[sv.constellation] || '#ffffff'}
                />
            ))}
            {visibleSatellites.map((sat) => (
                <SatelliteMarker
                    key={`marker-${sat.svId}`}
                    svId={sat.svId}
                    el={sat.el}
                    az={sat.az}
                    color={sat.color}
                    snr={sat.snr}
                    isTracked={sat.isTracked}
                />
            ))}
        </group>
    );
};

export default SatelliteOverlay;
