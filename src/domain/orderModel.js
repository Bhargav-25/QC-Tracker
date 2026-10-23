import { STATUS } from "../constants.js";
import { computeStatus } from "../utils/status.js";

// Sales workflow on the order itself. Once a machine is linked, the badge
// shown in the app comes from that machine's computed status instead.
export const ORDER_STATUSES = ["Pause Shipment", "Please Ship", "Cancelled"];

export const ORDER_PAYMENTS = ["Paid", "Advance", "COD", "Cancelled"];

export const COURIERS = ["Smartr", "Safexpress", "Delhivery", "Other"];

export const ACCESSORY_SHIP_STATUSES = ["Not sent", "In transit", "Delivered"];

export const FULFILLMENT_STATUSES = [
  STATUS.PACKED,
  STATUS.DISPATCHED,
  STATUS.DELIVERED,
  STATUS.INSTALLED,
];

// Firestore document ids cannot contain "/". A handful of historical group
// numbers do (G338/9). "~" is the reversible stand-in; the real group number
// is always stored on the document as `groupNumber`.
export function groupNumberToId(groupNumber) {
  return String(groupNumber || "").trim().split("/").join("~");
}

export function normalizeGroupNumber(value) {
  return String(value || "").replace(/[\u202a\u202c\u200e\u200f]/g, "").trim();
}

export function isSafeGroupId(groupNumber) {
  const id = groupNumberToId(groupNumber);
  if (!id || id === "." || id === "..") return false;
  if (id.includes("/")) return false;
  return id.length <= 700;
}

const STATUS_CANONICAL = {
  "pause shipment": "Pause Shipment",
  "please ship": "Please Ship",
  cancelled: "Cancelled",
  canceled: "Cancelled",
};

const PAYMENT_CANONICAL = {
  paid: "Paid",
  advance: "Advance",
  cod: "COD",
  cancelled: "Cancelled",
  canceled: "Cancelled",
};

export function canonicalOrderStatus(value) {
  const key = String(value || "").trim().toLowerCase();
  return STATUS_CANONICAL[key] || "";
}

export function canonicalPayment(value) {
  const key = String(value || "").trim().toLowerCase();
  return PAYMENT_CANONICAL[key] || "";
}

export function blankOrder(groupNumber, extras = {}) {
  return {
    groupNumber: normalizeGroupNumber(groupNumber),
    status: "Please Ship",
    // Original "Move to this slowly" Status cell, kept so the sheet mirror
    // does not rewrite historical Installed/Shipped rows until a machine is
    // linked or someone sets a sales status in the app.
    sheetStatus: "",
    payment: "Paid",
    orderDate: "",
    customer: "",
    comments: "",
    city: "",
    address: "",
    contact: "",
    tab: "No",
    accessories: "No",
    hanger: "No",
    bench: "NONE",
    glassMetal: "Metal",
    warranty: "Default, 1 year total warranty",
    orderType: "",
    paymentStatus: "",
    machineId: "",
    machineNumber: "",
    fulfillmentStatus: "",
    shippingDate: "",
    smartr: "",
    safexpress: "",
    accStatus: "",
    accTracking: "",
    installationPending: "",
    installationDate: "",
    sheetComments: "",
    warrantyPeriod: "",
    ...extras,
  };
}

export function machineForOrder(order, machines) {
  if (!order || !Array.isArray(machines)) return null;
  if (order.machineId) {
    const byId = machines.find((m) => m.id === order.machineId);
    if (byId) return byId;
  }
  if (order.machineNumber) {
    const byNumber = machines.find((m) => m.machineNumber === order.machineNumber);
    if (byNumber) return byNumber;
  }
  if (order.groupNumber) {
    return machines.find((m) => m.groupNumber === order.groupNumber) || null;
  }
  return null;
}

