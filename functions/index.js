import { onRequest } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { keysMatch, presentedApiKey } from "../src/domain/apiKey.js";
import { handleMachinesHttp, matchMachinesRoute } from "../src/domain/machinesHttp.js";
import { handleOrdersHttp, matchOrdersRoute } from "../src/domain/ordersHttp.js";
import { groupNumberToId, normalizeGroupNumber } from "../src/domain/orderModel.js";
import { syncOrderToSheet as writeOrderRow } from "./sheetSync.js";

initializeApp();
const db = getFirestore();

const ordersApiKey = defineSecret("ORDERS_API_KEY");
const machinesReadApiKey = defineSecret("MACHINES_READ_API_KEY");
const sheetsServiceAccount = defineSecret("SHEETS_SERVICE_ACCOUNT");

function authorized(req) {
  return keysMatch(String(ordersApiKey.value() || ""), presentedApiKey(req.headers));
}

function serializeValue(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  return value;
}

function serializeOrder(id, data) {
  const order = { id, ...data };
  order.createdAt = serializeValue(order.createdAt);
  order.updatedAt = serializeValue(order.updatedAt);
  return order;
}

async function loadOrder(groupNumber) {
  if (!groupNumber) return null;
  const snap = await db.collection("orders").doc(groupNumberToId(groupNumber)).get();
  if (!snap.exists) return null;
  return serializeOrder(snap.id, snap.data());
}

// The orders collection is one document per group. Read it and filter in
// the handler instead of adding a composite index.
async function loadOrdersForList() {
  const [orderSnap, machineSnap] = await Promise.all([
    db.collection("orders").get(),
    db.collection("machines").get(),
  ]);
  return {
    orders: orderSnap.docs.map((snap) => serializeOrder(snap.id, snap.data())),
    machines: machineSnap.docs.map((snap) => ({ id: snap.id, ...snap.data() })),
  };
}

async function loadLinkedMachine(order) {
  if (!order?.machineId && !order?.machineNumber && !order?.groupNumber) return null;
  if (order.machineId) {
    const snap = await db.collection("machines").doc(order.machineId).get();
    if (snap.exists) return { id: snap.id, ...snap.data() };
  }
  if (order.machineNumber) {
    const q = await db.collection("machines").where("machineNumber", "==", order.machineNumber).limit(1).get();
    if (!q.empty) return { id: q.docs[0].id, ...q.docs[0].data() };
  }
  return null;
}

export const api = onRequest(
  { secrets: [ordersApiKey], cors: false, invoker: "public", timeoutSeconds: 30 },
  async (req, res) => {
    if (!authorized(req)) {
      res.status(401).json({ ok: false, error: "Missing or invalid API key. Send Authorization: Bearer <key> or x-api-key." });
      return;
    }

    try {
      const urlPath = req.path || "/";
      const route = matchOrdersRoute(urlPath);
      let existing = null;
      let orders = [];
      let machines = [];
      const verb = String(req.method || "GET").toUpperCase();
      if (route.kind === "document") {
        existing = await loadOrder(route.groupNumber);
      } else if (route.kind === "collection" && verb === "POST") {
        existing = await loadOrder(normalizeGroupNumber(req.body?.groupNumber));
      } else if (route.kind === "collection" && verb === "GET") {
        const loaded = await loadOrdersForList();
        orders = loaded.orders;
        machines = loaded.machines;
      }

      const result = handleOrdersHttp({
        method: req.method,
        urlPath,
        query: req.query,
        body: req.body,
        existing,
        orders,
        machines,
      });

      if (result.create) {
        const ref = db.collection("orders").doc(result.id);
        await ref.set({
          ...result.body.order,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdBy: "api",
          updatedBy: "api",
        });
        const saved = await ref.get();
        res.status(201).json({ ok: true, created: true, order: serializeOrder(saved.id, saved.data()) });
        return;
      }

      if (result.update) {
        const ref = db.collection("orders").doc(result.id);
        await ref.update({
          ...result.update,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: "api",
        });
        const saved = await ref.get();
        res.status(200).json({ ok: true, order: serializeOrder(saved.id, saved.data()) });
        return;
      }

      res.status(result.status).json(result.body);
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: "Orders API failed." });
    }
  }
);

async function syncGroups(groupNumbers) {
  let raw = "";
  try {
    raw = String(sheetsServiceAccount.value() || "");
  } catch (err) {
    console.warn("Sheet sync secret unavailable:", err?.message || err);
    return;
  }
  if (!raw.trim() || raw.trim() === "{}") {
    console.warn("SHEETS_SERVICE_ACCOUNT is empty; skipping sheet sync.");
    return;
  }
  try {
    for (const groupNumber of groupNumbers) {
      if (!groupNumber) continue;
      const order = await loadOrder(groupNumber);
      if (!order) continue;
      const machine = await loadLinkedMachine(order);
      await writeOrderRow(raw, order, machine);
    }
  } catch (err) {
    const message = String(err?.message || err);
    // Bad credentials will never succeed on retry. Rate limits and 5xx will.
    if (/JSON|Unexpected token|invalid_grant|invalid_client|DECODER|No key or keyFile/i.test(message)) {
      console.warn("Sheet sync credentials rejected:", message);
      return;
    }
    throw err;
  }
}

// Read-only inventory feed. This function's only secret is the read key, so
// the orders write key is not accepted here, and this handler never writes.
export const machinesApi = onRequest(
  { secrets: [machinesReadApiKey], cors: false, invoker: "public", timeoutSeconds: 60 },
  async (req, res) => {
    const expectedKey = String(machinesReadApiKey.value() || "");
    const headers = req.headers;
    let machines = [];
    let stand = null;
    try {
      if (keysMatch(expectedKey, presentedApiKey(headers)) && req.method === "GET") {
        const route = matchMachinesRoute(req.path || "/");
        if (route.kind === "list" || route.kind === "machine") {
          const snap = await db.collection("machines").get();
          machines = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        } else if (route.kind === "stand") {
          const snap = await db.collection("inventory").doc("machineStand").get();
          stand = snap.exists ? snap.data() : null;
        }
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: "Machines API failed." });
      return;
    }

    const result = handleMachinesHttp({
      method: req.method,
      urlPath: req.path || "/",
      query: req.query,
      headers,
      expectedKey,
      machines,
      stand,
    });
    if (result.allow) res.setHeader("Allow", result.allow);
    res.status(result.status).json(result.body);
  }
);

export const syncOrderToSheet = onDocumentWritten(
  {
    document: "orders/{orderId}",
    secrets: [sheetsServiceAccount],
    retry: true,
    timeoutSeconds: 60,
  },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after?.groupNumber) return;
    await syncGroups([after.groupNumber]);
  }
);

export const syncMachineToSheet = onDocumentWritten(
  {
    document: "machines/{machineId}",
    secrets: [sheetsServiceAccount],
    retry: true,
    timeoutSeconds: 60,
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const groups = [...new Set([before.groupNumber, after.groupNumber].filter(Boolean))];
    if (!groups.length) return;
    await syncGroups(groups);
  }
);

// Dispatch / installation writes. Separate function and secret from `api`
// and `machinesApi`, so those handlers can change without editing this one.
export { opsApi } from "./opsApi.js";
