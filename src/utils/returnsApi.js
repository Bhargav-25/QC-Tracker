import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { groupNumberToId } from "../domain/orderModel.js";
import {
  planRefurbComplete,
  planReturn,
  planReturnUpdate,
  withRefurbLine,
} from "../domain/machineCycle.js";
import {
  applyCountDelta,
  applyStockDelta,
  planRefurbLine,
  planResolveRevive,
  planUndoRefurbLine,
  planUndoResolve,
} from "../domain/partLedger.js";

const countsRef = () => doc(db, "partCounts", "summary");

function newId() {
  return globalThis.crypto.randomUUID();
}

function audit(tx, entry) {
  tx.set(doc(collection(db, "auditLog")), {
    userEmail: entry.userEmail || "",
    machineId: entry.machineId || null,
    machineNumber: entry.machineNumber || null,
    section: entry.section || "return",
    action: entry.action || "updated",
    timestamp: serverTimestamp(),
  });
}

function writeMovement(tx, movement) {
  tx.set(doc(db, "partMovements", movement.id), {
    ...movement,
    timestamp: serverTimestamp(),
  });
}

function writeStock(tx, partRef, stock, userEmail) {
  tx.update(partRef, {
    revivedStock: stock,
    updatedAt: serverTimestamp(),
    updatedBy: userEmail || "",
  });
}

function writeCounts(tx, snap, next) {
  const payload = { reviveQueueCount: next, updatedAt: serverTimestamp() };
  if (snap.exists()) tx.update(countsRef(), payload);
  else tx.set(countsRef(), payload);
}

export async function recordMachineReturn({ machineId, input, photos, userEmail }) {
  const machineRef = doc(db, "machines", machineId);
  const now = new Date().toISOString();
  await runTransaction(db, async (tx) => {
    const machineSnap = await tx.get(machineRef);
    if (!machineSnap.exists()) throw new Error("That machine no longer exists.");
    const machine = { id: machineSnap.id, ...machineSnap.data() };
    const plan = planReturn(machine, input, { user: userEmail, now, photos });
    let orderSnap = null;
    let orderRef = null;
    if (plan.unlinkGroup) {
      orderRef = doc(db, "orders", groupNumberToId(plan.unlinkGroup));
      orderSnap = await tx.get(orderRef);
    }
    tx.update(machineRef, {
      ...plan.reset,
      sectionMeta: { return: { updatedBy: userEmail || "", updatedAt: now } },
      updatedAt: serverTimestamp(),
    });
    if (orderSnap?.exists()) {
      const order = orderSnap.data();
      const linked = order.machineId === machineId || (order.machineNumber && order.machineNumber === machine.machineNumber);
      if (linked) {
        tx.update(orderRef, {
          machineId: "",
          machineNumber: "",
          fulfillmentStatus: "",
          updatedAt: serverTimestamp(),
          updatedBy: userEmail || "",
        });
      }
    }
    const from = plan.unlinkGroup || plan.reset.intake.fromGroupNo || "no order";
    audit(tx, {
      userEmail,
      machineId,
      machineNumber: machine.machineNumber,
      section: "return",
      action: `recorded return from ${from}; closed cycle ${plan.cycleClosed}, opened cycle ${plan.nextCycle}`,
    });
  });
}

export async function updateReturnDetails({ machineId, patch, userEmail }) {
  const machineRef = doc(db, "machines", machineId);
  const now = new Date().toISOString();
  await runTransaction(db, async (tx) => {
    const machineSnap = await tx.get(machineRef);
    if (!machineSnap.exists()) throw new Error("That machine no longer exists.");
    const machine = { id: machineSnap.id, ...machineSnap.data() };
    const plan = planReturnUpdate(machine, patch);
    tx.update(machineRef, {
      intake: plan.intake,
      "sectionMeta.return": { updatedBy: userEmail || "", updatedAt: now },
      updatedAt: serverTimestamp(),
    });
    audit(tx, {
      userEmail,
      machineId,
      machineNumber: machine.machineNumber,
      section: "return",
      action: "updated return details",
    });
  });
}

