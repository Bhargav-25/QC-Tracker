import { FINAL_PACKING_ITEMS, PHOTO_CATEGORIES, STATUS, STATUS_ORDER } from "../constants.js";
import { PART_MOVEMENT_TYPES } from "./partLedger.js";
import { currentCycleNumber, isRefurbished } from "./machineCycle.js";
import { partDisplayName } from "./partsCatalog.js";
import { keysMatch, presentedApiKey } from "./apiKey.js";
import { computeStatus } from "../utils/status.js";

const SECTION_KEYS = [
  "resistance",
  "temperature",
  "photos",
  "packing",
  "finalPacking",
  "dispatch",
  "delivery",
  "installation",
  "return",
  "refurb",
];

const TESTING_SECTIONS = ["resistance", "temperature", "photos", "packing", "finalPacking"];

const STATUS_ALIASES = new Map(STATUS_ORDER.map((status) => [status.toLowerCase(), status]));
STATUS_ALIASES.set("assembly", STATUS.ASSEMBLY);

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function text(value) {
  return typeof value === "string" ? value : "";
}

export function toIsoTimestamp(value) {
  if (value == null || value === "") return null;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    const ms = value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function batchFromMachineNumber(machineNumber) {
  const match = /^X(\d+)M\d+$/i.exec(text(machineNumber).trim());
  if (!match) return null;
  const batch = Number(match[1]);
  return Number.isSafeInteger(batch) ? batch : null;
}

function earliestIso(values) {
  let best = null;
  let bestMs = Infinity;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) continue;
    if (ms < bestMs) {
      bestMs = ms;
      best = value;
    }
  }
  return best;
}

function finalPackingComplete(machine) {
  const fp = machine.finalPacking || {};
  return FINAL_PACKING_ITEMS.every((item) => Boolean(fp[item.key]?.url));
}

function sectionTimestamps(machine) {
  const meta = machine.sectionMeta || {};
  const out = {};
  for (const key of SECTION_KEYS) {
    out[key] = toIsoTimestamp(meta[key]?.updatedAt);
  }
  return out;
}

function statusReachedAt(machine, sections, createdAt) {
  const intake = machine.intake;
  const recorded = Boolean(intake);
  const refurb = intake?.refurb || {};
  const lines = Array.isArray(refurb.lines) ? refurb.lines : [];
  const started = Boolean(refurb.startedAt) || lines.some((line) => line && !line.undone);
  const reached = {
    [STATUS.RETURNED]: recorded ? toIsoTimestamp(intake.recordedAt) : null,
    [STATUS.REFURBISHING]: started ? toIsoTimestamp(refurb.startedAt) || toIsoTimestamp(intake?.recordedAt) : null,
    [STATUS.ASSEMBLY]: createdAt,
    [STATUS.TESTING]: earliestIso(TESTING_SECTIONS.map((key) => sections[key])),
    [STATUS.PACKED]: finalPackingComplete(machine) ? sections.finalPacking : null,
    [STATUS.DISPATCHED]: machine.dispatch?.dispatched ? sections.dispatch : null,
    [STATUS.DELIVERED]: machine.delivery?.delivered ? sections.delivery : null,
    [STATUS.INSTALLED]: machine.installation?.installed ? sections.installation : null,
  };
  return reached;
}

function photoCounts(photos) {
  const source = photos || {};
  const counts = {};
  for (const category of PHOTO_CATEGORIES) {
    const list = source[category.key];
    counts[category.key] = Array.isArray(list) ? list.length : 0;
  }
  return counts;
}

function finalPackingFlags(finalPacking) {
  const source = finalPacking || {};
  const flags = {};
  for (const item of FINAL_PACKING_ITEMS) {
    flags[item.key] = Boolean(source[item.key]?.url);
  }
  return flags;
}

function publicWarranty(warranty) {
  const extensions = Array.isArray(warranty?.extensions) ? warranty.extensions : [];
  return {
    extensions: extensions.map((ext) => ({
      months: Number(ext?.months) || 0,
      invoiceNumber: text(ext?.invoiceNumber),
      invoiceDate: text(ext?.invoiceDate),
    })),
  };
}

