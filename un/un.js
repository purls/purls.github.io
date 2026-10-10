// State
let entries = []; // { name, lower, sources: Set, rand }
let byLower = new Map();
let lists = new Map(); // list name -> name count
let filtered = [];
let currentPage = 1;
let triStates = {};
let starred = new Set();

const STAR_KEY = "un.starred";
const VOWELS = "aeiou";
const CONSONANT_RE = /[b-df-hj-np-tv-z]/;
const SYMBOL_RE = /[^a-z0-9]/;
const SPLIT_RE = /[\s,;]+/;
const ADJ_BADGE_PCT = 75;

const KEYBOARD_ROWS = ["1234567890-", "qwertyuiop", "asdfghjkl", "zxcvbnm."];
const LEFT_KEYS = "12345qwertasdfgzxcvb";
const RIGHT_KEYS = "67890-yuiophjklnm.";

// {key}:{neighbours}
const ADJACENT_KEYS = `
1:2q
2:1qw3
3:2we4
4:3er5
5:4rt6
6:5ty7
7:6yu8
8:7ui9
9:8io0
0:9op-
-:0p
q:12wa
w:23qeas
e:34wrsd
r:45etdf
t:56ryfg
y:67tugh
u:78yihj
i:89uojk
o:90ipkl
p:0ol-
a:qwsz
s:weadzx
d:ersfxc
f:rtdgcv
g:tyfhvb
h:yugjbn
j:uihknm
k:iojlm
l:opk.
z:asx
x:zsdc
c:xdfv
v:cfgb
b:vghn
n:bhjm
m:njk
.:l
`;

const keyRow = {};
KEYBOARD_ROWS.forEach((keys, i) => {
  for (const k of keys) keyRow[k] = i;
});

const adjacent = {};
for (const line of ADJACENT_KEYS.trim().split("\n")) {
  const [key, neighbours] = line.split(":");
  adjacent[key] = new Set(neighbours);
}

function keyboardReport(str) {
  const chars = [...str].filter((c) => c in keyRow);
  if (chars.length === 0) return { sameRow: false, adjacentPct: 0 };
  const sameRow = new Set(chars.map((c) => keyRow[c])).size === 1;
  let adj = 0;
  for (let i = 0; i < chars.length - 1; i++) {
    const a = chars[i];
    const b = chars[i + 1];
    // A doubled key counts as adjacent
    if (a === b || adjacent[a]?.has(b)) adj++;
  }
  const adjacentPct = chars.length > 1 ? (adj / (chars.length - 1)) * 100 : 0;
  return { sameRow, adjacentPct };
}

// Which hand types every key, or null when both are needed
function oneHand(s) {
  let left = true;
  let right = true;
  for (const c of s) {
    if (!LEFT_KEYS.includes(c)) left = false;
    if (!RIGHT_KEYS.includes(c)) right = false;
  }
  if (left) return "left";
  if (right) return "right";
  return null;
}

// Name helpers

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function hasConsecutive(s, count) {
  if (s.length < count) return false;
  for (let i = 0; i <= s.length - count; i++) {
    if (new Set(s.substring(i, i + count)).size === 1) return true;
  }
  return false;
}

function isPalindrome(s) {
  return s === [...s].reverse().join("");
}

// Longest run of characters passing test, e.g. consonants in "strength" is 3
function longestRun(s, test) {
  let best = 0;
  let run = 0;
  for (const c of s) {
    run = test(c) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

const isVowel = (c) => VOWELS.includes(c);
const isConsonant = (c) => CONSONANT_RE.test(c);

// Spell a name in structure letters, e.g. kiro_7 is CVCVSN
function structureOf(s) {
  let out = "";
  for (const c of s) {
    if (isVowel(c)) out += "V";
    else if (isConsonant(c)) out += "C";
    else if (c >= "0" && c <= "9") out += "N";
    else out += "S";
  }
  return out;
}

// Structure patterns compile to an anchored regex.
// L letter, C consonant, V vowel, N number, S symbol, * any, \x literal x.
function compileStructure(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      re += pattern[++i].replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
      continue;
    }
    if (ch === "l") re += "[a-z]";
    else if (ch === "c") re += "[b-df-hj-np-tv-z]";
    else if (ch === "v") re += "[aeiou]";
    else if (ch === "n") re += "[0-9]";
    else if (ch === "s") re += "[^a-z0-9]";
    else if (ch === "*") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  }
  try {
    return new RegExp("^" + re + "$");
  } catch {
    return null;
  }
}

