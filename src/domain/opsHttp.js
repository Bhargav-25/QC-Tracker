import { createHash } from "node:crypto";
import { INSTALLATION_PHOTO_COUNT, emptyDispatch, emptyInstallation } from "../constants.js";
import { keysMatch, presentedApiKey } from "./apiKey.js";
import {
  FULFILLMENT_STATUSES,
  isSafeGroupId,
  normalizeGroupNumber,
} from "./orderModel.js";
import { computeStatus } from "../utils/status.js";

// Ops write API. Kept out of machinesHttp.js and ordersHttp.js so the
// read-only inventory API and the returns/refurb work can change on their
// own. This module never writes; functions/opsApi.js applies `write` / `upload`.

export const OPS_ACTOR = "ops-api";
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

// `action` is lookup | dispatch | install | photos.
export function matchOpsRoute(urlPath) {
  const path = normalizeOpsPath(urlPath);
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[0] === "groups") {
    const groupNumber = normalizeGroupNumber(decodeSegment(parts[1]));
    if (parts.length === 2) return { action: "lookup", address: { type: "group", groupNumber } };
    if (parts.length === 3 && parts[2] === "dispatch") {
      return { action: "dispatch", address: { type: "group", groupNumber } };
    }
    if (parts.length === 3 && parts[2] === "installation") {
      return { action: "install", address: { type: "group", groupNumber } };
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
    auditAction: prior.dispatched ? "updated dispatch" : "marked dispatched",
  };
  const projected = applyOpsWrite(machine, write, now.toISOString());
  const status = computeStatus(projected);
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
    auditAction: prior.installed ? "updated installation" : "marked installed",
  };
  const projected = applyOpsWrite(machine, write, now.toISOString());
  const status = computeStatus(projected);
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
      auditAction: "uploaded installation photo",
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
  return action === "lookup" ? "GET" : "POST";
}

// Pure handler. `expectedKey` is OPS_WRITE_API_KEY only — callers must not
// pass the orders key or the machines read key. Comparison is keysMatch.
export function handleOpsHttp({
  method,
  urlPath,
  headers,
  body,
  expectedKey,
  machines,
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
  return planPhoto(
    machine,
    body,
    clock,
    linkedOrder,
    route.address,
    Number.isFinite(maxPhotoBytes) ? maxPhotoBytes : MAX_INSTALLATION_PHOTO_BYTES
  );
}