function publicReturn(record) {
  if (!record) return null;
  const photos = Array.isArray(record.photos) ? record.photos.filter((photo) => photo && typeof photo === "object") : [];
  return {
    date: text(record.date),
    reason: text(record.reason),
    fromGroupNo: text(record.fromGroupNo) || null,
    receivedAt: text(record.receivedAt),
    notes: text(record.notes),
    photoCount: photos.length,
    recordedAt: toIsoTimestamp(record.recordedAt),
  };
}

function publicRefurb(refurb) {
  const source = refurb || {};
  const lines = Array.isArray(source.lines) ? source.lines : [];
  return {
    startedAt: toIsoTimestamp(source.startedAt),
    completedAt: text(source.completedAt) || null,
    lines: lines
      .filter((line) => line && typeof line === "object")
      .map((line) => ({
        id: text(line.id),
        partCode: text(line.partCode),
        partName: partDisplayName({ code: line.partCode, name: line.partName || line.name }),
        qty: Number(line.qty) || 0,
        unit: text(line.unit),
        source: text(line.source),
        disposition: text(line.disposition),
        undone: Boolean(line.undone),
      })),
  };
}

function publicCycle(cycle) {
  const group = text(cycle?.groupNumber).trim();
  return {
    cycle: Number(cycle?.cycle) || null,
    groupNo: group || null,
    dispatch: publicDispatch(cycle?.dispatch),
    delivery: {
      delivered: Boolean(cycle?.delivery?.delivered),
      date: text(cycle?.delivery?.date),
    },
    installation: {
      installed: Boolean(cycle?.installation?.installed),
      date: text(cycle?.installation?.date),
    },
    warranty: publicWarranty(cycle?.warranty),
    return: publicReturn(cycle?.return),
    closedAt: toIsoTimestamp(cycle?.closedAt),
  };
}

function publicDispatch(dispatch) {
  const source = dispatch || {};
  return {
    dispatched: Boolean(source.dispatched),
    date: text(source.date),
    includeStand: Boolean(source.includeStand),
    courier: text(source.courier),
    trackingNumber: text(source.trackingNumber),
    accessoriesSeparate: Boolean(source.accessoriesSeparate),
    accessoriesCourier: text(source.accessoriesCourier),
    accessoriesTracking: text(source.accessoriesTracking),
    accessoriesSentOn: text(source.accessoriesSentOn),
    accessoriesStatus: text(source.accessoriesStatus) || "Not sent",
  };
}

// Read model for the inventory bot. Built field by field so photo URLs,
// storage paths, and other document fields cannot fall through.
export function toPublicMachine(machine) {
  const createdAt = toIsoTimestamp(machine.createdAt);
  const updatedAt = toIsoTimestamp(machine.updatedAt);
  const sections = sectionTimestamps(machine);
  const photos = machine.installation?.photos;
  const group = text(machine.groupNumber).trim();
  return {
    id: text(machine.id),
    machineNumber: text(machine.machineNumber).trim(),
    createdAt,
    updatedAt,
    batch: batchFromMachineNumber(machine.machineNumber),
    status: computeStatus(machine),
    statusReachedAt: statusReachedAt(machine, sections, createdAt),
    sectionTimestamps: sections,
    dispatch: publicDispatch(machine.dispatch),
    delivery: {
      delivered: Boolean(machine.delivery?.delivered),
      date: text(machine.delivery?.date),
    },
    installation: {
      installed: Boolean(machine.installation?.installed),
      date: text(machine.installation?.date),
    },
    groupNo: group || null,
    photos: photoCounts(machine.photos),
    finalPacking: finalPackingFlags(machine.finalPacking),
    installationPhotos: Array.isArray(photos) ? photos.filter((photo) => photo && typeof photo === "object").length : 0,
    hasVideo: Boolean(machine.installation?.video && typeof machine.installation.video === "object"),
    cycle: currentCycleNumber(machine),
    refurbished: isRefurbished(machine),
    cycles: (Array.isArray(machine.cycles) ? machine.cycles : []).map(publicCycle),
    return: machine.intake
      ? { ...publicReturn(machine.intake), refurb: publicRefurb(machine.intake.refurb) }
      : null,
  };
}

