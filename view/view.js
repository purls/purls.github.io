"use strict";

const STORE_KEY = "view-guide";
const GUIDE_FOV = rad(28);
const SENSOR_DIAG = 43.27; // 35mm frame diagonal in mm, used to turn focal length into field of view
const CLICK_SLOP = 4;
const ORBIT_SPEED = 0.4;
const ZOOM_SPEED = 0.0012;
const SHEET_MAX = 4096;
const FLASH_MS = 1200;
const SAVE_MS = 300;
const FT_PER_M = 3.28084;
const CONE_REACH = 0.75; // view cone length, in marker sizes
const FIT_MARGIN = 0.88;
const SOFT_MARGIN = 0.97;
const CAPTION_BAND = 0.09; // share of the image height kept clear for the caption

const DIRS = [
  "front",
  "front right",
  "right",
  "rear right",
  "rear",
  "rear left",
  "left",
  "front left",
];
const AROUND = [0, 45, 90, 135, 180, 225, 270, 315];

// Guide elevation for a given camera elevation. Low cameras get a guide that looks up from below
const AUTO_EL = [
  [-90, -38],
  [-30, -24],
  [-10, -12],
  [2, 22],
  [30, 30],
  [90, 52],
];
const AUTO_AZ = 38;

// Fixed material colors. body comes from the color picker
const MATS = {
  glass: "#1d2b30",
  tire: "#333333",
  hub: "#aab1b4",
  dark: "#30363a",
  under: "#40474a",
  metal: "#717a7e",
  pipe: "#a39a86",
  lamp: "#f1e7c4",
  tail: "#c0392b",
  plate: "#e8e8e8",
  roof: "#4d5257",
};

// prettier-ignore
const THEMES = {
  dark: { clear: [0.071, 0.071, 0.071, 1], inset: [0.11, 0.11, 0.11, 1], ground: [0.55, 0.7, 0.7], groundAlpha: 0.12, grid: [0.5, 0.62, 0.62], gridAlpha: 0.35, text: "#8f9a9a", strong: "#e0e0e0" },
  light: { clear: [1, 1, 1, 1], inset: [0.94, 0.95, 0.95, 1], ground: [0.35, 0.45, 0.45], groundAlpha: 0.12, grid: [0.35, 0.45, 0.45], gridAlpha: 0.4, text: "#6b7575", strong: "#1a1a1a" },
  none: { clear: [0, 0, 0, 0], inset: [0.11, 0.11, 0.11, 1], ground: [0.5, 0.6, 0.6], groundAlpha: 0.2, grid: [0.5, 0.6, 0.6], gridAlpha: 0.5, text: "#8a9494", strong: "#8a9494" },
};
const ARROW_COLOR = [0.3, 0.69, 0.67];

const SETS = {
  level: {
    label: "8 around, level",
    shots: AROUND.map((az) => ({ az, el: 0 })),
  },
  high: {
    label: "8 around, high",
    shots: AROUND.map((az) => ({ az, el: 40 })),
  },
  low: { label: "8 around, low", shots: AROUND.map((az) => ({ az, el: -25 })) },
  faces: {
    label: "6 faces",
    shots: [
      { az: 0, el: 0 },
      { az: 90, el: 0 },
      { az: 180, el: 0 },
      { az: 270, el: 0 },
      { az: 180, el: 90 },
      { az: 0, el: -90 },
    ],
  },
  under: {
    label: "Underside",
    shots: [
      ...["bottom", "frontAxle", "rearAxle"].map((aimName) => ({
        az: 0,
        el: -90,
        aimName,
      })),
      ...[0, 90, 180, 270].map((az) => ({ az, el: -25, aimName: "bottom" })),
    ],
  },
};

// prettier-ignore
const DEFAULTS = {
  model: "sedan", color: "#8fa3a3", raise: 0, boxL: 1, boxW: 1, boxH: 1,
  az: 315, el: 25, dist: 4, roll: 0, aimName: "center", aim: [0, 0, 0],
  lens: 24, shape: "4:3",
  autoView: true, vAz: 0, vEl: 30, vDist: 12, vTarget: [0, 0, 0],
  inset: true, labels: true, ground: true, opacity: 100, bg: "dark",
  markerColor: "#ff7a3d", markerSize: 1, labelOn: false, label: "",
  size: "1200x900", customW: 1200, customH: 900,
};
const SHOT_KEYS = ["az", "el", "dist", "roll", "aimName", "aim"];

const $ = (id) => document.getElementById(id);
const rgb = (hex) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const mod = (x, n) => ((x % n) + n) % n;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const meters = (m) => `${m.toFixed(2)} m (${(m * FT_PER_M).toFixed(1)} ft)`;

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
}

const saved = loadSaved();
const state = { ...DEFAULTS, ...saved.state };
if (!MODELS[state.model]) state.model = DEFAULTS.model;
let shots = Array.isArray(saved.shots) ? saved.shots : [];

