import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  collection,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../firebase";

export function loginWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// Each Firebase Auth user gets a matching doc at users/{uid} holding their
// role. On first login (before an admin has assigned a role), the user
// creates their own placeholder doc with role: null — an admin then sets
// the real role from the Manage Users page.
export async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  await setDoc(
    ref,
    { email: user.email, role: null, createdAt: serverTimestamp() },
    { merge: true }
  );
}

export function subscribeToUsers(callback) {
  return onSnapshot(collection(db, "users"), (snapshot) => {
    callback(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function subscribeToUserRole(uid, callback) {
  const ref = doc(db, "users", uid);
  return onSnapshot(ref, (snap) => {
    callback(snap.exists() ? snap.data() : null);
  });
}

export async function setUserRole(uid, role) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, { role });
}

export async function removeUser(uid) {
  await deleteDoc(doc(db, "users", uid));
}
