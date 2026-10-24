import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { logAction } from "./auditApi";

const partsCol = collection(db, "parts");
const queueCol = collection(db, "reviveQueue");
const countsDoc = doc(db, "partCounts", "summary");

export function subscribeToParts(callback, onError) {
  const q = query(partsCol, orderBy("code"));
  return onSnapshot(
    q,
    (snapshot) => {
      callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    },
    onError
  );
}

export function subscribeToReviveQueue(callback, onError) {
  const q = query(queueCol, orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    },
    onError
  );
}

export function subscribeToPartCounts(callback, onError) {
  return onSnapshot(
    countsDoc,
    (snapshot) => {
      callback(snapshot.exists() ? snapshot.data() : { reviveQueueCount: 0 });
    },
    onError
  );
}

export async function updatePartRevivable(code, revivable, userEmail) {
  await updateDoc(doc(db, "parts", code), {
    revivable: Boolean(revivable),
    revivableEdited: true,
    revivableUpdatedBy: userEmail || "",
    revivableUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: userEmail || "",
  });
  await logAction({
    userEmail,
    section: "parts",
    action: `set ${code} revivable to ${revivable ? "yes" : "no"}`,
  });
}

export async function updatePartFrequency(code, frequency, userEmail) {
  const value = frequency === "common" || frequency === "occasional" ? frequency : null;
  await updateDoc(doc(db, "parts", code), {
    frequency: value,
    frequencyEdited: true,
    frequencyUpdatedBy: userEmail || "",
    frequencyUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: userEmail || "",
  });
  await logAction({
    userEmail,
    section: "parts",
    action: `set ${code} frequency to ${value || "unset"}`,
  });
}
