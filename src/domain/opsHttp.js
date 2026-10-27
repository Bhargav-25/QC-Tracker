import { createHash } from "node:crypto";
import { FINAL_PACKING_ITEMS, INSTALLATION_PHOTO_COUNT, STATUS, STATUS_ORDER, emptyDelivery, emptyDispatch, emptyInstallation } from "../constants.js";
import { keysMatch, presentedApiKey } from "./apiKey.js";
import { batchFromMachineNumber, toIsoTimestamp } from "./machinesHttp.js";
import {
  FULFILLMENT_STATUSES,
  blankOrder,
  groupNumberToId,
  isSafeGroupId,
  normalizeGroupNumber,
} from "./orderModel.js";
import { currentCycleNumber, planRefurbComplete, planReturn } from "./machineCycle.js";
import { computeStatus } from "../utils/status.js";

// Ops write API. Kept out of machinesHttp.js and ordersHttp.js so the
// read-only inventory API and the returns/refurb work can change on their
// own. This module never writes; functions/opsApi.js applies `write` / `upload` /
// `assign` / `commit`.

export const OPS_ACTOR = "ops-api";
// Name shown in the Audit Log user column. The machine's updatedBy stays ops-api.
export const OPS_AUDIT_ACTOR = "ops-bot";
export const MAX_INSTALLATION_PHOTO_BYTES = 8 * 1024 * 1024;
export const SERVER_TIMESTAMP = Symbol("serverTimestamp");

const DISPATCH_KEYS = new Set([
  "courier",
  "shipper",
  "trackingNumber",
  "trackingLink",
  "trackingUrl",
  "date",
]);
const INSTALL_KEYS = new Set(["date", "notes", "installer", "installedBy"]);
const PHOTO_KEYS = new Set(["data", "filename", "fileName", "contentType", "id", "clientId"]);

const IMAGE_TYPES = {
  jpeg: { contentType: "image/jpeg", ext: "jpg" },
  png: { contentType: "image/png", ext: "png" },
  webp: { contentType: "image/webp", ext: "webp" },
  gif: { contentType: "image/gif", ext: "gif" },
};

