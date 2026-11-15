// Fixed point factor, keeps fractional units exact
const SCALE = 1000;
// Search nodes between clock reads
const NODE_CHECK = 4096;

// Martello-Toth L2 bound on the bins needed. Never below ceil(total / cap).
function lowerBound(sizes, cap) {
  const total = sizes.reduce((a, b) => a + b, 0);
  const half = cap / 2;
  let best = Math.ceil(total / cap);

  // Items above cap - a sit alone, items above half never share with each other
  for (const a of new Set(sizes.filter((s) => s <= half))) {
    let alone = 0;
    let big = 0;
    let bigSum = 0;
    let smallSum = 0;

    for (const s of sizes) {
      if (s > cap - a) alone++;
      else if (s > half) {
        big++;
        bigSum += s;
      } else if (s >= a) smallSum += s;
    }

    const spill = smallSum - (big * cap - bigSum);
    best = Math.max(best, alone + big + Math.max(0, Math.ceil(spill / cap)));
  }

  return best;
}

// First fit over sizes sorted descending. Returns the bin index per item.
function firstFit(sorted, cap) {
  const free = [];

  return sorted.map((size) => {
    let b = free.findIndex((f) => f >= size);
    if (b === -1) b = free.push(cap) - 1;

    free[b] -= size;
    return b;
  });
}

// Exact bin packing by branch and bound. Every size must be <= cap.
// Returns bins of item indexes. proven is false when the budget ran out.
function packBins(sizes, cap, budgetMs) {
  const n = sizes.length;
  if (!n) return { bins: [], lowerBound: 0, proven: true };

  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b] - sizes[a]);
  const sorted = order.map((i) => sizes[i]);
  const minSize = sorted[n - 1];
  const lower = lowerBound(sorted, cap);

  let best = firstFit(sorted, cap);
  let bestCount = Math.max(...best) + 1;

  // tail[i]: total size of items i and after
  const tail = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) tail[i] = tail[i + 1] + sorted[i];

  const deadline = performance.now() + budgetMs;
  const free = [];
  const assign = new Array(n);
  let nodes = 0;
  let timedOut = false;

  function search(i) {
    if (timedOut || bestCount === lower) return;

    if (++nodes % NODE_CHECK === 0 && performance.now() > deadline) {
      timedOut = true;
      return;
    }

    // Space smaller than the smallest item is dead, the rest may absorb the tail
    let usable = 0;
    for (const f of free) if (f >= minSize) usable += f;

    const extra = Math.max(0, Math.ceil((tail[i] - usable) / cap));
    if (free.length + extra >= bestCount) return;

    if (i === n) {
      bestCount = free.length;
      best = assign.slice();
      return;
    }

    const size = sorted[i];

    // A bin the item fills exactly is never a worse choice
    const exact = free.indexOf(size);
    if (exact !== -1) {
      free[exact] = 0;
      assign[i] = exact;
      search(i + 1);
      free[exact] = size;
      return;
    }

    for (let b = 0; b < free.length; b++) {
      if (free[b] < size) continue;
      // Bins with equal space left are interchangeable
      if (free.indexOf(free[b]) < b) continue;

      free[b] -= size;
      assign[i] = b;
      search(i + 1);
      free[b] += size;
    }

    if (free.length + 1 >= bestCount) return;

    free.push(cap - size);
    assign[i] = free.length - 1;
    search(i + 1);
    free.pop();
  }

  if (bestCount > lower) search(0);

  const bins = Array.from({ length: bestCount }, () => []);
  best.forEach((b, k) => bins[b].push(order[k]));

  const proven = !timedOut || bestCount === lower;
  return { bins, lowerBound: proven ? bestCount : lower, proven };
}

// Wrap items in the given order the way flex-wrap does.
// An item too wide for an empty row still takes that row.
function flow(order, sizes, cap) {
  const rows = [];
  let used = 0;

  for (const i of order) {
    if (!rows.length || used + sizes[i] > cap) {
      rows.push([]);
      used = 0;
    }

    rows[rows.length - 1].push(i);
    used += sizes[i];
  }

  return rows;
}

// Fewest rows for items of the given widths in a wrapping container.
// box: { width, pad, gap }. pad is per item, gap sits between neighbors.
// Returns rows of item indexes in display order.
function arrange(widths, box, budgetMs) {
  // n items fit when sum(w + pad) + gap * (n - 1) <= width.
  // Adding one gap to both sides turns that into plain bin packing.
  const cap = Math.round((box.width + box.gap) * SCALE);
  const sizes = widths.map((w) => Math.round((w + box.pad + box.gap) * SCALE));

  const fits = [];
  const oversized = [];
  sizes.forEach((s, i) => (s <= cap ? fits : oversized).push(i));

  const packed = packBins(
    fits.map((i) => sizes[i]),
    cap,
    budgetMs,
  );
  const bins = packed.bins.map((bin) => bin.map((k) => fits[k]));
  for (const i of oversized) bins.push([i]);

  // Stay close to the input order where the packing leaves a choice
  for (const bin of bins) bin.sort((a, b) => a - b);
  bins.sort((a, b) => a[0] - b[0]);

  // Reflow so the rows match what a wrapping container shows. Never adds rows.
  const rows = flow(bins.flat(), sizes, cap);
  const lower = packed.lowerBound + oversized.length;

  return {
    rows,
    lowerBound: Math.min(lower, rows.length),
    proven: packed.proven || rows.length === lower,
    oversized,
  };
}
