import {
  ORDER_PAYMENTS,
  ORDER_STATUSES,
  blankOrder,
  canonicalOrderStatus,
  canonicalPayment,
  groupNumberToId,
  isSafeGroupId,
  machineForOrder,
  normalizeGroupNumber,
  toIsoDate,
} from "./orderModel.js";
import { computeStatus } from "../utils/status.js";

// Fields a sales bot may set. Machine assignment stays in the app
// (Production / Admin), so machineId, machineNumber, and fulfillmentStatus
// are not writable here. Maintenance tickets can later hang off the same
// router as another resource — see functions/index.js.
export const ORDER_WRITE_FIELDS = [
  "status",
  "payment",
  "orderDate",
  "customer",
  "comments",
  "city",
  "address",
  "contact",
  "tab",
  "accessories",
  "hanger",
  "bench",
  "glassMetal",
  "warranty",
  "orderType",
  "paymentStatus",
  "shippingDate",
  "smartr",
  "safexpress",
  "accStatus",
  "accTracking",
  "installationPending",
  "installationDate",
  "sheetComments",
];

const DATE_FIELDS = new Set(["orderDate", "shippingDate", "installationDate"]);

function asText(value) {
  if (value == null) return "";
  return String(value);
}

export function normalizeRoutePath(urlPath) {
  const raw = String(urlPath || "/").split("?")[0];
  const trimmed = raw.replace(/\/+$/, "") || "/";
  const withoutApi = trimmed.replace(/^\/api(?=\/|$)/, "") || "/";
  return withoutApi;
}

// parts after the optional /v1: ["orders"] or ["orders", "G1458"]
export function matchOrdersRoute(urlPath) {
  const path = normalizeRoutePath(urlPath);
  const parts = path.split("/").filter(Boolean);
  const head = parts[0] === "v1" ? parts.slice(1) : parts;
  if (head.length === 0) return { kind: "index" };
  if (head[0] !== "orders") return { kind: "unknown", resource: head[0] };
  if (head.length === 1) return { kind: "collection" };
  if (head.length === 2) {
    let group = head[1];
    try {
      group = decodeURIComponent(group);
    } catch {
      // keep the raw segment
    }
    return { kind: "document", groupNumber: normalizeGroupNumber(group) };
  }
  return { kind: "unknown", resource: "orders" };
}

function reject(status, error) {
  return { status, body: { ok: false, error } };
}

function cleanWrite(input, { partial }) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Request body must be a JSON object." };
  }
  const unknown = Object.keys(input).filter((key) => key !== "groupNumber" && !ORDER_WRITE_FIELDS.includes(key));
  if (unknown.length) {
    return { error: `Unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.` };
  }
  const value = {};
  for (const key of ORDER_WRITE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const raw = input[key];
    if (raw != null && typeof raw === "object") {
      return { error: `${key} must be a string.` };
    }
    if (key === "status") {
      const status = canonicalOrderStatus(raw);
      if (!status) {
        return { error: `status must be one of: ${ORDER_STATUSES.join(", ")}.` };
      }
      value.status = status;
      // A sales-status write replaces the historical sheet label.
      value.sheetStatus = "";
      continue;
    }
    if (key === "payment") {
      const payment = canonicalPayment(raw);
      if (!payment) {
        return { error: `payment must be one of: ${ORDER_PAYMENTS.join(", ")}.` };
      }
      value.payment = payment;
      continue;
    }
    if (DATE_FIELDS.has(key)) {
      const iso = raw == null || raw === "" ? "" : toIsoDate(raw);
      if (raw != null && raw !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        return { error: `${key} must be a date (YYYY-MM-DD).` };
      }
      value[key] = iso;
      continue;
    }
    value[key] = asText(raw).trim();
  }
  if (!partial) {
    if (!Object.prototype.hasOwnProperty.call(input, "groupNumber")) {
      return { error: "groupNumber is required." };
    }
  }
  return { value };
}

export function publicOrder(order) {
  if (!order) return null;
  const rest = { ...order };
  delete rest.sheetRow;
  return rest;
}

