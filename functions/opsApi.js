import { randomUUID } from "node:crypto";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { keysMatch, presentedApiKey } from "../src/domain/apiKey.js";
import { groupNumberToId, normalizeGroupNumber } from "../src/domain/orderModel.js";
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
      let order = null;
      if (route.action !== "unknown") {
        const loaded = await loadContext(db, route);
        machines = loaded.machines;
        order = loaded.order;
      }

      const result = handleOpsHttp({
        method: req.method,
        urlPath,
        headers: req.headers,
        body: jsonBody(req),
        expectedKey,
        machines,
        order,
      });
      if (result.allow) res.setHeader("Allow", result.allow);

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
