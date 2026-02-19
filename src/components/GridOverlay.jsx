import React, { useMemo } from 'react';
import { Line, Text } from '@react-three/drei';
import * as THREE from 'three';

const GridOverlay = ({ showGrid, gridInterval }) => {
    if (!showGrid) return null;

    const radius = 490; // Slightly smaller than the image sphere (500)
    const color = '#ffffff';
    const opacity = 0.5;

    // Generate latitude lines (elevation)
    const elevationLines = useMemo(() => {
        const lines = [];
        // Loop from -90 to 90 degrees with the given interval
        for (let lat = -90 + gridInterval; lat < 90; lat += gridInterval) {
            const points = [];
            const phi = THREE.MathUtils.degToRad(90 - lat);

            // Create a circle at this latitude
            for (let long = 0; long <= 360; long += 5) {
                const theta = THREE.MathUtils.degToRad(long);

                const x = radius * Math.sin(phi) * Math.cos(theta);
                const y = radius * Math.cos(phi);
                const z = radius * Math.sin(phi) * Math.sin(theta);

                points.push(new THREE.Vector3(x, y, z));
            }
            lines.push(points);
        }
        return lines;
    }, [gridInterval, radius]);

    // Generate longitude lines (azimuth)
    const azimuthLines = useMemo(() => {
        const lines = [];
        const segments = 64;

        // We only need the 4 cardinal directions + intermediate lines based on interval
        // But for a grid, usually we want lines every X degrees of azimuth too
        for (let long = 0; long < 360; long += gridInterval) {
            const points = [];
            const theta = THREE.MathUtils.degToRad(long);

            for (let lat = -90; lat <= 90; lat += 5) {
                const phi = THREE.MathUtils.degToRad(90 - lat);

                const x = radius * Math.sin(phi) * Math.cos(theta);
                const y = radius * Math.cos(phi);
                const z = radius * Math.sin(phi) * Math.sin(theta);

                points.push(new THREE.Vector3(x, y, z));
            }
            lines.push(points);
        }
        return lines;
    }, [gridInterval, radius]);

    // Cardinal Directions Labels
    const labels = useMemo(() => {
        const dirs = [
            { text: 'N', rot: 0 },
            { text: 'W', rot: 90 }, // In 3D space, rotation might need adjustment based on coordinate system
            { text: 'S', rot: 180 },
            { text: 'E', rot: 270 },
        ];

        // Adjusting for standard mapping: 
        // Typically in Three.js: -Z is forward (North?), +X is Right (East), +Z is Back (South), -X is Left (West)
        // Equirectangular mapping: Center is usually facing -Z or +Z depending on offset.
        // Let's assume standard:
        // N: (0, 0, -radius)
        // E: (radius, 0, 0)
        // S: (0, 0, radius)
        // W: (-radius, 0, 0)

        return [
            { text: 'N', position: [0, 0, -radius], rotation: [0, 0, 0] },
            { text: 'S', position: [0, 0, radius], rotation: [0, Math.PI, 0] },
            { text: 'E', position: [radius, 0, 0], rotation: [0, -Math.PI / 2, 0] },
            { text: 'W', position: [-radius, 0, 0], rotation: [0, Math.PI / 2, 0] },
        ];
    }, [radius]);


    return (
        <group>
            {elevationLines.map((points, i) => (
                <Line
                    key={`lat-${i}`}
                    points={points}
                    color={color}
                    opacity={opacity}
                    transparent
                    lineWidth={1}
                />
            ))}

            {azimuthLines.map((points, i) => (
                <Line
                    key={`long-${i}`}
                    points={points}
                    color={color}
                    opacity={opacity}
                    transparent
                    lineWidth={1}
                />
            ))}

            {labels.map((label, i) => (
                <Text
                    key={i}
                    position={label.position}
                    rotation={label.rotation}
                    fontSize={20}
                    color="white"
                    anchorX="center"
                    anchorY="middle"
                >
                    {label.text}
                </Text>
            ))}
        </group>
    );
};

export default GridOverlay;
