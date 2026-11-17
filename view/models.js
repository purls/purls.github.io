"use strict";

// Subject models for the view guide. Units are meters.
// +X is the front, +Y is up, +Z is the subject's right. The ground is y = 0.
// Material names are resolved to colors in view.js.

const ARCH_SEG = 10;

// Wraps a finished builder with aim points and lift stands
function finishModel(b, extra = {}) {
  const geo = b.build();
  const [x0, y0, z0] = geo.min;
  const [x1, y1, z1] = geo.max;
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2,
    cz = (z0 + z1) / 2;

  const aims = new Map([
    ["center", { label: "center", p: [cx, cy, cz] }],
    ["front", { label: "front end", p: [x1, cy, cz] }],
    ["rear", { label: "rear end", p: [x0, cy, cz] }],
    ["left", { label: "left side", p: [cx, cy, z0] }],
    ["right", { label: "right side", p: [cx, cy, z1] }],
    ["top", { label: "top", p: [cx, y1, cz] }],
    ["bottom", { label: "underside", p: [cx, y0, cz] }],
  ]);
  for (const [id, label, p] of extra.aims || []) aims.set(id, { label, p });

  return {
    geo,
    aims,
    stands: extra.stands || [[cx, y0, cz]],
    size: Math.max(x1 - x0, y1 - y0, z1 - z0),
  };
}