const canvas = $("view");
const ctx = canvas.getContext("2d");
const fields = Object.keys(DEFAULTS).filter((key) => $(key));

let R = null;
let subject = null;
let ground = null;
let last = null; // camera, inset and size of the latest on-screen frame
let frameId = 0;
let saveId = 0;

// Shared shapes. The marker looks down its own -Z, like the cameras here
const marker = (() => {
  const b = new MeshBuilder();
  b.box("mk", [0, 0, 0.13], [0.34, 0.22, 0.14]);
  b.box("mk", [-0.09, 0.13, 0.13], [0.1, 0.04, 0.08]);
  b.tube("mkLens", [0, 0, 0.06], [0, 0, 0], 0.085, 0.095, 18);
  b.tube("mkGlass", [0, 0, 0.001], [0, 0, -0.004], 0.07, 0.07, 18, false);
  b.box("mkGlass", [0.03, -0.01, 0.2], [0.22, 0.15, 0.006]);
  return b.build();
})();

const unitBall = (() => {
  const b = new MeshBuilder();
  b.ball("m", [0, 0, 0], 1, 12, 8);
  return b.build().parts[0];
})();

const unitPost = (() => {
  const b = new MeshBuilder();
  b.tube("m", [0, 0, 0], [0, 1, 0], 1, 1, 10, false);
  return b.build().parts[0];
})();

/* Scene setup */

function buildGround(s) {
  const [x0, , z0] = s.geo.min;
  const [x1, , z1] = s.geo.max;
  const pad = clamp(s.size * 0.25, 0.35, 3);
  const gx0 = x0 - pad,
    gx1 = x1 + pad,
    gz0 = z0 - pad,
    gz1 = z1 + pad;
  const corners = [
    [gx0, 0, gz0],
    [gx1, 0, gz0],
    [gx1, 0, gz1],
    [gx0, 0, gz1],
  ];
  const step = s.size > 8 ? 2 : s.size > 3 ? 1 : 0.5;
  const b = new MeshBuilder();

  b.quad("ground", ...corners);
  b.loop(corners);
  for (let x = Math.ceil(gx0 / step) * step; x < gx1; x += step)
    b.line([x, 0, gz0], [x, 0, gz1]);
  for (let z = Math.ceil(gz0 / step) * step; z < gz1; z += step)
    b.line([gx0, 0, z], [gx1, 0, z]);

  // Flat arrow ahead of the subject
  const y = 0.004;
  const a0 = x1 + pad * 0.14,
    a1 = x1 + pad * 0.42,
    a2 = x1 + pad * 0.64;
  b.quad(
    "arrow",
    [a0, y, -pad * 0.05],
    [a1, y, -pad * 0.05],
    [a1, y, pad * 0.05],
    [a0, y, pad * 0.05],
  );
  b.tri("arrow", [a1, y, -pad * 0.14], [a2, y, 0], [a1, y, pad * 0.14]);

  const geo = b.build();
  const flat = (mat) => ({ pos: geo.parts.find((p) => p.mat === mat).pos });
  const cz = (z0 + z1) / 2,
    cx = (x0 + x1) / 2;

  return {
    quad: flat("ground"),
    arrow: flat("arrow"),
    lines: geo.lines,
    corners,
    labels: [
      ["FRONT", [x1 + pad * 0.84, 0, cz]],
      ["REAR", [x0 - pad * 0.55, 0, cz]],
      ["LEFT", [cx, 0, z0 - pad * 0.55]],
      ["RIGHT", [cx, 0, z1 + pad * 0.55]],
    ],
  };
}

function rebuildSubject() {
  const oldSize = subject?.size;
  subject = MODELS[state.model].build(state);
  ground = buildGround(subject);

  // Keep the camera at a similar relative distance when the subject changes size
  if (oldSize) state.dist *= subject.size / oldSize;
  const maxDist = Math.ceil(subject.size * 3 + 2);
  $("dist").max = maxDist;
  $("dist").step = subject.size > 8 ? 0.1 : 0.05;
  state.dist = clamp(state.dist, 0.1, maxDist);

  if (state.aimName !== "custom" && !subject.aims.has(state.aimName))
    state.aimName = "center";
  $("aimName").replaceChildren(
    ...[...subject.aims].map(([id, aim]) => new Option(cap(aim.label), id)),
    new Option("Custom point", "custom"),
  );
}

/* Cameras */

const curShot = () => Object.fromEntries(SHOT_KEYS.map((k) => [k, state[k]]));
const markerScale = () => state.markerSize * clamp(subject.size * 0.33, 0.5, 4);

function aimPoint(shot) {
  return subject.aims.get(shot.aimName)?.p || shot.aim;
}

// World positions for a shot. The subject may be lifted, the aim point rides with it
function place(shot) {
  const aim = V3.add(aimPoint(shot), [0, state.raise, 0]);
  return {
    aim,
    dist: shot.dist,
    pose: orbitPose(aim, shot.az, shot.el, shot.dist, shot.roll),
  };
}