export function toPublicPart(part) {
  const code = text(part.code || part.id).trim();
  const frequency = part.frequency === "common" || part.frequency === "occasional" ? part.frequency : null;
  const stock = Number(part.revivedStock);
  return {
    code,
    name: partDisplayName({ code, name: part.name }),
    group: text(part.group),
    unit: part.unit === "mtr" ? "mtr" : "pcs",
    revivable: part.revivable === true,
    frequency,
    revivedStock: Number.isFinite(stock) ? stock : 0,
    updatedAt: toIsoTimestamp(part.updatedAt),
  };
}

export function toPublicMovement(movement) {
  const qty = Number(movement.qty);
  return {
    id: text(movement.id),
    type: text(movement.type),
    partCode: text(movement.partCode),
    qty: Number.isFinite(qty) ? qty : 0,
    machineNumber: text(movement.machineNumber),
    cycle: Number(movement.cycle) || 0,
    timestamp: toIsoTimestamp(movement.timestamp),
    user: text(movement.user),
    reversal: movement.reversal === true,
    reversesId: text(movement.reversesId) || null,
  };
}

export function toPublicStand(data) {
  const count = Number(data?.count);
  return {
    ok: true,
    count: Number.isFinite(count) ? count : 0,
    updatedAt: toIsoTimestamp(data?.updatedAt),
  };
}

function reject(status, error) {
  return { status, body: { ok: false, error } };
}

export function normalizeMachinesPath(urlPath) {
  let path = String(urlPath || "/").split("?")[0];
  path = path.replace(/\/+$/, "") || "/";
  path = path.replace(/^\/machinesApi(?=\/|$)/i, "") || "/";
  path = path.replace(/^\/api(?=\/|$)/, "") || "/";
  path = path.replace(/^\/v1(?=\/|$)/, "") || "/";
  return path;
}

export function matchMachinesRoute(urlPath) {
  const path = normalizeMachinesPath(urlPath);
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "machines") return { kind: "list" };
  if (parts.length === 2 && parts[0] === "machines") {
    let machineNumber = parts[1];
    try {
      machineNumber = decodeURIComponent(machineNumber);
    } catch {
      // keep the raw segment
    }
    return { kind: "machine", machineNumber: machineNumber.trim() };
  }
  if (parts.length === 2 && parts[0] === "inventory" && parts[1] === "machine-stand") {
    return { kind: "stand" };
  }
  if (parts.length === 1 && parts[0] === "parts") return { kind: "parts" };
  if (parts.length === 1 && parts[0] === "part-movements") return { kind: "movements" };
  return { kind: "unknown" };
}

function queryValue(query, key) {
  const raw = query?.[key];
  if (Array.isArray(raw)) return raw[0] == null ? "" : String(raw[0]);
  return raw == null ? "" : String(raw);
}

function parseLimit(query) {
  const rawLimit = queryValue(query, "limit").trim();
  if (!rawLimit) return { limit: DEFAULT_LIMIT };
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) {
    return { error: "limit must be a whole number from 1 to 1000." };
  }
  return { limit: Math.min(Number(rawLimit), MAX_LIMIT) };
}

function parseUpdatedSince(query) {
  const rawSince = queryValue(query, "updatedSince").trim();
  if (!rawSince) return { updatedSince: null };
  const ms = Date.parse(rawSince);
  if (Number.isNaN(ms)) return { error: "updatedSince must be an ISO datetime." };
  return { updatedSince: ms };
}

export function parseMachinesQuery(query) {
  const limit = parseLimit(query);
  if (limit.error) return limit;
  const since = parseUpdatedSince(query);
  if (since.error) return since;

  const rawStatus = queryValue(query, "status").trim();
  const statuses = [];
  if (rawStatus) {
    for (const part of rawStatus.split(",")) {
      const token = part.trim();
      if (!token) continue;
      const canonical = STATUS_ALIASES.get(token.toLowerCase());
      if (!canonical) {
        return { error: `status must be one of: ${STATUS_ORDER.join(", ")}.` };
      }
      if (!statuses.includes(canonical)) statuses.push(canonical);
    }
    if (!statuses.length) {
      return { error: `status must be one of: ${STATUS_ORDER.join(", ")}.` };
    }
  }

  const pageToken = queryValue(query, "pageToken").trim() || queryValue(query, "cursor").trim();
  return { limit: limit.limit, updatedSince: since.updatedSince, statuses, pageToken };
}