const CONTENT_TYPE_TO_KIND = new Map([
  ["image/jpeg", "jpeg"],
  ["image/jpg", "jpeg"],
  ["image/pjpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

function text(value) {
  if (value == null) return "";
  return String(value);
}

function norm(value) {
  return text(value).trim();
}

function reject(status, error) {
  return { status, body: { ok: false, error } };
}

function hasOwn(body, key) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

// en-CA + Asia/Kolkata is YYYY-MM-DD. UTC midnight is the previous evening in IST.
export function todayIst(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function parseIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 2020 || year > 2100) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

function updatedMillis(machine) {
  const value = machine?.updatedAt;
  if (value == null || value === "") return 0;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

function byUpdatedDesc(a, b) {
  const delta = updatedMillis(b) - updatedMillis(a);
  if (delta !== 0) return delta;
  const left = text(a.id);
  const right = text(b.id);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function normalizeOpsPath(urlPath) {
  let path = String(urlPath || "/").split("?")[0];
  path = path.replace(/\/+$/, "") || "/";
  path = path.replace(/^\/opsApi(?=\/|$)/i, "") || "/";
  path = path.replace(/^\/api(?=\/|$)/, "") || "/";
  path = path.replace(/^\/v1(?=\/|$)/, "") || "/";
  return path;
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// `action` is lookup | machines | assign | dispatch | install | photos | return | refurbish.
export function matchOpsRoute(urlPath) {
  const path = normalizeOpsPath(urlPath);
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "machines") return { action: "machines" };
  if (parts.length >= 2 && parts[0] === "groups") {
    const groupNumber = normalizeGroupNumber(decodeSegment(parts[1]));
    if (parts.length === 2) return { action: "lookup", address: { type: "group", groupNumber } };
    if (parts.length === 3 && parts[2] === "dispatch") {
      return { action: "dispatch", address: { type: "group", groupNumber } };
    }
    if (parts.length === 3 && parts[2] === "installation") {
      return { action: "install", address: { type: "group", groupNumber } };
    }
    if (parts.length === 3 && parts[2] === "assign") {
      return { action: "assign", address: { type: "group", groupNumber } };
    }
    if (parts.length === 3 && parts[2] === "return") {
      return { action: "return", address: { type: "group", groupNumber } };
    }
    if (parts.length === 3 && parts[2] === "refurbish") {
      return { action: "refurbish", address: { type: "group", groupNumber } };
    }
    if (parts.length === 4 && parts[2] === "installation" && parts[3] === "photos") {
      return { action: "photos", address: { type: "group", groupNumber } };
    }
  }
  if (parts.length >= 3 && parts[0] === "machines") {
    const machineNumber = norm(decodeSegment(parts[1]));
    if (parts.length === 3 && parts[2] === "dispatch") {
      return { action: "dispatch", address: { type: "machine", machineNumber } };
    }
    if (parts.length === 3 && parts[2] === "return") {
      return { action: "return", address: { type: "machine", machineNumber } };
    }
    if (parts.length === 3 && parts[2] === "refurbish") {
      return { action: "refurbish", address: { type: "machine", machineNumber } };
    }
    if (parts.length === 3 && parts[2] === "installation") {
      return { action: "install", address: { type: "machine", machineNumber } };
    }
    if (parts.length === 4 && parts[2] === "installation" && parts[3] === "photos") {
      return { action: "photos", address: { type: "machine", machineNumber } };
    }
  }
  return { action: "unknown" };
}

// Order link first (machineId, then machineNumber), then machine.groupNumber.
export function selectOpsMachine({ address, machines, order }) {
  const unique = [];
  const seen = new Set();
  for (const machine of machines || []) {
    if (!machine?.id || seen.has(machine.id)) continue;
    seen.add(machine.id);
    unique.push(machine);
  }

  if (address.type === "machine") {
    const wanted = address.machineNumber.trim();
    const matches = unique.filter((machine) => norm(machine.machineNumber) === wanted);
    if (!matches.length) return { error: "not-found" };
    matches.sort(byUpdatedDesc);
    return { machine: matches[0], order: order || null };
  }

  if (order?.machineId) {
    const byId = unique.find((machine) => machine.id === order.machineId);
    if (byId) return { machine: byId, order };
  }
  if (order?.machineNumber) {
    const wanted = norm(order.machineNumber);
    const byNumber = unique.filter((machine) => norm(machine.machineNumber) === wanted);
    if (byNumber.length) {
      byNumber.sort(byUpdatedDesc);
      return { machine: byNumber[0], order };
    }
  }
  const group = address.groupNumber;
  const byGroup = unique.filter((machine) => normalizeGroupNumber(machine.groupNumber) === group);
  if (byGroup.length === 1) return { machine: byGroup[0], order: order || null };
  if (byGroup.length > 1) return { error: "ambiguous" };
  return { error: "not-found" };
}

function linkedGroup(machine, order) {
  const machineGroup = normalizeGroupNumber(machine.groupNumber);
  if (order?.groupNumber) {
    const orderGroup = normalizeGroupNumber(order.groupNumber);
    const linked =
      (order.machineId && order.machineId === machine.id) ||
      (order.machineNumber && norm(order.machineNumber) === norm(machine.machineNumber)) ||
      (machineGroup && machineGroup === orderGroup);
    if (linked && orderGroup) return orderGroup;
  }
  return machineGroup;
}

function shown(value) {
  const trimmed = norm(value);
  return trimmed || "—";
}

// Same fields the Audit Log page reads, plus groupNumber so the row can show
// which order the write was for. `timestamp` is added when the batch commits.
export function opsAuditEntry({ machineId, machineNumber, groupNumber, section, action }) {
  return {
    userEmail: OPS_AUDIT_ACTOR,
    machineId: machineId || null,
    machineNumber: machineNumber || null,
    groupNumber: groupNumber || null,
    section: section || null,
    action,
  };
}

function dispatchAudit(machine, order, prior, next, beforeStatus, afterStatus) {
  const group = linkedGroup(machine, order);
  const machineNumber = norm(machine.machineNumber);
  const verb = prior?.dispatched ? "updated dispatch" : "marked dispatched";
  const action = [
    `${verb} ${machineNumber} group ${shown(group)}:`,
    `status ${shown(beforeStatus)} → ${shown(afterStatus)}`,
    `courier ${shown(prior?.courier)} → ${shown(next.courier)}`,
    `tracking ${shown(prior?.trackingNumber)} → ${shown(next.trackingNumber)}`,
    `link ${shown(prior?.trackingLink)} → ${shown(next.trackingLink)}`,
    `date ${shown(prior?.date)} → ${shown(next.date)}`,
  ].join(" ");
  return opsAuditEntry({
    machineId: machine.id,
    machineNumber,
    groupNumber: group || null,
    section: "dispatch",
    action,
  });
}

function installationAudit(machine, order, prior, next, beforeStatus, afterStatus) {
  const group = linkedGroup(machine, order);
  const machineNumber = norm(machine.machineNumber);
  const verb = prior?.installed ? "updated installation" : "marked installed";
  const parts = [
    `${verb} ${machineNumber} group ${shown(group)}:`,
    `status ${shown(beforeStatus)} → ${shown(afterStatus)}`,
    `date ${shown(prior?.date)} → ${shown(next.date)}`,
  ];
  if (norm(prior?.installedBy) !== norm(next.installedBy)) {
    parts.push(`installer ${shown(prior?.installedBy)} → ${shown(next.installedBy)}`);
  }
  if (norm(prior?.notes) !== norm(next.notes)) {
    parts.push(`notes ${shown(prior?.notes)} → ${shown(next.notes)}`);
  }
  return opsAuditEntry({
    machineId: machine.id,
    machineNumber,
    groupNumber: group || null,
    section: "installation",
    action: parts.join(" "),
  });
}

function photoAudit(machine, order, { filename, contentHash }) {
  const group = linkedGroup(machine, order);
  const machineNumber = norm(machine.machineNumber);
  const action = `uploaded installation photo ${filename} sha256 ${contentHash} on ${machineNumber} group ${shown(group)}`;
  return opsAuditEntry({
    machineId: machine.id,
    machineNumber,
    groupNumber: group || null,
    section: "installation",
    action,
  });
}

function machineLabel(machine, address) {
  return norm(machine?.machineNumber) || norm(address?.machineNumber) || norm(address?.groupNumber) || "machine";
}

function notReadyError(machine, address) {
  const label = machineLabel(machine, address);
  const status = computeStatus(machine);
  return `Machine ${label} is ${status}. Dispatch or delivery has to be recorded before it can be marked installed.`;
}

export function applyOpsWrite(machine, write, nowIso) {
  if (!write) return machine;
  const next = { ...machine, ...write.fields };
  if (write.sectionStamps?.length) {
    const sectionMeta = { ...(machine.sectionMeta || {}) };
    for (const section of write.sectionStamps) {
      sectionMeta[section] = { updatedBy: OPS_ACTOR, updatedAt: nowIso };
    }
    next.sectionMeta = sectionMeta;
  }
  return next;
}

export function buildMachineUpdate(write) {
  const update = { ...write.fields, updatedAt: SERVER_TIMESTAMP };
  for (const section of write.sectionStamps || []) {
    update[`sectionMeta.${section}`] = {
      updatedBy: OPS_ACTOR,
      updatedAt: SERVER_TIMESTAMP,
    };
  }
  return update;
}

function publicIdentity(machine, order) {
  const group = linkedGroup(machine, order);
  return {
    machineNumber: norm(machine.machineNumber),
    machineId: machine.id,
    groupNumber: group || null,
    status: computeStatus(machine),
  };
}

function unknownFields(body, allowed) {
  return Object.keys(body).filter((key) => !allowed.has(key));
}

function pickAlias(body, primary, alias) {
  const hasPrimary = hasOwn(body, primary);
  const hasAlias = hasOwn(body, alias);
  if (!hasPrimary && !hasAlias) return { present: false, value: undefined };
  if (hasPrimary && hasAlias && norm(body[primary]) !== norm(body[alias])) {
    return { error: `Send ${primary} or ${alias}, not two different values.` };
  }
  return { present: true, value: hasPrimary ? body[primary] : body[alias] };
}

function hasControlChar(value, { newlines = false } = {}) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 10 || code === 13) {
      if (!newlines) return true;
      continue;
    }
    if (code < 32) return true;
  }
  return false;
}

function plainText(value, label, max) {
  const trimmed = norm(value);
  if (!trimmed) return { error: `${label} is required.` };
  if (trimmed.length > max) return { error: `${label} must be ${max} characters or fewer.` };
  if (hasControlChar(trimmed)) return { error: `${label} cannot contain line breaks.` };
  return { value: trimmed };
}

function optionalPlain(value, label, max, { newlines = false } = {}) {
  if (value == null) return { value: "" };
  if (typeof value !== "string") return { error: `${label} must be a string.` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `${label} must be ${max} characters or fewer.` };
  if (hasControlChar(trimmed, { newlines })) {
    return { error: newlines ? `${label} contains unsupported characters.` : `${label} cannot contain line breaks.` };
  }
  return { value: trimmed };
}

function parseTrackingLink(value) {
  const trimmed = norm(value);
  if (!trimmed) return { value: "" };
  if (trimmed.length > 2000) return { error: "trackingLink must be 2000 characters or fewer." };
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: "trackingLink must be an http or https URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "trackingLink must be an http or https URL." };
  }
  return { value: url.toString() };
}

function dispatchSignature(dispatch) {
  return JSON.stringify({
    dispatched: Boolean(dispatch?.dispatched),
    date: norm(dispatch?.date),
    courier: norm(dispatch?.courier),
    trackingNumber: norm(dispatch?.trackingNumber),
    trackingLink: norm(dispatch?.trackingLink),
  });
}

function planDispatch(machine, body, now, order) {
  const extra = unknownFields(body, DISPATCH_KEYS);
  if (extra.length) {
    return reject(400, "Dispatch accepts courier, trackingNumber, trackingLink, and date.");
  }
  const courierPick = pickAlias(body, "courier", "shipper");
  if (courierPick.error) return reject(400, courierPick.error);
  if (!courierPick.present) return reject(400, "courier is required.");
  if (typeof courierPick.value !== "string") return reject(400, "courier must be a string.");
  const courier = plainText(courierPick.value, "courier", 120);
  if (courier.error) return reject(400, courier.error);

  const numberPick = hasOwn(body, "trackingNumber")
    ? { present: true, value: body.trackingNumber }
    : { present: false, value: undefined };
  const linkPick = pickAlias(body, "trackingLink", "trackingUrl");
  if (linkPick.error) return reject(400, linkPick.error);

  const prior = machine.dispatch || {};
  let trackingNumber = norm(prior.trackingNumber);
  let trackingLink = norm(prior.trackingLink);
  let providedTracking = false;
  if (numberPick.present && norm(numberPick.value)) {
    const parsed = optionalPlain(numberPick.value, "trackingNumber", 200);
    if (parsed.error) return reject(400, parsed.error);
    trackingNumber = parsed.value;
    providedTracking = true;
  } else if (numberPick.present && numberPick.value != null && typeof numberPick.value !== "string") {
    return reject(400, "trackingNumber must be a string.");
  }
  if (linkPick.present && norm(linkPick.value)) {
    if (typeof linkPick.value !== "string") return reject(400, "trackingLink must be a string.");
    const parsed = parseTrackingLink(linkPick.value);
    if (parsed.error) return reject(400, parsed.error);
    trackingLink = parsed.value;
    providedTracking = true;
  } else if (linkPick.present && linkPick.value != null && typeof linkPick.value !== "string") {
    return reject(400, "trackingLink must be a string.");
  }
  if (!providedTracking) {
    return reject(400, "Provide a tracking number, a tracking link, or both.");
  }
  // A link with no number still has to show in the Tracking no. field and the sheet.
  if (!trackingNumber && trackingLink) trackingNumber = trackingLink;

  let date = parseIsoDate(norm(prior.date)) || "";
  if (hasOwn(body, "date") && norm(body.date)) {
    const parsed = parseIsoDate(norm(body.date));
    if (!parsed) return reject(400, "date must be YYYY-MM-DD.");
    date = parsed;
  } else if (!date) {
    date = todayIst(now);
  }

  const nextDispatch = {
    ...emptyDispatch(),
    ...prior,
    dispatched: true,
    date,
    courier: courier.value,
    trackingNumber,
    trackingLink,
  };
  const unchanged = dispatchSignature(prior) === dispatchSignature(nextDispatch);
  const identity = publicIdentity(machine, order);
  const dispatchSummary = {
    dispatched: true,
    date: nextDispatch.date,
    courier: nextDispatch.courier,
    trackingNumber: nextDispatch.trackingNumber,
    trackingLink: nextDispatch.trackingLink,
  };

  if (unchanged) {
    return {
      status: 200,
      body: { ok: true, unchanged: true, ...identity, updatedBy: OPS_ACTOR, dispatch: dispatchSummary },
    };
  }

  const write = {
    machineId: machine.id,
    machineNumber: identity.machineNumber,
    groupNumber: identity.groupNumber || "",
    fields: { dispatch: nextDispatch, updatedBy: OPS_ACTOR },
    sectionStamps: ["dispatch"],
  };
  const projected = applyOpsWrite(machine, write, now.toISOString());
  const status = computeStatus(projected);
  write.audit = dispatchAudit(machine, order, prior, nextDispatch, identity.status, status);
  write.fulfillmentStatus =
    status !== identity.status && FULFILLMENT_STATUSES.includes(status) ? status : null;
  return {
    status: 200,
    body: { ok: true, unchanged: false, ...identity, status, updatedBy: OPS_ACTOR, dispatch: dispatchSummary },
    write,
  };
}

function installSignature(installation) {
  return JSON.stringify({
    installed: Boolean(installation?.installed),
    date: norm(installation?.date),
    notes: norm(installation?.notes),
    installedBy: norm(installation?.installedBy),
  });
}

function planInstall(machine, body, now, order, address) {
  const extra = unknownFields(body, INSTALL_KEYS);
  if (extra.length) {
    return reject(400, "Installation accepts date, notes, and installer.");
  }
  if (!machine.dispatch?.dispatched && !machine.delivery?.delivered) {
    return reject(409, notReadyError(machine, address));
  }

  const prior = machine.installation || {};
  let date = parseIsoDate(norm(prior.date)) || "";
  if (hasOwn(body, "date") && norm(body.date)) {
    const parsed = parseIsoDate(norm(body.date));
    if (!parsed) return reject(400, "date must be YYYY-MM-DD.");
    date = parsed;
  } else if (!date) {
    date = todayIst(now);
  }

  let notes = norm(prior.notes);
  if (hasOwn(body, "notes")) {
    const parsed = optionalPlain(body.notes, "notes", 2000, { newlines: true });
    if (parsed.error) return reject(400, parsed.error);
    notes = parsed.value;
  }

  const installerPick = pickAlias(body, "installer", "installedBy");
  if (installerPick.error) return reject(400, installerPick.error);
  let installedBy = norm(prior.installedBy);
  if (installerPick.present) {
    const parsed = optionalPlain(installerPick.value, "installer", 200);
    if (parsed.error) return reject(400, parsed.error);
    installedBy = parsed.value;
  }

  const nextInstallation = {
    ...emptyInstallation(),
    ...prior,
    photos: Array.isArray(prior.photos) ? prior.photos.slice() : [],
    video: prior.video ?? null,
    installed: true,
    date,
    notes,
    installedBy,
  };
  const unchanged = installSignature(prior) === installSignature(nextInstallation);
  const identity = publicIdentity(machine, order);
  const summary = {
    installed: true,
    date: nextInstallation.date,
    notes: nextInstallation.notes || "",
    installedBy: nextInstallation.installedBy || "",
  };
  if (unchanged) {
    return {
      status: 200,
      body: { ok: true, unchanged: true, ...identity, updatedBy: OPS_ACTOR, installation: summary },
    };
  }

  const write = {
    machineId: machine.id,
    machineNumber: identity.machineNumber,
    groupNumber: identity.groupNumber || "",
    fields: { installation: nextInstallation, updatedBy: OPS_ACTOR },
    sectionStamps: ["installation"],
  };
  const projected = applyOpsWrite(machine, write, now.toISOString());
  const status = computeStatus(projected);
  write.audit = installationAudit(machine, order, prior, nextInstallation, identity.status, status);
  write.fulfillmentStatus =
    status !== identity.status && FULFILLMENT_STATUSES.includes(status) ? status : null;
  return {
    status: 200,
    body: { ok: true, unchanged: false, ...identity, status, updatedBy: OPS_ACTOR, installation: summary },
    write,
  };
}

export function detectImageKind(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.slice(0, 6).toString("ascii") === "GIF87a" || bytes.slice(0, 6).toString("ascii") === "GIF89a") {
    return "gif";
  }
  if (bytes.slice(0, 4).toString("ascii") === "RIFF" && bytes.slice(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }
  return null;
}

function decodeBase64(input, maxBytes) {
  const cleaned = text(input).replace(/\s/g, "");
  const maxChars = Math.ceil(maxBytes / 3) * 4 + 4;
  if (cleaned.length > maxChars) return { error: "too-large" };
  if (!cleaned || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(cleaned) || cleaned.length % 4 === 1) {
    return { error: "invalid" };
  }
  const normalized = cleaned.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Buffer.from(normalized, "base64");
  if (!bytes.length) return { error: "invalid" };
  if (bytes.length > maxBytes) return { error: "too-large" };
  return { bytes };
}

function safeFilename(name, ext) {
  const leaf = text(name).split(/[/\\]/).pop() || "photo";
  const cleaned = leaf.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 80);
  const stem = cleaned.replace(/\.[^.]+$/, "") || "photo";
  return `${stem}.${ext}`;
}

