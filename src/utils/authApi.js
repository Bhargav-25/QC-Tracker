import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  doc,
  getDoc,
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
// role. This only ever WRITES on the very first login, when the doc doesn't
// exist yet — after that it's read-only from here, so a role an admin
// assigns is never overwritten by a later login or page refresh.
export async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { email: user.email, role: null, createdAt: serverTimestamp() });
  }
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
