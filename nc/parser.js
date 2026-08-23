// State
let rawRows = [];
let filteredRows = [];
let headers = [];
let tableMode = null; // 'auction' or 'buynow'
let domainCol = "name"; // actual header holding the domain name for the loaded file
let priceCol = "price"; // actual header holding the price for the loaded file
let availableCol = ""; // bulk-search only: the Available / Premium flag columns
let premiumCol = "";
let currentPage = 1;
let triStates = {};
let tldCounts = new Map();
let learnedRenew = new Map();

const KEYBOARD_ROWS = ["1234567890-", "qwertyuiop", "asdfghjkl", "zxcvbnm."];

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
  const chars = [...str.toLowerCase()].filter((c) => c in keyRow);
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

// Domain helpers
function extractParts(name) {
  if (!name || !name.includes(".")) return [name || "", ""];
  const i = name.indexOf(".");
  return [name.substring(0, i), name.substring(i + 1)];
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

// Structure patterns: L=letter, C=consonant, V=vowel, N=number, -=hyphen, *=any,
// .=literal dot, anything else matches itself. Vowels are aeiou, matching the
// vowel tri-toggle, so y counts as a consonant.
// Compiled to an anchored regex over the whole target.
function compileStructure(pattern) {
  let re = "";
  for (const ch of pattern) {
    if (ch === "l") re += "[a-z]";
    else if (ch === "c") re += "[b-df-hj-np-tv-z]";
    else if (ch === "v") re += "[aeiou]";
    else if (ch === "n") re += "[0-9]";
    else if (ch === "*") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  }
  try {
    return { re: new RegExp("^" + re + "$"), dotted: pattern.includes(".") };
  } catch {
    return null;
  }
}

// A term containing a dot is always matched against the full name so that
// "foo.co" hits both foo.com and foo.co.com. Dotless terms respect the scope:
// 'sld' = ignore the TLD, 'tld' = domain and TLD joined without the dot
// (so "example" can be found in exampl.e).
function termMatches(term, parts, scope) {
  if (term.includes(".")) return parts.full.includes(term);
  return (scope === "tld" ? parts.joined : parts.sld).includes(term);
}

// Tag input component
function setupTagInput(inputId, wrapId, opts = {}) {
  const input = document.getElementById(inputId);
  const wrap = document.getElementById(wrapId);
  const tags = [];

  function addTag(raw) {
    let val = (raw || "").trim().toLowerCase();
    if (opts.stripDot) val = val.replace(/^\./, "");
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
      el.innerHTML = `${opts.upper ? t.toUpperCase() : t} <span class="remove-tag" data-idx="${i}">×</span>`;
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
    add: addTag,
    clear: () => {
      tags.length = 0;
      renderTags();
    },
  };
}

const tldInclude = setupTagInput("tldIncludeInput", "tldIncludeWrap", {
  stripDot: true,
});
const tldExclude = setupTagInput("tldExcludeInput", "tldExcludeWrap", {
  stripDot: true,
});
const substrings = setupTagInput("substringInput", "substringWrap");
const subExclude = setupTagInput("subExcludeInput", "subExcludeWrap");
const structures = setupTagInput("structureInput", "structureWrap", {
  upper: true,
});

// TLD dropdown built from the loaded file
document.getElementById("tldAddInclude").addEventListener("click", () => {
  const v = document.getElementById("tldList").value;
  if (v) tldInclude.add(v);
});
document.getElementById("tldAddExclude").addEventListener("click", () => {
  const v = document.getElementById("tldList").value;
  if (v) tldExclude.add(v);
});

function renderTldList() {
  const sel = document.getElementById("tldList");
  const sorted = [...tldCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  sel.innerHTML =
    `<option value="">. ${sorted.length} TLDs in file. </option>` +
    sorted
      .map(
        ([t, n]) =>
          `<option value="${t}">.${t} (${n.toLocaleString("en-US")})</option>`,
      )
      .join("");
}

// Tri-toggle buttons
document.querySelectorAll(".tri-toggle").forEach((group) => {
  const filterName = group.dataset.filter;
  triStates[filterName] = "any";
  group.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      group.querySelectorAll("button").forEach((b) => (b.className = ""));
      const val = btn.dataset.val;
      triStates[filterName] = val;
      btn.className =
        val === "yes"
          ? "active-yes"
          : val === "no"
            ? "active-no"
            : "active-any";
    });
  });
});

