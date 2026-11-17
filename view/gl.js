"use strict";

// Small WebGL toolkit for the view guide. No dependencies.
// Vectors are [x, y, z]. Matrices are column-major Float32Array(16).

const rad = (deg) => (deg * Math.PI) / 180;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

const M4 = {
  identity: () =>
    new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),

  multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    return o;
  },

  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const d = 1 / (near - far);
    return new Float32Array([
      f / aspect,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      0,
      0,
      (far + near) * d,
      -1,
      0,
      0,
      2 * far * near * d,
      0,
    ]);
  },

  // World to camera, from a pose with pos, right, up, back
  view({ pos, right, up, back }) {
    return new Float32Array([
      right[0],
      up[0],
      back[0],
      0,
      right[1],
      up[1],
      back[1],
      0,
      right[2],
      up[2],
      back[2],
      0,
      -V3.dot(right, pos),
      -V3.dot(up, pos),
      -V3.dot(back, pos),
      1,
    ]);
  },

  // Places local axes x, y, z at pos. Axis length is the scale
  frame(pos, x, y, z) {
    return new Float32Array([...x, 0, ...y, 0, ...z, 0, ...pos, 1]);
  },

  translation: (x, y, z) =>
    new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]),
};

// Camera pose on a sphere around target. Azimuth 0 is +X, 90 is +Z. Elevation 90 is straight above.
// Up follows the elevation arc, so the pose stays defined at the poles.
function orbitPose(target, azDeg, elDeg, dist, rollDeg = 0) {
  const az = rad(azDeg);
  const el = rad(elDeg);
  const back = [
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az),
  ];
  let up = [
    -Math.sin(el) * Math.cos(az),
    Math.cos(el),
    -Math.sin(el) * Math.sin(az),
  ];
  let right = V3.cross(up, back);

  if (rollDeg) {
    const c = Math.cos(rad(rollDeg));
    const s = Math.sin(rad(rollDeg));
    [right, up] = [
      V3.add(V3.scale(right, c), V3.scale(up, s)),
      V3.add(V3.scale(up, c), V3.scale(right, -s)),
    ];
  }

  return { pos: V3.add(target, V3.scale(back, dist)), right, up, back };
}

function makeCamera(pose, fovY, aspect, near, far) {
  const tanY = Math.tan(fovY / 2);
  const view = M4.view(pose);
  const proj = M4.perspective(fovY, aspect, near, far);

  return { ...pose, tanY, tanX: tanY * aspect, vp: M4.multiply(proj, view) };
}

// World point to pixel in a w by h image. front is false behind the camera
function projectPoint(cam, p, w, h) {
  const m = cam.vp;
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const ww = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];

  return {
    x: (x / ww / 2 + 0.5) * w,
    y: (0.5 - y / ww / 2) * h,
    front: ww > 0,
  };
}

// Direction of the ray through a pixel
function pixelRay(cam, px, py, w, h) {
  const nx = (px / w) * 2 - 1;
  const ny = 1 - (py / h) * 2;

  return V3.norm(
    V3.add(
      V3.scale(cam.back, -1),
      V3.add(
        V3.scale(cam.right, nx * cam.tanX),
        V3.scale(cam.up, ny * cam.tanY),
      ),
    ),
  );
}

// Nearest hit distance of a ray against a flat triangle list, Infinity on a miss
function raycast(tris, o, d) {
  const EPS = 1e-9;
  let best = Infinity;

  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i],
      ay = tris[i + 1],
      az = tris[i + 2];
    const e1x = tris[i + 3] - ax,
      e1y = tris[i + 4] - ay,
      e1z = tris[i + 5] - az;
    const e2x = tris[i + 6] - ax,
      e2y = tris[i + 7] - ay,
      e2z = tris[i + 8] - az;
    const px = d[1] * e2z - d[2] * e2y,
      py = d[2] * e2x - d[0] * e2z,
      pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < EPS) continue;

    const inv = 1 / det;
    const tx = o[0] - ax,
      ty = o[1] - ay,
      tz = o[2] - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;

    const qx = ty * e1z - tz * e1y,
      qy = tz * e1x - tx * e1z,
      qz = tx * e1y - ty * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;

    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > 1e-4 && t < best) best = t;
  }

  return best;
}