export function parsePartsQuery(query) {
  const limit = parseLimit(query);
  if (limit.error) return limit;
  const since = parseUpdatedSince(query);
  if (since.error) return since;
  const pageToken = queryValue(query, "pageToken").trim() || queryValue(query, "cursor").trim();
  return { limit: limit.limit, updatedSince: since.updatedSince, pageToken };
}

export function parseMovementsQuery(query) {
  const limit = parseLimit(query);
  if (limit.error) return limit;
  const since = parseUpdatedSince(query);
  if (since.error) return since;
  const rawType = queryValue(query, "type").trim();
  const types = [];
  if (rawType) {
    for (const part of rawType.split(",")) {
      const token = part.trim();
      if (!token) continue;
      if (!PART_MOVEMENT_TYPES.includes(token)) {
        return { error: `type must be one of: ${PART_MOVEMENT_TYPES.join(", ")}.` };
      }
      if (!types.includes(token)) types.push(token);
    }
    if (!types.length) return { error: `type must be one of: ${PART_MOVEMENT_TYPES.join(", ")}.` };
  }
  const pageToken = queryValue(query, "pageToken").trim() || queryValue(query, "cursor").trim();
  return { limit: limit.limit, updatedSince: since.updatedSince, types, pageToken };
}

function encodePageToken(machine) {
  return Buffer.from(
    JSON.stringify({ u: machine.updatedAt || "", i: machine.id }),
    "utf8"
  ).toString("base64url");
}

function decodePageToken(token) {
  if (!token) return { cursor: null };
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return { error: "pageToken is not valid." };
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.i !== "string" || typeof parsed.u !== "string") {
    return { error: "pageToken is not valid." };
  }
  return { cursor: { u: parsed.u, i: parsed.i } };
}