// Canonical repeat shape, first new character becomes A, next B and so on.
// otto and ABBA both give ABBA.
function repeatShape(s) {
  const seen = new Map();
  let out = "";
  for (const c of s) {
    if (!seen.has(c)) seen.set(c, String.fromCharCode(65 + seen.size));
    out += seen.get(c);
  }
  return out;
}

// Starred names, persisted per browser
function loadStars() {
  try {
    starred = new Set(JSON.parse(localStorage.getItem(STAR_KEY)) || []);
  } catch {
    starred = new Set();
  }
}

function saveStars() {
  try {
    localStorage.setItem(STAR_KEY, JSON.stringify([...starred]));
  } catch {}
}

// Tag input component
function setupTagInput(inputId, wrapId, opts = {}) {
  const input = document.getElementById(inputId);
  const wrap = document.getElementById(wrapId);
  const tags = [];

  function addTag(raw) {
    const val = (raw || "").trim().toLowerCase();
    if (!val || tags.includes(val)) return;
    tags.push(val);
    renderTags();
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input.value);
      input.value = "";
    }
    if (e.key === "Backspace" && input.value === "" && tags.length) {
      tags.pop();
      renderTags();
    }
  });

  function renderTags() {
    wrap.querySelectorAll(".tag").forEach((t) => t.remove());
    tags.forEach((t, i) => {
      const el = document.createElement("span");
      el.className = "tag";
      el.innerHTML = `${esc(opts.upper ? t.toUpperCase() : t)} <span class="remove-tag" data-idx="${i}">×</span>`;
      wrap.insertBefore(el, input);
    });
  }

  wrap.addEventListener("click", (e) => {
    if (e.target.classList.contains("remove-tag")) {
      tags.splice(+e.target.dataset.idx, 1);
      renderTags();
    }
    input.focus();
  });

  return {
    getTags: () => [...tags],
    clear: () => {
      tags.length = 0;
      renderTags();
    },
  };
}

const substrings = setupTagInput("substringInput", "substringWrap");
const subExclude = setupTagInput("subExcludeInput", "subExcludeWrap");
const prefixes = setupTagInput("prefixInput", "prefixWrap");
const suffixes = setupTagInput("suffixInput", "suffixWrap");
const structures = setupTagInput("structureInput", "structureWrap", {
  upper: true,
});
const shapes = setupTagInput("shapeInput", "shapeWrap", { upper: true });

// Tri-toggle buttons
document.querySelectorAll(".tri-toggle").forEach((group) => {
  const filterName = group.dataset.filter;
  triStates[filterName] = "any";
  group.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      group.querySelectorAll("button").forEach((b) => (b.className = ""));
      const val = btn.dataset.val;
      triStates[filterName] = val;
      btn.className = "active-" + val;
    });
  });
});

// True when the toggle is Any, or when test() agrees with Yes / No.
// test is only run when needed, so costly checks stay lazy.
function tri(filter, test) {
  const state = triStates[filter];
  if (state === "any") return true;
  return (state === "yes") === test();
}

// File upload
const uploadArea = document.getElementById("uploadArea");
const fileInput = document.getElementById("fileInput");

uploadArea.addEventListener("click", () => fileInput.click());
uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("dragover");
});
uploadArea.addEventListener("dragleave", () =>
  uploadArea.classList.remove("dragover"),
);
uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("dragover");
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener("change", () => {
  handleFiles(fileInput.files);
  fileInput.value = "";
});

// Copied up front since clearing the input empties its live FileList
async function handleFiles(fileList) {
  const files = [...fileList];
  for (const file of files) {
    const label = file.name.replace(/\.[^.]+$/, "");
    addList(uniqueLabel(label), await file.text());
  }
  afterLoad();
}

document.getElementById("pasteBtn").addEventListener("click", () => {
  const box = document.getElementById("pasteInput");
  const nameBox = document.getElementById("pasteName");
  if (!box.value.trim()) return;
  const label = nameBox.value.trim() || "pasted";
  addList(uniqueLabel(label), box.value);
  box.value = "";
  nameBox.value = "";
  afterLoad();
});

// Two files named the same would otherwise share one list
function uniqueLabel(label) {
  if (!lists.has(label)) return label;
  let n = 2;
  while (lists.has(`${label} (${n})`)) n++;
  return `${label} (${n})`;
}