function photoAspect() {
  const [a, b] = state.shape.split(":").map(Number);
  return a / b;
}

function povCamera(sc) {
  const aspect = photoAspect();
  const tanY = SENSOR_DIAG / (2 * state.lens) / Math.hypot(1, aspect);

  return makeCamera(
    sc.pose,
    2 * Math.atan(tanY),
    aspect,
    clamp(sc.dist * 0.05, 0.02, 0.5),
    500,
  );
}

function tableLerp(table, x) {
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1];
    const [x1, y1] = table[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return table.at(-1)[1];
}

// Points the guide image must show clear of the inset and caption
function framePoints(sc) {
  const [x0, y0, z0] = subject.geo.min;
  const [x1, y1, z1] = subject.geo.max;
  const r = 0.22 * markerScale();
  const pts = [sc.aim];

  for (const x of [x0, x1])
    for (const y of [y0, y1])
      for (const z of [z0, z1]) pts.push([x, y + state.raise, z]);
  for (const axis of [sc.pose.right, sc.pose.up, sc.pose.back])
    for (const s of [-r, r]) pts.push(V3.add(sc.pose.pos, V3.scale(axis, s)));
  if (state.labels) pts.push(...ground.labels.map(([, p]) => p));
  if (state.ground && !state.inset) pts.push(...ground.corners);

  return pts;
}

// Closest view from a direction that shows every frame point, clear of the caption and the inset.
// With an inset the ground only has to fit the image as a whole, so it may run under the inset
function fitView(sc, az, el, w, h, label) {
  const { right, up, back } = orbitPose([0, 0, 0], az, el, 1);
  const tanY = Math.tan(GUIDE_FOV / 2);
  const tanX = (tanY * w) / h;
  const toView = (p) => [V3.dot(p, right), V3.dot(p, up), V3.dot(p, back)];
  const pts = framePoints(sc).map(toView);
  const soft = state.ground && state.inset ? ground.corners.map(toView) : [];
  const c = [0, 1, 2].map(
    (k) =>
      (Math.min(...pts.map((p) => p[k])) + Math.max(...pts.map((p) => p[k]))) /
      2,
  );

  // Distance at which points fit a window of half-size hx by hy, per unit of distance, around a center
  const reach = (list, [cx, cy], hx, hy) =>
    list.reduce(
      (d, p) =>
        Math.max(
          d,
          p[2] -
            c[2] +
            Math.max(Math.abs(p[0] - cx) / hx, Math.abs(p[1] - cy) / hy),
        ),
      0,
    );

  // Usable window in -1..1 screen units. The caption takes a band at the top,
  // the inset takes a strip on the right or along the bottom, whichever costs less
  const top = label ? 1 - 2 * CAPTION_BAND : 1;
  let wins = [{ u0: -1, u1: 1, v0: -1, v1: top }];

  if (state.inset) {
    const r = insetRect(w, h, 0);
    const margin = w - r.x - r.w;
    wins = [
      { u0: -1, u1: 1 - (2 * (r.w + 2 * margin)) / w, v0: -1, v1: top },
      { u0: -1, u1: 1, v0: -1 + (2 * (r.h + 2 * margin)) / h, v1: top },
    ];
  }

  let best = null;
  for (const win of wins) {
    const u = (win.u0 + win.u1) / 2;
    const v = (win.v0 + win.v1) / 2;
    let dist = reach(
      pts,
      c,
      (tanX * FIT_MARGIN * (win.u1 - win.u0)) / 2,
      (tanY * FIT_MARGIN * (win.v1 - win.v0)) / 2,
    );
    let at = null;

    // The target slides to center the points in the window, which moves the ground too. A few rounds settle it
    for (let i = 0; i < 4; i++) {
      at = [c[0] - u * tanX * dist, c[1] - v * tanY * dist];
      const need = reach(soft, at, tanX * SOFT_MARGIN, tanY * SOFT_MARGIN);
      if (need <= dist) break;
      dist = need;
    }
    if (!best || dist < best.dist) best = { dist, at };
  }

  const { dist, at } = best;
  return {
    dist,
    target: V3.add(
      V3.scale(right, at[0]),
      V3.add(V3.scale(up, at[1]), V3.scale(back, c[2])),
    ),
  };
}

function guideCamera(sc, shot, w, h, label) {
  const aspect = w / h;
  let orbit;

  if (state.autoView) {
    const az = shot.az + AUTO_AZ;
    const el = tableLerp(AUTO_EL, shot.el);
    orbit = { az, el, ...fitView(sc, az, el, w, h, label) };
  } else {
    orbit = {
      az: state.vAz,
      el: state.vEl,
      dist: state.vDist,
      target: state.vTarget,
    };
  }

  const pose = orbitPose(orbit.target, orbit.az, orbit.el, orbit.dist);
  const cam = makeCamera(
    pose,
    GUIDE_FOV,
    aspect,
    Math.max(0.02, orbit.dist * 0.03),
    orbit.dist * 3 + 300,
  );
  cam.orbit = orbit;
  return cam;
}

