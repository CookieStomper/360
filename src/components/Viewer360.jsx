import React, { useRef, useEffect } from 'react';
import { Canvas, useLoader, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Sphere } from '@react-three/drei';
import * as THREE from 'three';

function Panorama({ imageUrl }) {
    const texture = useLoader(THREE.TextureLoader, imageUrl);

    return (
        <Sphere args={[500, 60, 40]} scale={[-1, 1, 1]} rotation={[0, -Math.PI / 2, 0]}>
            <meshBasicMaterial map={texture} side={THREE.BackSide} />
        </Sphere>
    );
}

import GridOverlay from './GridOverlay';
import SatelliteOverlay from './SatelliteOverlay';

const _targetPos = new THREE.Vector3();

function CameraNavigator({ lookAtTarget }) {
    const { camera } = useThree();
    const animating = useRef(false);
    const goal = useRef(new THREE.Vector3());

    useEffect(() => {
        if (!lookAtTarget) return;
        const { el, az } = lookAtTarget;
        const elRad = THREE.MathUtils.degToRad(el);
        const azRad = THREE.MathUtils.degToRad(az);
        // Camera must be opposite to the satellite direction (looks through origin)
        goal.current.set(
            -Math.cos(elRad) * Math.sin(azRad),
            -Math.sin(elRad),
            Math.cos(elRad) * Math.cos(azRad)
        ).multiplyScalar(0.1);
        animating.current = true;
    }, [lookAtTarget]);

    useFrame(() => {
        if (!animating.current) return;
        camera.position.lerp(goal.current, 0.08);
        if (camera.position.distanceTo(goal.current) < 0.0005) {
            camera.position.copy(goal.current);
            animating.current = false;
        }
    });

    return null;
}

export default function Viewer360({ imageUrl, showGrid, gridInterval, satelliteData, epochIndex, obsStartIdx, obsEndIdx, constellationFilter, trackMode, trackColorMode, showHeatmap, lookAtTarget }) {
    if (!imageUrl) {
        return (
            <div className="flex items-center justify-center h-full bg-gray-900 text-white">
                <p>No image selected</p>
            </div>
        );
    }

    return (
        <div className="w-full h-full">
            <Canvas camera={{ position: [0, 0, 0.1] }}>
                <Panorama imageUrl={imageUrl} />
                <GridOverlay showGrid={showGrid} gridInterval={gridInterval} />
                <SatelliteOverlay
                    satelliteData={satelliteData}
                    epochIndex={epochIndex}
                    obsStartIdx={obsStartIdx ?? 0}
                    obsEndIdx={obsEndIdx ?? 0}
                    constellationFilter={constellationFilter}
                    trackMode={trackMode}
                    trackColorMode={trackColorMode}
                    showHeatmap={showHeatmap}
                />
                <CameraNavigator lookAtTarget={lookAtTarget} />
                <OrbitControls enableZoom={false} enablePan={false} rotateSpeed={-0.5} />
            </Canvas>
        </div>
    );
}