export function installationPhotoPath(machineId, filename, nowMs) {
  return `machines/${machineId}/installation/${nowMs}-${filename}`;
}

export function firebaseDownloadUrl(bucketName, path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

function photoCount(photos) {
  return (Array.isArray(photos) ? photos : []).filter((photo) => photo && typeof photo === "object").length;
}

export function placeInstallationPhoto(machine, entry) {
  const photos = Array.isArray(machine.installation?.photos) ? machine.installation.photos.slice() : [];
  const duplicate = photos.find((photo) => {
    if (!photo || typeof photo !== "object") return false;
    if (entry.contentHash && photo.contentHash === entry.contentHash) return true;
    if (entry.clientId && photo.clientId && photo.clientId === entry.clientId) return true;
    return false;
  });
  if (duplicate) return { duplicate };
  if (photoCount(photos) >= INSTALLATION_PHOTO_COUNT) return { error: "full" };
  const hole = photos.findIndex((photo) => !photo);
  if (hole === -1) photos.push(entry);
  else photos[hole] = entry;
  return { photos };
}

export function installationPhotoBody(machine, photo, { duplicate, order }) {
  const photos = machine.installation?.photos;
  return {
    ok: true,
    duplicate: Boolean(duplicate),
    ...publicIdentity(machine, order),
    updatedBy: OPS_ACTOR,
    photo: {
      url: text(photo?.url),
      path: text(photo?.path),
      contentHash: photo?.contentHash || null,
      clientId: photo?.clientId || null,
    },
    installationPhotos: photoCount(photos),
  };
}

function splitDataUrl(data) {
  if (typeof data !== "string") return { error: "data must be a base64 string." };
  if (!data.startsWith("data:")) return { data };
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(data);
  if (!match) return { error: "data URL must be base64, like data:image/jpeg;base64,..." };
  return { data: match[2], contentType: match[1] };
}

function planPhoto(machine, body, now, order, address, maxPhotoBytes) {
  if (body.photos) {
    return reject(400, "Send one image per request. JSON body: filename, contentType, and base64 data.");
  }
  const extra = unknownFields(body, PHOTO_KEYS);
  if (extra.length) {
    return reject(400, "Photo upload accepts filename, contentType, data, and id.");
  }
  if (!machine.dispatch?.dispatched && !machine.delivery?.delivered) {
    return reject(409, notReadyError(machine, address));
  }

  const idPick = pickAlias(body, "id", "clientId");
  if (idPick.error) return reject(400, idPick.error);
  let clientId = null;
  if (idPick.present && norm(idPick.value)) {
    const parsed = plainText(idPick.value, "id", 128);
    if (parsed.error) return reject(400, parsed.error);
    if (!/^[A-Za-z0-9._:-]+$/.test(parsed.value)) {
      return reject(400, "id may contain letters, numbers, and . _ : -.");
    }
    clientId = parsed.value;
  }

  const namePick = pickAlias(body, "filename", "fileName");
  if (namePick.error) return reject(400, namePick.error);
  if (!hasOwn(body, "data")) return reject(400, "data must be a base64 string.");
  const split = splitDataUrl(body.data);
  if (split.error) return reject(400, split.error);
  const decoded = decodeBase64(split.data, maxPhotoBytes);
  if (decoded.error === "too-large") {
    const limitLabel =
      maxPhotoBytes % (1024 * 1024) === 0
        ? `${maxPhotoBytes / (1024 * 1024)} MB`
        : `${maxPhotoBytes} bytes`;
    return reject(413, `Image is larger than ${limitLabel}.`);
  }
  if (decoded.error || !decoded.bytes) return reject(400, "data must be a base64 string.");
  const bytes = decoded.bytes;

  const kind = detectImageKind(bytes);
  if (!kind) return reject(400, "Image must be JPEG, PNG, WebP, or GIF.");
  const declared = norm(body.contentType || split.contentType).toLowerCase().split(";")[0].trim();
  if (declared) {
    const declaredKind = CONTENT_TYPE_TO_KIND.get(declared);
    if (!declaredKind) return reject(400, "contentType must be image/jpeg, image/png, image/webp, or image/gif.");
    if (declaredKind !== kind) return reject(400, "contentType does not match the image bytes.");
  }
  const spec = IMAGE_TYPES[kind];
  const filename = safeFilename(namePick.present ? namePick.value : "photo", spec.ext);
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const path = installationPhotoPath(machine.id, filename, now.getTime());
  const entry = {
    path,
    lat: null,
    lng: null,
    capturedAt: now.toISOString(),
    contentHash,
    clientId,
  };
  const placed = placeInstallationPhoto(machine, entry);
  if (placed.duplicate) {
    return { status: 200, body: installationPhotoBody(machine, placed.duplicate, { duplicate: true, order }) };
  }
  if (placed.error === "full") {
    const label = machineLabel(machine, address);
    return reject(409, `Machine ${label} already has ${INSTALLATION_PHOTO_COUNT} installation photos.`);
  }

  const identity = publicIdentity(machine, order);
  return {
    status: 201,
    upload: {
      machineId: machine.id,
      machineNumber: identity.machineNumber,
      groupNumber: identity.groupNumber || "",
      path,
      bytes,
      contentType: spec.contentType,
      contentHash,
      clientId,
      entry,
      sectionStamps: ["installation"],
      audit: photoAudit(machine, order, { filename, contentHash }),
    },
  };
}

function resolveAddress(route, machines, order) {
  if (route.address.type === "group" && !isSafeGroupId(route.address.groupNumber)) {
    return reject(400, "groupNumber is not a valid id.");
  }
  if (route.address.type === "machine" && !route.address.machineNumber) {
    return reject(404, "No machine.");
  }
  if (route.address.type === "machine" && route.address.machineNumber.length > 40) {
    return reject(400, "machineNumber is too long.");
  }
  const selected = selectOpsMachine({ address: route.address, machines, order });
  if (selected.error === "ambiguous") {
    return reject(409, `More than one machine is linked to ${route.address.groupNumber}. Pass the machine number.`);
  }
  if (selected.error === "not-found") {
    if (route.address.type === "machine") {
      return reject(404, `No machine ${route.address.machineNumber.slice(0, 40)}.`);
    }
    return reject(404, `No machine linked to ${route.address.groupNumber}.`);
  }
  return { machine: selected.machine, order: selected.order || null };
}

function allowedMethod(action) {
  if (action === "lookup" || action === "machines") return "GET";
  return "POST";
}

const OPS_MACHINE_LIST_DEFAULT_LIMIT = 200;
const OPS_MACHINE_LIST_MAX_LIMIT = 500;
const STATUS_CANONICAL = new Map(STATUS_ORDER.map((status) => [status.toLowerCase(), status]));
STATUS_CANONICAL.set("assembly", STATUS.ASSEMBLY);
const ASSIGN_KEYS = new Set(["machineNumber", "reason", "note", "force", "customer", "city"]);
const ASSIGN_REASONS = new Set(["auto", "reserved"]);

// Same rule as the returns work: a previous cycle, or cycle > 1, means the
// machine was returned and refurbished. Absent on machines that have not.
export function machineIsRefurbished(machine) {
  const archived = Array.isArray(machine?.cycles) ? machine.cycles.length : 0;
  const stored = Number(machine?.cycle);
  const cycle = Number.isInteger(stored) && stored > 0 ? stored : archived + 1;
  return archived > 0 || cycle > 1;
}

function packingComplete(machine) {
  const fp = machine?.finalPacking || {};
  return FINAL_PACKING_ITEMS.every((item) => Boolean(fp[item.key]?.url));
}

function packedAtIso(machine) {
  if (packingComplete(machine)) {
    const packed = toIsoTimestamp(machine.sectionMeta?.finalPacking?.updatedAt);
    if (packed) return packed;
  }
  const meta = machine?.sectionMeta || {};
  let best = null;
  let bestMs = -Infinity;
  for (const value of Object.values(meta)) {
    const iso = toIsoTimestamp(value?.updatedAt);
    const ms = iso ? Date.parse(iso) : NaN;
    if (!Number.isNaN(ms) && ms > bestMs) {
      bestMs = ms;
      best = iso;
    }
  }
  return best || toIsoTimestamp(machine?.updatedAt);
}

function orderLinksMachine(order, machine) {
  if (!order || !machine) return false;
  if (order.machineId && order.machineId === machine.id) return true;
  if (norm(order.machineNumber) && norm(order.machineNumber) === norm(machine.machineNumber)) return true;
  return false;
}

function linkedGroupForMachine(machine, orders) {
  const own = normalizeGroupNumber(machine?.groupNumber);
  if (own) return own;
  const hits = (orders || []).filter((order) => orderLinksMachine(order, machine));
  const byId = hits.find((order) => order.machineId && order.machineId === machine.id);
  const chosen = byId || hits[0];
  return chosen ? normalizeGroupNumber(chosen.groupNumber) || null : null;
}

function queryTokens(query, key) {
  const raw = query?.[key];
  const parts = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const tokens = [];
  for (const part of parts) {
    for (const piece of String(part).split(",")) {
      const token = piece.trim();
      if (token) tokens.push(token);
    }
  }
  return tokens;
}

export function parseOpsMachineQuery(query) {
  const rawLimit = query?.limit;
  const limitText = (Array.isArray(rawLimit) ? rawLimit[0] : rawLimit) == null
    ? ""
    : String(Array.isArray(rawLimit) ? rawLimit[0] : rawLimit).trim();
  let limit = OPS_MACHINE_LIST_DEFAULT_LIMIT;
  if (limitText) {
    if (!/^\d+$/.test(limitText) || Number(limitText) < 1) {
      return { error: `limit must be a whole number from 1 to ${OPS_MACHINE_LIST_MAX_LIMIT}.` };
    }
    limit = Math.min(Number(limitText), OPS_MACHINE_LIST_MAX_LIMIT);
  }
  const present = query != null && Object.prototype.hasOwnProperty.call(query, "status");
  const statuses = [];
  if (present) {
    const tokens = queryTokens(query, "status");
    if (!tokens.length) {
      return { error: `status must be one of: ${STATUS_ORDER.join(", ")}.` };
    }
    for (const token of tokens) {
      const canonical = STATUS_CANONICAL.get(token.toLowerCase());
      if (!canonical) return { error: `status must be one of: ${STATUS_ORDER.join(", ")}.` };
      if (!statuses.includes(canonical)) statuses.push(canonical);
    }
  }
  return { limit, statuses };
}

export function listOpsMachines(machines, orders, { limit, statuses }) {
  let rows = (Array.isArray(machines) ? machines : []).filter((machine) => machine && machine.id);
  if (statuses?.length) {
    rows = rows.filter((machine) => statuses.includes(computeStatus(machine)));
  }
  const items = rows.map((machine) => ({
    machineNumber: norm(machine.machineNumber),
    status: computeStatus(machine),
    packedAt: packedAtIso(machine),
    refurbished: machineIsRefurbished(machine),
    groupNumber: linkedGroupForMachine(machine, orders),
    batch: batchFromMachineNumber(machine.machineNumber),
  }));
  items.sort((a, b) => {
    const left = a.packedAt ? Date.parse(a.packedAt) : NaN;
    const right = b.packedAt ? Date.parse(b.packedAt) : NaN;
    const l = Number.isNaN(left) ? Infinity : left;
    const r = Number.isNaN(right) ? Infinity : right;
    if (l !== r) return l - r;
    return a.machineNumber.localeCompare(b.machineNumber, undefined, { numeric: true });
  });
  const page = items.slice(0, limit);
  return { count: page.length, machines: page };
}

function findOrderForGroup(orders, groupNumber) {
  const group = normalizeGroupNumber(groupNumber);
  const id = groupNumberToId(group);
  const matches = (orders || []).filter(
    (order) => order && (order.id === id || normalizeGroupNumber(order.groupNumber) === group)
  );
  return matches.find((order) => order.id === id) || matches[0] || null;
}

function machinesNumbered(machines, machineNumber) {
  const wanted = norm(machineNumber);
  return (machines || []).filter((machine) => machine?.id && norm(machine.machineNumber) === wanted);
}

function assignAudit(machine, group, { reason, note, beforeMachine, beforeGroup, created }) {
  const parts = [
    `assign machine ${norm(machine.machineNumber)} group ${shown(group)}`,
    `reason ${shown(reason)}`,
    `machine ${shown(beforeMachine)} → ${norm(machine.machineNumber)}`,
    `group ${shown(beforeGroup)} → ${shown(group)}`,
  ];
  if (created) parts.push("created order");
  if (note) parts.push(`note ${note}`);
  return opsAuditEntry({
    machineId: machine.id,
    machineNumber: norm(machine.machineNumber),
    groupNumber: group,
    section: "order",
    action: parts.join(" "),
  });
}

export function planAssign({ groupNumber, body, machines, orders }) {
  const group = normalizeGroupNumber(groupNumber);
  if (!group || !isSafeGroupId(group)) return reject(400, "groupNumber is not a valid id.");
  if (!body || typeof body !== "object" || Array.isArray(body)) return reject(400, "Send a JSON object.");
  const extra = unknownFields(body, ASSIGN_KEYS);
  if (extra.length) return reject(400, "Assign accepts machineNumber, reason, note, force, customer, and city.");
  if (!hasOwn(body, "machineNumber")) return reject(400, "machineNumber is required.");
  const machineNumber = plainText(body.machineNumber, "machineNumber", 40);
  if (machineNumber.error) return reject(400, machineNumber.error);

  let reason = "";
  if (hasOwn(body, "reason") && norm(body.reason)) {
    if (typeof body.reason !== "string" || !ASSIGN_REASONS.has(norm(body.reason))) {
      return reject(400, "reason must be auto or reserved.");
    }
    reason = norm(body.reason);
  }
  let note = "";
  if (hasOwn(body, "note")) {
    const parsed = optionalPlain(body.note, "note", 500);
    if (parsed.error) return reject(400, parsed.error);
    note = parsed.value;
  }
  let customer = "";
  if (hasOwn(body, "customer")) {
    const parsed = optionalPlain(body.customer, "customer", 200);
    if (parsed.error) return reject(400, parsed.error);
    customer = parsed.value;
  }
  let city = "";
  if (hasOwn(body, "city")) {
    const parsed = optionalPlain(body.city, "city", 120);
    if (parsed.error) return reject(400, parsed.error);
    city = parsed.value;
  }
  if (hasOwn(body, "force") && typeof body.force !== "boolean") {
    return reject(400, "force must be true or false.");
  }
  const force = body.force === true;

  const numbered = machinesNumbered(machines, machineNumber.value);
  if (!numbered.length) return reject(404, `No machine ${machineNumber.value}.`);
  if (numbered.length > 1) return reject(409, `More than one machine is numbered ${machineNumber.value}.`);
  const machine = numbered[0];
  const status = computeStatus(machine);
  if (status !== STATUS.PACKED) {
    return reject(409, `Machine ${norm(machine.machineNumber)} is ${status}. Only a Packed machine can be assigned.`);
  }

  const machineGroup = normalizeGroupNumber(machine.groupNumber);
  if (machineGroup && machineGroup !== group) {
    return reject(409, `Machine ${norm(machine.machineNumber)} is already assigned to ${machineGroup}.`);
  }
  const otherOrder = (orders || []).find(
    (order) => normalizeGroupNumber(order.groupNumber) !== group && orderLinksMachine(order, machine)
  );
  if (otherOrder) {
    return reject(
      409,
      `Machine ${norm(machine.machineNumber)} is already assigned to ${normalizeGroupNumber(otherOrder.groupNumber)}.`
    );
  }

  const order = findOrderForGroup(orders, group);
  const holders = (machines || []).filter(
    (item) => item?.id && item.id !== machine.id && normalizeGroupNumber(item.groupNumber) === group
  );
  const orderMachineId = order?.machineId || "";
  const orderMachineNumber = norm(order?.machineNumber);
  const different =
    (orderMachineId && orderMachineId !== machine.id) ||
    (orderMachineNumber && orderMachineNumber !== norm(machine.machineNumber)) ||
    holders.length > 0;
  if (different && !force) {
    const current = orderMachineNumber || norm(holders[0]?.machineNumber) || orderMachineId;
    return reject(409, `${group} is already assigned to ${current}. Pass force:true to replace that link.`);
  }

  const same =
    order &&
    order.machineId === machine.id &&
    orderMachineNumber === norm(machine.machineNumber) &&
    machineGroup === group &&
    order.fulfillmentStatus === STATUS.PACKED;
  const summary = {
    ok: true,
    unchanged: Boolean(same),
    createdOrder: !order,
    groupNumber: group,
    machineNumber: norm(machine.machineNumber),
    machineId: machine.id,
    status,
    fulfillmentStatus: STATUS.PACKED,
    reason: reason || null,
    refurbished: machineIsRefurbished(machine),
  };
  if (same) return { status: 200, body: summary };

  const clearMachineIds = [];
  if (orderMachineId && orderMachineId !== machine.id) {
    const previous = (machines || []).find((item) => item.id === orderMachineId);
    if (!previous || normalizeGroupNumber(previous.groupNumber) === group) clearMachineIds.push(orderMachineId);
  }
  for (const holder of holders) {
    if (!clearMachineIds.includes(holder.id)) clearMachineIds.push(holder.id);
  }

  const beforeMachine = orderMachineNumber || norm(holders[0]?.machineNumber);
  const orderId = groupNumberToId(group);
  let createOrder = null;
  let orderUpdate = null;
  if (!order) {
    createOrder = {
      ...blankOrder(group, { customer, city, machineId: machine.id, machineNumber: norm(machine.machineNumber), fulfillmentStatus: STATUS.PACKED }),
      createdAt: SERVER_TIMESTAMP,
      updatedAt: SERVER_TIMESTAMP,
      createdBy: OPS_ACTOR,
      updatedBy: OPS_ACTOR,
    };
  } else {
    orderUpdate = {
      machineId: machine.id,
      machineNumber: norm(machine.machineNumber),
      fulfillmentStatus: STATUS.PACKED,
      updatedAt: SERVER_TIMESTAMP,
      updatedBy: OPS_ACTOR,
    };
  }
  return {
    status: 200,
    body: { ...summary, unchanged: false, createdOrder: !order },
    assign: {
      groupNumber: group,
      machineNumber: norm(machine.machineNumber),
      machineId: machine.id,
      orderId,
      body,
      clearMachineIds,
      createOrder,
      orderUpdate,
      audit: assignAudit(machine, group, {
        reason,
        note,
        beforeMachine,
        beforeGroup: machineGroup,
        created: !order,
      }),
    },
  };
}

const RETURN_KEYS = new Set(["date", "reason", "receivedAt", "notes", "fromGroupNo"]);
const REFURBISH_KEYS = new Set(["date"]);
const RETURNABLE = new Set([STATUS.DISPATCHED, STATUS.DELIVERED, STATUS.INSTALLED]);

function cloneJson(value) {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
}

function publicOpsDispatchRecord(dispatch) {
  const source = dispatch || {};
  return {
    dispatched: Boolean(source.dispatched),
    date: norm(source.date),
    courier: norm(source.courier),
    trackingNumber: norm(source.trackingNumber),
    trackingLink: norm(source.trackingLink),
    includeStand: Boolean(source.includeStand),
  };
}

export function publicOpsDispatchHistory(machine) {
  return (Array.isArray(machine?.dispatchHistory) ? machine.dispatchHistory : []).map((entry) => ({
    cycle: Number(entry?.cycle) || null,
    groupNumber: norm(entry?.groupNumber) || null,
    returnDate: norm(entry?.returnDate),
    reason: norm(entry?.reason),
    recordedAt: norm(entry?.recordedAt),
    dispatch: publicOpsDispatchRecord(entry?.dispatch),
  }));
}

function withCommit(result, kind, machine, body, now) {
  if (!result?.write) return result;
  return {
    ...result,
    commit: {
      kind,
      machineNumber: norm(machine.machineNumber),
      body,
      now: now.toISOString(),
    },
  };
}

function returnSummary(intake) {
  return {
    date: norm(intake?.date),
    reason: norm(intake?.reason),
    receivedAt: norm(intake?.receivedAt),
    fromGroupNo: norm(intake?.fromGroupNo),
    notes: norm(intake?.notes),
  };
}

function refurbSummary(refurb) {
  return {
    completedAt: norm(refurb?.completedAt),
    packed: refurb?.packed === true,
  };
}

function parseRequiredDate(value) {
  if (typeof value !== "string") return { error: "date must be YYYY-MM-DD." };
  const parsed = parseIsoDate(norm(value));
  if (!parsed) return { error: "date must be YYYY-MM-DD." };
  return { value: parsed };
}

function openReturnMatches(machine, input, provided) {
  const intake = machine?.intake;
  if (!intake || intake.refurb?.completedAt) return false;
  if (norm(intake.date) !== input.date) return false;
  if (norm(intake.reason) !== input.reason) return false;
  if (provided.receivedAt && norm(intake.receivedAt) !== input.receivedAt) return false;
  if (provided.notes && norm(intake.notes) !== input.notes) return false;
  if (provided.fromGroupNo && norm(intake.fromGroupNo) !== input.fromGroupNo) return false;
  return true;
}

function returnAudit(machine, order, beforeStatus, afterStatus, input) {
  const group = linkedGroup(machine, order);
  const machineNumber = norm(machine.machineNumber);
  const prior = machine.dispatch || {};
  const action = [
    `recorded return ${machineNumber} group ${shown(group)}:`,
    `status ${shown(beforeStatus)} → ${shown(afterStatus)}`,
    `date — → ${shown(input.date)}`,
    `reason — → ${shown(input.reason)}`,
    `previous dispatch ${shown(prior.courier)} ${shown(prior.trackingNumber)} on ${shown(prior.date)} kept in history`,
  ].join(" ");
  return opsAuditEntry({
    machineId: machine.id,
    machineNumber,
    groupNumber: group || null,
    section: "return",
    action,
  });
}

function refurbishAudit(machine, order, beforeStatus, afterStatus, date) {
  const group = linkedGroup(machine, order);
  const machineNumber = norm(machine.machineNumber);
  const action = [
    `marked refurbished ${machineNumber} group ${shown(group)}:`,
    `status ${shown(beforeStatus)} → ${shown(afterStatus)}`,
    `date — → ${shown(date)}`,
  ].join(" ");
  return opsAuditEntry({
    machineId: machine.id,
    machineNumber,
    groupNumber: group || null,
    section: "refurb",
    action,
  });
}

function shipmentStillActive(machine) {
  return Boolean(machine?.dispatch?.dispatched || machine?.delivery?.delivered || machine?.installation?.installed);
}

function latestCompletePacking(machine) {
  const cycles = Array.isArray(machine?.cycles) ? machine.cycles : [];
  for (let i = cycles.length - 1; i >= 0; i -= 1) {
    if (packingComplete({ finalPacking: cycles[i]?.finalPacking })) return cycles[i].finalPacking;
  }
  return null;
}

function anyPackingPhoto(machine) {
  const fp = machine?.finalPacking || {};
  return FINAL_PACKING_ITEMS.some((item) => Boolean(fp[item.key]?.url));
}

// Archives the current cycle and appends the active dispatch to
// `dispatchHistory` before clearing it. Same cycle record the Return tab writes.
export function planOpsReturn(machine, body, now, order) {
  const payload = body && typeof body === "object" && !Array.isArray(body) ? body : null;
  if (!payload) return reject(400, "Send a JSON object.");
  const extra = unknownFields(payload, RETURN_KEYS);
  if (extra.length) return reject(400, "Return accepts date, reason, receivedAt, notes, and fromGroupNo.");
  if (!hasOwn(payload, "date") || !norm(payload.date)) return reject(400, "date is required.");
  const date = parseRequiredDate(payload.date);
  if (date.error) return reject(400, date.error);
  const reason = plainText(payload.reason, "reason", 500);
  if (reason.error) return reject(400, reason.error);

  const provided = {
    receivedAt: hasOwn(payload, "receivedAt") && norm(payload.receivedAt) !== "",
    notes: hasOwn(payload, "notes"),
    fromGroupNo: hasOwn(payload, "fromGroupNo"),
  };
  let receivedAt = date.value;
  if (provided.receivedAt) {
    const parsed = parseRequiredDate(payload.receivedAt);
    if (parsed.error) return reject(400, "receivedAt must be YYYY-MM-DD.");
    receivedAt = parsed.value;
  }
  let notes = "";
  if (provided.notes) {
    const parsed = optionalPlain(payload.notes, "notes", 2000, { newlines: true });
    if (parsed.error) return reject(400, parsed.error);
    notes = parsed.value;
  }
  let fromGroupNo = norm(machine.groupNumber);
  if (provided.fromGroupNo) {
    const parsed = optionalPlain(payload.fromGroupNo, "fromGroupNo", 80);
    if (parsed.error) return reject(400, parsed.error);
    fromGroupNo = parsed.value;
  }
  const input = { date: date.value, reason: reason.value, receivedAt, notes, fromGroupNo };
  const identity = publicIdentity(machine, order);

  if (openReturnMatches(machine, input, provided)) {
    return {
      status: 200,
      body: {
        ok: true,
        unchanged: true,
        ...identity,
        cycle: currentCycleNumber(machine),
        refurbished: machineIsRefurbished(machine),
        updatedBy: OPS_ACTOR,
        return: returnSummary(machine.intake),
        dispatchHistory: publicOpsDispatchHistory(machine),
      },
    };
  }
  if (machine.intake && !machine.intake.refurb?.completedAt) {
    return reject(409, "This machine already has an open return. Finish refurbishment before recording another.");
  }
  if (!RETURNABLE.has(identity.status)) {
    return reject(
      409,
      `Machine ${identity.machineNumber} is ${identity.status}. Only a dispatched, delivered, or installed machine can be returned.`
    );
  }

  let plan;
  try {
    plan = planReturn(machine, input, { user: OPS_ACTOR, now: now.toISOString(), photos: [] });
  } catch (err) {
    return reject(400, err instanceof Error ? err.message : "Return could not be recorded.");
  }

  const orderClear =
    plan.unlinkGroup && isSafeGroupId(plan.unlinkGroup)
      ? {
          id: groupNumberToId(plan.unlinkGroup),
          fields: {
            machineId: "",
            machineNumber: "",
            fulfillmentStatus: "",
            updatedAt: SERVER_TIMESTAMP,
            updatedBy: OPS_ACTOR,
          },
        }
      : null;
  const write = {
    machineId: machine.id,
    machineNumber: identity.machineNumber,
    groupNumber: identity.groupNumber || "",
    fields: { ...plan.reset, updatedBy: OPS_ACTOR },
    sectionStamps: ["return"],
    orderClear,
  };
  const projected = applyOpsWrite(machine, write, now.toISOString());
  const status = computeStatus(projected);
  write.audit = returnAudit(machine, order, identity.status, status, input);
  return withCommit(
    {
      status: 200,
      body: {
        ok: true,
        unchanged: false,
        machineNumber: identity.machineNumber,
        machineId: identity.machineId,
        groupNumber: identity.groupNumber,
        status,
        cycle: plan.nextCycle,
        refurbished: machineIsRefurbished(projected),
        updatedBy: OPS_ACTOR,
        return: returnSummary(projected.intake),
        dispatchHistory: publicOpsDispatchHistory(projected),
      },
      write,
    },
    "return",
    machine,
    payload,
    now
  );
}

// Marks the open return refurbished and moves the machine to Packed.
// A dispatch that is still on the active record is appended to dispatchHistory
// before it is cleared. Packing photos from the archived cycle are restored
// when the active record has none; `intake.refurb.packed` makes status Packed
// even when those photos were never stored.
export function planOpsRefurbish(machine, body, now, order) {
  const payload = body && typeof body === "object" && !Array.isArray(body) ? body : null;
  if (!payload) return reject(400, "Send a JSON object.");
  const extra = unknownFields(payload, REFURBISH_KEYS);
  if (extra.length) return reject(400, "Refurbish accepts date.");
  let date = todayIst(now);
  if (hasOwn(payload, "date") && norm(payload.date)) {
    const parsed = parseRequiredDate(payload.date);
    if (parsed.error) return reject(400, parsed.error);
    date = parsed.value;
  } else if (hasOwn(payload, "date") && payload.date != null && typeof payload.date !== "string") {
    return reject(400, "date must be YYYY-MM-DD.");
  }

  const identity = publicIdentity(machine, order);
  if (!machine?.intake) {
    return reject(409, `Machine ${identity.machineNumber} has no return. Record a return before refurbishing it.`);
  }
  if (machine.intake.refurb?.completedAt && identity.status === STATUS.PACKED) {
    return {
      status: 200,
      body: {
        ok: true,
        unchanged: true,
        ...identity,
        cycle: currentCycleNumber(machine),
        refurbished: machineIsRefurbished(machine),
        updatedBy: OPS_ACTOR,
        refurb: refurbSummary(machine.intake.refurb),
        dispatchHistory: publicOpsDispatchHistory(machine),
      },
    };
  }
  if (machine.intake.refurb?.completedAt && RETURNABLE.has(identity.status)) {
    return reject(
      409,
      `Machine ${identity.machineNumber} is ${identity.status}. Return it before refurbishing again.`
    );
  }

  let intake = machine.intake;
  if (!intake.refurb?.completedAt) {
    try {
      intake = planRefurbComplete(machine, { date, user: OPS_ACTOR, now: now.toISOString() }).intake;
    } catch (err) {
      return reject(409, err instanceof Error ? err.message : "Refurbishment could not be completed.");
    }
  }
  intake = {
    ...intake,
    refurb: {
      ...(intake.refurb || {}),
      lines: Array.isArray(intake.refurb?.lines) ? intake.refurb.lines : [],
      completedAt: intake.refurb?.completedAt || date,
      completedBy: intake.refurb?.completedBy || OPS_ACTOR,
      packed: true,
    },
  };

  const fields = { intake, updatedBy: OPS_ACTOR };
  if (shipmentStillActive(machine)) {
    const prior = Array.isArray(machine.dispatchHistory)
      ? machine.dispatchHistory.map((entry) => cloneJson(entry)).filter(Boolean)
      : [];
    fields.dispatchHistory = [
      ...prior,
      {
        cycle: currentCycleNumber(machine),
        groupNumber: norm(machine.groupNumber),
        returnDate: norm(machine.intake?.date) || date,
        reason: norm(machine.intake?.reason),
        recordedAt: now.toISOString(),
        dispatch: cloneJson(machine.dispatch) || emptyDispatch(),
      },
    ];
    fields.dispatch = emptyDispatch();
    fields.delivery = emptyDelivery();
    fields.installation = emptyInstallation();
  }
  if (!packingComplete(machine) && !anyPackingPhoto(machine)) {
    const archived = latestCompletePacking(machine);
    if (archived) fields.finalPacking = cloneJson(archived);
  }

  const write = {
    machineId: machine.id,
    machineNumber: identity.machineNumber,
    groupNumber: identity.groupNumber || "",
    fields,
    sectionStamps: ["refurb"],
  };
  const projected = applyOpsWrite(machine, write, now.toISOString());
  const status = computeStatus(projected);
  write.audit = refurbishAudit(machine, order, identity.status, status, date);
  return withCommit(
    {
      status: 200,
      body: {
        ok: true,
        unchanged: false,
        machineNumber: identity.machineNumber,
        machineId: identity.machineId,
        groupNumber: identity.groupNumber,
        status,
        cycle: currentCycleNumber(projected),
        refurbished: machineIsRefurbished(projected),
        updatedBy: OPS_ACTOR,
        refurb: refurbSummary(projected.intake?.refurb),
        dispatchHistory: publicOpsDispatchHistory(projected),
      },
      write,
    },
    "refurbish",
    machine,
    payload,
    now
  );
}

// Pure handler. `expectedKey` is OPS_WRITE_API_KEY only — callers must not
// pass the orders key or the machines read key. Comparison is keysMatch.
export function handleOpsHttp({
  method,
  urlPath,
  headers,
  query,
  body,
  expectedKey,
  machines,
  orders,
  order,
  now,
  maxPhotoBytes,
}) {
  if (!keysMatch(expectedKey, presentedApiKey(headers))) {
    return {
      status: 401,
      body: { ok: false, error: "Missing or invalid API key. Send X-API-Key or Authorization: Bearer." },
    };
  }

  const route = matchOpsRoute(urlPath);
  if (route.action === "unknown") return reject(404, "No route matches that path.");

  const verb = text(method || "GET").toUpperCase();
  const allow = allowedMethod(route.action);
  if (verb !== allow) {
    return {
      status: 405,
      allow,
      body: { ok: false, error: `Ops API does not allow ${verb} on this path. Use ${allow}.` },
    };
  }

  if (route.action === "machines") {
    const parsed = parseOpsMachineQuery(query);
    if (parsed.error) return reject(400, parsed.error);
    return { status: 200, body: { ok: true, ...listOpsMachines(machines, orders, parsed) } };
  }

  if (route.action === "assign") {
    return planAssign({ groupNumber: route.address.groupNumber, body, machines, orders });
  }

  const resolved = resolveAddress(route, machines, order);
  if (resolved.status) return resolved;
  const { machine } = resolved;
  const linkedOrder = resolved.order;
  const clock = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();

  if (route.action === "lookup") {
    return {
      status: 200,
      body: { ok: true, ...publicIdentity(machine, linkedOrder) },
    };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reject(400, "Send a JSON object.");
  }

  if (route.action === "dispatch") return planDispatch(machine, body, clock, linkedOrder);
  if (route.action === "install") return planInstall(machine, body, clock, linkedOrder, route.address);
  if (route.action === "return") return planOpsReturn(machine, body, clock, linkedOrder);
  if (route.action === "refurbish") return planOpsRefurbish(machine, body, clock, linkedOrder);
  return planPhoto(
    machine,
    body,
    clock,
    linkedOrder,
    route.address,
    Number.isFinite(maxPhotoBytes) ? maxPhotoBytes : MAX_INSTALLATION_PHOTO_BYTES
  );
}