/* Drawing */

// Corner 0 is bottom right, 1 bottom left, 2 top right, 3 top left
function insetRect(w, h, corner) {
  const aspect = photoAspect();
  const margin = Math.round(Math.min(w, h) * 0.025);
  let iw = w * 0.28;
  let ih = iw / aspect;

  if (ih > h * 0.42) {
    ih = h * 0.42;
    iw = ih * aspect;
  }
  iw = Math.round(iw);
  ih = Math.round(ih);

  return {
    x: corner & 1 ? margin : w - margin - iw,
    y: corner & 2 ? margin : h - margin - ih,
    w: iw,
    h: ih,
    corner,
  };
}

// Puts the inset in the corner that hides the least. keep wins ties so the inset does not hop around
function pickInset(w, h, cam, sc, label, keep) {
  const [x0, y0, z0] = subject.geo.min;
  const [x1, y1, z1] = subject.geo.max;
  const pad = Math.min(w, h) * 0.05;
  const reach = 0.25 * markerScale();
  const pts = [
    [sc.pose.pos, 100],
    [sc.aim, 30],
  ];

  for (const axis of [sc.pose.right, sc.pose.up, sc.pose.back])
    for (const side of [-reach, reach])
      pts.push([V3.add(sc.pose.pos, V3.scale(axis, side)), 30]);
  for (const x of [x0, x1])
    for (const y of [y0, y1])
      for (const z of [z0, z1]) pts.push([[x, y + state.raise, z], 3]);
  if (state.labels) for (const [, p] of ground.labels) pts.push([p, 2]);
  const marks = pts.map(([p, weight]) => ({
    at: projectPoint(cam, p, w, h),
    weight,
  }));

  let best = null;
  for (const corner of [keep, 0, 1, 2, 3]) {
    const r = insetRect(w, h, corner);
    const inside = ({ at }) =>
      at.x > r.x - pad &&
      at.x < r.x + r.w + pad &&
      at.y > r.y - pad &&
      at.y < r.y + r.h + pad;
    const score = marks.reduce(
      (n, m) => n + (inside(m) ? m.weight : 0),
      corner === 3 && label ? 50 : 0,
    );
    if (!best || score < best.score) best = { ...r, score };
  }

  return best;
}

// Short view cone in front of the marker, plus a line to the aim point
function buildFrustum(sc, pov) {
  const { pos, right, up, back } = sc.pose;
  const reach = Math.min(sc.dist, CONE_REACH * markerScale());
  const center = V3.add(pos, V3.scale(back, -reach));
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) =>
    V3.add(
      center,
      V3.add(
        V3.scale(right, sx * reach * pov.tanX),
        V3.scale(up, sy * reach * pov.tanY),
      ),
    ),
  );
  const lines = [...pos, ...sc.aim];

  corners.forEach((c, i) =>
    lines.push(...pos, ...c, ...c, ...corners[(i + 1) % 4]),
  );

  return {
    lines: { pos: new Float32Array(lines) },
    fill: {
      pos: new Float32Array([
        ...corners[0],
        ...corners[1],
        ...corners[2],
        ...corners[0],
        ...corners[2],
        ...corners[3],
      ]),
    },
  };
}

function drawMarker(sc, frustum, ghost) {
  const s = markerScale();
  const { pos, right, up, back } = sc.pose;
  const model = M4.frame(
    pos,
    V3.scale(right, s),
    V3.scale(up, s),
    V3.scale(back, s),
  );
  const base = rgb(state.markerColor);
  const colors = {
    mk: base,
    mkLens: V3.scale(base, 0.55),
    mkGlass: [0.08, 0.09, 0.1],
  };
  const dot = 0.035 * s;
  const aimModel = M4.frame(sc.aim, [dot, 0, 0], [0, dot, 0], [0, 0, dot]);
  const pass = ghost ? { opacity: 0.2, depthTest: false } : {};

  for (const part of marker.parts)
    R.draw(part, { model, color: colors[part.mat], ...pass });
  R.draw(marker.lines, {
    model,
    color: [0, 0, 0],
    lines: true,
    opacity: ghost ? 0.12 : 0.6,
    depthTest: !ghost,
  });
  R.draw(unitBall, { model: aimModel, color: base, ...pass });
  R.draw(frustum.lines, {
    color: base,
    lines: true,
    opacity: ghost ? 0.3 : 1,
    depthTest: !ghost,
  });
}