// Merge a text list into entries, deduping case insensitively
function addList(label, text) {
  let count = 0;
  for (const raw of text.split(SPLIT_RE)) {
    const name = raw.replace(/^@/, "");
    if (!name) continue;
    const lower = name.toLowerCase();
    let entry = byLower.get(lower);
    if (!entry) {
      entry = { name, lower, sources: new Set(), rand: Math.random() };
      byLower.set(lower, entry);
      entries.push(entry);
    }
    if (entry.sources.has(label)) continue;
    entry.sources.add(label);
    count++;
  }
  lists.set(label, count);
}

function removeList(label) {
  lists.delete(label);
  entries = entries.filter((e) => {
    e.sources.delete(label);
    if (e.sources.size) return true;
    byLower.delete(e.lower);
    return false;
  });
  afterLoad();
}

function afterLoad() {
  renderLists();
  renderSortOptions();
  const has = entries.length > 0;
  document.getElementById("filtersSection").style.display = has ? "" : "none";
  document.getElementById("actionsSection").style.display = has ? "" : "none";
  if (!has) {
    hideResults();
    showInfo("");
    return;
  }

  applyAndRender();
}

function renderLists() {
  const chips = [...lists.entries()]
    .map(
      ([label, n]) =>
        `<span class="tag">${esc(label)} (${n.toLocaleString("en-US")}) ` +
        `<span class="remove-tag" data-list="${esc(label)}">×</span></span>`,
    )
    .join("");
  document.getElementById("listChips").innerHTML = chips;

  // Keep the list filter selection when it still exists
  const sel = document.getElementById("sourceFilter");
  const prev = sel.value;
  sel.innerHTML =
    '<option value="">Any</option>' +
    [...lists.keys()]
      .map((l) => `<option value="${esc(l)}">${esc(l)}</option>`)
      .join("");
  sel.value = lists.has(prev) ? prev : "";
}

document.getElementById("listChips").addEventListener("click", (e) => {
  const label = e.target.dataset.list;
  if (label !== undefined) removeList(label);
});

function keyboardEnabled() {
  return document.getElementById("keyboardEnabled").checked;
}

function multiList() {
  return lists.size > 1;
}

// Sort keys in menu order
const SORT_KEYS = {
  alpha: {
    label: "Alphabetical",
    asc: "A→Z",
    desc: "Z→A",
    key: (e) => e.lower,
  },
  length: {
    label: "Length",
    asc: "short→long",
    desc: "long→short",
    key: (e) => e.lower.length,
  },
  distinct: {
    label: "Distinct chars",
    asc: "few→many",
    desc: "many→few",
    key: (e) => new Set(e.lower).size,
  },
  vowels: {
    label: "Vowel %",
    asc: "low→high",
    desc: "high→low",
    key: (e) => [...e.lower].filter(isVowel).length / e.lower.length,
  },
  lists: {
    label: "Lists",
    asc: "few→many",
    desc: "many→few",
    needsMulti: true,
    key: (e) => e.sources.size,
  },
  keyboard: {
    label: "Keyboard Adj %",
    asc: "low→high",
    desc: "high→low",
    needsKeyboard: true,
    key: (e) => keyboardReport(e.lower).adjacentPct,
  },
  random: {
    label: "Random",
    asc: "shuffle",
    desc: "reverse shuffle",
    key: (e) => e.rand,
  },
};

// Every level the user has set, primary first
function sortValues() {
  return [...document.querySelectorAll(".sort-select")]
    .map((sel) => sel.value)
    .filter((v) => v && v !== "none");
}

// Sort by each level in turn, the next breaking the ties left by the last
function sortRows(rows, values) {
  const specs = [];
  for (const value of values) {
    const desc = value.endsWith("-desc");
    const spec = SORT_KEYS[desc ? value.slice(0, -5) : value];
    if (spec) specs.push({ key: spec.key, dir: desc ? -1 : 1 });
  }
  if (!specs.length) return rows;

  // Compute keys once instead of on every comparison
  const decorated = rows.map((row) => ({
    row,
    keys: specs.map((s) => s.key(row)),
  }));

  decorated.sort((a, b) => {
    for (let i = 0; i < specs.length; i++) {
      const x = a.keys[i];
      const y = b.keys[i];
      const c = typeof x === "string" ? x.localeCompare(y) : x - y;
      if (c) return c * specs[i].dir;
    }
    return 0;
  });

  return decorated.map((d) => d.row);
}

