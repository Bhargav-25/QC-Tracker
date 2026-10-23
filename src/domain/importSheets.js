import {
  blankOrder,
  canonicalOrderStatus,
  canonicalPayment,
  cellText,
  contactToString,
  normalizeCustomerName,
  normalizeGroupNumber,
  toIsoDate,
} from "./orderModel.js";

function normHeader(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

const ORDER_HEADER_KEYS = {
  "group no": "groupNumber",
  status: "status",
  payment: "payment",
  "order date": "orderDate",
  customer: "customer",
  city: "city",
  address: "address",
  contact: "contact",
  tab: "tab",
  accessories: "accessories",
  hanger: "hanger",
  bench: "bench",
  "glass/metal": "glassMetal",
  warranty: "warranty",
  "order type": "orderType",
  "shipping date": "shippingDate",
  "payment status": "paymentStatus",
  smartr: "smartr",
  safexpress: "safexpress",
  "acc status": "accStatus",
  "acc tracking": "accTracking",
  "installation pending": "installationPending",
  "installation date": "installationDate",
  "warranty period": "warrantyPeriod",
};

function rowIsBlank(row) {
  return !(row || []).some((cell) => cell != null && String(cell).trim() !== "");
}

export function findOrdersHeader(rows) {
  const limit = Math.min(rows.length, 10);
  for (let i = 0; i < limit; i += 1) {
    const cells = (rows[i] || []).map(normHeader);
    if (cells.includes("group no")) return i;
  }
  return -1;
}

export function headerIndexMap(headerRow) {
  const index = {};
  let commentsSeen = 0;
  (headerRow || []).forEach((cell, i) => {
    const name = normHeader(cell);
    if (!name) return;
    if (name === "comments") {
      commentsSeen += 1;
      index[commentsSeen === 1 ? "comments" : "sheetComments"] = i;
      return;
    }
    const key = ORDER_HEADER_KEYS[name];
    if (key && index[key] == null) index[key] = i;
  });
  return index;
}

function pick(row, index, key) {
  const i = index[key];
  if (i == null) return "";
  return row[i];
}

export function orderFromSheetRow(row, index, sheetRow) {
  const groupNumber = normalizeGroupNumber(pick(row, index, "groupNumber"));
  const rawStatus = cellText(pick(row, index, "status"));
  const rawPayment = cellText(pick(row, index, "payment"));
  const salesStatus = canonicalOrderStatus(rawStatus);
  const payment = canonicalPayment(rawPayment) || rawPayment;
  const warrantyPeriodRaw = pick(row, index, "warrantyPeriod");
  let warrantyPeriod = "";
  if (typeof warrantyPeriodRaw === "number" && Number.isFinite(warrantyPeriodRaw)) {
    warrantyPeriod = warrantyPeriodRaw;
  } else if (warrantyPeriodRaw != null && String(warrantyPeriodRaw).trim() !== "") {
    const n = Number(warrantyPeriodRaw);
    warrantyPeriod = Number.isFinite(n) ? n : "";
  }

  return blankOrder(groupNumber, {
    status: salesStatus,
    sheetStatus: rawStatus,
    payment,
    orderDate: toIsoDate(pick(row, index, "orderDate")),
    customer: cellText(pick(row, index, "customer")),
    comments: cellText(pick(row, index, "comments")),
    city: cellText(pick(row, index, "city")),
    address: cellText(pick(row, index, "address")),
    contact: contactToString(pick(row, index, "contact")),
    tab: cellText(pick(row, index, "tab")),
    accessories: cellText(pick(row, index, "accessories")),
    hanger: cellText(pick(row, index, "hanger")),
    bench: cellText(pick(row, index, "bench")),
    glassMetal: cellText(pick(row, index, "glassMetal")),
    warranty: cellText(pick(row, index, "warranty")),
    orderType: cellText(pick(row, index, "orderType")),
    paymentStatus: cellText(pick(row, index, "paymentStatus")),
    shippingDate: toIsoDate(pick(row, index, "shippingDate")),
    smartr: cellText(pick(row, index, "smartr")),
    safexpress: cellText(pick(row, index, "safexpress")),
    accStatus: cellText(pick(row, index, "accStatus")),
    accTracking: cellText(pick(row, index, "accTracking")),
    installationPending: cellText(pick(row, index, "installationPending")),
    installationDate: toIsoDate(pick(row, index, "installationDate")),
    sheetComments: cellText(pick(row, index, "sheetComments")),
    warrantyPeriod,
    sheetRow,
  });
}

function sameIdentity(a, b) {
  const keys = ["customer", "status", "payment", "city", "contact", "address", "orderDate"];
  return keys.every((key) => String(a[key] || "").trim() === String(b[key] || "").trim());
}

// Turns the orders worksheet (including the owner row and the header row)
// into order documents. Duplicate group numbers are not merged by guessing:
// identical repeats keep one row, conflicting repeats are skipped and reported.
export function parseOrdersMatrix(rows) {
  const headerIndex = findOrdersHeader(rows);
  if (headerIndex < 0) {
    throw new Error('Could not find a "Group No" header on the orders sheet.');
  }
  const index = headerIndexMap(rows[headerIndex]);
  if (index.groupNumber == null) {
    throw new Error("The orders header row has no Group No column.");
  }

  const grouped = new Map();
  const issues = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    if (rowIsBlank(row)) continue;
    const parsed = orderFromSheetRow(row, index, i + 1);
    if (!parsed.groupNumber) {
      issues.push({ reason: "blank group number", row: i + 1 });
      continue;
    }
    const list = grouped.get(parsed.groupNumber) || [];
    list.push(parsed);
    grouped.set(parsed.groupNumber, list);
  }

  const orders = [];
  for (const [groupNumber, list] of grouped) {
    if (list.length === 1) {
      orders.push(list[0]);
      continue;
    }
    const identical = list.every((row) => sameIdentity(row, list[0]));
    if (identical) {
      orders.push(list[0]);
      issues.push({
        reason: "duplicate group number with the same customer; kept one row",
        groupNumber,
        rows: list.map((row) => row.sheetRow),
      });
      continue;
    }
    issues.push({
      reason: "duplicate group number with different customers; skipped",
      groupNumber,
      rows: list.map((row) => row.sheetRow),
      customers: list.map((row) => row.customer),
    });
  }

  return { orders, issues, headerIndex };
}