// File upload
const uploadArea = document.getElementById("uploadArea");
const fileInput = document.getElementById("fileInput");
const fileNameEl = document.getElementById("fileName");

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
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  fileNameEl.textContent = file.name;
  const reader = new FileReader();
  reader.onload = (e) => parseCSV(e.target.result);
  reader.readAsText(file);
}

// Exports disagree on capitalisation. The Market files are lowercase, a bulk
// search writes Domain/Available/Premium/Price. Resolving headers by name
// without case and handing back the spelling the file actually used.
function findHeader(...names) {
  const lower = headers.map((h) => h.toLowerCase());
  for (const name of names) {
    const i = lower.indexOf(name.toLowerCase());
    if (i > -1) return headers[i];
  }
  return null;
}

// Prices arrive as 18.48, $138.60 or $1,138.60 depending on the export.
// Stripping the currency and separators first:
// parseFloat("$138.60") is NaN, and worse, parseFloat("1,138.60") is 1.
function toNumber(val) {
  return parseFloat(String(val == null ? "" : val).replace(/[$,\s]/g, ""));
}

// CSV parsing
function parseCSVLine(line, delim) {
  if (line.indexOf('"') === -1) return line.split(delim);

  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else current += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) {
        result.push(current);
        current = "";
      } else current += c;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(text) {
  // Normalize CRLF/CR line endings first, otherwise the last field of every line
  // (except the very last, which .trim() cleans up) keeps a trailing "\r" glued on,
  // silently breaking header lookups like "permalink".
  const normalized = text.replace(/\r\n?/g, "\n");
  const firstLine = normalized.split("\n")[0];
  const delim = firstLine.includes("\t") ? "\t" : ",";
  const lines = normalized.trim().split("\n");
  if (lines.length < 2) {
    showError("CSV has no data rows.");
    return;
  }

  headers = parseCSVLine(lines[0], delim);

  // Detect table type. Namecheap ships several Buy-Now shapes:
  // - The full export (permalink,domain,price,extensions_taken)
  // - A pre-filtered one (name,price_usd,permalink) from filtered/selected results.
  //   price_usd is a buy-now-only column, so it's as strong a signal as permalink/domain.
  // A bulk search is checked before buy-now: it also has a Domain and a Price
  // column, so only the Available/Premium pair tells the two apart.
  if (findHeader("bidCount") || findHeader("startPrice")) {
    tableMode = "auction";
  } else if (findHeader("available") || findHeader("premium")) {
    tableMode = "beast";
  } else if (
    findHeader("permalink") ||
    findHeader("domain") ||
    findHeader("price_usd")
  ) {
    tableMode = "buynow";
  } else {
    tableMode = findHeader("name") ? "auction" : "buynow";
  }

  // Resolve the actual column names present in this file rather than assuming "domain"/"price"
  // Pre-filtered buy-now export uses "name"/"price_usd".
  if (tableMode === "auction") {
    domainCol = findHeader("name") || "name";
    priceCol = findHeader("price") || "price";
  } else {
    domainCol = findHeader("domain", "name") || "domain";
    priceCol = findHeader("price", "price_usd") || "price";
  }
  availableCol = findHeader("available") || "";
  premiumCol = findHeader("premium") || "";

  rawRows = [];
  tldCounts = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCSVLine(lines[i], delim);
    const row = {};
    headers.forEach((h, j) => (row[h] = vals[j] || ""));
    rawRows.push(row);
    const name = row[domainCol];
    if (name) {
      const dot = name.indexOf(".");
      if (dot > -1) {
        const tld = name.substring(dot + 1).toLowerCase();
        tldCounts.set(tld, (tldCounts.get(tld) || 0) + 1);
      }
    }
  }
  renderTldList();
  learnRenewPrices(rawRows);
  renderSortOptions();

  // Update UI
  const typeEl = document.getElementById("tableType");
  const typeLabel = { auction: "Auction", buynow: "Buy-Now", beast: "Bulk Search" };
  typeEl.innerHTML = `<span class="detected-type ${tableMode}">${typeLabel[tableMode]}</span>`;

  document.getElementById("filtersSection").style.display = "";
  document.getElementById("beastFilters").style.display =
    tableMode === "beast" ? "" : "none";
  document.getElementById("actionsSection").style.display = "";

  showInfo(`Loaded ${rawRows.length} rows (${tableMode}).`);
  applyAndRender();
}