export async function addRefurbLine({ machineId, partCode, qty, source, disposition, userEmail }) {
  const machineRef = doc(db, "machines", machineId);
  const partRef = doc(db, "parts", partCode);
  const ids = { line: newId(), fit: newId(), removed: newId(), revive: newId() };
  const now = new Date().toISOString();
  await runTransaction(db, async (tx) => {
    const machineSnap = await tx.get(machineRef);
    const partSnap = await tx.get(partRef);
    const countsSnap = await tx.get(countsRef());
    if (!machineSnap.exists()) throw new Error("That machine no longer exists.");
    if (!partSnap.exists()) throw new Error(`Part ${partCode} is not in the catalog.`);
    const machine = { id: machineSnap.id, ...machineSnap.data() };
    const part = { id: partSnap.id, code: partSnap.id, ...partSnap.data() };
    const planned = planRefurbLine({
      part,
      qty,
      source,
      disposition,
      machine,
      user: userEmail,
      ids,
    });
    const intake = withRefurbLine(machine, planned.line, { now, user: userEmail });
    tx.update(machineRef, {
      intake,
      "sectionMeta.refurb": { updatedBy: userEmail || "", updatedAt: now },
      updatedAt: serverTimestamp(),
    });
    for (const movement of planned.movements) writeMovement(tx, movement);
    if (planned.reviveItem) {
      tx.set(doc(db, "reviveQueue", planned.reviveItem.id), {
        ...planned.reviveItem,
        createdAt: serverTimestamp(),
      });
    }
    if (planned.stockDelta) {
      writeStock(tx, partRef, applyStockDelta(part.revivedStock, planned.stockDelta), userEmail);
    }
    if (planned.queueDelta) {
      const current = countsSnap.exists() ? countsSnap.data().reviveQueueCount || 0 : 0;
      writeCounts(tx, countsSnap, applyCountDelta(current, planned.queueDelta));
    }
    audit(tx, {
      userEmail,
      machineId,
      machineNumber: machine.machineNumber,
      section: "refurb",
      action: `fitted ${planned.line.qty} ${planned.line.unit} ${planned.line.partCode} (${source}); removed part ${disposition}`,
    });
  });
}

export async function undoRefurbLine({ machineId, lineId, userEmail }) {
  const machineRef = doc(db, "machines", machineId);
  const ids = { fit: newId(), removed: newId() };
  const now = new Date().toISOString();
  await runTransaction(db, async (tx) => {
    const machineSnap = await tx.get(machineRef);
    if (!machineSnap.exists()) throw new Error("That machine no longer exists.");
    const machine = { id: machineSnap.id, ...machineSnap.data() };
    const line = (machine.intake?.refurb?.lines || []).find((item) => item?.id === lineId);
    if (!line) throw new Error("That refurb line is not on this machine.");
    const partRef = doc(db, "parts", line.partCode);
    const partSnap = await tx.get(partRef);
    const reviveRef = line.reviveItemId ? doc(db, "reviveQueue", line.reviveItemId) : null;
    const reviveSnap = reviveRef ? await tx.get(reviveRef) : null;
    const countsSnap = await tx.get(countsRef());
    const part = partSnap.exists() ? { id: partSnap.id, ...partSnap.data() } : null;
    const reviveItem = reviveSnap?.exists() ? { id: reviveSnap.id, ...reviveSnap.data() } : null;
    const planned = planUndoRefurbLine({ machine, lineId, reviveItem, user: userEmail, ids });
    if (planned.stockDelta && !partSnap.exists()) {
      throw new Error(`Part ${line.partCode} is not in the catalog.`);
    }
    const intake = {
      ...machine.intake,
      refurb: {
        ...machine.intake.refurb,
        lines: planned.nextLines.map((item) => (item.id === lineId ? { ...item, undoneAt: now } : item)),
      },
    };
    tx.update(machineRef, {
      intake,
      "sectionMeta.refurb": { updatedBy: userEmail || "", updatedAt: now },
      updatedAt: serverTimestamp(),
    });
    for (const movement of planned.movements) writeMovement(tx, movement);
    if (planned.reverseRevive && reviveSnap?.exists()) {
      tx.update(reviveRef, {
        status: "reversed",
        resolvedBy: userEmail || "",
        resolvedAt: serverTimestamp(),
      });
    }
    if (planned.stockDelta) {
      writeStock(tx, partRef, applyStockDelta(part.revivedStock, planned.stockDelta), userEmail);
    }
    const queueDelta = reviveSnap?.exists() ? planned.queueDelta : 0;
    if (queueDelta) {
      const current = countsSnap.exists() ? countsSnap.data().reviveQueueCount || 0 : 0;
      writeCounts(tx, countsSnap, applyCountDelta(current, queueDelta));
    }
    audit(tx, {
      userEmail,
      machineId,
      machineNumber: machine.machineNumber,
      section: "refurb",
      action: `undid refurb line ${line.partCode}`,
    });
  });
}