// Four-wheeled vehicle from a side profile. See CARS for the spec fields
function buildCar(s) {
  const b = new MeshBuilder();
  const { L, W, H, wb, fo, wr, tw, yb, belt, nose } = s;
  const hw = W / 2,
    xF = L / 2,
    xR = -L / 2;
  const axF = xF - fo,
    axR = axF - wb;
  const ar = wr + 0.06;
  const bedWall = s.bed === undefined ? null : axR + s.bed;
  const rearRef = s.tail ? xR : axR;
  const cab = {
    fb: axF + s.cabF[0],
    ft: axF + s.cabF[1],
    rt: (bedWall ?? rearRef) + s.cabR[0],
    rb: (bedWall ?? rearRef) + s.cabR[1],
  };

  // Bottom edge running rearward from x0 to x1, with a cut-out per wheel inside that span
  const bottom = (x0, x1) => {
    const pts = [];
    const t0 = Math.asin((yb - wr) / ar);

    for (const ax of [axF, axR]) {
      if (ax + ar > x0 || ax - ar < x1) continue;
      for (let i = 0; i <= ARCH_SEG; i++) {
        const t = t0 + ((Math.PI - 2 * t0) * i) / ARCH_SEG;
        pts.push([ax + ar * Math.cos(t), wr + ar * Math.sin(t)]);
      }
    }
    return pts;
  };

  // Lowest body height at x, which rises over a wheel
  const sillAt = (x) => {
    for (const ax of [axF, axR])
      if (Math.abs(x - ax) < ar) return wr + Math.sqrt(ar * ar - (x - ax) ** 2);
    return yb;
  };

  // Lower body
  const front = [
    [cab.fb, belt],
    [xF - 0.12, nose],
    [xF, nose - 0.1],
    [xF, yb + 0.08],
    [xF - 0.04, yb],
  ];

  if (bedWall === null) {
    const deck = s.deck ?? belt;
    const rear = [
      [xR + 0.04, yb],
      [xR, yb + 0.08],
      [xR, deck - 0.05],
      [xR + 0.05, deck],
      [cab.rb, belt],
    ];
    b.prism("body", [...rear, ...front, ...bottom(xF, xR)], -hw, hw);
  } else {
    // Pickup. Cab and nose are one solid, the bed is two walls, a floor and a tailgate
    const t = 0.07;
    const floorY = wr + ar + 0.02;
    const wall = [
      [xR + 0.04, yb],
      [xR, yb + 0.08],
      [xR, belt],
      [bedWall, belt],
      [bedWall, yb],
      ...bottom(bedWall, xR),
    ];

    b.prism(
      "body",
      [[bedWall, yb], [bedWall, belt], ...front, ...bottom(xF, bedWall)],
      -hw,
      hw,
    );
    b.prism("body", wall, -hw, -hw + t);
    b.prism("body", wall, hw - t, hw);
    b.box(
      "under",
      [(xR + bedWall) / 2, floorY - 0.02, 0],
      [bedWall - xR - 0.1, 0.04, W - 2 * t],
    );
    b.box(
      "body",
      [xR + 0.045, (yb + 0.08 + belt) / 2, 0],
      [t, belt - yb - 0.08, W - 2 * t],
    );
  }

  // Dark floor plates between the wheels, and a ceiling inside each wheel tunnel
  const spans = [
    [xF - 0.06, axF + ar],
    [axF - ar, axR + ar],
    [axR - ar, xR + 0.06],
  ];
  for (const [x1, x0] of spans)
    b.box("under", [(x0 + x1) / 2, yb - 0.01, 0], [x1 - x0, 0.02, W - 0.06]);
  for (const ax of [axF, axR])
    b.box(
      "under",
      [ax, wr + ar * 0.6, 0],
      [2 * ar, ar * 0.8 + 0.04, W - 2 * tw - 0.1],
      false,
    );

  // Cabin. A glass block that leans in toward the roof, then body-colored pillars over it
  const yt = H - 0.04;
  const zb = hw - 0.03;
  const zt = hw - (s.tumble ?? 0.14);
  const ring = (x0, x1, y, z) => [
    [x0, y, -z],
    [x1, y, -z],
    [x1, y, z],
    [x0, y, z],
  ];
  const topX = (x) =>
    cab.rt + ((x - cab.rb) / (cab.fb - cab.rb)) * (cab.ft - cab.rt);
  const pillar = (x0, x1) => {
    for (const side of [-1, 1]) {
      const e = side * 0.012;
      b.quad(
        "body",
        [x0, belt, side * zb + e],
        [x1, belt, side * zb + e],
        [topX(x1), yt, side * zt + e],
        [topX(x0), yt, side * zt + e],
      );
    }
  };

  b.hexa("glass", ring(cab.rb, cab.fb, belt, zb), ring(cab.rt, cab.ft, yt, zt));
  b.hexa(
    "body",
    ring(cab.rt - 0.01, cab.ft + 0.01, yt, zt + 0.01),
    ring(cab.rt + 0.03, cab.ft - 0.03, H, zt - 0.03),
  );

  // Door seams, front to rear. Inner seams get a pillar
  const d0 = cab.fb + 0.02;
  const doorEnd = (bedWall ?? axR + 0.14) + 0.06;
  const seams =
    s.doors === 4
      ? [d0, (d0 + doorEnd) / 2 + 0.06, doorEnd]
      : [d0, d0 - Math.min((d0 - doorEnd) * 0.62, 1.25)];

  for (const x of seams)
    for (const z of [-hw - 0.004, hw + 0.004])
      b.line([x, sillAt(x) + 0.03, z], [x, belt - 0.02, z]);

  pillar(cab.fb - 0.07, cab.fb);
  pillar(seams[1] - 0.04, seams[1] + 0.04);
  if (s.tail && s.doors === 4) pillar(doorEnd - 0.05, doorEnd + 0.05);
  if (s.panel) pillar(cab.rb, seams[1]);
  else pillar(cab.rb, cab.rb + (s.rearPillar ?? 0.1));

  // Bumpers, lights, plate, mirrors
  const lampY = nose - 0.14;
  const tailY = (s.deck ?? belt) - 0.16;

  for (const [x, mat] of [
    [xF + 0.02, "dark"],
    [xR - 0.02, "dark"],
  ])
    b.box(mat, [x, yb + 0.14, 0], [0.1, 0.14, W + 0.02]);
  b.box("dark", [xF + 0.005, lampY, 0], [0.03, 0.1, W - 0.9]);
  b.box("plate", [xR - 0.005, tailY, 0], [0.02, 0.11, 0.42]);

  for (const side of [-1, 1]) {
    b.box("lamp", [xF + 0.005, lampY, side * (hw - 0.24)], [0.04, 0.12, 0.34]);
    b.box("tail", [xR - 0.005, tailY, side * (hw - 0.22)], [0.04, 0.13, 0.34]);
    b.box(
      "dark",
      [cab.fb - 0.02, belt + 0.07, side * (hw + 0.07)],
      [0.07, 0.09, 0.15],
    );
  }

  // Wheels and axles
  for (const ax of [axF, axR]) {
    b.tube(
      "metal",
      [ax, wr, -hw + tw],
      [ax, wr, hw - tw],
      0.035,
      0.035,
      10,
      false,
    );

    for (const side of [-1, 1]) {
      b.tube(
        "tire",
        [ax, wr, side * (hw - tw - 0.01)],
        [ax, wr, side * (hw - 0.01)],
        wr,
        wr,
        24,
      );
      b.tube(
        "hub",
        [ax, wr, side * (hw - 0.05)],
        [ax, wr, side * hw],
        wr * 0.58,
        wr * 0.58,
        24,
      );
    }
  }

  // Underside. Engine up front, gearbox, driveshaft to a rear differential, exhaust down one side
  const low = yb - 0.02;
  const zPipe = -hw * 0.38;

  b.box(
    "metal",
    [axF + 0.03, (low - 0.13 + wr + 0.14) / 2, 0],
    [0.56, wr + 0.27 - low, 0.52],
  );
  b.box("metal", [axF - 0.6, low - 0.055, 0], [0.66, 0.11, 0.3]);
  b.tube(
    "metal",
    [axF - 0.9, low - 0.06, 0],
    [axR + 0.14, low - 0.06, 0],
    0.04,
    0.04,
    10,
    false,
  );
  b.box("metal", [axR, wr, 0], [0.3, 0.24, 0.3]);
  b.box(
    "under",
    [axR + ar + 0.38, low - 0.05, hw * 0.2],
    [0.52, 0.1, hw * 0.9],
  );

  b.tube(
    "pipe",
    [axF - 0.25, low - 0.05, zPipe],
    [axR + ar, low - 0.05, zPipe],
    0.035,
    0.035,
    10,
    false,
  );
  b.tube(
    "pipe",
    [axR - ar - 0.02, low - 0.085, zPipe],
    [xR + 0.14, low - 0.085, zPipe],
    0.085,
    0.085,
    14,
  );
  b.tube(
    "pipe",
    [xR + 0.14, low - 0.085, zPipe],
    [xR - 0.04, low - 0.085, zPipe],
    0.03,
    0.03,
    10,
    false,
  );

  const sx = [axF - ar - 0.2, axR + ar + 0.2];
  const wheel = (ax, side) => [ax, wr, side * hw];

  return finishModel(b, {
    stands: sx.flatMap((x) => [
      [x, yb - 0.02, -hw + 0.14],
      [x, yb - 0.02, hw - 0.14],
    ]),
    aims: [
      ["bottom", "underside", [(axF + axR) / 2, low, 0]],
      ["frontAxle", "front axle", [axF, low, 0]],
      ["rearAxle", "rear axle", [axR, low, 0]],
      ["wheelFL", "front left wheel", wheel(axF, -1)],
      ["wheelFR", "front right wheel", wheel(axF, 1)],
      ["wheelRL", "rear left wheel", wheel(axR, -1)],
      ["wheelRR", "rear right wheel", wheel(axR, 1)],
    ],
  });
}

