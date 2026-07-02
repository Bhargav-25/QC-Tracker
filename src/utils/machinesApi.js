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

const machinesCol = collection(db, "machines");

export function subscribeToMachines(callback) {
  const q = query(machinesCol, orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    const machines = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(machines);
  });
}

export async function createMachine(machineNumber) {
  const docRef = await addDoc(machinesCol, {
    machineNumber,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
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
  });
  return docRef.id;
}

export async function updateMachine(id, data) {
  const docRef = doc(db, "machines", id);
  await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
}

export async function deleteMachine(id) {
  const docRef = doc(db, "machines", id);
  await deleteDoc(docRef);
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