export async function completeRefurb({ machineId, date, userEmail }) {
  const machineRef = doc(db, "machines", machineId);
  const now = new Date().toISOString();
  await runTransaction(db, async (tx) => {
    const machineSnap = await tx.get(machineRef);
    if (!machineSnap.exists()) throw new Error("That machine no longer exists.");
    const machine = { id: machineSnap.id, ...machineSnap.data() };
    const plan = planRefurbComplete(machine, { date, user: userEmail, now });
    tx.update(machineRef, {
      intake: plan.intake,
      "sectionMeta.refurb": { updatedBy: userEmail || "", updatedAt: now },
      updatedAt: serverTimestamp(),
    });
    audit(tx, {
      userEmail,
      machineId,
      machineNumber: machine.machineNumber,
      section: "refurb",
      action: `marked refurbishment complete on ${date}`,
    });
  });
}

export async function resolveReviveItem({ itemId, outcome, userEmail }) {
  const itemRef = doc(db, "reviveQueue", itemId);
  const movementId = newId();
  await runTransaction(db, async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists()) throw new Error("That revive-queue item no longer exists.");
    const item = { id: itemSnap.id, ...itemSnap.data() };
    const partRef = doc(db, "parts", item.partCode);
    const partSnap = await tx.get(partRef);
    const countsSnap = await tx.get(countsRef());
    if (!partSnap.exists()) throw new Error(`Part ${item.partCode} is not in the catalog.`);
    const part = partSnap.data();
    const planned = planResolveRevive({ item, outcome, user: userEmail, id: movementId });
    tx.update(itemRef, {
      status: planned.status,
      resolvedMovementId: planned.movement.id,
      resolvedBy: userEmail || "",
      resolvedAt: serverTimestamp(),
    });
    writeMovement(tx, planned.movement);
    if (planned.stockDelta) {
      writeStock(tx, partRef, applyStockDelta(part.revivedStock, planned.stockDelta), userEmail);
    }
    const current = countsSnap.exists() ? countsSnap.data().reviveQueueCount || 0 : 0;
    writeCounts(tx, countsSnap, applyCountDelta(current, planned.queueDelta));
    audit(tx, {
      userEmail,
      machineId: item.machineId || null,
      machineNumber: item.machineNumber,
      section: "revive",
      action: outcome === "revived"
        ? `revived ${item.qty} ${item.partCode} back to stock`
        : `revive failed; scrapped ${item.qty} ${item.partCode}`,
    });
  });
}

export async function undoReviveResolution({ itemId, userEmail }) {
  const itemRef = doc(db, "reviveQueue", itemId);
  const movementId = newId();
  await runTransaction(db, async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists()) throw new Error("That revive-queue item no longer exists.");
    const item = { id: itemSnap.id, ...itemSnap.data() };
    const partRef = doc(db, "parts", item.partCode);
    const partSnap = await tx.get(partRef);
    const countsSnap = await tx.get(countsRef());
    const part = partSnap.exists() ? partSnap.data() : null;
    const planned = planUndoResolve({ item, part, user: userEmail, id: movementId });
    if (!partSnap.exists()) throw new Error(`Part ${item.partCode} is not in the catalog.`);
    tx.update(itemRef, {
      status: "queued",
      resolvedMovementId: "",
      resolvedBy: userEmail || "",
      resolvedAt: serverTimestamp(),
    });
    writeMovement(tx, planned.movement);
    if (planned.stockDelta) {
      writeStock(tx, partRef, applyStockDelta(part.revivedStock, planned.stockDelta), userEmail);
    }
    const current = countsSnap.exists() ? countsSnap.data().reviveQueueCount || 0 : 0;
    writeCounts(tx, countsSnap, applyCountDelta(current, planned.queueDelta));
    audit(tx, {
      userEmail,
      machineId: item.machineId || null,
      machineNumber: item.machineNumber,
      section: "revive",
      action: `undid revive result for ${item.partCode}; back in queue`,
    });
  });
}