function sortOptionsHtml(includeNone) {
  let html = includeNone ? '<option value="none">Original Order</option>' : "";
  for (const [name, spec] of Object.entries(SORT_KEYS)) {
    if (spec.needsMulti && !multiList()) continue;
    if (spec.needsKeyboard && !keyboardEnabled()) continue;
    html +=
      `<option value="${name}">${spec.label} (${spec.asc})</option>` +
      `<option value="${name}-desc">${spec.label} (${spec.desc})</option>`;
  }
  return html;
}

function renderSortOptions() {
  document.querySelectorAll(".sort-select").forEach((sel) => {
    const prev = sel.value;
    sel.innerHTML = sortOptionsHtml(sel.id === "sortBy");
    const kept = [...sel.options].some((o) => o.value === prev);
    sel.value = kept ? prev : sel.options[0].value;
  });
}

// More levels than keys can never break another tie
const MAX_SORT_LEVELS = Object.keys(SORT_KEYS).length;

function updateAddSortState() {
  document.getElementById("addSort").disabled =
    document.querySelectorAll(".sort-select").length >= MAX_SORT_LEVELS;
}

function addSortLevel() {
  if (document.querySelectorAll(".sort-select").length >= MAX_SORT_LEVELS)
    return;
  const wrap = document.createElement("span");
  wrap.className = "sort-then";
  wrap.innerHTML =
    `<label>then by:</label><select class="sort-select">${sortOptionsHtml(false)}</select>` +
    '<button type="button" class="mini-btn remove-sort" title="Remove this level">×</button>';
  const controls = document.getElementById("sortControls");
  controls.insertBefore(wrap, document.getElementById("addSort"));
  updateAddSortState();
}

function clearSortLevels() {
  document.querySelectorAll(".sort-then").forEach((el) => el.remove());
  updateAddSortState();
}

function syncKeyboardEnabled() {
  document
    .getElementById("keyboardOptions")
    .classList.toggle("filters-off", !keyboardEnabled());
  renderSortOptions();
}

document
  .getElementById("keyboardEnabled")
  .addEventListener("change", syncKeyboardEnabled);

document.getElementById("addSort").addEventListener("click", addSortLevel);
document.getElementById("sortControls").addEventListener("click", (e) => {
  if (!e.target.classList.contains("remove-sort")) return;
  e.target.closest(".sort-then").remove();
  updateAddSortState();
});

// Filtering

function numOrNull(id) {
  const v = document.getElementById(id).value;
  return v === "" ? null : +v;
}