// Ear clipping for a simple 2D polygon. Returns index triples
function triangulate(poly) {
  const cross2 = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const idx = poly.map((_, i) => i);

  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) idx.reverse();

  const out = [];
  let guard = poly.length * poly.length;

  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;

    for (let i = 0; i < idx.length && !clipped; i++) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      const turn = cross2(poly[a], poly[b], poly[c]);

      // Straight run, drop the middle point
      if (Math.abs(turn) < 1e-10) {
        idx.splice(i, 1);
        clipped = true;
        break;
      }
      if (turn < 0) continue;

      const blocked = idx.some(
        (j) =>
          j !== a &&
          j !== b &&
          j !== c &&
          cross2(poly[a], poly[b], poly[j]) > 0 &&
          cross2(poly[b], poly[c], poly[j]) > 0 &&
          cross2(poly[c], poly[a], poly[j]) > 0,
      );
      if (blocked) continue;

      out.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
    }

    if (!clipped) break;
  }

  if (idx.length === 3) out.push(idx);
  return out;
}

// Collects triangles per material name plus outline segments
class MeshBuilder {
  constructor() {
    this.parts = {};
    this.lines = [];
  }

  // Normals default to the face normal. Winding does not matter, the shader faces normals to the viewer
  tri(mat, a, b, c, na, nb, nc) {
    const part = (this.parts[mat] ??= { pos: [], nrm: [] });
    if (!na) na = nb = nc = V3.norm(V3.cross(V3.sub(b, a), V3.sub(c, a)));

    part.pos.push(...a, ...b, ...c);
    part.nrm.push(...na, ...nb, ...nc);
  }

  quad(mat, a, b, c, d) {
    this.tri(mat, a, b, c);
    this.tri(mat, a, c, d);
  }

  line(a, b) {
    this.lines.push(...a, ...b);
  }

  loop(pts) {
    pts.forEach((p, i) => this.line(p, pts[(i + 1) % pts.length]));
  }

  // Six-sided solid from a bottom ring and a top ring of four points each
  hexa(mat, bot, top, edges = true) {
    this.quad(mat, ...bot);
    this.quad(mat, ...top);

    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(mat, bot[i], bot[j], top[j], top[i]);
      if (edges) this.line(bot[i], top[i]);
    }

