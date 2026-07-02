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

const ticketsCol = collection(db, "tickets");

export function subscribeToTickets(callback) {
  const q = query(ticketsCol, orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    const tickets = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(tickets);
  });
}

export async function createTicket(machineId, { issueName, description, date }) {
  await addDoc(ticketsCol, {
    machineId,
    issueName,
    description,
    date,
    status: "Open",
    scheduledResolutionDate: "",
    solution: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateTicket(id, data) {
  const docRef = doc(db, "tickets", id);
  await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
}
