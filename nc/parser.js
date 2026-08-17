// State
let rawRows = [];
let filteredRows = [];
let headers = [];
let tableMode = null; // 'auction' or 'buynow'
let domainCol = "name"; // actual header holding the domain name for the loaded file
let priceCol = "price"; // actual header holding the price for the loaded file
let currentPage = 1;
let triStates = {};
let tldCounts = new Map();

// QWERTY keyboard layout
const KEYBOARD = {
  1: "`1234567890-=".split(""),
  2: "qwertyuiop[]\\".split(""),
  3: "asdfghjkl;'".split(""),
  4: "zxcvbnm,./".split(""),
};

const keyPos = {};
for (const [row, keys] of Object.entries(KEYBOARD)) {
  keys.forEach((k, col) => {
    keyPos[k] = [+row, col];
  });
}
for (let c = 97; c <= 122; c++) {
  const ch = String.fromCharCode(c);
  if (keyPos[ch]) keyPos[String.fromCharCode(c - 32)] = keyPos[ch];
}

function keyboardReport(str) {
  const chars = [...str.toLowerCase()].filter((c) => keyPos[c]);
  if (chars.length === 0) return { sameRow: false, adjacentPct: 0 };
  const rows = chars.map((c) => keyPos[c][0]);
  const sameRow = new Set(rows).size === 1;
  let adj = 0;
  for (let i = 0; i < chars.length - 1; i++) {
    const [r1, c1] = keyPos[chars[i]];
    const [r2, c2] = keyPos[chars[i + 1]];
    const dist = Math.sqrt((r2 - r1) ** 2 + (c2 - c1) ** 2);
    if (dist <= 1.5) adj++;
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
    `<option value="">— ${sorted.length} TLDs in file —</option>` +
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

// CSV parsing
function parseCSVLine(line, delim) {
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
  if (headers.includes("bidCount") || headers.includes("startPrice")) {
    tableMode = "auction";
  } else if (
    headers.includes("permalink") ||
    headers.includes("domain") ||
    headers.includes("price_usd")
  ) {
    tableMode = "buynow";
  } else {
    tableMode = headers.includes("name") ? "auction" : "buynow";
  }

  // Resolve the actual column names present in this file rather than assuming "domain"/"price"
  // Pre-filtered buy-now export uses "name"/"price_usd".
  if (tableMode === "auction") {
    domainCol = "name";
    priceCol = "price";
  } else {
    domainCol = ["domain", "name"].find((c) => headers.includes(c)) || "domain";
    priceCol =
      ["price", "price_usd"].find((c) => headers.includes(c)) || "price";
  }

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

  // Update UI
  const typeEl = document.getElementById("tableType");
  typeEl.innerHTML = `<span class="detected-type ${tableMode}">${tableMode === "auction" ? "Auction" : "Buy-Now"}</span>`;

  document.getElementById("filtersSection").style.display = "";
  document.getElementById("actionsSection").style.display = "";
  document.getElementById("auctionFilters").style.display =
    tableMode === "auction" ? "" : "none";
  document.getElementById("bidSortOpt").style.display =
    tableMode === "auction" ? "" : "none";

  showInfo(`Loaded ${rawRows.length} rows (${tableMode}).`);
  applyAndRender();
}

// Accessors
function getNameCol(row) {
  return row[domainCol] || "";
}

function getPriceCol(row) {
  return parseFloat(row[priceCol]) || 0;
}

// Filtering
function applyFilters() {
  const minLen = document.getElementById("minLength").value
    ? +document.getElementById("minLength").value
    : null;
  const maxLen = document.getElementById("maxLength").value
    ? +document.getElementById("maxLength").value
    : null;
  const maxRenew = document.getElementById("maxRenew").value
    ? +document.getElementById("maxRenew").value
    : null;
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

    // TLD include / exclude
    if (tldInc.length && !tldInc.includes(tldLower)) return false;
    if (tldExc.length && tldExc.includes(tldLower)) return false;

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

    // Repeats
    const repeatMap = {
      dubs: 2,
      trips: 3,
      quads: 4,
      quints: 5,
      sexts: 6,
      septs: 7,
    };
    for (const [key, count] of Object.entries(repeatMap)) {
      if (triStates[key] === "yes" && !hasConsecutive(domLower, count))
        return false;
      if (triStates[key] === "no" && hasConsecutive(domLower, count))
        return false;
    }

    // Substrings & structure — match targets built only for rows that got this far
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

    // Max renew (auction only)
    if (maxRenew !== null && tableMode === "auction") {
      const rp = parseFloat(row["renewPrice"]) || 0;
      if (rp > maxRenew) return false;
    }

    // Keyboard: same row
    if (triStates.sameRow !== "any") {
      const kb = keyboardReport(domain);
      if (triStates.sameRow === "yes" && !kb.sameRow) return false;
      if (triStates.sameRow === "no" && kb.sameRow) return false;
    }

    // Keyboard: min adjacent %
    if (minAdjPct !== null) {
      const kb = keyboardReport(domain);
      if (kb.adjacentPct < minAdjPct) return false;
    }

    return true;
  });

  // Sort
  const sortBy = document.getElementById("sortBy").value;
  if (sortBy === "alpha") {
    filteredRows.sort((a, b) => getNameCol(a).localeCompare(getNameCol(b)));
  } else if (sortBy === "alpha-desc") {
    filteredRows.sort((a, b) => getNameCol(b).localeCompare(getNameCol(a)));
  } else if (sortBy === "length") {
    filteredRows.sort(
      (a, b) =>
        extractParts(getNameCol(a))[0].length -
        extractParts(getNameCol(b))[0].length,
    );
  } else if (sortBy === "length-desc") {
    filteredRows.sort(
      (a, b) =>
        extractParts(getNameCol(b))[0].length -
        extractParts(getNameCol(a))[0].length,
    );
  } else if (sortBy === "price") {
    filteredRows.sort((a, b) => getPriceCol(a) - getPriceCol(b));
  } else if (sortBy === "price-desc") {
    filteredRows.sort((a, b) => getPriceCol(b) - getPriceCol(a));
  } else if (sortBy === "bid" && tableMode === "auction") {
    filteredRows.sort((a, b) => (+b["bidCount"] || 0) - (+a["bidCount"] || 0));
  } else if (sortBy === "keyboard") {
    filteredRows.sort((a, b) => {
      return (
        keyboardReport(extractParts(getNameCol(b))[0]).adjacentPct -
        keyboardReport(extractParts(getNameCol(a))[0]).adjacentPct
      );
    });
  }

  currentPage = 1;
}