    if (edges) {
      this.loop(bot);
      this.loop(top);
    }
  }

  // Axis-aligned box from center and size
  box(mat, [x, y, z], [sx, sy, sz], edges = true) {
    const ring = (yy) => [
      [x - sx / 2, yy, z - sz / 2],
      [x + sx / 2, yy, z - sz / 2],
      [x + sx / 2, yy, z + sz / 2],
      [x - sx / 2, yy, z + sz / 2],
    ];

    this.hexa(mat, ring(y - sy / 2), ring(y + sy / 2), edges);
  }

  // 2D outline in the XY plane, pushed from z0 to z1
  prism(mat, poly, z0, z1) {
    const SHARP = Math.cos(rad(25));
    const at = (i, z) => [poly[i][0], poly[i][1], z];
    const n = poly.length;

    for (const [i, j, k] of triangulate(poly)) {
      this.tri(mat, at(i, z0), at(j, z0), at(k, z0));
      this.tri(mat, at(i, z1), at(j, z1), at(k, z1));
    }

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const h = (i + n - 1) % n;
      this.quad(mat, at(i, z0), at(j, z0), at(j, z1), at(i, z1));
      this.line(at(i, z0), at(j, z0));
      this.line(at(i, z1), at(j, z1));

      // Cross lines only at real corners, not along curves
      const d0 = V3.norm(V3.sub(at(i, 0), at(h, 0)));
      const d1 = V3.norm(V3.sub(at(j, 0), at(i, 0)));
      if (V3.dot(d0, d1) < SHARP) this.line(at(i, z0), at(i, z1));
    }
  }

  // Capped cylinder or cone between two points
  tube(mat, a, b, ra, rb = ra, seg = 16, edges = true) {
    const d = V3.norm(V3.sub(b, a));
    const u = V3.norm(
      V3.cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]),
    );
    const v = V3.cross(d, u);
    const back = V3.scale(d, -1);
    const ring = [];

    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const o = V3.add(V3.scale(u, Math.cos(t)), V3.scale(v, Math.sin(t)));
      ring.push({
        o,
        a: V3.add(a, V3.scale(o, ra)),
        b: V3.add(b, V3.scale(o, rb)),
      });
    }

    ring.forEach((p, i) => {
      const q = ring[(i + 1) % seg];
      this.tri(mat, p.a, q.a, q.b, p.o, q.o, q.o);
      this.tri(mat, p.a, q.b, p.b, p.o, q.o, p.o);
      this.tri(mat, a, p.a, q.a, back, back, back);
      this.tri(mat, b, p.b, q.b, d, d, d);

      if (edges) {
        this.line(p.a, q.a);
        this.line(p.b, q.b);
      }
    });
  }

  ball(mat, c, r, lon = 14, lat = 8) {
    const at = (i, j) => {
      const phi = (i / lon) * Math.PI * 2;
      const th = (j / lat) * Math.PI;
      const n = [
        Math.sin(th) * Math.cos(phi),
        Math.cos(th),
        Math.sin(th) * Math.sin(phi),
      ];
      return { n, p: V3.add(c, V3.scale(n, r)) };
    };

    for (let i = 0; i < lon; i++)
      for (let j = 0; j < lat; j++) {
        const p00 = at(i, j),
          p10 = at(i + 1, j),
          p01 = at(i, j + 1),
          p11 = at(i + 1, j + 1);
        this.tri(mat, p00.p, p10.p, p11.p, p00.n, p10.n, p11.n);
        this.tri(mat, p00.p, p11.p, p01.p, p00.n, p11.n, p01.n);
      }
  }

  // Torus around the Z axis. R is the ring radius, r the thickness
  ring(mat, c, R, r, seg = 28, tseg = 8) {
    const at = (i, j) => {
      const phi = (i / seg) * Math.PI * 2;
      const th = (j / tseg) * Math.PI * 2;
      const n = [
        Math.cos(phi) * Math.cos(th),
        Math.sin(phi) * Math.cos(th),
        Math.sin(th),
      ];
      const p = [
        c[0] + Math.cos(phi) * (R + r * Math.cos(th)),
        c[1] + Math.sin(phi) * (R + r * Math.cos(th)),
        c[2] + r * Math.sin(th),
      ];
      return { n, p };
    };

    for (let i = 0; i < seg; i++)
      for (let j = 0; j < tseg; j++) {
        const p00 = at(i, j),
          p10 = at(i + 1, j),
          p01 = at(i, j + 1),
          p11 = at(i + 1, j + 1);
        this.tri(mat, p00.p, p10.p, p11.p, p00.n, p10.n, p11.n);
        this.tri(mat, p00.p, p11.p, p01.p, p00.n, p11.n, p01.n);
      }
  }

  // Typed arrays ready for the renderer, plus bounds and one triangle list for ray tests
  build() {
    const parts = Object.entries(this.parts).map(([mat, p]) => ({
      mat,
      pos: new Float32Array(p.pos),
      nrm: new Float32Array(p.nrm),
    }));
    const tris = new Float32Array(parts.reduce((n, p) => n + p.pos.length, 0));
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];

    let offset = 0;
    for (const p of parts) {
      tris.set(p.pos, offset);
      offset += p.pos.length;
    }

    for (let i = 0; i < tris.length; i++) {
      const k = i % 3;
      if (tris[i] < min[k]) min[k] = tris[i];
      if (tris[i] > max[k]) max[k] = tris[i];
    }

    return {
      parts,
      lines: { pos: new Float32Array(this.lines) },
      tris,
      min,
      max,
    };
  }
}

const VERT_SRC = `
attribute vec3 aPos;
attribute vec3 aNrm;
uniform mat4 uVP;
uniform mat4 uModel;
varying vec3 vWorld;
varying vec3 vNrm;

void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNrm = (uModel * vec4(aNrm, 0.0)).xyz;
  gl_Position = uVP * world;
}`;