// Accessors
function getNameCol(row) {
  return row[domainCol] || "";
}

function getPriceCol(row) {
  return toNumber(row[priceCol]) || 0;
}

// Whether a bulk-search row is flagged premium, which changes what its renewal price is worth as an estimate.
function isPremium(row) {
  return (
    !!premiumCol && (row[premiumCol] || "").trim().toLowerCase() === "premium"
  );
}

// Renewal price for a row. The file's own renewPrice is authoritative when it has
// one, otherwise fall back to a per-TLD estimate (not always accurate).
function getRenew(row) {
  const own = toNumber(row["renewPrice"]);
  if (own > 0) return { value: own, exact: true };
  const tld = extractParts(getNameCol(row))[1].toLowerCase();
  if (!tld) return null;
  const listed = (window.TLD_RENEW || {})[tld];
  const est = listed > 0 ? listed : learnedRenew.get(tld);
  if (!(est > 0)) return null;
  // A premium name renews above its TLD's standard rate often enough that the
  // number below is a floor rather than an estimate. Worth flagging.
  return { value: est, exact: false, premium: isPremium(row) };
}

// Rebuild the learned TLD -> renewal map from a file that carries renewPrice,
// to cover TLDs missing from the bundled price list.
function learnRenewPrices(rows) {
  learnedRenew = new Map();
  if (!headers.includes("renewPrice")) return;
  const tally = new Map();
  for (const row of rows) {
    const price = toNumber(row["renewPrice"]);
    if (!(price > 0)) continue;
    const tld = extractParts(row[domainCol] || "")[1].toLowerCase();
    if (!tld) continue;
    if (!tally.has(tld)) tally.set(tld, new Map());
    const counts = tally.get(tld);
    counts.set(price, (counts.get(price) || 0) + 1);
  }
  for (const [tld, counts] of tally) {
    let best = 0;
    let bestCount = 0;
    for (const [price, n] of counts) {
      if (n > bestCount) {
        best = price;
        bestCount = n;
      }
    }
    learnedRenew.set(tld, best);
  }
}

// Scoring every row is cheap, but the column and its filters are noise when not set
function keyboardEnabled() {
  return document.getElementById("keyboardEnabled").checked;
}

// Sort keys in menu order
const SORT_KEYS = {
  alpha: {
    label: "Alphabetical",
    asc: "A\u2192Z",
    desc: "Z\u2192A",
    key: (r) => getNameCol(r),
  },
  length: {
    label: "Length",
    asc: "short\u2192long",
    desc: "long\u2192short",
    key: (r) => extractParts(getNameCol(r))[0].length,
  },
  price: {
    label: "Price",
    asc: "low\u2192high",
    desc: "high\u2192low",
    key: (r) => getPriceCol(r),
  },
  renew: {
    label: "Renew $",
    asc: "low\u2192high",
    desc: "high\u2192low",
    key: (r) => {
      const renew = getRenew(r);
      return renew ? renew.value : null;
    },
  },
  total: {
    label: "Price + Renew",
    asc: "low\u2192high",
    desc: "high\u2192low",
    key: (r) => {
      const renew = getRenew(r);
      return renew ? getPriceCol(r) + renew.value : null;
    },
  },
  bid: {
    label: "Bids",
    asc: "low\u2192high",
    desc: "high\u2192low",
    auctionOnly: true,
    key: (r) => +r["bidCount"] || 0,
  },
  keyboard: {
    label: "Keyboard Adj %",
    asc: "low\u2192high",
    desc: "high\u2192low",
    needsKeyboard: true,
    key: (r) => keyboardReport(extractParts(getNameCol(r))[0]).adjacentPct,
  },
};

// Every level the user has set, primary first
function sortValues() {
  return [...document.querySelectorAll(".sort-select")]
    .map((sel) => sel.value)
    .filter((v) => v && v !== "none");
}

// Sort by each level in turn, the next breaking the ties left by the last.
function sortRows(rows, values) {
  const specs = [];
  for (const value of values) {
    const desc = value.endsWith("-desc");
    const spec = SORT_KEYS[desc ? value.slice(0, -5) : value];
    if (spec) specs.push({ key: spec.key, dir: desc ? -1 : 1 });
  }
  if (!specs.length) return rows;

  // Compute every row's keys once up front instead of inside the comparator,
  // which would recompute them on each of the n log n comparisons
  const decorated = rows.map((row) => ({
    row,
    keys: specs.map((s) => s.key(row)),
  }));

  decorated.sort((a, b) => {
    for (let i = 0; i < specs.length; i++) {
      const x = a.keys[i];
      const y = b.keys[i];
      if (x == null || y == null) {
        if (x == null && y == null) continue;
        return x == null ? 1 : -1;
      }
      const c = typeof x === "string" ? x.localeCompare(y) : x - y;
      if (c) return c * specs[i].dir;
    }
    return 0; // still tied: Array#sort is stable, so file order wins
  });

  return decorated.map((d) => d.row);
}