// One pass over the world. Solid things first, then see-through ones, then the marker's ghost
function drawScene(cam, sc, theme, frustum) {
  const lift = M4.translation(0, state.raise, 0);
  const alpha = state.opacity / 100;
  const solid = alpha >= 1;
  const body = rgb(state.color);
  const matColor = (mat) => (mat === "body" ? body : rgb(MATS[mat]));
  const drawSubject = () => {
    for (const part of subject.geo.parts)
      R.draw(part, {
        model: lift,
        color: matColor(part.mat),
        opacity: alpha,
        depthWrite: solid,
      });
    R.draw(subject.geo.lines, {
      model: lift,
      color: [0, 0, 0],
      lines: true,
      opacity: 0.55,
    });
  };

  R.camera(cam);
  if (solid) drawSubject();

  if (state.raise > 0) {
    const r = 0.03 * clamp(subject.size / 4, 0.5, 3);
    for (const [x, y, z] of subject.stands)
      R.draw(unitPost, {
        model: M4.frame(
          [x, 0, z],
          [r, 0, 0],
          [0, y + state.raise, 0],
          [0, 0, r],
        ),
        color: rgb(MATS.metal),
      });
  }

  if (state.labels) R.draw(ground.arrow, { color: ARROW_COLOR });
  if (frustum) drawMarker(sc, frustum, false);

  if (state.ground) {
    R.draw(ground.quad, { color: theme.ground, opacity: theme.groundAlpha });
    R.draw(ground.lines, {
      color: theme.grid,
      lines: true,
      opacity: theme.gridAlpha,
    });
  }
  if (!solid) drawSubject();

  if (frustum) {
    R.draw(frustum.fill, { color: rgb(state.markerColor), opacity: 0.1 });
    drawMarker(sc, frustum, true);
  }
}

function drawOverlays(c, w, h, cam, theme, inset, label) {
  const unit = Math.min(w, h);
  const font = (k) =>
    `${Math.max(9, Math.round(unit * k))}px "JetBrains Mono", monospace`;
  const insideInset = (p) =>
    inset &&
    p.x > inset.x &&
    p.x < inset.x + inset.w &&
    p.y > inset.y &&
    p.y < inset.y + inset.h;

  c.textAlign = "center";
  c.textBaseline = "middle";

  // Direction words on the ground. Faded when the subject is in the way
  if (state.labels) {
    const eye = V3.sub(cam.pos, [0, state.raise, 0]);

    for (const [text, p] of ground.labels) {
      const at = projectPoint(cam, p, w, h);
      if (!at.front || insideInset(at)) continue;

      const to = V3.sub(V3.sub(p, [0, state.raise, 0]), eye);
      const hidden = raycast(subject.geo.tris, eye, V3.norm(to)) < V3.len(to);
      const front = text === "FRONT";

      c.globalAlpha = hidden ? 0.3 : 1;
      c.font = font(front ? 0.03 : 0.024);
      c.fillStyle = front ? theme.strong : theme.text;
      c.fillText(text, at.x, at.y);
    }
    c.globalAlpha = 1;
  }

  if (inset) {
    const lw = Math.max(1, Math.round(unit / 320));
    c.strokeStyle = state.markerColor;
    c.lineWidth = lw;
    c.strokeRect(
      inset.x - lw / 2,
      inset.y - lw / 2,
      inset.w + lw,
      inset.h + lw,
    );

    // Caption on the side facing the middle of the image
    const below = inset.corner & 2;
    c.textAlign = inset.corner & 1 ? "left" : "right";
    c.textBaseline = below ? "top" : "bottom";
    c.font = font(0.022);
    c.fillStyle = state.markerColor;
    c.fillText(
      "CAMERA VIEW",
      inset.x + (inset.corner & 1 ? 0 : inset.w),
      below ? inset.y + inset.h + lw * 3 : inset.y - lw * 3,
    );
  }

  if (label) {
    const pad = Math.round(unit * 0.03);
    let size = Math.round(unit * 0.04);

    c.textAlign = "left";
    c.textBaseline = "top";
    c.fillStyle = theme.strong;
    c.font = `${size}px "JetBrains Mono", monospace`;

    // Shrink long labels to the image width
    const wide = c.measureText(label).width;
    if (wide > w - pad * 2) size = Math.floor((size * (w - pad * 2)) / wide);
    c.font = `${size}px "JetBrains Mono", monospace`;
    c.fillText(label, pad, pad);
  }
}

// Renders one guide image into a 2D context of w by h pixels
// corner is the preferred inset corner. lock keeps it there no matter what it covers
function drawGuide(c, w, h, shot, label, corner = 0, lock = false) {
  const theme = THEMES[state.bg];
  const sc = place(shot);
  const cam = guideCamera(sc, shot, w, h, label);
  const pov = povCamera(sc);
  const frustum = buildFrustum(sc, pov);
  let inset = null;
  if (state.inset)
    inset = lock
      ? insetRect(w, h, corner)
      : pickInset(w, h, cam, sc, label, corner);

  R.resize(w, h);
  R.begin(0, 0, w, h, theme.clear);
  drawScene(cam, sc, theme, frustum);

  if (inset) {
    R.begin(inset.x, inset.y, inset.w, inset.h, theme.inset);
    drawScene(pov, sc, theme, null);
  }
  R.release(frustum.lines);
  R.release(frustum.fill);

  c.clearRect(0, 0, w, h);
  c.drawImage(R.canvas, 0, 0);
  drawOverlays(c, w, h, cam, theme, inset, label);

  return { cam, inset, sc, w, h };
}

