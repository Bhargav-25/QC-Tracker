// Pure part-movement planning. Firestore writes the result in one transaction.
// Undo appends a reversing row (negative qty, reversal: true). Nothing is deleted.

import { currentCycleNumber } from "./machineCycle.js";

export const PART_MOVEMENT_TYPES = [
  "NEW_PART_USED",
  "REVIVED_PART_USED",
  "SENT_TO_REVIVE",
  "REVIVED_TO_STOCK",
  "SCRAPPED",
];

export const FIT_SOURCES = ["New", "Revived"];
export const REMOVED_DISPOSITIONS = ["Scrap", "Revive"];

export function roundQty(value) {
  const qty = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(qty)) return NaN;
  return Math.round(qty * 1000) / 1000;
}

export function parsePartQty(raw, unit) {
  const qty = roundQty(raw);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("Quantity must be greater than 0.");
  if (unit === "pcs") {
    if (!Number.isInteger(qty)) throw new Error("Piece quantities must be whole numbers.");
    return qty;
  }
  if (unit === "mtr") return qty;
  throw new Error("Unknown unit. Use pcs or mtr.");
}

export function applyStockDelta(stock, delta) {
  const next = roundQty(roundQty(stock || 0) + roundQty(delta || 0));
  if (!Number.isFinite(next) || next < -0.0005) {
    throw new Error("Not enough revived stock.");
  }
  return next < 0 ? 0 : next;
}

export function applyCountDelta(count, delta) {
  const next = Math.round(Number(count || 0) + Number(delta || 0));
  return next < 0 ? 0 : next;
}

export function movementDoc({
  id,
  type,
  partCode,
  qty,
  machineNumber,
  cycle,
  user,
  reversal = false,
  reversesId = "",
}) {
  if (!PART_MOVEMENT_TYPES.includes(type)) throw new Error(`Unknown movement type ${type}.`);
  const amount = roundQty(qty);
  if (!Number.isFinite(amount) || amount === 0) throw new Error("Movement qty cannot be 0.");
  if (reversal && amount > 0) throw new Error("A reversing movement has a negative qty.");
  if (!reversal && amount < 0) throw new Error("Qty is negative only on a reversing movement.");
  return {
    id,
    type,
    partCode: String(partCode || "").trim(),
    qty: amount,
    machineNumber: String(machineNumber || ""),
    cycle: Number(cycle) || 0,
    user: String(user || ""),
    reversal: Boolean(reversal),
    reversesId: reversesId || "",
  };
}

function fitType(source) {
  return source === "Revived" ? "REVIVED_PART_USED" : "NEW_PART_USED";
}

function removedType(disposition) {
  return disposition === "Revive" ? "SENT_TO_REVIVE" : "SCRAPPED";
}

export function planRefurbLine({ part, qty, source, disposition, machine, user, ids }) {
  if (!machine?.intake) throw new Error("Record a return before logging replaced parts.");
  if (machine.intake.refurb?.completedAt) throw new Error("Refurbishment is already complete.");
  if (!part?.code) throw new Error("Choose a part.");
  if (!FIT_SOURCES.includes(source)) throw new Error("Fitted part source must be New or Revived.");
  if (!REMOVED_DISPOSITIONS.includes(disposition)) {
    throw new Error("Removed part must be Scrap or Revive queue.");
  }
  const unit = part.unit === "mtr" ? "mtr" : part.unit === "pcs" ? "pcs" : null;
  if (!unit) throw new Error(`Part ${part.code} has no unit.`);
  const amount = parsePartQty(qty, unit);
  if (disposition === "Revive" && part.revivable !== true) {
    throw new Error(`${part.code} is not revivable. Scrap the removed part instead.`);
  }
  const stock = roundQty(part.revivedStock || 0);
  if (source === "Revived" && stock + 0.0005 < amount) {
    const available = Number.isFinite(stock) ? stock : 0;
    throw new Error(`No revived ${part.code} left in stock (${available} available).`);
  }

  const cycle = currentCycleNumber(machine);
  const machineNumber = machine.machineNumber || "";
  const base = { partCode: part.code, machineNumber, cycle, user };
  const movements = [
    movementDoc({ id: ids.fit, type: fitType(source), qty: amount, ...base }),
  ];
  let reviveItem = null;
  if (disposition === "Revive") {
    reviveItem = {
      id: ids.revive,
      partCode: part.code,
      partName: part.name || "",
      group: part.group || "",
      unit,
      qty: amount,
      machineNumber,
      machineId: machine.id || "",
      cycle,
      refurbLineId: ids.line,
      status: "queued",
      sentMovementId: ids.removed,
      resolvedMovementId: "",
      createdBy: user || "",
    };
    movements.push(movementDoc({ id: ids.removed, type: "SENT_TO_REVIVE", qty: amount, ...base }));
  } else {
    movements.push(movementDoc({ id: ids.removed, type: "SCRAPPED", qty: amount, ...base }));
  }

  const line = {
    id: ids.line,
    partCode: part.code,
    partName: part.name || "",
    group: part.group || "",
    unit,
    qty: amount,
    source,
    disposition,
    cycle,
    fitMovementId: ids.fit,
    removedMovementId: ids.removed,
    reviveItemId: reviveItem?.id || "",
    undone: false,
    createdBy: user || "",
  };

  return {
    line,
    movements,
    reviveItem,
    stockDelta: source === "Revived" ? -amount : 0,
    queueDelta: reviveItem ? 1 : 0,
  };
}