// Badge on the orders list and order page.
// Cancelled wins. A linked machine in Packed/Dispatched/Delivered/Installed
// wins over the sales status. Otherwise the sales status, or the historical
// sheet status when this order was imported from a non-sales value.
export function displayOrderStatus(order, machine) {
  if (!order) return "";
  const sales = canonicalOrderStatus(order.status) || (ORDER_STATUSES.includes(order.status) ? order.status : "");
  if (sales === "Cancelled" || canonicalOrderStatus(order.sheetStatus) === "Cancelled") {
    return "Cancelled";
  }
  const linked = machine || null;
  if (linked) {
    const computed = computeStatus(linked);
    if (FULFILLMENT_STATUSES.includes(computed)) return computed;
  }
  if ((order.machineId || order.machineNumber) && FULFILLMENT_STATUSES.includes(order.fulfillmentStatus)) {
    return order.fulfillmentStatus;
  }
  if (sales) return sales;
  if (order.sheetStatus) return String(order.sheetStatus);
  return order.status || "";
}

export function orderHasMachine(order) {
  return Boolean(order?.machineId || order?.machineNumber);
}

export function normalizeCustomerName(value) {
  return String(value || "")
    .replace(/[\u202a\u202c\u200e\u200f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function contactToString(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.round(value));
  }
  return String(value).replace(/[\u202a\u202c\u200e\u200f]/g, "").trim();
}

export function maskContact(contact) {
  const digits = contactToString(contact).replace(/\D/g, "");
  if (digits.length < 6) return contactToString(contact);
  const first = digits.slice(0, 5);
  const last = digits.slice(-2);
  return `${first} ···${last}`;
}

export function telHref(contact) {
  const digits = contactToString(contact).replace(/\D/g, "");
  return digits ? `tel:${digits}` : "";
}

export function toIsoDate(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial date (1900 system). 25569 = 1970-01-01.
    const utc = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (Number.isNaN(utc.getTime())) return "";
    return utc.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime()) && /\d/.test(text)) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return text;
}

export function formatDisplayDate(iso) {
  if (!iso) return "";
  const text = String(iso);
  const d = new Date(text.length === 10 ? `${text}T00:00:00` : text);
  if (Number.isNaN(d.getTime())) return text;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function isYes(value) {
  const v = String(value || "").trim().toLowerCase();
  return v === "yes" || v === "y";
}

export function sheetYesNo(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "yes" || v === "y") return "YES";
  if (v === "no" || v === "n") return "NO";
  if (!v) return "";
  return String(value).trim();
}

export function displayYesNo(value) {
  const sheet = sheetYesNo(value);
  if (sheet === "YES") return "Yes";
  if (sheet === "NO") return "No";
  return sheet;
}

export function displayBench(value) {
  const text = String(value || "").trim();
  if (!text) return "—";
  if (text.toLowerCase() === "none") return "None";
  return text;
}

export function warrantyYears(warranty, fallback = "") {
  const text = String(warranty || "");
  const total = text.match(/(\d+)\s*year total/i);
  if (total) return Number(total[1]);
  const any = text.match(/(\d+)\s*year/i);
  if (any) return Number(any[1]);
  return fallback === "" || fallback == null ? "" : fallback;
}

export function shortWarranty(warranty) {
  const years = warrantyYears(warranty, "");
  if (years === "" || years == null) return "";
  return `${years}yr warranty`;
}

export function orderAddonSummary(order) {
  if (!order) return "";
  const parts = [];
  if (isYes(order.accessories)) parts.push("Accessories");
  if (isYes(order.hanger)) parts.push("Hanger");
  if (isYes(order.tab)) parts.push("Tab");
  const bench = String(order.bench || "").trim();
  if (bench && bench.toLowerCase() !== "none") parts.push(bench);
  const glass = String(order.glassMetal || "").split(",")[0].trim();
  if (glass) parts.push(glass);
  const warranty = shortWarranty(order.warranty);
  if (warranty) parts.push(warranty);
  return parts.join(" · ");
}

export function cellText(value) {
  if (value == null) return "";
  return String(value).trim();
}
