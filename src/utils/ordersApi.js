import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { logAction } from "./auditApi";
import { computeStatus } from "./status.js";
import { STATUS } from "../constants.js";
import {
  FULFILLMENT_STATUSES,
  blankOrder,
  groupNumberToId,
  normalizeGroupNumber,
} from "../domain/orderModel.js";

const ordersCol = collection(db, "orders");

const EDITABLE_FIELDS = [
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
];

export function subscribeToOrders(callback, onError) {
  const q = query(ordersCol, orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      callback(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    onError
  );
}

export async function createOrder(draft, userEmail) {
  const groupNumber = normalizeGroupNumber(draft.groupNumber);
  const id = groupNumberToId(groupNumber);
  const ref = doc(db, "orders", id);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    const err = new Error(`Order ${groupNumber} already exists.`);
    err.code = "already-exists";
    throw err;
  }
  const base = blankOrder(groupNumber);
  const payload = { ...base, machineId: "", machineNumber: "", fulfillmentStatus: "", sheetStatus: "" };
  for (const key of EDITABLE_FIELDS) {
    if (draft[key] != null) payload[key] = draft[key];
  }
  payload.groupNumber = groupNumber;
  payload.createdAt = serverTimestamp();
  payload.updatedAt = serverTimestamp();
  payload.createdBy = userEmail || "";
  payload.updatedBy = userEmail || "";
  await setDoc(ref, payload);
  return id;
}

export async function updateOrder(groupNumber, patch, userEmail) {
  const ref = doc(db, "orders", groupNumberToId(groupNumber));
  const payload = {
    updatedAt: serverTimestamp(),
    updatedBy: userEmail || "",
  };
  for (const key of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) payload[key] = patch[key];
  }
  // Editing the sales status retires the historical sheet label so the
  // mirror starts writing Pause Shipment / Please Ship / Cancelled.
  if (Object.prototype.hasOwnProperty.call(patch, "status")) payload.sheetStatus = "";
  await updateDoc(ref, payload);
}

export async function refreshOrderFulfillment(machine) {
  if (!machine?.groupNumber) return;
  const status = computeStatus(machine);
  const fulfillmentStatus = FULFILLMENT_STATUSES.includes(status) ? status : "";
  const ref = doc(db, "orders", groupNumberToId(machine.groupNumber));
  await updateDoc(ref, {
    fulfillmentStatus,
    updatedAt: serverTimestamp(),
  });
}

export async function assignMachineToOrder({ order, machine, userEmail }) {
  const orderRef = doc(db, "orders", groupNumberToId(order.groupNumber));
  const machineRef = doc(db, "machines", machine.id);

  await runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const machineSnap = await tx.get(machineRef);
    if (!orderSnap.exists()) throw new Error("That order no longer exists.");
    if (!machineSnap.exists()) throw new Error("That machine no longer exists.");
    const orderData = orderSnap.data();
    const machineData = machineSnap.data();
    if (orderData.machineId && orderData.machineId !== machine.id) {
      throw new Error(`This order already has machine ${orderData.machineNumber || orderData.machineId}. Unassign it first.`);
    }
    if (machineData.groupNumber && machineData.groupNumber !== order.groupNumber) {
      throw new Error(`${machineData.machineNumber} is already assigned to ${machineData.groupNumber}.`);
    }
    const status = computeStatus({ id: machine.id, ...machineData });
    if (status !== STATUS.PACKED) {
      throw new Error("Only a Packed machine can be assigned to an order.");
    }
    tx.update(machineRef, {
      groupNumber: order.groupNumber,
      updatedAt: serverTimestamp(),
    });
    tx.update(orderRef, {
      machineId: machine.id,
      machineNumber: machineData.machineNumber || "",
      fulfillmentStatus: status,
      updatedAt: serverTimestamp(),
      updatedBy: userEmail || "",
    });
  });

  await logAction({
    userEmail,
    machineId: machine.id,
    machineNumber: machine.machineNumber,
    section: "order",
    action: `assigned to order ${order.groupNumber}`,
  });
}

export async function unassignMachineFromOrder({ order, machine, userEmail }) {
  const orderRef = doc(db, "orders", groupNumberToId(order.groupNumber));
  const machineRef = machine?.id ? doc(db, "machines", machine.id) : null;

  await runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists()) throw new Error("That order no longer exists.");
    if (machineRef) {
      const machineSnap = await tx.get(machineRef);
      if (machineSnap.exists() && machineSnap.data().groupNumber === order.groupNumber) {
        tx.update(machineRef, {
          groupNumber: "",
          updatedAt: serverTimestamp(),
        });
      }
    }
    tx.update(orderRef, {
      machineId: "",
      machineNumber: "",
      fulfillmentStatus: "",
      updatedAt: serverTimestamp(),
      updatedBy: userEmail || "",
    });
  });

  if (machine?.id) {
    await logAction({
      userEmail,
      machineId: machine.id,
      machineNumber: machine.machineNumber,
      section: "order",
      action: `unassigned from order ${order.groupNumber}`,
    });
  }
}