// L W H   overall size
// wb fo   wheelbase and front overhang
// wr tw   wheel radius and tire width
// yb      height of the body's bottom edge
// belt    height where the glass starts
// nose    hood height at the front
// deck    trunk lid height, defaults to belt
// cabF    windshield base and roof front, as x offsets from the front axle
// cabR    roof rear and rear glass base, as x offsets from the rear axle, or the tail if tail is set
// bed     pickup only, x offset of the cab's back wall from the rear axle
// prettier-ignore
const CARS = {
  sedan: { L: 4.33, W: 1.65, H: 1.38, wb: 2.57, fo: 0.8, wr: 0.3, tw: 0.2, yb: 0.26, belt: 0.9, nose: 0.78, cabF: [-0.55, -1.1], cabR: [0.25, -0.2], doors: 4, rearPillar: 0.3 },
  coupe: { L: 4.45, W: 1.75, H: 1.3, wb: 2.6, fo: 0.85, wr: 0.31, tw: 0.22, yb: 0.25, belt: 0.88, nose: 0.74, cabF: [-0.6, -1.25], cabR: [0.45, -0.38], doors: 2, rearPillar: 0.34 },
  hatchback: { L: 4.0, W: 1.72, H: 1.45, wb: 2.55, fo: 0.85, wr: 0.3, tw: 0.2, yb: 0.26, belt: 0.92, nose: 0.8, cabF: [-0.45, -1.0], cabR: [0.5, 0.08], tail: true, doors: 4, rearPillar: 0.14 },
  wagon: { L: 4.7, W: 1.78, H: 1.46, wb: 2.75, fo: 0.85, wr: 0.31, tw: 0.21, yb: 0.26, belt: 0.92, nose: 0.78, cabF: [-0.55, -1.1], cabR: [0.2, 0.08], tail: true, doors: 4 },
  suv: { L: 4.75, W: 1.92, H: 1.78, wb: 2.8, fo: 0.88, wr: 0.38, tw: 0.26, yb: 0.4, belt: 1.14, nose: 1.04, cabF: [-0.45, -0.95], cabR: [0.18, 0.08], tail: true, doors: 4, tumble: 0.12 },
  pickup: { L: 5.7, W: 2.0, H: 1.88, wb: 3.65, fo: 0.95, wr: 0.4, tw: 0.28, yb: 0.44, belt: 1.28, nose: 1.18, cabF: [-0.45, -0.9], cabR: [0.1, 0.03], bed: 1.0, doors: 4, tumble: 0.12 },
  van: { L: 5.3, W: 2.0, H: 2.35, wb: 3.3, fo: 0.95, wr: 0.36, tw: 0.24, yb: 0.38, belt: 1.3, nose: 1.08, cabF: [0.25, -0.3], cabR: [0.07, 0.08], tail: true, doors: 2, panel: true, tumble: 0.07 },
};

