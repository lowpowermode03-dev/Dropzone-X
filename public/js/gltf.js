// Minimal binary glTF (GLB) loader — enough for static PBR meshes (no skins/animations/textures).
// Keeps Dropzone X dependency-free: no three addons required.
import * as THREE from 'three';

const TYPE_SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT_ARRAYS = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array,
  5125: Uint32Array, 5126: Float32Array,
};

function readAccessor(json, bin, index) {
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const Ctor = COMPONENT_ARRAYS[acc.componentType];
  const itemSize = TYPE_SIZES[acc.type];
  const compBytes = Ctor.BYTES_PER_ELEMENT;
  const stride = view.byteStride || compBytes * itemSize;
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new Ctor(acc.count * itemSize);
  if (stride === compBytes * itemSize && (bin.byteOffset + start) % compBytes === 0) {
    // fast path: tightly packed and correctly aligned
    out.set(new Ctor(bin.buffer, bin.byteOffset + start, acc.count * itemSize));
    return { array: out, itemSize };
  }
  const dv = new DataView(bin.buffer, bin.byteOffset);
  const readers = {
    5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16',
    5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32',
  };
  const read = readers[acc.componentType];
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < itemSize; c++) {
      out[i * itemSize + c] = dv[read](start + i * stride + c * compBytes, true);
    }
  }
  return { array: out, itemSize };
}

function buildMaterial(def) {
  const pbr = (def && def.pbrMetallicRoughness) || {};
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(...(pbr.baseColorFactor || [1, 1, 1]).slice(0, 3)),
    metalness: pbr.metallicFactor !== undefined ? pbr.metallicFactor : 0,
    roughness: pbr.roughnessFactor !== undefined ? pbr.roughnessFactor : 0.6,
  });
  if (def && def.name) mat.name = def.name;
  if (def && def.doubleSided) mat.side = THREE.DoubleSide;
  const emissive = def && def.emissiveFactor;
  if (emissive) mat.emissive.setRGB(emissive[0], emissive[1], emissive[2]);
  return mat;
}

export function parseGLB(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a GLB file');
  let json = null, bin = null;
  let offset = 12;
  while (offset < dv.byteLength) {
    const len = dv.getUint32(offset, true);
    const type = dv.getUint32(offset + 4, true);
    const chunk = new Uint8Array(arrayBuffer, offset + 8, len);
    if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004E4942) bin = chunk;
    offset += 8 + len;
  }
  if (!json || !bin) throw new Error('GLB missing chunks');
  const materials = (json.materials || []).map(buildMaterial);
  const meshes = (json.meshes || []).map((meshDef) => {
    const grp = new THREE.Group();
    grp.name = meshDef.name || 'mesh';
    for (const prim of meshDef.primitives) {
      const geo = new THREE.BufferGeometry();
      const pos = readAccessor(json, bin, prim.attributes.POSITION);
      geo.setAttribute('position', new THREE.BufferAttribute(pos.array, pos.itemSize));
      if (prim.attributes.NORMAL !== undefined) {
        const n = readAccessor(json, bin, prim.attributes.NORMAL);
        geo.setAttribute('normal', new THREE.BufferAttribute(n.array, n.itemSize));
      }
      if (prim.attributes.TEXCOORD_0 !== undefined) {
        const uv = readAccessor(json, bin, prim.attributes.TEXCOORD_0);
        geo.setAttribute('uv', new THREE.BufferAttribute(uv.array, uv.itemSize));
      }
      if (prim.indices !== undefined) {
        const idx = readAccessor(json, bin, prim.indices);
        geo.setIndex(new THREE.BufferAttribute(idx.array, 1));
      }
      if (!geo.getAttribute('normal')) geo.computeVertexNormals();
      const mat = materials[prim.material] || new THREE.MeshStandardMaterial({ color: 0xcccccc });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      grp.add(mesh);
    }
    return grp;
  });
  const buildNode = (nodeDef) => {
    const obj = nodeDef.mesh !== undefined ? meshes[nodeDef.mesh] : new THREE.Group();
    if (nodeDef.name) obj.name = nodeDef.name;
    if (nodeDef.matrix) {
      const m = new THREE.Matrix4().fromArray(nodeDef.matrix);
      m.decompose(obj.position, obj.quaternion, obj.scale);
    } else {
      if (nodeDef.translation) obj.position.fromArray(nodeDef.translation);
      if (nodeDef.rotation) obj.quaternion.fromArray(nodeDef.rotation);
      if (nodeDef.scale) obj.scale.fromArray(nodeDef.scale);
    }
    for (const childIdx of nodeDef.children || []) obj.add(buildNode(json.nodes[childIdx]));
    return obj;
  };
  const root = new THREE.Group();
  const sceneDef = json.scenes[json.scene || 0];
  for (const nodeIdx of sceneDef.nodes || []) root.add(buildNode(json.nodes[nodeIdx]));
  return root;
}

export async function loadGLB(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('GLB fetch failed: ' + res.status);
  return parseGLB(await res.arrayBuffer());
}
