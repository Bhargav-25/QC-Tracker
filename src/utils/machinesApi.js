import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { db, storage } from "../firebase";
import {
  emptyResistanceRows,
  emptyPhotos,
  emptyPackingChecklist,
  emptyPackingSentBack,
  emptyFinalPacking,
  emptyDispatch,
  emptyDelivery,
  emptyInstallation,
  emptyWarranty,
} from "../constants";
import { logAction } from "./auditApi";

const machinesCol = collection(db, "machines");

export function subscribeToMachines(callback) {
  const q = query(machinesCol, orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    const machines = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(machines);
  });
}

export async function createMachine(machineNumber, userEmail) {
  const docRef = await addDoc(machinesCol, {
    machineNumber,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: userEmail || "",
    resistance: emptyResistanceRows(),
    temperature: { temp: "", time: "" },
    photos: emptyPhotos(),
    packingChecklist: emptyPackingChecklist(),
    packingSentBack: emptyPackingSentBack(),
    finalPacking: emptyFinalPacking(),
    dispatch: emptyDispatch(),
    delivery: emptyDelivery(),
    installation: emptyInstallation(),
    warranty: emptyWarranty(),
    sectionMeta: {},
  });
  await logAction({
    userEmail,
    machineId: docRef.id,
    machineNumber,
    section: "machine",
    action: "created machine",
  });
  return docRef.id;
}

// `meta` (optional): { userEmail, section, machineNumber, action }
// When provided, this both stamps sectionMeta.<section> with who/when, and
// writes an audit log entry — so every save is attributable.
export async function updateMachine(id, data, meta) {
  const docRef = doc(db, "machines", id);
  const payload = { ...data, updatedAt: serverTimestamp() };
  if (meta?.section) {
    payload[`sectionMeta.${meta.section}`] = {
      updatedBy: meta.userEmail || "unknown",
      updatedAt: serverTimestamp(),
    };
  }
  await updateDoc(docRef, payload);
  if (meta?.userEmail) {
    await logAction({
      userEmail: meta.userEmail,
      machineId: id,
      machineNumber: meta.machineNumber,
      section: meta.section,
      action: meta.action || "updated " + (meta.section || "machine"),
    });
  }
}

export async function deleteMachine(id, meta) {
  const docRef = doc(db, "machines", id);
  await deleteDoc(docRef);
  if (meta?.userEmail) {
    await logAction({
      userEmail: meta.userEmail,
      machineId: id,
      machineNumber: meta.machineNumber,
      section: "machine",
      action: "deleted machine",
    });
  }
}

export async function uploadMachinePhoto(machineId, categoryKey, file) {
  const path = `machines/${machineId}/${categoryKey}/${Date.now()}-${file.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  return { url, path };
}

export async function deleteMachinePhoto(path) {
  try {
    const storageRef = ref(storage, path);
    await deleteObject(storageRef);
  } catch (err) {
    // If the file is already gone, don't block the UI on it.
    console.warn("Could not delete storage file:", err);
  }
}