// Machine numbers in the batch tabs look like X33M002.
const MACHINE_NUMBER = /^X\d{2}M\d{3,4}$/i;

export function normalizeMachineNumber(value) {
  const text = String(value || "").replace(/[\u202a\u202c\u200e\u200f]/g, "").trim().toUpperCase();
  if (!MACHINE_NUMBER.test(text)) return "";
  return text;
}

export function findMachineHeader(rows) {
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i += 1) {
    const cells = (rows[i] || []).map(normHeader);
    const hasCustomer = cells.some((cell) => cell === "customer" || cell === "custormer");
    const hasMachine = cells.some((cell) => cell.includes("machine") && !cell.includes("customer"));
    const hasStatus = cells.some((cell) => cell === "status");
    if (hasCustomer && (hasMachine || hasStatus)) return i;
  }
  return -1;
}

export function parseMachineSheet(sheetName, rows) {
  if (!/^batch\b/i.test(String(sheetName || ""))) {
    return { sheet: sheetName, skipped: true, reason: "not a batch tab", machines: [], skippedRows: [] };
  }
  const headerIndex = findMachineHeader(rows);
  if (headerIndex < 0) {
    return {
      sheet: sheetName,
      skipped: true,
      reason: "no customer header",
      machines: [],
      skippedRows: [],
    };
  }
  const header = (rows[headerIndex] || []).map(normHeader);
  const findCol = (pred) => header.findIndex(pred);
  const customerCol = findCol((cell) => cell === "customer" || cell === "custormer");
  let machineCol = findCol((cell) => cell.includes("machine") && !cell.includes("customer"));
  const cityCol = findCol((cell) => cell === "city");
  const contactCol = findCol((cell) => cell.includes("contact"));
  if (machineCol < 0) machineCol = 0;

  const machines = [];
  const skippedRows = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    if (rowIsBlank(row)) continue;
    const machineNumber = normalizeMachineNumber(row[machineCol])
      || normalizeMachineNumber(row[0])
      || normalizeMachineNumber(row[1]);
    const customer = customerCol >= 0 ? cellText(row[customerCol]).replace(/[\u202a\u202c\u200e\u200f]/g, "").trim() : "";
    if (!machineNumber) {
      if (customer) {
        skippedRows.push({
          sheet: sheetName,
          row: i + 1,
          customer,
          reason: "no machine number",
        });
      }
      continue;
    }
    if (!customer) {
      skippedRows.push({
        sheet: sheetName,
        row: i + 1,
        machineNumber,
        reason: "no customer on the batch row",
      });
      continue;
    }
    machines.push({
      sheet: sheetName,
      row: i + 1,
      machineNumber,
      customer,
      city: cityCol >= 0 ? cellText(row[cityCol]) : "",
      contact: contactCol >= 0 ? contactToString(row[contactCol]) : "",
    });
  }
  return { sheet: sheetName, skipped: false, machines, skippedRows };
}

