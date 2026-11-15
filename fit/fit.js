// Elements
const itemsInput = document.getElementById("itemsInput");
const optSource = document.getElementById("optSource");
const optWidth = document.getElementById("optWidth");
const optPad = document.getElementById("optPad");
const optGap = document.getElementById("optGap");
const optBlank = document.getElementById("optBlank");
const summaryText = document.getElementById("summaryText");
const moreBtn = document.getElementById("moreBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");
const errorText = document.getElementById("errorText");
const rowsEl = document.getElementById("rows");
const orderOutput = document.getElementById("orderOutput");

// Search budgets. Quick keeps typing responsive, long is on request.
const QUICK_MS = 300;
const LONG_MS = 10000;
const DEBOUNCE_MS = 150;
const COPY_FLASH_MS = 1200;
const PERCENT = 100;

const LINE_RE = /\r?\n/;
// "Crate A, 12.5", "Crate A 12.5", "Crate A = 12.5" or a bare "12.5"
const VALUE_RE = /^(?:(.*?)[\s,;|:=]+)?(\d*\.?\d+)$/;

const Source = Object.freeze({ CHARS: "chars", VALUE: "value" });

let debounceId = 0;

// 55.50 -> "55.5"
function fmt(x) {
  return String(+x.toFixed(2));
}

// 1 -> "1 row", 2 -> "2 rows"
function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function readBox() {
  return {
    width: parseFloat(optWidth.value),
    pad: parseFloat(optPad.value),
    gap: parseFloat(optGap.value),
  };
}

function boxError(box) {
  if (!(box.width > 0)) return "Width must be above 0.";
  if (!(box.pad >= 0)) return "Padding must be 0 or more.";
  if (!(box.gap >= 0)) return "Gap must be 0 or more.";

  return "";
}

// Non-empty lines as { line, label, width }. bad holds line numbers without a value.
function parseItems(text, source) {
  const items = [];
  const bad = [];

  text.split(LINE_RE).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;

    if (source === Source.CHARS) {
      // Code points, so an emoji counts once
      items.push({ line, label: line, width: [...line].length });
      return;
    }

    const m = VALUE_RE.exec(line);
    if (!m) {
      bad.push(idx + 1);
      return;
    }

    items.push({ line, label: m[1] || m[2], width: parseFloat(m[2]) });
  });

  return { items, bad };
}

// Width a row occupies, gaps included
function rowUsed(row, items, box) {
  const boxes = row.reduce((sum, i) => sum + items[i].width + box.pad, 0);

  return boxes + box.gap * (row.length - 1);
}

function drawRows(result, items, box) {
  const oversized = new Set(result.oversized);
  const share = (x) => `${Math.min(PERCENT, (x / box.width) * PERCENT)}%`;

  // Character mode draws at true scale, values stretch to the page
  const isChars = optSource.value === Source.CHARS;
  rowsEl.style.setProperty("--track-width", isChars ? `${box.width}ch` : "1fr");

  rowsEl.replaceChildren(
    ...result.rows.map((row, r) => {
      const li = document.createElement("li");
      li.className = "row";
      if (oversized.has(row[0])) li.classList.add("oversized");

      const num = document.createElement("span");
      num.className = "row-num";
      num.textContent = r + 1;

      const track = document.createElement("div");
      track.className = "track";
      track.style.gap = share(box.gap);

      for (const i of row) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.style.width = share(items[i].width + box.pad);
        chip.textContent = items[i].label;
        chip.title = `${items[i].label} (${fmt(items[i].width)})`;
        track.append(chip);
      }

      const used = document.createElement("span");
      used.className = "row-used";
      used.textContent = fmt(rowUsed(row, items, box));
      used.title = `Used of ${fmt(box.width)}`;

      li.append(num, track, used);
      return li;
    }),
  );
}

function drawSummary(result, count) {
  const parts = [plural(count, "item"), plural(result.rows.length, "row")];

  parts.push(
    result.proven
      ? "optimal"
      : `unproven, at least ${result.lowerBound} needed`,
  );
  if (result.oversized.length)
    parts.push(`${result.oversized.length} wider than the container`);

  summaryText.textContent = parts.join(", ");
  moreBtn.hidden = result.proven;
}

function drawOrder(rows, items) {
  const rowSep = optBlank.checked ? "\n\n" : "\n";

  orderOutput.value = rows
    .map((row) => row.map((i) => items[i].line).join("\n"))
    .join(rowSep);
}

function clearResults(count) {
  rowsEl.replaceChildren();
  orderOutput.value = "";
  summaryText.textContent = plural(count, "item");
  moreBtn.hidden = true;
}

function render(budgetMs) {
  const box = readBox();
  const { items, bad } = parseItems(itemsInput.value, optSource.value);

  const errors = [boxError(box)];
  if (bad.length) errors.push(`No trailing value on line ${bad.join(", ")}.`);
  errorText.textContent = errors.filter(Boolean).join(" ");

  if (errors[0] || !items.length) {
    clearResults(items.length);
    return;
  }

  const result = arrange(
    items.map((it) => it.width),
    box,
    budgetMs,
  );

  drawRows(result, items, box);
  drawSummary(result, items.length);
  drawOrder(result.rows, items);
}

function renderSoon() {
  clearTimeout(debounceId);
  debounceId = setTimeout(() => render(QUICK_MS), DEBOUNCE_MS);
}

for (const el of [itemsInput, optWidth, optPad, optGap])
  el.addEventListener("input", renderSoon);
for (const el of [optSource, optBlank])
  el.addEventListener("change", () => render(QUICK_MS));

moreBtn.addEventListener("click", () => {
  summaryText.textContent = "Searching...";
  moreBtn.hidden = true;

  // Let the status paint before the search blocks the page
  requestAnimationFrame(() => setTimeout(() => render(LONG_MS), 0));
});

copyBtn.addEventListener("click", async () => {
  if (!orderOutput.value) return;

  await navigator.clipboard.writeText(orderOutput.value);
  copyBtn.textContent = "Copied";
  setTimeout(() => (copyBtn.textContent = "Copy order"), COPY_FLASH_MS);
});

clearBtn.addEventListener("click", () => {
  itemsInput.value = "";
  render(QUICK_MS);
  itemsInput.focus();
});

render(QUICK_MS);
