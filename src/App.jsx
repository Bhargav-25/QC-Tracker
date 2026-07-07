import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import AddMachine from "./pages/AddMachine.jsx";
import MachineDetail from "./pages/MachineDetail.jsx";
import Notifications from "./pages/Notifications.jsx";
import MachinesList from "./pages/MachinesList.jsx";
import StandInventory from "./pages/StandInventory.jsx";
import MaintenanceAdmin from "./pages/MaintenanceAdmin.jsx";
import ManageUsers from "./pages/ManageUsers.jsx";
import AuditLog from "./pages/AuditLog.jsx";
import DuplicateMachines from "./pages/DuplicateMachines.jsx";
import { subscribeToMachines } from "./utils/machinesApi";
import { subscribeToStandInventory } from "./utils/inventoryApi";
import { subscribeToTickets } from "./utils/ticketsApi";
import { missingPackingItems, isWarrantyExpiringSoon } from "./utils/status";
import {
  onAuthChange,
  ensureUserDoc,
  subscribeToUserRole,
  subscribeToUsers,
} from "./utils/authApi";
import { ROLES } from "./constants";

const HOME_BY_ROLE = {
  [ROLES.ADMIN]: "/",
  [ROLES.PRODUCTION]: "/machines",
  [ROLES.INSTALLATION]: "/machines",
  [ROLES.DASHBOARD]: "/",
};

function Gate({ role, allow, children }) {
  if (!allow.includes(role)) {
    return <Navigate to={HOME_BY_ROLE[role] || "/"} replace />;
  }
  return children;
}

export default function App() {
  const [authUser, setAuthUser] = useState(undefined); // undefined = not checked yet, null = signed out
  const [roleDoc, setRoleDoc] = useState(undefined);

  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [standCount, setStandCount] = useState(0);
  const [tickets, setTickets] = useState([]);
  const [allUsers, setAllUsers] = useState([]);

  useEffect(() => {
    return onAuthChange(async (user) => {
      setAuthUser(user);
      if (user) {
        await ensureUserDoc(user);
      } else {
        setRoleDoc(null);
      }
    });
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const unsub = subscribeToUserRole(authUser.uid, setRoleDoc);
    return unsub;
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    const unsub = subscribeToMachines(
      (data) => {
        setMachines(data);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
    return unsub;
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    const unsub = subscribeToStandInventory(setStandCount);
    return unsub;
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    const unsub = subscribeToTickets(setTickets);
    return unsub;
  }, [authUser]);

  useEffect(() => {
    if (!authUser || roleDoc?.role !== ROLES.ADMIN) return;
    const unsub = subscribeToUsers(setAllUsers);
    return unsub;
  }, [authUser, roleDoc]);

  // Still checking auth state on first load.
  if (authUser === undefined) {
    return <div style={{ padding: 40, color: "var(--paper-dim)" }}>Loading…</div>;
  }

  if (!authUser) {
    return <Login />;
  }

  if (roleDoc === undefined) {
    return <div style={{ padding: 40, color: "var(--paper-dim)" }}>Loading your account…</div>;
  }

  if (!roleDoc?.role) {
    return (
      <div style={{ padding: 40, maxWidth: 480 }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>Waiting for access</h1>
        <p style={{ color: "var(--paper-dim)" }}>
          You're signed in as <strong>{authUser.email}</strong>, but no role
          has been assigned yet. Ask an admin to assign you one from Manage
          Users.
        </p>
      </div>
    );
  }

  const role = roleDoc.role;

  if (error) {
    return (
      <div style={{ padding: 40, fontFamily: "monospace", color: "#d95d39" }}>
        Could not connect to Firebase: {error.message}
      </div>
    );
  }

  const missingPackingCount = machines.reduce(
    (sum, m) => sum + missingPackingItems(m).length,
    0
  );
  const warrantyExpiringCount = machines.filter((m) => isWarrantyExpiringSoon(m)).length;
  const notificationCount = missingPackingCount + warrantyExpiringCount;

  return (
    <Layout missingCount={notificationCount} role={role} userEmail={authUser.email}>
      <Routes>
        <Route
          path="/"
          element={
            <Gate role={role} allow={[ROLES.ADMIN, ROLES.DASHBOARD]}>
              <Dashboard machines={machines} loading={loading} tickets={tickets} role={role} currentUserEmail={authUser.email} />
            </Gate>
          }
        />
        <Route
          path="/machines"
          element={
            <Gate role={role} allow={[ROLES.ADMIN, ROLES.PRODUCTION, ROLES.INSTALLATION]}>
              <MachinesList machines={machines} role={role} currentUserEmail={authUser.email} />
            </Gate>
          }
        />
        <Route
          path="/machine/new"
          element={
            <Gate role={role} allow={[ROLES.ADMIN, ROLES.PRODUCTION]}>
              <AddMachine currentUserEmail={authUser.email} />
            </Gate>
          }
        />
        <Route
          path="/machine/:id"
          element={
            <Gate role={role} allow={[ROLES.ADMIN, ROLES.PRODUCTION, ROLES.INSTALLATION]}>
              <MachineDetail
                machines={machines}
                standCount={standCount}
                tickets={tickets}
                role={role}
                currentUserEmail={authUser.email}
              />
            </Gate>
          }
        />
        <Route
          path="/stand-inventory"
          element={
            <Gate role={role} allow={[ROLES.ADMIN, ROLES.PRODUCTION]}>
              <StandInventory standCount={standCount} currentUserEmail={authUser.email} />
            </Gate>
          }
        />
        <Route
          path="/maintenance"
          element={
            <Gate role={role} allow={[ROLES.ADMIN]}>
              <MaintenanceAdmin machines={machines} tickets={tickets} currentUserEmail={authUser.email} />
            </Gate>
          }
        />
        <Route
          path="/notifications"
          element={
            <Gate role={role} allow={[ROLES.ADMIN, ROLES.PRODUCTION]}>
              <Notifications machines={machines} />
            </Gate>
          }
        />
        <Route
          path="/manage-users"
          element={
            <Gate role={role} allow={[ROLES.ADMIN]}>
              <ManageUsers users={allUsers} />
            </Gate>
          }
        />
        <Route
          path="/audit-log"
          element={
            <Gate role={role} allow={[ROLES.ADMIN]}>
              <AuditLog />
            </Gate>
          }
        />
        <Route
          path="/duplicates"
          element={
            <Gate role={role} allow={[ROLES.ADMIN]}>
              <DuplicateMachines machines={machines} currentUserEmail={authUser.email} />
            </Gate>
          }
        />
        <Route path="*" element={<Navigate to={HOME_BY_ROLE[role] || "/"} replace />} />
      </Routes>
    </Layout>
  );
}