// Link a batch-tab row to an order only when the customer name matches
// exactly one order AND that order matches exactly one machine. Everything
// else is reported and left unlinked.
export function matchMachinesToOrders(orders, machineRows) {
  const byName = new Map();
  for (const order of orders) {
    const name = normalizeCustomerName(order.customer);
    if (!name) continue;
    const list = byName.get(name) || [];
    list.push(order);
    byName.set(name, list);
  }

  const unmatched = [];
  const candidates = [];
  const seenMachines = new Map();

  for (const row of machineRows) {
    const prior = seenMachines.get(row.machineNumber) || [];
    prior.push(row);
    seenMachines.set(row.machineNumber, prior);
  }

  for (const row of machineRows) {
    const copies = seenMachines.get(row.machineNumber) || [];
    if (copies.length > 1) {
      unmatched.push({
        ...row,
        reason: "machine number appears on more than one batch row",
        alsoOn: copies.map((copy) => `${copy.sheet} row ${copy.row}`),
      });
      continue;
    }
    const name = normalizeCustomerName(row.customer);
    const matches = byName.get(name) || [];
    if (matches.length === 0) {
      unmatched.push({ ...row, reason: "no order with this customer" });
      continue;
    }
    if (matches.length > 1) {
      unmatched.push({
        ...row,
        reason: "customer matches more than one order",
        candidateGroupNumbers: matches.map((order) => order.groupNumber),
      });
      continue;
    }
    candidates.push({ machine: row, order: matches[0] });
  }

  const byOrder = new Map();
  for (const pair of candidates) {
    const list = byOrder.get(pair.order.groupNumber) || [];
    list.push(pair);
    byOrder.set(pair.order.groupNumber, list);
  }

  const links = [];
  for (const [, pairs] of byOrder) {
    if (pairs.length === 1) {
      links.push({
        groupNumber: pairs[0].order.groupNumber,
        machineNumber: pairs[0].machine.machineNumber,
        customer: pairs[0].machine.customer,
        sheet: pairs[0].machine.sheet,
        row: pairs[0].machine.row,
      });
      continue;
    }
    for (const pair of pairs) {
      unmatched.push({
        ...pair.machine,
        reason: "more than one machine matches this order's customer",
        groupNumber: pair.order.groupNumber,
        otherMachines: pairs.map((item) => item.machine.machineNumber),
      });
    }
  }

  return { links, unmatched };
}