/* Naming */

function describe(shot) {
  let where;

  if (shot.el >= 75) where = "top down";
  else if (shot.el <= -75) where = "underneath";
  else {
    const dir = DIRS[Math.round(mod(shot.az, 360) / 45) % DIRS.length];
    const height = shot.el >= 25 ? "high" : shot.el <= -10 ? "low" : "level";
    where = `${dir}, ${height}`;
  }

  const aim =
    shot.aimName === "custom"
      ? "custom point"
      : subject.aims.get(shot.aimName)?.label;
  return (
    cap(where) + (aim && shot.aimName !== "center" ? `, aimed at ${aim}` : "")
  );
}

const currentLabel = () =>
  state.labelOn ? state.label.trim() || describe(curShot()) : "";

/* Screen */

function exportSize() {
  if (state.size !== "custom") return state.size.split("x").map(Number);
  return [
    clamp(Math.round(state.customW) || 1200, 64, SHEET_MAX),
    clamp(Math.round(state.customH) || 900, 64, SHEET_MAX),
  ];
}

function layoutCanvas() {
  const [w, h] = exportSize();
  canvas.style.aspectRatio = `${w} / ${h}`;
  canvas.style.width = `min(100%, calc(78vh * ${w / h}))`;
}

function paint() {
  const [w, h] = exportSize();
  const cw = Math.max(2, Math.round(canvas.clientWidth * devicePixelRatio));
  const ch = Math.max(2, Math.round((cw * h) / w));

  if (canvas.width !== cw) canvas.width = cw;
  if (canvas.height !== ch) canvas.height = ch;
  last = drawGuide(
    ctx,
    cw,
    ch,
    curShot(),
    currentLabel(),
    last?.inset?.corner ?? 0,
    drag?.zone === "cam",
  );

  const height = last.sc.pose.pos[1];
  $("readout").textContent =
    `${describe(curShot())}. Camera is ${meters(state.dist)} from its aim point and ` +
    `${meters(Math.abs(height))} ${height < 0 ? "below" : "above"} the ground.`;
}

function render() {
  if (!R || frameId) return;

  frameId = requestAnimationFrame(() => {
    frameId = 0;
    paint();
  });
}

/* Controls */

function save() {
  clearTimeout(saveId);
  saveId = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ state, shots }));
    } catch {
      // Storage can be blocked. The page works without it
    }
  }, SAVE_MS);
}

function readField(el) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "range" || el.type === "number") return parseFloat(el.value);
  return el.value;
}

// Pushes state into the inputs and the bits of UI that depend on it
function syncUI() {
  for (const key of fields) {
    const el = $(key);
    if (el.type === "checkbox") el.checked = state[key];
    else el.value = state[key];
  }

  $("azOut").textContent = `${Math.round(state.az)}°`;
  $("elOut").textContent = `${Math.round(state.el)}°`;
  $("rollOut").textContent = `${Math.round(state.roll)}°`;
  $("distOut").textContent = `${state.dist.toFixed(2)} m`;
  $("raiseOut").textContent = `${state.raise.toFixed(2)} m`;
  $("opacityOut").textContent = `${state.opacity}%`;
  $("markerSizeOut").textContent = `${state.markerSize.toFixed(1)}x`;

  $("boxDims").hidden = state.model !== "box";
  $("customSize").hidden = state.size !== "custom";
  $("label").placeholder = describe(curShot());

  for (const btn of document.querySelectorAll("[data-az]"))
    btn.classList.toggle("on", +btn.dataset.az === state.az);
  for (const btn of document.querySelectorAll("[data-el]"))
    btn.classList.toggle("on", +btn.dataset.el === state.el);
}

function update() {
  syncUI();
  save();
  render();
}

// Leaves auto framing but keeps the view that was on screen
function freeView() {
  if (!state.autoView || !last) return;

  const { az, el, dist, target } = last.cam.orbit;
  Object.assign(state, {
    autoView: false,
    vAz: az,
    vEl: el,
    vDist: dist,
    vTarget: target,
  });
}

function onField(key) {
  const value = readField($(key));
  if (typeof value === "number" && Number.isNaN(value)) return;

  if (key === "autoView" && !value) freeView();
  else state[key] = value;

  if (key === "model" || key.startsWith("box")) {
    for (const k of ["boxL", "boxW", "boxH"])
      state[k] = clamp(state[k] || 1, 0.05, 50);
    rebuildSubject();
  }
  if (key === "aimName" && value !== "custom") state.aim = aimPoint(state);
  if (key === "size" || key === "customW" || key === "customH") layoutCanvas();

  update();
}

function applyShot(shot) {
  for (const k of SHOT_KEYS) if (shot[k] !== undefined) state[k] = shot[k];
  if (state.aimName !== "custom" && !subject.aims.has(state.aimName))
    state.aimName = "center";
  state.dist = clamp(state.dist, 0.1, +$("dist").max);
  update();
}