function buildMotorcycle() {
  const b = new MeshBuilder();
  const wr = 0.31,
    xf = 0.74,
    xr = -0.7;

  for (const x of [xf, xr]) {
    b.ring("tire", [x, wr, 0], wr - 0.055, 0.055);
    b.tube("hub", [x, wr, -0.05], [x, wr, 0.05], 0.1, 0.1, 14);
    b.tube(
      "hub",
      [x, wr, -0.012],
      [x, wr, 0.012],
      wr - 0.09,
      wr - 0.09,
      20,
      false,
    );
  }

  // Engine, tank, seat, tail
  b.box("metal", [0.02, 0.42, 0], [0.46, 0.36, 0.34]);
  b.hexa(
    "body",
    [
      [-0.08, 0.7, -0.13],
      [0.42, 0.7, -0.13],
      [0.42, 0.7, 0.13],
      [-0.08, 0.7, 0.13],
    ],
    [
      [-0.05, 0.9, -0.1],
      [0.3, 0.94, -0.12],
      [0.3, 0.94, 0.12],
      [-0.05, 0.9, 0.1],
    ],
  );
  b.box("dark", [-0.38, 0.8, 0], [0.62, 0.08, 0.26]);
  b.hexa(
    "body",
    [
      [-0.98, 0.72, -0.08],
      [-0.66, 0.68, -0.12],
      [-0.66, 0.68, 0.12],
      [-0.98, 0.72, 0.08],
    ],
    [
      [-0.98, 0.78, -0.08],
      [-0.66, 0.78, -0.12],
      [-0.66, 0.78, 0.12],
      [-0.98, 0.78, 0.08],
    ],
  );
  b.box("tail", [-0.99, 0.75, 0], [0.03, 0.05, 0.12]);

  // Fork, bars, headlight
  for (const z of [-0.1, 0.1]) {
    b.tube("hub", [xf, wr, z], [0.46, 1.0, z], 0.022, 0.022, 8, false);
    b.tube("metal", [-0.1, 0.36, z], [xr, wr, z], 0.022, 0.022, 8, false);
  }
  b.tube(
    "dark",
    [0.44, 1.04, -0.36],
    [0.44, 1.04, 0.36],
    0.018,
    0.018,
    8,
    false,
  );
  b.tube("lamp", [0.55, 0.9, 0], [0.63, 0.9, 0], 0.09, 0.09, 14);
  b.box("body", [xf, wr * 2 + 0.03, 0], [0.36, 0.03, 0.14]);

  // Frame and exhaust
  b.tube("metal", [0.44, 0.92, 0], [-0.1, 0.36, 0], 0.025, 0.025, 8, false);
  b.tube("metal", [0.44, 0.92, 0], [-0.5, 0.74, 0], 0.025, 0.025, 8, false);
  b.tube("pipe", [0.15, 0.3, 0.2], [-0.35, 0.3, 0.2], 0.03, 0.03, 10, false);
  b.tube("pipe", [-0.35, 0.3, 0.2], [-0.95, 0.42, 0.2], 0.05, 0.06, 12);

  return finishModel(b, {
    stands: [[0, 0.24, 0]],
    aims: [
      ["bottom", "underside", [0, 0.24, 0]],
      ["frontAxle", "front wheel", [xf, wr, 0]],
      ["rearAxle", "rear wheel", [xr, wr, 0]],
    ],
  });
}

