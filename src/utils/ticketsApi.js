import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { logAction } from "./auditApi";

const ticketsCol = collection(db, "tickets");

export function subscribeToTickets(callback) {
  const q = query(ticketsCol, orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    const tickets = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(tickets);
  });
}

export async function createTicket(machineId, { issueName, description, date }, meta) {
  const docRef = await addDoc(ticketsCol, {
    machineId,
    issueName,
    description,
    date,
    status: "Open",
    scheduledResolutionDate: "",
    solution: "",
    photo: null,
    createdBy: meta?.userEmail || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await logAction({
    userEmail: meta?.userEmail,
    machineId,
    machineNumber: meta?.machineNumber,
    section: "maintenance",
    action: `raised ticket "${issueName}"`,
  });
  return docRef.id;
}

export async function updateTicket(id, data, meta) {
  const docRef = doc(db, "tickets", id);
  await updateDoc(docRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: meta?.userEmail || "",
  });
  if (meta?.userEmail) {
    await logAction({
      userEmail: meta.userEmail,
      machineId: meta.machineId,
      machineNumber: meta.machineNumber,
      section: "maintenance",
      action: `updated ticket${data.status ? " to " + data.status : ""}`,
    });
  }
}