// Build the option list for one select. Only the primary offers "Original Order"
// A then-by level is removed with its own button instead.
function sortOptionsHtml(includeNone) {
  let html = includeNone ? '<option value="none">Original Order</option>' : "";
  for (const [name, spec] of Object.entries(SORT_KEYS)) {
    if (spec.auctionOnly && tableMode !== "auction") continue;
    if (spec.needsKeyboard && !keyboardEnabled()) continue;
    html +=
      `<option value="${name}">${spec.label} (${spec.asc})</option>` +
      `<option value="${name}-desc">${spec.label} (${spec.desc})</option>`;
  }
  return html;
}

// Rebuild every select, keeping each one's selection where it is still offered.
// Called on load because which keys exist depends on the table type.
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
    '<button type="button" class="mini-btn remove-sort" title="Remove this level">\u00d7</button>';
  const controls = document.getElementById("sortControls");
  controls.insertBefore(wrap, document.getElementById("addSort"));
  updateAddSortState();
}

function clearSortLevels() {
  document.querySelectorAll(".sort-then").forEach((el) => el.remove());
  updateAddSortState();
}

// Switching scoring off greys its filters and drops its sort keys from the menus
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
  if (e.target.classList.contains("remove-sort")) {
    e.target.closest(".sort-then").remove();
    updateAddSortState();
  }
});

