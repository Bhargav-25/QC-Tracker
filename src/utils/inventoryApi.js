import {
  doc,
  onSnapshot,
  setDoc,
  runTransaction,
  increment,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { logAction } from "./auditApi";

const STAND_DOC = doc(db, "inventory", "machineStand");

export function subscribeToStandInventory(callback) {
  return onSnapshot(STAND_DOC, (snap) => {
    callback(snap.exists() ? snap.data().count || 0 : 0);
  });
}

export async function addStandStock(qty, userEmail) {
  await setDoc(
    STAND_DOC,
    { count: increment(qty), updatedAt: serverTimestamp() },
    { merge: true }
  );
  await logAction({
    userEmail,
    section: "inventory",
    action: `added ${qty} machine stand${qty === 1 ? "" : "s"} to stock`,
  });
}

// Decrements by 1 inside a transaction so two people dispatching at the same
// moment can't both succeed when only one stand is left.
export async function decrementStandForDispatch(meta) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(STAND_DOC);
    const current = snap.exists() ? snap.data().count || 0 : 0;
    if (current <= 0) {
      throw new Error("No machine stands left in inventory.");
    }
    tx.set(
      STAND_DOC,
      { count: current - 1, updatedAt: serverTimestamp() },
      { merge: true }
    );
  });
  await logAction({
    userEmail: meta?.userEmail,
    machineId: meta?.machineId,
    machineNumber: meta?.machineNumber,
    section: "inventory",
    action: "included a machine stand with dispatch",
  });
}

// Used when un-marking a dispatch that had included a stand, to put it back.
export async function returnStandToInventory(meta) {
  await setDoc(
    STAND_DOC,
    { count: increment(1), updatedAt: serverTimestamp() },
    { merge: true }
  );
  await logAction({
    userEmail: meta?.userEmail,
    machineId: meta?.machineId,
    machineNumber: meta?.machineNumber,
    section: "inventory",
    action: "returned a machine stand to stock",
  });
}
