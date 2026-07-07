import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  getDocs,
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
  STATUS_ORDER,
} from "../constants";
import { logAction } from "./auditApi";
import { computeStatus } from "./status";

const machinesCol = collection(db, "machines");

export function subscribeToMachines(callback) {
  const q = query(machinesCol, orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    const machines = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(machines);
  });
}

export async function findMachineByNumber(machineNumber) {
  const q = query(machinesCol, where("machineNumber", "==", machineNumber.trim()));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
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

// --- Duplicate cleanup -------------------------------------------------------

function rank(machine) {
  return STATUS_ORDER.indexOf(computeStatus(machine));
}

function pickNonEmpty(a, b) {
  return a === "" || a === null || a === undefined ? b : a;
}

function mergeResistance(a, b) {
  return (a || []).map((row, i) => {
    const other = (b || [])[i] || {};
    return {
      current: row.current,
      eccentric: pickNonEmpty(row.eccentric, other.eccentric ?? ""),
      concentric: pickNonEmpty(row.concentric, other.concentric ?? ""),
    };
  });
}

function mergePhotoArrays(a, b) {
  const seen = new Set();
  const combined = [...(a || []), ...(b || [])];
  return combined.filter((p) => {
    if (!p?.path) return true;
    if (seen.has(p.path)) return false;
    seen.add(p.path);
    return true;
  });
}

// Merges every duplicate in `group` (array of machine docs, same
// machineNumber) into a single record: the most advanced one becomes the
// base, and any field left empty there is filled in from the others. The
// merged record keeps the base doc's ID; the rest are deleted.
export function buildMergedMachine(group) {
  const sorted = [...group].sort((a, b) => rank(b) - rank(a));
  const base = sorted[0];
  const others = sorted.slice(1);

  let merged = { ...base };

  for (const other of others) {
    merged.resistance = mergeResistance(merged.resistance, other.resistance);
    merged.temperature = {
      temp: pickNonEmpty(merged.temperature?.temp, other.temperature?.temp ?? ""),
      time: pickNonEmpty(merged.temperature?.time, other.temperature?.time ?? ""),
    };
    const photoKeys = new Set([...Object.keys(merged.photos || {}), ...Object.keys(other.photos || {})]);
    const mergedPhotos = {};
    photoKeys.forEach((k) => {
      mergedPhotos[k] = mergePhotoArrays(merged.photos?.[k], other.photos?.[k]);
    });
    merged.photos = mergedPhotos;

    const checklistKeys = new Set([...Object.keys(merged.packingChecklist || {}), ...Object.keys(other.packingChecklist || {})]);
    const mergedChecklist = {};
    checklistKeys.forEach((k) => {
      mergedChecklist[k] = Boolean(merged.packingChecklist?.[k]) || Boolean(other.packingChecklist?.[k]);
    });
    merged.packingChecklist = mergedChecklist;

    const sentBackKeys = new Set([...Object.keys(merged.packingSentBack || {}), ...Object.keys(other.packingSentBack || {})]);
    const mergedSentBack = {};
    sentBackKeys.forEach((k) => {
      mergedSentBack[k] = Boolean(merged.packingSentBack?.[k]) || Boolean(other.packingSentBack?.[k]);
    });
    merged.packingSentBack = mergedSentBack;

    const fpKeys = new Set([...Object.keys(merged.finalPacking || {}), ...Object.keys(other.finalPacking || {})]);
    const mergedFp = {};
    fpKeys.forEach((k) => {
      mergedFp[k] = merged.finalPacking?.[k]?.url ? merged.finalPacking[k] : other.finalPacking?.[k] || null;
    });
    merged.finalPacking = mergedFp;

    if (!merged.dispatch?.dispatched && other.dispatch?.dispatched) merged.dispatch = other.dispatch;
    if (!merged.delivery?.delivered && other.delivery?.delivered) merged.delivery = other.delivery;
    if (!merged.installation?.installed && other.installation?.installed) merged.installation = other.installation;

    const extA = merged.warranty?.extensions || [];
    const extB = other.warranty?.extensions || [];
    merged.warranty = { extensions: [...extA, ...extB] };

    merged.sectionMeta = { ...(other.sectionMeta || {}), ...(merged.sectionMeta || {}) };
    merged.createdBy = merged.createdBy || other.createdBy;
  }

  return { mergedDoc: merged, keepId: base.id, removeIds: others.map((o) => o.id) };
}

export async function mergeDuplicateMachines(group, meta) {
  const { mergedDoc, keepId, removeIds } = buildMergedMachine(group);
  const { id, ...dataWithoutId } = mergedDoc;
  const docRef = doc(db, "machines", keepId);
  await updateDoc(docRef, { ...dataWithoutId, updatedAt: serverTimestamp() });
  for (const rid of removeIds) {
    await deleteDoc(doc(db, "machines", rid));
  }
  await logAction({
    userEmail: meta?.userEmail,
    machineId: keepId,
    machineNumber: mergedDoc.machineNumber,
    section: "machine",
    action: `merged ${removeIds.length + 1} duplicate records into one`,
  });
  return keepId;
}