function applyFilters() {
  const minLen = numOrNull("minLength");
  const maxLen = numOrNull("maxLength");
  const minDistinct = numOrNull("minDistinct");
  const maxDistinct = numOrNull("maxDistinct");
  const maxConsRun = numOrNull("maxConsRun");
  const maxVowelRun = numOrNull("maxVowelRun");
  const minLists = numOrNull("minLists");
  const minAdjPct = numOrNull("minAdjacentPct");
  const repeatCount = numOrNull("repeatCount") || 2;
  const source = document.getElementById("sourceFilter").value;
  const hand = document.getElementById("handFilter").value;
  const subs = substrings.getTags();
  const subsExc = subExclude.getTags();
  const pres = prefixes.getTags();
  const sufs = suffixes.getTags();
  const structPatterns = structures
    .getTags()
    .map(compileStructure)
    .filter(Boolean);
  const shapeSet = new Set(shapes.getTags().map(repeatShape));
  const kbOn = keyboardEnabled();

  // A bad regex reports and leaves the last results in place
  let regex = null;
  const regexText = document.getElementById("regexInput").value.trim();
  if (regexText) {
    try {
      regex = new RegExp(regexText, "i");
    } catch (err) {
      showError(`Regex: ${err.message}`);
      return false;
    }
  }

  filtered = entries.filter((e) => {
    const s = e.lower;

    // Length
    if (minLen !== null && s.length < minLen) return false;
    if (maxLen !== null && s.length > maxLen) return false;
    if (minDistinct !== null || maxDistinct !== null) {
      const d = new Set(s).size;
      if (minDistinct !== null && d < minDistinct) return false;
      if (maxDistinct !== null && d > maxDistinct) return false;
    }

    // Lists & shortlist
    if (source && !e.sources.has(source)) return false;
    if (minLists !== null && e.sources.size < minLists) return false;
    if (!tri("starred", () => starred.has(s))) return false;

    // Characters
    if (!tri("letters", () => /[a-z]/.test(s))) return false;
    if (!tri("vowels", () => /[aeiou]/.test(s))) return false;
    if (!tri("numbers", () => /\d/.test(s))) return false;
    if (!tri("symbols", () => SYMBOL_RE.test(s))) return false;
    if (!tri("letterFirst", () => /^[a-z]/.test(s))) return false;

    // Patterns
    if (!tri("palindrome", () => isPalindrome(s))) return false;
    if (!tri("unique", () => new Set(s).size === s.length)) return false;
    if (!tri("repeats", () => hasConsecutive(s, repeatCount))) return false;
    if (maxConsRun !== null && longestRun(s, isConsonant) > maxConsRun)
      return false;
    if (maxVowelRun !== null && longestRun(s, isVowel) > maxVowelRun)
      return false;

    // Substrings
    if (subs.length && !subs.some((t) => s.includes(t))) return false;
    if (subsExc.some((t) => s.includes(t))) return false;
    if (pres.length && !pres.some((t) => s.startsWith(t))) return false;
    if (sufs.length && !sufs.some((t) => s.endsWith(t))) return false;
    if (regex && !regex.test(e.name)) return false;

    // Shapes
    if (structPatterns.length && !structPatterns.some((re) => re.test(s)))
      return false;
    if (shapeSet.size && !shapeSet.has(repeatShape(s))) return false;

    // Keyboard
    if (!kbOn) return true;
    if (hand) {
      const h = oneHand(s);
      if (!h || (hand !== "either" && h !== hand)) return false;
    }
    if (triStates.sameRow !== "any" || minAdjPct !== null) {
      const kb = keyboardReport(s);
      if (!tri("sameRow", () => kb.sameRow)) return false;
      if (minAdjPct !== null && kb.adjacentPct < minAdjPct) return false;
    }

    return true;
  });

  filtered = sortRows(filtered, sortValues());
  currentPage = 1;
  return true;
}

// Rendering

function kbCell(s) {
  const kb = keyboardReport(s);
  let html = "";
  if (kb.sameRow) html = '<span class="keyboard-badge same-row">row</span> ';
  const hand = oneHand(s);
  if (hand) html += `<span class="keyboard-badge same-row">${hand}</span> `;
  if (kb.adjacentPct >= ADJ_BADGE_PCT)
    html += `<span class="keyboard-badge adjacent">${kb.adjacentPct.toFixed(0)}%</span>`;
  else if (kb.adjacentPct > 0) html += `${kb.adjacentPct.toFixed(0)}%`;
  return `<td>${html}</td>`;
}

function renderTable() {
  const kbOn = keyboardEnabled();
  const multi = multiList();

  document.getElementById("tableHead").innerHTML =
    "<tr><th>★</th><th>Name</th><th>Len</th><th>Shape</th>" +
    (multi ? "<th>Lists</th>" : "") +
    (kbOn ? "<th>KB</th>" : "") +
    "</tr>";

  // Pagination
  const perPage = +document.getElementById("perPage").value || filtered.length;
  const totalPages = perPage ? Math.ceil(filtered.length / perPage) || 1 : 1;
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * perPage;
  const pageRows = perPage ? filtered.slice(start, start + perPage) : filtered;

  document.getElementById("tableBody").innerHTML = pageRows
    .map((e) => {
      const on = starred.has(e.lower);
      const name = esc(e.name);
      return (
        "<tr>" +
        `<td><span class="star${on ? " on" : ""}" data-star="${esc(e.lower)}">${on ? "★" : "☆"}</span></td>` +
        `<td><span class="name-cell" data-copy="${name}" title="Click to copy">${name}</span></td>` +
        `<td>${e.lower.length}</td>` +
        `<td class="shape-cell">${structureOf(e.lower)}</td>` +
        (multi
          ? `<td title="${esc([...e.sources].join(", "))}">${e.sources.size}</td>`
          : "") +
        (kbOn ? kbCell(e.lower) : "") +
        "</tr>"
      );
    })
    .join("");

  // Stats
  document.getElementById("resultCount").textContent =
    filtered.length.toLocaleString("en-US");
  document.getElementById("totalCount").textContent =
    entries.length.toLocaleString("en-US");
  document.getElementById("starStat").innerHTML = starred.size
    ? `Starred: <span>${starred.size}</span>`
    : "";

  // Pagination controls
  document.getElementById("pageInfo").textContent =
    `Page ${currentPage} of ${totalPages}`;
  document.getElementById("prevPage").disabled = currentPage <= 1;
  document.getElementById("nextPage").disabled = currentPage >= totalPages;

  // Show sections
  document.getElementById("statsBar").style.display = "";
  document.getElementById("tableWrap").style.display = "";
  document.getElementById("pagination").style.display = "";
  document.getElementById("exportBtn").disabled = filtered.length === 0;
  document.getElementById("copyBtn").disabled = filtered.length === 0;
}

