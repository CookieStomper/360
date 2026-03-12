import React from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
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

export default function Viewer360({ imageUrl, showGrid, gridInterval, satelliteData, epochIndex, constellationFilter, trackMode }) {
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
                    constellationFilter={constellationFilter}
                    trackMode={trackMode}
                />
                <OrbitControls enableZoom={false} enablePan={false} rotateSpeed={-0.5} />
            </Canvas>
        </div>
    );
}