/* Pointer input. Dragging the big view moves the guide, dragging the inset moves the camera */

const pointers = new Map();
let drag = null;

function canvasPoint(e) {
  const box = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - box.left) * canvas.width) / box.width,
    y: ((e.clientY - box.top) * canvas.height) / box.height,
  };
}

function zoneAt(e) {
  const p = canvasPoint(e);
  const r = last?.inset;
  return r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
    ? "cam"
    : "view";
}

function orbitBy(zone, dx, dy) {
  if (zone === "cam") {
    state.az = Math.round(mod(state.az + dx * ORBIT_SPEED, 360));
    state.el = Math.round(clamp(state.el + dy * ORBIT_SPEED, -90, 90));
  } else {
    freeView();
    state.vAz = mod(state.vAz + dx * ORBIT_SPEED, 360);
    state.vEl = clamp(state.vEl + dy * ORBIT_SPEED, -90, 90);
  }
}

function zoomBy(zone, factor) {
  if (zone === "cam") {
    state.dist = clamp(state.dist * factor, 0.1, +$("dist").max);
  } else {
    freeView();
    state.vDist = clamp(state.vDist * factor, 0.2, 500);
  }
}

// Aims the camera at the surface point under the pointer
function aimAt(e) {
  const p = canvasPoint(e);
  const lift = [0, state.raise, 0];
  const origin = V3.sub(last.cam.pos, lift);
  const dir = pixelRay(last.cam, p.x, p.y, last.w, last.h);
  const t = raycast(subject.geo.tris, origin, dir);
  if (t === Infinity) return;

  state.aim = V3.add(origin, V3.scale(dir, t)).map((x) => +x.toFixed(3));
  state.aimName = "custom";
  update();
}

canvas.addEventListener("pointerdown", (e) => {
  if (!last) return;

  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) drag = { zone: zoneAt(e), moved: 0 };
});

canvas.addEventListener("pointermove", (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev || !drag) return;

  const cur = { x: e.clientX, y: e.clientY };

  if (pointers.size === 2) {
    // Pinch. Compare finger spread before and after this move
    const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
    const before = Math.hypot(prev.x - other.x, prev.y - other.y);
    const after = Math.hypot(cur.x - other.x, cur.y - other.y);
    if (before > 0 && after > 0) zoomBy(drag.zone, before / after);
    drag.moved = Infinity;
  } else {
    const dx = cur.x - prev.x,
      dy = cur.y - prev.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved > CLICK_SLOP) orbitBy(drag.zone, dx, dy);
  }

  pointers.set(e.pointerId, cur);
  update();
});

function endPointer(e) {
  if (!pointers.delete(e.pointerId) || pointers.size) return;

  if (
    drag &&
    drag.moved <= CLICK_SLOP &&
    drag.zone === "view" &&
    e.type === "pointerup"
  )
    aimAt(e);
  drag = null;
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

canvas.addEventListener(
  "wheel",
  (e) => {
    if (!last) return;

    e.preventDefault();
    zoomBy(zoneAt(e), Math.exp(e.deltaY * ZOOM_SPEED));
    update();
  },
  { passive: false },
);

/* Export */

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = old), FLASH_MS);
}

function renderCanvas(w, h, shot, label, corner = 0) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  drawGuide(c.getContext("2d"), w, h, shot, label, corner);
  return c;
}

// The image as shown on screen, at export size
const renderCurrent = () =>
  renderCanvas(
    ...exportSize(),
    curShot(),
    currentLabel(),
    last?.inset?.corner ?? 0,
  );

const toBlob = (c) => new Promise((resolve) => c.toBlob(resolve, "image/png"));
const fileBase = () => `view-${state.model}`;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Uncompressed zip. files is [{ name, data }] with data as Uint8Array
function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  const header = (sig, extra, f) => {
    const head = new DataView(new ArrayBuffer(extra ? 46 : 30));
    let at = 0;
    const u16 = (v) => (head.setUint16(at, v, true), (at += 2));
    const u32 = (v) => (head.setUint32(at, v, true), (at += 4));

    u32(sig);
    if (extra) u16(20);
    (u16(20), u16(0x0800), u16(0), u16(0), u16(0x21));
    (u32(f.crc), u32(f.data.length), u32(f.data.length));
    (u16(f.name.length), u16(0));
    if (extra) (u16(0), u16(0), u16(0), u32(0), u32(f.offset));

    return new Uint8Array(head.buffer);
  };

  for (const file of files) {
    const f = {
      name: enc.encode(file.name),
      data: file.data,
      crc: crc32(file.data),
      offset,
    };
    const local = header(0x04034b50, false, f);

    chunks.push(local, f.name, f.data);
    central.push(header(0x02014b50, true, f), f.name);
    offset += local.length + f.name.length + f.data.length;
  }

  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, end], { type: "application/zip" });
}

