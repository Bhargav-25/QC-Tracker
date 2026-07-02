import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";

const logCol = collection(db, "auditLog");

export async function logAction({ userEmail, machineId, machineNumber, section, action }) {
  if (!userEmail) return; // no user context — nothing to attribute
  try {
    await addDoc(logCol, {
      userEmail,
      machineId: machineId || null,
      machineNumber: machineNumber || null,
      section: section || null,
      action: action || "updated",
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    // Never let logging failures block the actual save the user cares about.
    console.warn("Audit log write failed:", err);
  }
}

export function subscribeToAuditLog(callback, count = 300) {
  const q = query(logCol, orderBy("timestamp", "desc"), limit(count));
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