function byUpdatedThenId(a, b) {
  const left = a.updatedAt || "";
  const right = b.updatedAt || "";
  if (left < right) return -1;
  if (left > right) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function isAfterCursor(machine, cursor) {
  const updated = machine.updatedAt || "";
  if (updated > cursor.u) return true;
  if (updated < cursor.u) return false;
  return machine.id > cursor.i;
}

export function listPublicMachines(machines, { limit, updatedSince, statuses, cursor }) {
  let rows = machines.map((machine) => toPublicMachine(machine));
  if (updatedSince != null) {
    rows = rows.filter((machine) => {
      if (!machine.updatedAt) return false;
      return Date.parse(machine.updatedAt) >= updatedSince;
    });
  }
  if (statuses.length) {
    rows = rows.filter((machine) => statuses.includes(machine.status));
  }
  rows.sort(byUpdatedThenId);
  if (cursor) rows = rows.filter((machine) => isAfterCursor(machine, cursor));
  const page = rows.slice(0, limit);
  const nextPageToken = rows.length > limit ? encodePageToken(page[page.length - 1]) : null;
  return { machines: page, nextPageToken };
}

function findMachine(machines, machineNumber) {
  const wanted = machineNumber.toLowerCase();
  const matches = machines.filter((machine) => text(machine.machineNumber).trim().toLowerCase() === wanted);
  matches.sort((a, b) => {
    const left = toIsoTimestamp(a.updatedAt) || "";
    const right = toIsoTimestamp(b.updatedAt) || "";
    if (left < right) return 1;
    if (left > right) return -1;
    return text(a.id) < text(b.id) ? -1 : text(a.id) > text(b.id) ? 1 : 0;
  });
  return matches[0] || null;
}

// Pure GET handler. Callers load `machines` and `stand` with reads only.
// `expectedKey` is the machines read secret, never the orders write key.
function listRows(rows, { limit, cursor, isAfter, tokenFor }) {
  let pageRows = rows;
  if (cursor) pageRows = pageRows.filter((row) => isAfter(row, cursor));
  const page = pageRows.slice(0, limit);
  const nextPageToken = pageRows.length > limit ? tokenFor(page[page.length - 1]) : null;
  return { page, nextPageToken };
}

function encodeToken(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeToken(token, shape) {
  if (!token) return { cursor: null };
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return { error: "pageToken is not valid." };
  }
  if (!parsed || typeof parsed !== "object") return { error: "pageToken is not valid." };
  for (const key of shape) {
    if (typeof parsed[key] !== "string") return { error: "pageToken is not valid." };
  }
  return { cursor: parsed };
}

export function listPublicParts(parts, { limit, updatedSince, cursor }) {
  let rows = (parts || []).map((part) => toPublicPart(part));
  if (updatedSince != null) {
    rows = rows.filter((part) => part.updatedAt && Date.parse(part.updatedAt) >= updatedSince);
  }
  rows.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const listed = listRows(rows, {
    limit,
    cursor,
    isAfter: (part, token) => part.code > token.c,
    tokenFor: (part) => encodeToken({ c: part.code }),
  });
  return { parts: listed.page, nextPageToken: listed.nextPageToken };
}

export function listPublicMovements(movements, { limit, updatedSince, types, cursor }) {
  let rows = (movements || []).map((movement) => toPublicMovement(movement));
  if (updatedSince != null) {
    rows = rows.filter((movement) => movement.timestamp && Date.parse(movement.timestamp) >= updatedSince);
  }
  if (types?.length) rows = rows.filter((movement) => types.includes(movement.type));
  rows.sort((a, b) => {
    const left = a.timestamp || "";
    const right = b.timestamp || "";
    if (left < right) return -1;
    if (left > right) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  const listed = listRows(rows, {
    limit,
    cursor,
    isAfter: (movement, token) => {
      const stamp = movement.timestamp || "";
      if (stamp > token.t) return true;
      if (stamp < token.t) return false;
      return movement.id > token.i;
    },
    tokenFor: (movement) => encodeToken({ t: movement.timestamp || "", i: movement.id }),
  });
  return { movements: listed.page, nextPageToken: listed.nextPageToken };
}

export function handleMachinesHttp({ method, urlPath, query, headers, expectedKey, machines, stand, parts, movements }) {
  if (!keysMatch(expectedKey, presentedApiKey(headers))) {
    return {
      status: 401,
      body: { ok: false, error: "Missing or invalid API key. Send X-API-Key or Authorization: Bearer." },
    };
  }

  const verb = String(method || "GET").toUpperCase();
  if (verb !== "GET") {
    return {
      status: 405,
      allow: "GET",
      body: { ok: false, error: "Machines API is read-only. Use GET." },
    };
  }

  const route = matchMachinesRoute(urlPath);
  if (route.kind === "unknown") return reject(404, "No route matches that path.");

  if (route.kind === "stand") {
    return { status: 200, body: toPublicStand(stand) };
  }

  if (route.kind === "parts") {
    const parsed = parsePartsQuery(query);
    if (parsed.error) return reject(400, parsed.error);
    const token = decodeToken(parsed.pageToken, ["c"]);
    if (token.error) return reject(400, token.error);
    return {
      status: 200,
      body: { ok: true, ...listPublicParts(parts || [], { ...parsed, cursor: token.cursor }) },
    };
  }

  if (route.kind === "movements") {
    const parsed = parseMovementsQuery(query);
    if (parsed.error) return reject(400, parsed.error);
    const token = decodeToken(parsed.pageToken, ["t", "i"]);
    if (token.error) return reject(400, token.error);
    return {
      status: 200,
      body: { ok: true, ...listPublicMovements(movements || [], { ...parsed, cursor: token.cursor }) },
    };
  }

  if (route.kind === "machine") {
    const found = findMachine(machines || [], route.machineNumber);
    if (!found) return reject(404, `No machine ${route.machineNumber.slice(0, 40)}.`);
    return { status: 200, body: { ok: true, machine: toPublicMachine(found) } };
  }

  const parsed = parseMachinesQuery(query);
  if (parsed.error) return reject(400, parsed.error);
  const token = decodePageToken(parsed.pageToken);
  if (token.error) return reject(400, token.error);
  const page = listPublicMachines(machines || [], {
    limit: parsed.limit,
    updatedSince: parsed.updatedSince,
    statuses: parsed.statuses,
    cursor: token.cursor,
  });
  return { status: 200, body: { ok: true, ...page } };
}