export function planUndoRefurbLine({ machine, lineId, reviveItem, user, ids }) {
  const lines = machine?.intake?.refurb?.lines || [];
  const line = lines.find((item) => item && item.id === lineId);
  if (!line) throw new Error("That refurb line is not on this machine.");
  if (line.undone) throw new Error("That refurb line is already undone.");
  if (line.disposition === "Revive") {
    const status = reviveItem?.status || "queued";
    if (status !== "queued" && status !== "reversed") {
      throw new Error("That removed part has already left the revive queue. Undo the queue result first.");
    }
  }

  const base = {
    partCode: line.partCode,
    machineNumber: machine.machineNumber || "",
    cycle: Number(line.cycle) || currentCycleNumber(machine),
    user,
    reversal: true,
  };
  const movements = [
    movementDoc({
      id: ids.fit,
      type: fitType(line.source),
      qty: -roundQty(line.qty),
      reversesId: line.fitMovementId || "",
      ...base,
    }),
    movementDoc({
      id: ids.removed,
      type: removedType(line.disposition),
      qty: -roundQty(line.qty),
      reversesId: line.removedMovementId || "",
      ...base,
    }),
  ];

  return {
    movements,
    stockDelta: line.source === "Revived" ? roundQty(line.qty) : 0,
    queueDelta: line.disposition === "Revive" && reviveItem?.status === "queued" ? -1 : 0,
    reverseRevive: line.disposition === "Revive",
    nextLines: lines.map((item) =>
      item.id === lineId ? { ...item, undone: true, undoneBy: user || "" } : item
    ),
  };
}

export function planResolveRevive({ item, outcome, user, id }) {
  if (!item) throw new Error("That revive-queue item no longer exists.");
  if (item.status !== "queued") throw new Error("That part is no longer in the revive queue.");
  if (outcome !== "revived" && outcome !== "failed") throw new Error("Choose Revived or Failed.");
  const qty = roundQty(item.qty);
  return {
    movement: movementDoc({
      id,
      type: outcome === "revived" ? "REVIVED_TO_STOCK" : "SCRAPPED",
      partCode: item.partCode,
      qty,
      machineNumber: item.machineNumber || "",
      cycle: item.cycle || 0,
      user,
    }),
    stockDelta: outcome === "revived" ? qty : 0,
    queueDelta: -1,
    status: outcome === "revived" ? "revived" : "failed",
  };
}

export function planUndoResolve({ item, part, user, id }) {
  if (!item) throw new Error("That revive-queue item no longer exists.");
  if (item.status !== "revived" && item.status !== "failed") {
    throw new Error("Only a revived or failed queue result can be undone.");
  }
  const qty = roundQty(item.qty);
  if (item.status === "revived") {
    const stock = roundQty(part?.revivedStock || 0);
    if (stock + 0.0005 < qty) {
      throw new Error(`Cannot undo. Only ${stock} revived ${item.partCode} left in stock.`);
    }
  }
  return {
    movement: movementDoc({
      id,
      type: item.status === "revived" ? "REVIVED_TO_STOCK" : "SCRAPPED",
      partCode: item.partCode,
      qty: -qty,
      machineNumber: item.machineNumber || "",
      cycle: item.cycle || 0,
      user,
      reversal: true,
      reversesId: item.resolvedMovementId || "",
    }),
    stockDelta: item.status === "revived" ? -qty : 0,
    queueDelta: 1,
    status: "queued",
  };
}