function buildBicycle() {
  const b = new MeshBuilder();
  const wr = 0.34,
    xf = 0.6,
    xr = -0.5;
  const bb = [0.0, 0.28],
    seat = [-0.14, 0.86],
    headTop = [0.42, 0.88],
    headLow = [0.45, 0.74];
  const rod = (p, q, z0 = 0, z1 = z0, r = 0.016) =>
    b.tube("body", [p[0], p[1], z0], [q[0], q[1], z1], r, r, 8, false);

  for (const x of [xf, xr]) {
    b.ring("tire", [x, wr, 0], wr - 0.018, 0.018, 32, 6);
    b.ring("hub", [x, wr, 0], wr - 0.045, 0.01, 32, 6);
    b.tube("hub", [x, wr, -0.04], [x, wr, 0.04], 0.025, 0.025, 8, false);
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2;
      b.line(
        [x, wr, 0],
        [x + Math.cos(t) * (wr - 0.03), wr + Math.sin(t) * (wr - 0.03), 0],
      );
    }
  }

  // Frame triangle, stays and fork
  rod(seat, headTop);
  rod(bb, headLow, 0, 0, 0.02);
  rod(bb, [-0.17, 0.98]);
  rod(headTop, headLow, 0, 0, 0.02);
  for (const z of [-0.05, 0.05]) {
    rod(bb, [xr, wr], 0, z, 0.011);
    rod(seat, [xr, wr], 0, z, 0.011);
    rod(headLow, [xf, wr], 0, z, 0.012);
  }

  // Bars, saddle, cranks
  rod(headTop, [0.4, 1.0]);
  b.tube("dark", [0.44, 1.0, -0.23], [0.44, 1.0, 0.23], 0.014, 0.014, 8, false);
  b.box("dark", [-0.18, 0.99, 0], [0.26, 0.04, 0.13]);
  b.tube("metal", [0, 0.28, -0.08], [0, 0.28, 0.08], 0.02, 0.02, 8, false);
  b.tube("metal", [0, 0.28, 0.06], [0, 0.28, 0.07], 0.09, 0.09, 16);
  b.tube("metal", [0, 0.28, 0.08], [0.15, 0.2, 0.08], 0.01, 0.01, 6, false);
  b.tube("metal", [0, 0.28, -0.08], [-0.15, 0.36, -0.08], 0.01, 0.01, 6, false);
  b.box("dark", [0.15, 0.2, 0.13], [0.09, 0.02, 0.09]);
  b.box("dark", [-0.15, 0.36, -0.13], [0.09, 0.02, 0.09]);

  return finishModel(b, {
    stands: [[0, 0.26, 0]],
    aims: [
      ["bottom", "underside", [0, 0.26, 0]],
      ["frontAxle", "front wheel", [xf, wr, 0]],
      ["rearAxle", "rear wheel", [xr, wr, 0]],
    ],
  });
}

