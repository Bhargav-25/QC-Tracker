import {
  doc,
  onSnapshot,
  setDoc,
  runTransaction,
  increment,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";

const STAND_DOC = doc(db, "inventory", "machineStand");

export function subscribeToStandInventory(callback) {
  return onSnapshot(STAND_DOC, (snap) => {
    callback(snap.exists() ? snap.data().count || 0 : 0);
  });
}

export async function addStandStock(qty) {
  await setDoc(
    STAND_DOC,
    { count: increment(qty), updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// Decrements by 1 inside a transaction so two people dispatching at the same
// moment can't both succeed when only one stand is left.
export async function decrementStandForDispatch() {
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
}

// Used when un-marking a dispatch that had included a stand, to put it back.
export async function returnStandToInventory() {
  await setDoc(
    STAND_DOC,
    { count: increment(1), updatedAt: serverTimestamp() },
    { merge: true }
  );
}