// One document per group. The list is filtered in memory, so no composite
// Firestore index is required.
export const ORDER_LIST_DEFAULT_LIMIT = 200;
export const ORDER_LIST_MAX_LIMIT = 500;

const ORDER_LIST_KEYS = [
  "groupNumber",
  "customer",
  "city",
  "status",
  "payment",
  "shippingDate",
  "smartr",
  "safexpress",
  "accTracking",
  "installationPending",
  "installationDate",
  "machineNumber",
  "machineStatus",
  "createdAt",
  "updatedAt",
];

function timeMillis(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  return null;
}

function toIsoTimestamp(value) {
  if (typeof value === "string") return timeMillis(value) == null ? null : value;
  const ms = timeMillis(value);
  return ms == null ? null : new Date(ms).toISOString();
}

function salesStatus(order) {
  return canonicalOrderStatus(order?.status) || (ORDER_STATUSES.includes(order?.status) ? order.status : "");
}

function parseUpdatedSince(text) {
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(text)) {
    return null;
  }
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

function statusTokens(query) {
  const raw = query?.status;
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

export function parseOrdersListQuery(query) {
  const rawLimit = query?.limit;
  const limitText = (Array.isArray(rawLimit) ? rawLimit[0] : rawLimit) == null
    ? ""
    : String(Array.isArray(rawLimit) ? rawLimit[0] : rawLimit).trim();
  let limit = ORDER_LIST_DEFAULT_LIMIT;
  if (limitText) {
    if (!/^\d+$/.test(limitText) || Number(limitText) < 1) {
      return { error: `limit must be a whole number from 1 to ${ORDER_LIST_MAX_LIMIT}.` };
    }
    limit = Math.min(Number(limitText), ORDER_LIST_MAX_LIMIT);
  }

  const rawSince = query?.updatedSince;
  const sinceText = (Array.isArray(rawSince) ? rawSince[0] : rawSince) == null
    ? ""
    : String(Array.isArray(rawSince) ? rawSince[0] : rawSince).trim();
  let updatedSince = null;
  if (sinceText) {
    const ms = parseUpdatedSince(sinceText);
    if (ms == null) return { error: "updatedSince must be an ISO date or date-time." };
    updatedSince = ms;
  }

  const present = query != null && Object.prototype.hasOwnProperty.call(query, "status");
  const tokens = statusTokens(query);
  const statuses = [];
  if (present) {
    if (!tokens.length) {
      return { error: `status must be one of: ${ORDER_STATUSES.join(", ")}.` };
    }
    for (const token of tokens) {
      const canonical = canonicalOrderStatus(token);
      if (!canonical) {
        return { error: `status must be one of: ${ORDER_STATUSES.join(", ")}.` };
      }
      if (!statuses.includes(canonical)) statuses.push(canonical);
    }
  }

  return { limit, updatedSince, statuses };
}

// List shape only. Phone, email, and street address stay off this response.
export function orderListItem(order, machine) {
  const linked = machine || null;
  const machineNumber = asText(linked?.machineNumber).trim() || asText(order?.machineNumber).trim() || null;
  const item = {
    groupNumber: asText(order?.groupNumber).trim(),
    customer: asText(order?.customer).trim(),
    city: asText(order?.city).trim(),
    status: salesStatus(order) || asText(order?.status).trim(),
    payment: canonicalPayment(order?.payment) || asText(order?.payment).trim(),
    shippingDate: asText(order?.shippingDate).trim(),
    smartr: asText(order?.smartr).trim(),
    safexpress: asText(order?.safexpress).trim(),
    accTracking: asText(order?.accTracking).trim(),
    installationPending: asText(order?.installationPending).trim(),
    installationDate: asText(order?.installationDate).trim(),
    machineNumber,
    machineStatus: linked ? computeStatus(linked) : null,
    createdAt: toIsoTimestamp(order?.createdAt),
    updatedAt: toIsoTimestamp(order?.updatedAt),
  };
  return item;
}

function byUpdatedDesc(a, b) {
  const left = timeMillis(a?.updatedAt);
  const right = timeMillis(b?.updatedAt);
  const l = left == null ? -Infinity : left;
  const r = right == null ? -Infinity : right;
  if (l !== r) return r - l;
  const lg = asText(a?.groupNumber);
  const rg = asText(b?.groupNumber);
  if (lg < rg) return -1;
  if (lg > rg) return 1;
  return 0;
}

export function listOrders(orders, machines, { limit, updatedSince, statuses }) {
  let rows = (Array.isArray(orders) ? orders : []).filter((order) => order && typeof order === "object");
  if (statuses?.length) {
    rows = rows.filter((order) => statuses.includes(salesStatus(order)));
  }
  if (updatedSince != null) {
    rows = rows.filter((order) => {
      const ms = timeMillis(order.updatedAt);
      return ms != null && ms >= updatedSince;
    });
  }
  rows.sort(byUpdatedDesc);
  const page = rows.slice(0, limit);
  const items = page.map((order) => orderListItem(order, machineForOrder(order, machines || [])));
  for (const item of items) {
    for (const key of Object.keys(item)) {
      if (!ORDER_LIST_KEYS.includes(key)) delete item[key];
    }
  }
  return { count: items.length, orders: items };
}

// Pure request handler. `existing` is the current order or null.
// Create is idempotent on group number: a second POST returns the stored
// order and does not overwrite it. Changes go through PATCH.
export function handleOrdersHttp({ method, urlPath, query, body, existing, orders, machines }) {
  const route = matchOrdersRoute(urlPath);
  const verb = String(method || "GET").toUpperCase();

  if (route.kind === "index" && verb === "GET") {
    return {
      status: 200,
      body: {
        ok: true,
        resources: ["orders"],
        // Reserved so maintenance tickets can join this API without a new host.
        planned: ["tickets"],
      },
    };
  }

  if (route.kind === "unknown") {
    if (route.resource === "tickets") {
      return reject(501, "Maintenance tickets are not part of this API yet.");
    }
    return reject(404, "No route matches that path.");
  }

  if (route.kind === "collection") {
    if (verb === "GET") {
      const parsed = parseOrdersListQuery(query);
      if (parsed.error) return reject(400, parsed.error);
      return { status: 200, body: { ok: true, ...listOrders(orders, machines, parsed) } };
    }
    if (verb === "POST") {
      const groupNumber = normalizeGroupNumber(body?.groupNumber);
      if (!groupNumber) return reject(400, "groupNumber is required.");
      if (!isSafeGroupId(groupNumber)) return reject(400, "groupNumber cannot be used as an id.");
      if (existing) {
        return { status: 200, body: { ok: true, created: false, order: publicOrder(existing) } };
      }
      const cleaned = cleanWrite(body, { partial: false });
      if (cleaned.error) return reject(400, cleaned.error);
      if (!cleaned.value.status) {
        return reject(400, `status must be one of: ${ORDER_STATUSES.join(", ")}.`);
      }
      if (!cleaned.value.payment) {
        return reject(400, `payment must be one of: ${ORDER_PAYMENTS.join(", ")}.`);
      }
      const order = blankOrder(groupNumber, cleaned.value);
      return {
        status: 201,
        create: true,
        id: groupNumberToId(groupNumber),
        body: { ok: true, created: true, order },
      };
    }
    return reject(405, "Use GET to list orders or POST to create one.");
  }

  if (verb === "GET") {
    if (!existing) return reject(404, `No order ${route.groupNumber}.`);
    return { status: 200, body: { ok: true, order: publicOrder(existing) } };
  }

  if (verb === "PATCH" || verb === "PUT") {
    if (!existing) return reject(404, `No order ${route.groupNumber}.`);
    const cleaned = cleanWrite(body, { partial: true });
    if (cleaned.error) return reject(400, cleaned.error);
    if (!Object.keys(cleaned.value).length) return reject(400, "Provide at least one field to update.");
    const order = { ...existing, ...cleaned.value, groupNumber: existing.groupNumber };
    return {
      status: 200,
      update: cleaned.value,
      id: groupNumberToId(existing.groupNumber),
      body: { ok: true, order: publicOrder(order) },
    };
  }

  return reject(405, "Use GET, PATCH, or PUT for an order.");
}