// Filtering
function applyFilters() {
  const minLen = document.getElementById("minLength").value
    ? +document.getElementById("minLength").value
    : null;
  const maxLen = document.getElementById("maxLength").value
    ? +document.getElementById("maxLength").value
    : null;
  const minTotalLen = document.getElementById("minTotalLength").value
    ? +document.getElementById("minTotalLength").value
    : null;
  const maxTotalLen = document.getElementById("maxTotalLength").value
    ? +document.getElementById("maxTotalLength").value
    : null;
  const minTldLen = document.getElementById("minTldLength").value
    ? +document.getElementById("minTldLength").value
    : null;
  const maxTldLen = document.getElementById("maxTldLength").value
    ? +document.getElementById("maxTldLength").value
    : null;
  const minPrice = document.getElementById("minPrice").value
    ? +document.getElementById("minPrice").value
    : null;
  const maxPrice = document.getElementById("maxPrice").value
    ? +document.getElementById("maxPrice").value
    : null;
  const maxRenew = document.getElementById("maxRenew").value
    ? +document.getElementById("maxRenew").value
    : null;
  const maxTotal = document.getElementById("maxTotal").value
    ? +document.getElementById("maxTotal").value
    : null;
  const repeatCount = +document.getElementById("repeatCount").value || 2;
  const minAdjPct = document.getElementById("minAdjacentPct").value
    ? +document.getElementById("minAdjacentPct").value
    : null;
  const tldInc = tldInclude.getTags();
  const tldExc = tldExclude.getTags();
  const subs = substrings.getTags();
  const subsExc = subExclude.getTags();
  const subIncScope = document.getElementById("subIncScope").value;
  const subExcScope = document.getElementById("subExcScope").value;
  const structScope = document.getElementById("structScope").value;
  const structPatterns = structures
    .getTags()
    .map(compileStructure)
    .filter(Boolean);
  const kbOn = keyboardEnabled();

  // Only pay for the extra match targets when something actually asks for them
  const hasDotted = (t) => t.includes(".");
  const needFull =
    subs.some(hasDotted) ||
    subsExc.some(hasDotted) ||
    structPatterns.some((p) => p.dotted);
  const needJoined =
    (subs.length && subIncScope === "tld") ||
    (subsExc.length && subExcScope === "tld") ||
    (structPatterns.length && structScope === "tld");

  filteredRows = rawRows.filter((row) => {
    const fullName = getNameCol(row);
    if (!fullName) return false;
    const [domain, tld] = extractParts(fullName);
    const domLower = domain.toLowerCase();
    const tldLower = tld.toLowerCase();

    // Length
    if (minLen !== null && domain.length < minLen) return false;
    if (maxLen !== null && domain.length > maxLen) return false;

    // Total length (domain + dot + TLD)
    if (minTotalLen !== null && fullName.length < minTotalLen) return false;
    if (maxTotalLen !== null && fullName.length > maxTotalLen) return false;

    // Price
    if (minPrice !== null || maxPrice !== null) {
      const price = getPriceCol(row);
      if (minPrice !== null && price < minPrice) return false;
      if (maxPrice !== null && price > maxPrice) return false;
    }

    // TLD include / exclude
    if (tldInc.length && !tldInc.includes(tldLower)) return false;
    if (tldExc.length && tldExc.includes(tldLower)) return false;

    // TLD length (e.g. omit anything over 2 chars to keep ccTLDs like .io, .co)
    if (minTldLen !== null && tldLower.length < minTldLen) return false;
    if (maxTldLen !== null && tldLower.length > maxTldLen) return false;

    // Compound TLD (multi-part, e.g. co.uk, com.au)
    if (triStates.compoundTld === "yes" && !tldLower.includes("."))
      return false;
    if (triStates.compoundTld === "no" && tldLower.includes(".")) return false;

    // Character filters
    if (triStates.letters === "yes" && !/[a-z]/i.test(domain)) return false;
    if (triStates.letters === "no" && /[a-z]/i.test(domain)) return false;
    if (triStates.vowels === "yes" && !/[aeiou]/i.test(domain)) return false;
    if (triStates.vowels === "no" && /[aeiou]/i.test(domain)) return false;
    if (triStates.numbers === "yes" && !/\d/.test(domain)) return false;
    if (triStates.numbers === "no" && /\d/.test(domain)) return false;
    if (triStates.hyphens === "yes" && !domain.includes("-")) return false;
    if (triStates.hyphens === "no" && domain.includes("-")) return false;

    // Palindrome
    if (triStates.palindrome === "yes" && !isPalindrome(domLower)) return false;
    if (triStates.palindrome === "no" && isPalindrome(domLower)) return false;

    // Repeats: a run of `repeatCount` identical characters (2 = dubs, 3 = trips, ...)
    if (triStates.repeats !== "any") {
      const hit = hasConsecutive(domLower, repeatCount);
      if (triStates.repeats === "yes" && !hit) return false;
      if (triStates.repeats === "no" && hit) return false;
    }

    // Substrings & structure
    const parts = { sld: domLower, full: "", joined: "" };
    if (needFull) parts.full = tldLower ? domLower + "." + tldLower : domLower;
    if (needJoined) parts.joined = domLower + tldLower.replace(/\./g, "");

    if (subs.length && !subs.some((s) => termMatches(s, parts, subIncScope)))
      return false;
    if (
      subsExc.length &&
      subsExc.some((s) => termMatches(s, parts, subExcScope))
    )
      return false;

    // Structure
    if (structPatterns.length) {
      const ok = structPatterns.some((p) => {
        const target = p.dotted
          ? parts.full
          : structScope === "tld"
            ? parts.joined
            : parts.sld;
        return p.re.test(target);
      });
      if (!ok) return false;
    }

    // Renewal cost, from the row itself or the TLD table
    if (
      maxRenew !== null ||
      maxTotal !== null ||
      triStates.renewKnown !== "any"
    ) {
      const renew = getRenew(row);
      if (triStates.renewKnown === "yes" && !renew) return false;
      if (triStates.renewKnown === "no" && renew) return false;
      if (renew) {
        if (maxRenew !== null && renew.value > maxRenew) return false;
        if (maxTotal !== null && getPriceCol(row) + renew.value > maxTotal)
          return false;
      }
    }

    // Bulk search flags
    if (availableCol && triStates.available !== "any") {
      const avail =
        (row[availableCol] || "").trim().toLowerCase() === "available";
      if (triStates.available === "yes" && !avail) return false;
      if (triStates.available === "no" && avail) return false;
    }
    if (premiumCol && triStates.premium !== "any") {
      const prem = isPremium(row);
      if (triStates.premium === "yes" && !prem) return false;
      if (triStates.premium === "no" && prem) return false;
    }

    // Keyboard: same row
    if (kbOn && triStates.sameRow !== "any") {
      const kb = keyboardReport(domain);
      if (triStates.sameRow === "yes" && !kb.sameRow) return false;
      if (triStates.sameRow === "no" && kb.sameRow) return false;
    }

    // Keyboard: min adjacent %
    if (kbOn && minAdjPct !== null) {
      const kb = keyboardReport(domain);
      if (kb.adjacentPct < minAdjPct) return false;
    }

    return true;
  });

  // Sort
  filteredRows = sortRows(filteredRows, sortValues());

  currentPage = 1;
}