function hideResults() {
  for (const id of ["statsBar", "tableWrap", "pagination"])
    document.getElementById(id).style.display = "none";
}

function applyAndRender() {
  if (!applyFilters()) return;
  renderTable();
  showInfo(
    `Showing ${filtered.length.toLocaleString("en-US")} of ${entries.length.toLocaleString("en-US")} names.`,
  );
}

// Events
document.getElementById("applyBtn").addEventListener("click", applyAndRender);

// Enter in any plain field applies, tag boxes keep Enter for adding tags
document.getElementById("filtersSection").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.target.classList.contains("tag-text-input"))
    return;
  if (e.target.tagName === "INPUT") applyAndRender();
});

document.getElementById("prevPage").addEventListener("click", () => {
  currentPage--;
  renderTable();
});
document.getElementById("nextPage").addEventListener("click", () => {
  currentPage++;
  renderTable();
});
document.getElementById("perPage").addEventListener("change", () => {
  currentPage = 1;
  renderTable();
});

// Star toggles and click to copy
document.getElementById("tableBody").addEventListener("click", (e) => {
  const star = e.target.dataset.star;
  if (star !== undefined) {
    if (starred.has(star)) starred.delete(star);
    else starred.add(star);
    saveStars();
    e.target.classList.toggle("on", starred.has(star));
    e.target.textContent = starred.has(star) ? "★" : "☆";
    document.getElementById("starStat").innerHTML = starred.size
      ? `Starred: <span>${starred.size}</span>`
      : "";
    return;
  }

  const copy = e.target.dataset.copy;
  if (copy === undefined) return;
  navigator.clipboard
    .writeText(copy)
    .then(() => showInfo(`Copied ${copy}`))
    .catch(() => showError("Clipboard unavailable."));
});

document.getElementById("clearStars").addEventListener("click", () => {
  if (!starred.size || !confirm(`Clear ${starred.size} starred names?`)) return;
  starred.clear();
  saveStars();
  if (entries.length) renderTable();
});

document.getElementById("resetBtn").addEventListener("click", () => {
  document
    .querySelectorAll("#filtersSection input[type=number], #regexInput")
    .forEach((el) => (el.value = ""));
  document.getElementById("sourceFilter").value = "";
  document.getElementById("handFilter").value = "";
  document.getElementById("keyboardEnabled").checked = true;
  syncKeyboardEnabled();
  clearSortLevels();
  document.getElementById("sortBy").value = "none";
  for (const t of [
    substrings,
    subExclude,
    prefixes,
    suffixes,
    structures,
    shapes,
  ])
    t.clear();
  document.querySelectorAll(".tri-toggle").forEach((g) => {
    triStates[g.dataset.filter] = "any";
    g.querySelectorAll("button").forEach((b) => (b.className = ""));
    g.querySelector('[data-val="any"]').className = "active-any";
  });
  if (entries.length) applyAndRender();
});

function filteredText() {
  return filtered.map((e) => e.name).join("\n");
}

document.getElementById("copyBtn").addEventListener("click", () => {
  navigator.clipboard
    .writeText(filteredText())
    .then(() => showInfo(`Copied ${filtered.length} names.`))
    .catch(() => showError("Clipboard unavailable."));
});

document.getElementById("exportBtn").addEventListener("click", () => {
  if (!filtered.length) return;
  const blob = new Blob([filteredText()], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "filtered_usernames.txt";
  a.click();
  URL.revokeObjectURL(url);
  showInfo(`Exported ${filtered.length} names.`);
});

loadStars();
syncKeyboardEnabled();
updateAddSortState();

// Messages
function showError(msg) {
  document.getElementById("errorMessage").textContent = msg;
  document.getElementById("infoMessage").textContent = "";
}
function showInfo(msg) {
  document.getElementById("infoMessage").textContent = msg;
  document.getElementById("errorMessage").textContent = "";
}
