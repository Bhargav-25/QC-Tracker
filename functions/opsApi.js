import { randomUUID } from "node:crypto";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { keysMatch, presentedApiKey } from "../src/domain/apiKey.js";
import { groupNumberToId, isSafeGroupId, normalizeGroupNumber } from "../src/domain/orderModel.js";
import {
  OPS_ACTOR,
  OPS_AUDIT_ACTOR,
  SERVER_TIMESTAMP,
  buildMachineUpdate,
  firebaseDownloadUrl,
  handleOpsHttp,
  installationPhotoBody,
  matchOpsRoute,
  placeInstallationPhoto,
  planAssign,
  planOpsRefurbish,
  planOpsReturn,
  selectOpsMachine,
} from "../src/domain/opsHttp.js";

// This function's only secret is the ops write key. The orders secret and the
// machines read secret are not declared here, so they cannot authorize a call.
// handleOpsHttp compares the presented key with this secret alone.
const opsWriteApiKey = defineSecret("OPS_WRITE_API_KEY");

const AUTH_ERROR = "Missing or invalid API key. Send X-API-Key or Authorization: Bearer.";

function docData(snap) {
  return { id: snap.id, ...snap.data() };
}

function jsonBody(req) {
  const body = req.body;
  if (body == null || body === "") return {};
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString());
    } catch {
      return null;
    }
  }
  return body;
}