const FRAG_SRC = `
precision mediump float;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uLit;
uniform vec3 uEye;
uniform vec3 uLight;
varying vec3 vWorld;
varying vec3 vNrm;

void main() {
  vec3 color = uColor;

  if (uLit > 0.5) {
    vec3 n = normalize(vNrm);
    if (dot(n, uEye - vWorld) < 0.0) n = -n;

    float sky = mix(0.5, 0.74, n.y * 0.5 + 0.5);
    float sun = max(dot(n, uLight), 0.0);
    color *= sky + 0.42 * sun;
  }

  gl_FragColor = vec4(color, uOpacity);
}`;

// Draws into its own offscreen canvas. The page copies that canvas into a 2D one
class Renderer {
  constructor() {
    this.canvas = document.createElement("canvas");
    const gl = this.canvas.getContext("webgl", {
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL is not available");
    this.gl = gl;

    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s));
      return s;
    };

    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT_SRC));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG_SRC));
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.bindAttribLocation(prog, 1, "aNrm");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    this.u = {};
    for (const name of [
      "uVP",
      "uModel",
      "uColor",
      "uOpacity",
      "uLit",
      "uEye",
      "uLight",
    ])
      this.u[name] = gl.getUniformLocation(prog, name);

    this.buffers = new WeakMap();
    this.identity = M4.identity();

    gl.enableVertexAttribArray(0);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.SCISSOR_TEST);

    // Faces sit slightly back so outlines stay on top
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);

    // Leaves premultiplied color in the canvas, which is what the browser expects
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    );
  }

  resize(w, h) {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  // Starts a region given in pixels from the top left and clears it
  begin(x, y, w, h, [r, g, b, a]) {
    const gl = this.gl;
    const bottom = this.canvas.height - y - h;

    gl.viewport(x, bottom, w, h);
    gl.scissor(x, bottom, w, h);
    gl.depthMask(true);
    gl.clearColor(r * a, g * a, b * a, a);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  // Light rides with the camera, up and to the left, so every side gets lit
  camera(cam) {
    const gl = this.gl;
    const light = V3.norm(
      V3.add(
        V3.scale(cam.back, 0.6),
        V3.add(V3.scale(cam.up, 0.65), V3.scale(cam.right, -0.45)),
      ),
    );

    gl.uniformMatrix4fv(this.u.uVP, false, cam.vp);
    gl.uniform3fv(this.u.uEye, cam.pos);
    gl.uniform3fv(this.u.uLight, light);
  }

  buffer(data) {
    let buf = this.buffers.get(data);
    if (!buf) {
      buf = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);
      this.buffers.set(data, buf);
    }
    return buf;
  }

  // geo is { pos, nrm }. Options are model, color, opacity, lines, depthTest, depthWrite
  draw(geo, o) {
    const gl = this.gl;
    const opacity = o.opacity ?? 1;
    const lit = !o.lines && !!geo.nrm;
    if (!geo.pos.length) return;

    if (opacity < 1) gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
    if (o.depthTest === false) gl.disable(gl.DEPTH_TEST);
    else gl.enable(gl.DEPTH_TEST);
    gl.depthMask(o.depthWrite ?? opacity >= 1);

    gl.uniformMatrix4fv(this.u.uModel, false, o.model || this.identity);
    gl.uniform3fv(this.u.uColor, o.color);
    gl.uniform1f(this.u.uOpacity, opacity);
    gl.uniform1f(this.u.uLit, lit ? 1 : 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer(geo.pos));
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    if (lit) {
      gl.enableVertexAttribArray(1);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer(geo.nrm));
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    } else {
      gl.disableVertexAttribArray(1);
    }

    gl.drawArrays(o.lines ? gl.LINES : gl.TRIANGLES, 0, geo.pos.length / 3);
  }

  // Frees the buffers of geometry that was rebuilt for a single frame
  release(geo) {
    for (const data of [geo.pos, geo.nrm]) {
      const buf = data && this.buffers.get(data);
      if (!buf) continue;

      this.gl.deleteBuffer(buf);
      this.buffers.delete(data);
    }
  }
}
