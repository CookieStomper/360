import * as THREE from 'three';

const geometry = new THREE.SphereGeometry(1, 60, 40);
const pos = geometry.attributes.position;
const uv = geometry.attributes.uv;

function findU(targetU) {
    let minDiff = 100;
    let centerIdx = -1;
    for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i);
        const v = uv.getY(i);
        if (Math.abs(v - 0.5) < 0.1) {
            if (Math.abs(u - targetU) < minDiff) {
                minDiff = Math.abs(u - targetU);
                centerIdx = i;
            }
        }
    }
    return centerIdx;
}

const uVals = [0, 0.25, 0.5, 0.75];
uVals.forEach(target => {
    const idx = findU(target);
    console.log(`u=${target} -> x: ${pos.getX(idx).toFixed(2)}, y: ${pos.getY(idx).toFixed(2)}, z: ${pos.getZ(idx).toFixed(2)}`);
});