function stampUpdate(update) {
  const out = {};
  for (const [key, value] of Object.entries(update)) {
    if (value === SERVER_TIMESTAMP) {
      out[key] = FieldValue.serverTimestamp();
    } else if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.updatedAt === SERVER_TIMESTAMP
    ) {
      out[key] = { ...value, updatedAt: FieldValue.serverTimestamp() };
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function loadContext(db, route) {
  if (route.address.type === "machine") {
    const snap = await db.collection("machines").where("machineNumber", "==", route.address.machineNumber).get();
    return { machines: snap.docs.map(docData), order: null };
  }
  const groupNumber = normalizeGroupNumber(route.address.groupNumber);
  const orderSnap = await db.collection("orders").doc(groupNumberToId(groupNumber)).get();
  const order = orderSnap.exists ? docData(orderSnap) : null;
  const machines = [];
  if (order?.machineId) {
    const linked = await db.collection("machines").doc(order.machineId).get();
    if (linked.exists) machines.push(docData(linked));
  }
  if (order?.machineNumber) {
    const byNumber = await db.collection("machines").where("machineNumber", "==", order.machineNumber).get();
    byNumber.docs.forEach((snap) => machines.push(docData(snap)));
  }
  const byGroup = await db.collection("machines").where("groupNumber", "==", groupNumber).get();
  byGroup.docs.forEach((snap) => machines.push(docData(snap)));
  return { machines, order };
}

function dedupeDocs(docs) {
  const out = [];
  const seen = new Set();
  for (const item of docs) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

async function loadInventory(db) {
  const [machineSnap, orderSnap] = await Promise.all([
    db.collection("machines").get(),
    db.collection("orders").get(),
  ]);
  return {
    machines: machineSnap.docs.map(docData),
    orders: orderSnap.docs.map(docData),
  };
}

function auditWrite(audit) {
  if (!audit?.action || audit.userEmail !== OPS_AUDIT_ACTOR) {
    throw new Error("Ops write is missing its audit log entry.");
  }
  return {
    userEmail: audit.userEmail,
    machineId: audit.machineId || null,
    machineNumber: audit.machineNumber || null,
    groupNumber: audit.groupNumber || null,
    section: audit.section || null,
    action: audit.action,
    timestamp: FieldValue.serverTimestamp(),
  };
}

async function syncFulfillment(db, write) {
  if (!write.fulfillmentStatus || !write.groupNumber) return;
  try {
    const ref = db.collection("orders").doc(groupNumberToId(write.groupNumber));
    const snap = await ref.get();
    if (!snap.exists) return;
    await ref.update({
      fulfillmentStatus: write.fulfillmentStatus,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: OPS_ACTOR,
    });
  } catch (err) {
    console.warn("Ops API could not refresh order status:", err?.message || err);
  }
}

async function applyWrite(db, write) {
  const batch = db.batch();
  batch.update(db.collection("machines").doc(write.machineId), stampUpdate(buildMachineUpdate(write)));
  batch.set(db.collection("auditLog").doc(), auditWrite(write.audit));
  await batch.commit();
  // The order status is a follow-up. A missing order must not roll back the
  // machine update or its audit row, which already committed together.
  await syncFulfillment(db, write);
}

async function commitPhoto(db, bucket, upload) {
  const token = randomUUID();
  const file = bucket.file(upload.path);
  await file.save(upload.bytes, {
    resumable: false,
    contentType: upload.contentType,
    metadata: {
      contentType: upload.contentType,
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  const url = firebaseDownloadUrl(bucket.name, upload.path, token);
  const entry = { ...upload.entry, url, path: upload.path };
  const ref = db.collection("machines").doc(upload.machineId);
  const auditRef = db.collection("auditLog").doc();
  let outcome;
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        outcome = { missing: true };
        return;
      }
      const machine = { id: snap.id, ...snap.data() };
      const placed = placeInstallationPhoto(machine, entry);
      if (placed.duplicate) {
        outcome = { duplicate: placed.duplicate, machine };
        return;
      }
      if (placed.error) {
        outcome = { error: placed.error, machine };
        return;
      }
      const installation = { ...(machine.installation || {}), photos: placed.photos };
      tx.update(
        ref,
        stampUpdate(
          buildMachineUpdate({
            fields: { installation, updatedBy: OPS_ACTOR },
            sectionStamps: upload.sectionStamps,
          })
        )
      );
      tx.set(auditRef, auditWrite(upload.audit));
      outcome = { machine: { ...machine, installation }, entry };
    });
  } catch (err) {
    await file.delete({ ignoreNotFound: true }).catch(() => {});
    throw err;
  }
  if (!outcome?.entry) {
    await file.delete({ ignoreNotFound: true }).catch(() => {});
  }
  return outcome || { missing: true };
}

async function commitAssign(db, assign) {
  const orderRef = db.collection("orders").doc(assign.orderId);
  const auditRef = db.collection("auditLog").doc();
  let outcome = { status: 409, body: { ok: false, error: "Assignment could not be saved." } };
  await db.runTransaction(async (tx) => {
    const machineQuery = await tx.get(db.collection("machines").where("machineNumber", "==", assign.machineNumber));
    const groupQuery = await tx.get(db.collection("machines").where("groupNumber", "==", assign.groupNumber));
    const orderSnap = await tx.get(orderRef);
    const order = orderSnap.exists ? docData(orderSnap) : null;
    const previous = [];
    if (order?.machineId) {
      const prev = await tx.get(db.collection("machines").doc(order.machineId));
      if (prev.exists) previous.push(docData(prev));
    }
    const orderNumberQuery = await tx.get(db.collection("orders").where("machineNumber", "==", assign.machineNumber));
    const machines = dedupeDocs([
      ...machineQuery.docs.map(docData),
      ...groupQuery.docs.map(docData),
      ...previous,
    ]);
    const target = machines.find((machine) => machine.machineNumber === assign.machineNumber);
    let linkedOrders = orderNumberQuery.docs.map(docData);
    if (target) {
      const byId = await tx.get(db.collection("orders").where("machineId", "==", target.id));
      linkedOrders = linkedOrders.concat(byId.docs.map(docData));
    }
    const orders = dedupeDocs([...(order ? [order] : []), ...linkedOrders]);
    const planned = planAssign({
      groupNumber: assign.groupNumber,
      body: assign.body,
      machines,
      orders,
    });
    if (!planned.assign) {
      outcome = { status: planned.status, body: planned.body };
      return;
    }
    const plan = planned.assign;
    tx.update(
      db.collection("machines").doc(plan.machineId),
      stampUpdate({ groupNumber: plan.groupNumber, updatedBy: OPS_ACTOR, updatedAt: SERVER_TIMESTAMP })
    );
    for (const id of plan.clearMachineIds || []) {
      tx.update(
        db.collection("machines").doc(id),
        stampUpdate({ groupNumber: "", updatedBy: OPS_ACTOR, updatedAt: SERVER_TIMESTAMP })
      );
    }
    if (plan.createOrder) {
      tx.set(db.collection("orders").doc(plan.orderId), stampUpdate(plan.createOrder));
    } else {
      tx.update(db.collection("orders").doc(plan.orderId), stampUpdate(plan.orderUpdate));
    }
    tx.set(auditRef, auditWrite(plan.audit));
    outcome = { status: planned.status, body: planned.body };
  });
  return outcome;
}

// Return and refurbish re-read the machine inside the transaction so the
// dispatch copied into dispatchHistory is the one stored, then commit that
// update, the order unlink, and the ops-bot audit row together.
async function commitCycle(db, commit) {
  const auditRef = db.collection("auditLog").doc();
  let outcome = { status: 409, body: { ok: false, error: "Could not be saved." } };
  await db.runTransaction(async (tx) => {
    const machineQuery = await tx.get(db.collection("machines").where("machineNumber", "==", commit.machineNumber));
    const machines = machineQuery.docs.map(docData);
    const selected = selectOpsMachine({
      address: { type: "machine", machineNumber: commit.machineNumber },
      machines,
      order: null,
    });
    if (!selected.machine) {
      outcome = { status: 404, body: { ok: false, error: `No machine ${commit.machineNumber}.` } };
      return;
    }
    const machine = selected.machine;
    const group = normalizeGroupNumber(machine.groupNumber);
    let orderSnap = null;
    let order = null;
    if (group && isSafeGroupId(group)) {
      orderSnap = await tx.get(db.collection("orders").doc(groupNumberToId(group)));
      if (orderSnap.exists) order = docData(orderSnap);
    }
    const parsedNow = new Date(commit.now);
    const now = Number.isNaN(parsedNow.getTime()) ? new Date() : parsedNow;
    const planned = commit.kind === "refurbish"
      ? planOpsRefurbish(machine, commit.body, now, order)
      : planOpsReturn(machine, commit.body, now, order);
    if (!planned.write) {
      outcome = { status: planned.status, body: planned.body };
      return;
    }
    tx.update(
      db.collection("machines").doc(planned.write.machineId),
      stampUpdate(buildMachineUpdate(planned.write))
    );
    if (orderSnap?.exists && planned.write.orderClear?.id) {
      const orderData = orderSnap.data();
      const linked =
        orderData.machineId === machine.id ||
        (orderData.machineNumber && orderData.machineNumber === machine.machineNumber);
      if (linked) {
        tx.update(db.collection("orders").doc(orderSnap.id), stampUpdate(planned.write.orderClear.fields));
      }
    }
    tx.set(auditRef, auditWrite(planned.write.audit));
    outcome = { status: planned.status, body: planned.body };
  });
  return outcome;
}

export const opsApi = onRequest(
  {
    secrets: [opsWriteApiKey],
    cors: false,
    invoker: "public",
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  async (req, res) => {
    const expectedKey = String(opsWriteApiKey.value() || "");
    if (!keysMatch(expectedKey, presentedApiKey(req.headers))) {
      res.status(401).json({ ok: false, error: AUTH_ERROR });
      return;
    }

    try {
      const urlPath = req.path || "/";
      const route = matchOpsRoute(urlPath);
      const db = getFirestore();
      let machines = [];
      let orders = [];
      let order = null;
      if (route.action === "machines" || route.action === "assign") {
        const loaded = await loadInventory(db);
        machines = loaded.machines;
        orders = loaded.orders;
      } else if (route.action !== "unknown") {
        const loaded = await loadContext(db, route);
        machines = loaded.machines;
        order = loaded.order;
      }

      const result = handleOpsHttp({
        method: req.method,
        urlPath,
        headers: req.headers,
        query: req.query,
        body: jsonBody(req),
        expectedKey,
        machines,
        orders,
        order,
      });
      if (result.allow) res.setHeader("Allow", result.allow);

      if (result.assign) {
        const committed = await commitAssign(db, result.assign);
        res.status(committed.status).json(committed.body);
        return;
      }

      if (result.commit) {
        const committed = await commitCycle(db, result.commit);
        res.status(committed.status).json(committed.body);
        return;
      }

      if (result.upload) {
        const outcome = await commitPhoto(db, getStorage().bucket(), result.upload);
        if (outcome.missing) {
          res.status(404).json({ ok: false, error: `No machine ${result.upload.machineNumber}.` });
          return;
        }
        if (outcome.error) {
          res.status(409).json({
            ok: false,
            error: `Machine ${result.upload.machineNumber} already has 4 installation photos.`,
          });
          return;
        }
        if (outcome.duplicate) {
          res.status(200).json(installationPhotoBody(outcome.machine, outcome.duplicate, { duplicate: true, order }));
          return;
        }
        res.status(201).json(installationPhotoBody(outcome.machine, outcome.entry, { duplicate: false, order }));
        return;
      }

      if (result.write) await applyWrite(db, result.write);
      res.status(result.status).json(result.body);
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: "Ops API failed." });
    }
  }
);
