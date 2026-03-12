import * as THREE from 'three';

const geometry = new THREE.SphereGeometry(1, 60, 40);
const pos = geometry.attributes.position;
const uv = geometry.attributes.uv;

let minU = 1, maxU = 0;
let centerIdx = -1;
let minDiff = 100;
for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    // find vertex near u=0.5, v=0.5
    if (Math.abs(v - 0.5) < 0.1) {
        if (Math.abs(u - 0.5) < minDiff) {
            minDiff = Math.abs(u - 0.5);
            centerIdx = i;
        }
    }
}
const x = pos.getX(centerIdx);
const y = pos.getY(centerIdx);
const z = pos.getZ(centerIdx);

console.log("u=0.5 vertex coordinate:", x.toFixed(2), y.toFixed(2), z.toFixed(2));