async function exportZip(btn) {
  if (!shots.length) return;

  const [w, h] = exportSize();
  const files = [];
  btn.disabled = true;

  for (const [i, shot] of shots.entries()) {
    const blob = await toBlob(
      renderCanvas(w, h, shot, state.labelOn ? shot.name : ""),
    );
    const num = String(i + 1).padStart(2, "0");
    files.push({
      name: `${fileBase()}-${num}-${slug(shot.name)}.png`,
      data: new Uint8Array(await blob.arrayBuffer()),
    });
  }

  download(zipStore(files), `${fileBase()}-shots.zip`);
  btn.disabled = false;
  render();
}

// Every shot in one labeled grid
async function exportSheet() {
  if (!shots.length) return;

  const [w, h] = exportSize();
  const cols = Math.ceil(Math.sqrt(shots.length));
  const rows = Math.ceil(shots.length / cols);
  const cw = Math.min(w, Math.floor(SHEET_MAX / cols));
  const ch = Math.round((cw * h) / w);
  const sheet = document.createElement("canvas");
  sheet.width = cw * cols;
  sheet.height = ch * rows;

  const c = sheet.getContext("2d");
  if (state.bg !== "none") {
    c.fillStyle = state.bg === "dark" ? "#121212" : "#ffffff";
    c.fillRect(0, 0, sheet.width, sheet.height);
  }
  shots.forEach((shot, i) =>
    c.drawImage(
      renderCanvas(cw, ch, shot, shot.name),
      (i % cols) * cw,
      Math.floor(i / cols) * ch,
    ),
  );

  download(await toBlob(sheet), `${fileBase()}-sheet.png`);
  render();
}

/* Shot list */

function renderShots() {
  $("shotList").replaceChildren(
    ...shots.map((shot, i) => {
      const li = document.createElement("li");
      const name = document.createElement("input");
      const go = document.createElement("button");
      const del = document.createElement("button");

      name.type = "text";
      name.value = shot.name;
      name.setAttribute("aria-label", `Name of shot ${i + 1}`);
      name.addEventListener("input", () => {
        shot.name = name.value;
        save();
      });

      go.type = "button";
      go.textContent = "Show";
      go.title = "Move the camera to this shot";
      go.addEventListener("click", () => applyShot(shot));

      del.type = "button";
      del.textContent = "×";
      del.title = "Remove";
      del.addEventListener("click", () => {
        shots.splice(i, 1);
        renderShots();
        save();
      });

      li.append(name, go, del);
      return li;
    }),
  );

  $("shotCount").textContent = shots.length ? `(${shots.length})` : "";
  for (const id of ["zipBtn", "sheetBtn", "clearShots"])
    $(id).disabled = !shots.length;
}

function addShots(list) {
  for (const partial of list) {
    const shot = { ...curShot(), ...partial };
    if (shot.aimName !== "custom" && !subject.aims.has(shot.aimName)) continue;
    shots.push({ ...shot, name: describe(shot) });
  }
  renderShots();
  save();
}

/* Wiring */

function init() {
  try {
    R = new Renderer();
  } catch (err) {
    $("readout").textContent = `This page needs WebGL. ${err.message}`;
    return;
  }

  $("model").replaceChildren(
    ...Object.entries(MODELS).map(([id, m]) => new Option(m.label, id)),
  );
  $("shotSet").replaceChildren(
    ...Object.entries(SETS).map(([id, s]) => new Option(s.label, id)),
  );

  for (const key of fields)
    $(key).addEventListener("input", () => onField(key));

  for (const btn of document.querySelectorAll("[data-az]"))
    btn.addEventListener("click", () => applyShot({ az: +btn.dataset.az }));
  for (const btn of document.querySelectorAll("[data-el]"))
    btn.addEventListener("click", () => applyShot({ el: +btn.dataset.el }));

  $("pngBtn").addEventListener("click", async () => {
    download(
      await toBlob(renderCurrent()),
      `${fileBase()}-${slug(describe(curShot()))}.png`,
    );
    render();
  });

  $("copyBtn").addEventListener("click", async () => {
    const blob = await toBlob(renderCurrent());
    render();

    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      flash($("copyBtn"), "Copied");
    } catch {
      flash($("copyBtn"), "Copy blocked");
    }
  });

  $("addShot").addEventListener("click", () => addShots([{}]));
  $("addSet").addEventListener("click", () =>
    addShots(SETS[$("shotSet").value].shots),
  );
  $("zipBtn").addEventListener("click", () => exportZip($("zipBtn")));
  $("sheetBtn").addEventListener("click", exportSheet);
  $("clearShots").addEventListener("click", () => {
    shots = [];
    renderShots();
    save();
  });

  $("resetBtn").addEventListener("click", () => {
    Object.assign(state, DEFAULTS);
    subject = null;
    rebuildSubject();
    layoutCanvas();
    update();
  });

  rebuildSubject();
  layoutCanvas();
  renderShots();
  syncUI();

  new ResizeObserver(render).observe(canvas);
  document.fonts?.ready.then(render);
  render();
}

init();