function buildPerson() {
  const b = new MeshBuilder();
  const ring = (y, x, z) => [
    [-x, y, -z],
    [x, y, -z],
    [x, y, z],
    [-x, y, z],
  ];

  // Legs and feet, toes forward
  for (const z of [-0.1, 0.1]) {
    b.tube("dark", [0, 0.94, z], [0, 0.08, z], 0.085, 0.06, 10, false);
    b.box("dark", [0.05, 0.04, z], [0.26, 0.08, 0.1]);
  }

  // Torso, arms, head
  b.hexa("body", ring(0.9, 0.1, 0.17), ring(1.46, 0.11, 0.21));
  for (const z of [-1, 1]) {
    b.tube(
      "body",
      [0, 1.42, z * 0.26],
      [0.03, 0.86, z * 0.31],
      0.055,
      0.045,
      10,
      false,
    );
    b.ball("lamp", [0.03, 0.82, z * 0.31], 0.05, 10, 6);
  }
  b.tube("lamp", [0, 1.46, 0], [0, 1.54, 0], 0.05, 0.05, 10, false);
  b.ball("lamp", [0, 1.64, 0], 0.115);
  b.tube("lamp", [0.1, 1.63, 0], [0.15, 1.62, 0], 0.022, 0.006, 8, false);

  return finishModel(b, {
    aims: [
      ["head", "head", [0, 1.64, 0]],
      ["feet", "feet", [0.05, 0.04, 0]],
    ],
  });
}

function buildHouse() {
  const b = new MeshBuilder();
  const L = 9,
    W = 11,
    wall = 3,
    peak = 5.4,
    eave = 0.4;

  b.box("body", [0, wall / 2, 0], [L, wall, W]);
  b.prism(
    "roof",
    [
      [-L / 2 - eave, wall],
      [L / 2 + eave, wall],
      [0, peak],
    ],
    -W / 2 - eave,
    W / 2 + eave,
  );
  b.box("body", [-1.6, 4.9, 2.6], [0.7, 1.6, 0.9]);

  // Front face. Door, windows, step
  b.box("dark", [L / 2 + 0.03, 1.05, 0], [0.06, 2.1, 1.0]);
  b.box("under", [L / 2 + 0.5, 0.08, 0], [1.0, 0.16, 1.8]);
  for (const z of [-3.4, 3.4])
    b.box("glass", [L / 2 + 0.03, 1.65, z], [0.06, 1.2, 1.8]);

  // Sides and back
  for (const x of [-2.2, 2.2])
    for (const z of [-W / 2 - 0.03, W / 2 + 0.03])
      b.box("glass", [x, 1.65, z], [1.4, 1.2, 0.06]);
  for (const z of [-3, 0, 3])
    b.box("glass", [-L / 2 - 0.03, 1.65, z], [0.06, 1.2, 1.5]);

  return finishModel(b, { aims: [["roof", "roof", [0, peak, 0]]] });
}

function buildBox({ boxL, boxW, boxH }) {
  const b = new MeshBuilder();
  b.box("body", [0, boxH / 2, 0], [boxL, boxH, boxW]);

  return finishModel(b);
}

const MODELS = {
  sedan: { label: "Sedan", build: () => buildCar(CARS.sedan) },
  coupe: { label: "Coupe", build: () => buildCar(CARS.coupe) },
  hatchback: { label: "Hatchback", build: () => buildCar(CARS.hatchback) },
  wagon: { label: "Wagon", build: () => buildCar(CARS.wagon) },
  suv: { label: "SUV", build: () => buildCar(CARS.suv) },
  pickup: { label: "Pickup truck", build: () => buildCar(CARS.pickup) },
  van: { label: "Van", build: () => buildCar(CARS.van) },
  motorcycle: { label: "Motorcycle", build: buildMotorcycle },
  bicycle: { label: "Bicycle", build: buildBicycle },
  person: { label: "Person", build: buildPerson },
  house: { label: "House", build: buildHouse },
  box: { label: "Box", build: buildBox },
};