// Rendering
function getDisplayCols() {
  if (tableMode === "auction") {
    return [
      "name",
      "price",
      "bidCount",
      "endDate",
      "ahrefsDomainRating",
      "estibotValue",
      "goValue",
      "url",
    ];
  }
  if (tableMode === "beast") {
    return [domainCol, priceCol, availableCol, premiumCol].filter(Boolean);
  }
  return [domainCol, priceCol, "extensions_taken", "permalink"];
}

function friendlyHeader(col) {
  const map = {
    name: "Domain",
    domain: "Domain",
    price: "Price",
    price_usd: "Price",
    bidCount: "Bids",
    endDate: "Ends",
    ahrefsDomainRating: "Ahrefs DR",
    estibotValue: "Estibot $",
    goValue: "GO Value",
    url: "Link",
    permalink: "Link",
    extensions_taken: "Ext. Taken",
  };
  return map[col] || col;
}

function money(n) {
  return (
    "$" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

// Renew + Total cells. An estimate pulled from the TLD table is greyed and marked
// with ~, since a premium domain can renew well above its TLD's standard rate.
function renewCells(row) {
  const renew = getRenew(row);
  if (!renew) return "<td></td><td></td>";
  const total = getPriceCol(row) + renew.value;
  if (renew.exact)
    return `<td>${money(renew.value)}</td><td>${money(total)}</td>`;
  const cls = renew.premium ? "est premium-est" : "est";
  const mark = renew.premium ? "?" : "~";
  const title = renew.premium
    ? "The TLD's standard renewal - a premium domain usually renews above this"
    : "Estimated from the TLD renewal table, not from the file";
  const cell = (n) =>
    `<td><span class="${cls}" title="${title}">${mark}${money(n)}</span></td>`;
  return cell(renew.value) + cell(total);
}

function renderTable() {
  const cols = getDisplayCols().filter((c) => headers.includes(c));
  const showCols = [...cols];
  const thead = document.getElementById("tableHead");
  const tbody = document.getElementById("tableBody");

  const kbOn = keyboardEnabled();
  thead.innerHTML =
    "<tr>" +
    showCols.map((c) => `<th>${friendlyHeader(c)}</th>`).join("") +
    "<th>Renew $</th><th>Total $</th><th>Len</th>" +
    (kbOn ? "<th>KB</th>" : "") +
    "</tr>";

  // Pagination
  const perPage =
    +document.getElementById("perPage").value || filteredRows.length;
  const totalPages = perPage
    ? Math.ceil(filteredRows.length / perPage) || 1
    : 1;
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * perPage;
  const pageRows = perPage
    ? filteredRows.slice(start, start + perPage)
    : filteredRows;

  tbody.innerHTML = pageRows
    .map((row) => {
      const fullName = getNameCol(row);
      const [domain] = extractParts(fullName);
      let kbCell = "";
      if (kbOn) {
        const kb = keyboardReport(domain);
        let kbBadge = "";
        if (kb.sameRow)
          kbBadge = '<span class="keyboard-badge same-row">row</span> ';
        if (kb.adjacentPct >= 75)
          kbBadge += `<span class="keyboard-badge adjacent">${kb.adjacentPct.toFixed(0)}%</span>`;
        else if (kb.adjacentPct > 0) kbBadge += `${kb.adjacentPct.toFixed(0)}%`;
        kbCell = `<td>${kbBadge}</td>`;
      }

      return (
        "<tr>" +
        showCols
          .map((c) => {
            let val = row[c] || "";
            if (c === "url" || c === "permalink") {
              return `<td><a href="${val}" target="_blank" rel="noopener">↗</a></td>`;
            }
            if (c === priceCol || c === "estibotValue" || c === "goValue") {
              const n = toNumber(val);
              return `<td>${isNaN(n) ? val : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>`;
            }
            if (c === "endDate") {
              if (val) {
                const d = new Date(val);
                return `<td>${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>`;
              }
              return "<td></td>";
            }
            return `<td>${val}</td>`;
          })
          .join("") +
        renewCells(row) +
        `<td>${domain.length}</td>` +
        kbCell +
        "</tr>"
      );
    })
    .join("");

  // Stats
  document.getElementById("resultCount").textContent = filteredRows.length;
  document.getElementById("totalCount").textContent = rawRows.length;
  // Accumulate in a loop, spreading a million-element array overflows the stack
  let count = 0,
    sum = 0,
    min = Infinity,
    max = -Infinity;
  for (const r of filteredRows) {
    const p = getPriceCol(r);
    if (p <= 0) continue;
    count++;
    sum += p;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  const pstat = document.getElementById("priceStat");
  if (count) {
    const avg = sum / count;
    pstat.innerHTML = `Price: <span>$${min.toFixed(2)}</span> – <span>$${max.toFixed(2)}</span> (avg <span>$${avg.toFixed(2)}</span>)`;
  } else {
    pstat.textContent = "";
  }

  // Renewal coverage: how much of the filtered set has a price at all, and where from
  let exact = 0,
    estimated = 0;
  for (const r of filteredRows) {
    const renew = getRenew(r);
    if (!renew) continue;
    if (renew.exact) exact++;
    else estimated++;
  }
  const unknown = filteredRows.length - exact - estimated;
  document.getElementById("renewStat").innerHTML = filteredRows.length
    ? `Renew: <span>${exact.toLocaleString("en-US")}</span> from file, ` +
      `<span>${estimated.toLocaleString("en-US")}</span> estimated, ` +
      `<span>${unknown.toLocaleString("en-US")}</span> unknown`
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
  document.getElementById("exportBtn").disabled = filteredRows.length === 0;
}

function applyAndRender() {
  applyFilters();
  renderTable();
  showInfo(`Showing ${filteredRows.length} of ${rawRows.length} domains.`);
}

// Events
document.getElementById("applyBtn").addEventListener("click", applyAndRender);

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

document.getElementById("resetBtn").addEventListener("click", () => {
  document.getElementById("minLength").value = "";
  document.getElementById("maxLength").value = "";
  document.getElementById("minTldLength").value = "";
  document.getElementById("maxTldLength").value = "";
  document.getElementById("minPrice").value = "";
  document.getElementById("maxPrice").value = "";
  document.getElementById("maxRenew").value = "";
  document.getElementById("maxTotal").value = "";
  document.getElementById("repeatCount").value = "";
  document.getElementById("minAdjacentPct").value = "";
  document.getElementById("keyboardEnabled").checked = true;
  syncKeyboardEnabled();
  clearSortLevels();
  document.getElementById("sortBy").value = "none";
  document.getElementById("subIncScope").value = "sld";
  document.getElementById("subExcScope").value = "sld";
  document.getElementById("structScope").value = "sld";
  document.getElementById("tldList").value = "";
  tldInclude.clear();
  tldExclude.clear();
  substrings.clear();
  subExclude.clear();
  structures.clear();
  document.querySelectorAll(".tri-toggle").forEach((g) => {
    triStates[g.dataset.filter] = "any";
    g.querySelectorAll("button").forEach((b) => (b.className = ""));
    g.querySelector('[data-val="any"]').className = "active-any";
  });
  if (rawRows.length) applyAndRender();
});

document.getElementById("exportBtn").addEventListener("click", () => {
  if (!filteredRows.length) return;
  const cols = headers;
  // renew_usd / total_usd carry the looked-up numbers out with the rows, and
  // renew_source says whether each came from the file or the TLD table.
  const lines = [[...cols, "renew_usd", "total_usd", "renew_source"].join(",")];
  filteredRows.forEach((row) => {
    const renew = getRenew(row);
    const extra = renew
      ? [
          renew.value.toFixed(2),
          (getPriceCol(row) + renew.value).toFixed(2),
          renew.exact ? "file" : "tld_table",
        ]
      : ["", "", ""];
    lines.push(
      [
        ...cols.map((c) => {
          let v = row[c] || "";
          if (v.includes(",") || v.includes('"') || v.includes("\n")) {
            v = '"' + v.replace(/"/g, '""') + '"';
          }
          return v;
        }),
        ...extra,
      ].join(","),
    );
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "filtered_domains.csv";
  a.click();
  URL.revokeObjectURL(url);
  showInfo(`Exported ${filteredRows.length} rows.`);
});

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
