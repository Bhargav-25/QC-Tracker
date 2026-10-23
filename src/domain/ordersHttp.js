import {
  ORDER_PAYMENTS,
  ORDER_STATUSES,
  blankOrder,
  canonicalOrderStatus,
  canonicalPayment,
  groupNumberToId,
  isSafeGroupId,
  normalizeGroupNumber,
  toIsoDate,
} from "./orderModel.js";

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

// Pure request handler. `existing` is the current order or null.
// Create is idempotent on group number: a second POST returns the stored
// order and does not overwrite it. Changes go through PATCH.
export function handleOrdersHttp({ method, urlPath, body, existing }) {
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
    return reject(405, "Use POST to create an order.");
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
