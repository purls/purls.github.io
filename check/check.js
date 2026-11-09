// Elements
const masterInput = document.getElementById("masterInput");
const checkInput = document.getElementById("checkInput");
const optCase = document.getElementById("optCase");
const optStrip = document.getElementById("optStrip");
const optPunct = document.getElementById("optPunct");
const optAccents = document.getElementById("optAccents");
const optMode = document.getElementById("optMode");
const summaryText = document.getElementById("summaryText");
const progressBar = document.getElementById("progressBar");
const copyMissing = document.getElementById("copyMissing");
const clearBtn = document.getElementById("clearBtn");
const itemsEl = document.getElementById("items");
const extrasSection = document.getElementById("extrasSection");
const extrasCount = document.getElementById("extrasCount");
const extrasEl = document.getElementById("extras");

// "01. ", "1 - ", "A1 ", "07\t", but not "99 Luftballons"
const TRACK_NUM_RE =
  /^\s*(?:[A-H]?\d{1,3}\s*[.)\-–—:]|0\d\s|\d{1,3}\t|[A-H]\d{1,2}\s)\s*/;
// "3:45", "(1:02:03)", "[4:10]"
const DURATION_RE = /\s*[\[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s*$/;
const PUNCT_SPACE_RE = /[\p{P}\p{S}\p{Z}\s]+/gu;
const SPACE_RE = /\s+/g;
const LATIN_MARK_RE = /(\p{Script=Latin})\p{M}+/gu;
const LINE_RE = /\r?\n/;
const COPY_FLASH_MS = 1200;

const Mode = Object.freeze({ EXACT: "exact", CONTAINS: "contains" });

let items = []; // { text, key, el }

function readOpts() {
  return {
    ignoreCase: optCase.checked,
    strip: optStrip.checked,
    punct: optPunct.checked,
    accents: optAccents.checked,
    mode: optMode.value,
  };
}

// Normalized comparison key. Empty means the line carries nothing to match.
function toKey(line, opts) {
  let s = line.normalize("NFKC").trim();

  if (opts.strip) s = s.replace(TRACK_NUM_RE, "").replace(DURATION_RE, "");
  if (opts.accents)
    s = s.normalize("NFD").replace(LATIN_MARK_RE, "$1").normalize("NFC");

  s = opts.punct
    ? s.replace(PUNCT_SPACE_RE, "")
    : s.replace(SPACE_RE, " ").trim();
  if (opts.ignoreCase) s = s.toLowerCase();

  return s;
}

// Unique, non-empty lines with their keys, first occurrence wins
function parseLines(text, opts) {
  const seen = new Set();
  const out = [];

  for (const line of text.split(LINE_RE)) {
    const key = toKey(line, opts);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    out.push({ text: line.trim(), key });
  }

  return out;
}

// Which master keys appear in the checker, and which checker lines hit nothing
function matchKeys(masterKeys, lineKeys, mode) {
  const isHit =
    mode === Mode.CONTAINS ? (m, l) => l.includes(m) : (m, l) => l === m;
  const used = new Set();

  const found = masterKeys.map((m) => {
    let hit = false;
    lineKeys.forEach((l, i) => {
      if (!isHit(m, l)) return;
      hit = true;
      used.add(i);
    });
    return hit;
  });

  const extras = lineKeys.map((_, i) => i).filter((i) => !used.has(i));
  return { found, extras };
}

// Rebuild the stack when the master list or options change
function renderMaster() {
  items = parseLines(masterInput.value, readOpts());
  itemsEl.replaceChildren();

  items.forEach((item, i) => {
    const li = document.createElement("li");
    li.className = "item";

    const num = document.createElement("span");
    num.className = "item-num";
    num.textContent = i + 1;

    const text = document.createElement("span");
    text.className = "item-text";
    text.textContent = item.text;

    li.append(num, text);
    itemsEl.append(li);
    item.el = li;
  });

  update();
}

// Toggle found state in place so the color transition plays
function update() {
  const opts = readOpts();
  const lines = parseLines(checkInput.value, opts);
  const { found, extras } = matchKeys(
    items.map((it) => it.key),
    lines.map((l) => l.key),
    opts.mode,
  );

  items.forEach((item, i) => item.el.classList.toggle("found", found[i]));

  const hits = found.filter(Boolean).length;
  summaryText.textContent = `${hits} / ${items.length} found`;
  progressBar.style.width = items.length
    ? `${(hits / items.length) * 100}%`
    : "0";

  renderExtras(extras.map((i) => lines[i].text));
}

function renderExtras(texts) {
  extrasSection.hidden = !texts.length;
  extrasCount.textContent = `(${texts.length})`;

  extrasEl.replaceChildren(
    ...texts.map((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      return li;
    }),
  );
}

// Copy unfound items, one per line
async function copyMissingItems() {
  const missing = items
    .filter((it) => !it.el.classList.contains("found"))
    .map((it) => it.text);
  await navigator.clipboard.writeText(missing.join("\n"));

  const label = copyMissing.textContent;
  copyMissing.textContent = `Copied ${missing.length}`;
  setTimeout(() => (copyMissing.textContent = label), COPY_FLASH_MS);
}

masterInput.addEventListener("input", renderMaster);
checkInput.addEventListener("input", update);
[optCase, optStrip, optPunct, optAccents, optMode].forEach((el) =>
  el.addEventListener("change", renderMaster),
);
copyMissing.addEventListener("click", copyMissingItems);
clearBtn.addEventListener("click", () => {
  masterInput.value = "";
  checkInput.value = "";
  renderMaster();
});

renderMaster();
