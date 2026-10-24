// Parts catalog shared by the seed script, the refurb picker, and tests.
// Codes stay strings so leading zeros and RM_ ids are never coerced.

export const PART_UNITS = ["pcs", "mtr"];
export const PART_FREQUENCIES = ["common", "occasional"];

// Bhargav's replacement order. Parts an admin later marks common/occasional
// and that are not in these lists sort after them.
export const COMMON_CODE_ORDER = [
  "0000170",
  "0000073",
  "0000074",
  "0000075",
  "0000076",
  "0000060",
  "0000033",
  "0000030",
  "0000056",
  "0000083",
  "0000105",
  "0000080",
  "0000081",
  "0000082",
  "0000016",
  "0000173",
  "0000057",
  "0000058",
  "0000069",
  "0000055",
];

export const OCCASIONAL_CODE_ORDER = [
  "0000047",
  "0000040",
  "0000046",
  "0000043",
  "0000044",
  "0000041",
  "0000042",
  "0000045",
  "0000204",
  "0000183",
];

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const src = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => String(value).trim() !== ""));
}

export function parseRevivable(value) {
  const token = String(value ?? "").trim().toLowerCase();
  if (["yes", "true", "1", "y"].includes(token)) return true;
  if (["no", "false", "0", "n", ""].includes(token)) return false;
  throw new Error(`revivable must be yes or no (got ${value}).`);
}

export function parseFrequency(value) {
  const token = String(value ?? "").trim().toLowerCase();
  if (!token) return null;
  if (token === "common" || token === "occasional") return token;
  throw new Error(`frequency must be common, occasional, or blank (got ${value}).`);
}

export function partDisplayName(part) {
  const code = String(part?.code || "").trim();
  const name = String(part?.name || "").trim();
  if (code === "0000056" || name.toLowerCase() === "hooks") return "Hooks (carabiners)";
  return name;
}

export function parsePartsCsv(text) {
  const table = parseCsv(text);
  if (!table.length) throw new Error("The parts CSV is empty.");
  const header = table[0].map((cell) => cell.trim().toLowerCase());
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  for (const required of ["code", "name", "group", "unit", "revivable"]) {
    if (index[required] == null) throw new Error(`CSV header must include ${required}.`);
  }
  const parts = [];
  const errors = [];
  const seen = new Set();
  for (let i = 1; i < table.length; i++) {
    const row = table[i];
    const code = String(row[index.code] ?? "").trim();
    if (!code) {
      errors.push(`Row ${i + 1} has no code.`);
      continue;
    }
    if (code.includes("/")) {
      errors.push(`Row ${i + 1} code ${code} cannot contain "/".`);
      continue;
    }
    if (seen.has(code)) {
      errors.push(`Duplicate code ${code}.`);
      continue;
    }
    seen.add(code);
    const unit = String(row[index.unit] ?? "").trim().toLowerCase();
    if (!PART_UNITS.includes(unit)) {
      errors.push(`Row ${i + 1} (${code}) unit must be pcs or mtr.`);
      continue;
    }
    let revivable = false;
    let frequency = null;
    try {
      revivable = parseRevivable(row[index.revivable]);
      frequency = index.frequency == null ? null : parseFrequency(row[index.frequency]);
    } catch (err) {
      errors.push(`Row ${i + 1} (${code}): ${err.message}`);
      continue;
    }
    parts.push({
      code,
      name: String(row[index.name] ?? "").trim(),
      group: String(row[index.group] ?? "").trim(),
      unit,
      revivable,
      frequency,
    });
  }
  return { parts, errors };
}

function frequencyOf(part) {
  return part?.frequency === "common" || part?.frequency === "occasional" ? part.frequency : null;
}

// What a seed run would write. Revivable and frequency stay put once an
// admin has edited them, unless force is set. revivedStock is never touched.
// Name, group, and unit follow the CSV. An empty change list means no write.
export function planSeedPart(existing, row, { force = false } = {}) {
  const frequency = frequencyOf(row);
  if (!existing) {
    return {
      action: "create",
      id: row.code,
      data: {
        code: row.code,
        name: row.name,
        group: row.group,
        unit: row.unit,
        revivable: Boolean(row.revivable),
        revivableEdited: false,
        frequency,
        frequencyEdited: false,
        revivedStock: 0,
      },
      skippedRevivable: false,
      skippedFrequency: false,
    };
  }

  const changes = {};
  if ((existing.name || "") !== row.name) changes.name = row.name;
  if ((existing.group || "") !== (row.group || "")) changes.group = row.group;
  if ((existing.unit || "") !== row.unit) changes.unit = row.unit;
  if ((existing.code || "") !== row.code) changes.code = row.code;

  const revivableLocked = existing.revivableEdited === true && !force;
  const revivableDiffers = existing.revivable !== Boolean(row.revivable);
  if (!revivableLocked && revivableDiffers) changes.revivable = Boolean(row.revivable);

  const frequencyLocked = existing.frequencyEdited === true && !force;
  const existingFrequency = frequencyOf(existing);
  const frequencyDiffers = existingFrequency !== frequency;
  if (!frequencyLocked && frequencyDiffers) changes.frequency = frequency;

  return {
    action: Object.keys(changes).length ? "update" : "unchanged",
    id: row.code,
    data: changes,
    skippedRevivable: revivableLocked && revivableDiffers,
    skippedFrequency: frequencyLocked && frequencyDiffers,
  };
}

function bySeedOrder(order) {
  return (a, b) => {
    const ai = order.indexOf(a.code);
    const bi = order.indexOf(b.code);
    const ar = ai === -1 ? 9999 : ai;
    const br = bi === -1 ? 9999 : bi;
    if (ar !== br) return ar - br;
    return String(a.label).localeCompare(String(b.label));
  };
}

export function groupPartsForPicker(parts, query = "") {
  const q = String(query || "").trim().toLowerCase();
  const decorated = (parts || []).map((part) => ({
    ...part,
    label: partDisplayName(part),
  }));
  const common = decorated.filter((part) => part.frequency === "common").sort(bySeedOrder(COMMON_CODE_ORDER));
  const occasional = decorated
    .filter((part) => part.frequency === "occasional")
    .sort(bySeedOrder(OCCASIONAL_CODE_ORDER));
  const matches = decorated
    .filter((part) => {
      if (!q) return true;
      return [part.code, part.label, part.name, part.group].some((value) =>
        String(value || "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  return { common, occasional, matches };
}