// Rendering
function getDisplayCols() {
  if (tableMode === "auction") {
    return [
      "name",
      "price",
      "bidCount",
      "renewPrice",
      "endDate",
      "ahrefsDomainRating",
      "estibotValue",
      "goValue",
      "url",
    ];
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
    renewPrice: "Renew $",
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

function renderTable() {
  const cols = getDisplayCols().filter((c) => headers.includes(c));
  const showCols = [...cols];
  const thead = document.getElementById("tableHead");
  const tbody = document.getElementById("tableBody");

  thead.innerHTML =
    "<tr>" +
    showCols.map((c) => `<th>${friendlyHeader(c)}</th>`).join("") +
    "<th>Len</th><th>KB</th></tr>";

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
      const kb = keyboardReport(domain);
      let kbBadge = "";
      if (kb.sameRow)
        kbBadge = '<span class="keyboard-badge same-row">row</span> ';
      if (kb.adjacentPct >= 75)
        kbBadge += `<span class="keyboard-badge adjacent">${kb.adjacentPct.toFixed(0)}%</span>`;
      else if (kb.adjacentPct > 0) kbBadge += `${kb.adjacentPct.toFixed(0)}%`;

      return (
        "<tr>" +
        showCols
          .map((c) => {
            let val = row[c] || "";
            if (c === "url" || c === "permalink") {
              return `<td><a href="${val}" target="_blank" rel="noopener">↗</a></td>`;
            }
            if (
              c === "price" ||
              c === "price_usd" ||
              c === "renewPrice" ||
              c === "estibotValue" ||
              c === "goValue"
            ) {
              const n = parseFloat(val);
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
        `<td>${domain.length}</td>` +
        `<td>${kbBadge}</td></tr>`
      );
    })
    .join("");

  // Stats
  document.getElementById("resultCount").textContent = filteredRows.length;
  document.getElementById("totalCount").textContent = rawRows.length;
  // Accumulate in a loop — spreading a million-element array overflows the stack
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
  document.getElementById("maxRenew").value = "";
  document.getElementById("minAdjacentPct").value = "";
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
  const lines = [cols.join(",")];
  filteredRows.forEach((row) => {
    lines.push(
      cols
        .map((c) => {
          let v = row[c] || "";
          if (v.includes(",") || v.includes('"') || v.includes("\n")) {
            v = '"' + v.replace(/"/g, '""') + '"';
          }
          return v;
        })
        .join(","),
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

// Messages
function showError(msg) {
  document.getElementById("errorMessage").textContent = msg;
  document.getElementById("infoMessage").textContent = "";
}
function showInfo(msg) {
  document.getElementById("infoMessage").textContent = msg;
  document.getElementById("errorMessage").textContent = "";
}
