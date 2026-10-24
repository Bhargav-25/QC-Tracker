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
import OrdersList from "./pages/OrdersList.jsx";
import OrderDetail from "./pages/OrderDetail.jsx";
import PartsPage from "./pages/PartsPage.jsx";
import ReviveQueuePage from "./pages/ReviveQueuePage.jsx";
import { subscribeToPartCounts, subscribeToParts, subscribeToReviveQueue } from "./utils/partsApi";
import { subscribeToMachines } from "./utils/machinesApi";
import { subscribeToOrders } from "./utils/ordersApi";
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
  [ROLES.SALES]: "/orders",
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
  const [orders, setOrders] = useState([]);
  const [ordersError, setOrdersError] = useState(null);
  const [parts, setParts] = useState([]);
  const [partsError, setPartsError] = useState(null);
  const [reviveQueue, setReviveQueue] = useState([]);
  const [reviveError, setReviveError] = useState(null);
  const [partCounts, setPartCounts] = useState({ reviveQueueCount: 0 });

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

  // Parts and the revive queue are Admin/Production only. A rules error here
  // must not take down machines or the dashboard.
  useEffect(() => {
    if (!authUser) return;
    const role = roleDoc?.role;
    if (role !== ROLES.ADMIN && role !== ROLES.PRODUCTION) return;
    const unsubParts = subscribeToParts(
      (data) => {
        setParts(data);
        setPartsError(null);
      },
      setPartsError
    );
    const unsubQueue = subscribeToReviveQueue(
      (data) => {
        setReviveQueue(data);
        setReviveError(null);
      },
      setReviveError
    );
    return () => {
      unsubParts();
      unsubQueue();
    };
  }, [authUser, roleDoc]);

  useEffect(() => {
    if (!authUser) return;
    const role = roleDoc?.role;
    if (role !== ROLES.ADMIN && role !== ROLES.PRODUCTION && role !== ROLES.DASHBOARD) return;
    return subscribeToPartCounts(
      (data) => setPartCounts(data || { reviveQueueCount: 0 }),
      () => setPartCounts({ reviveQueueCount: 0 })
    );
  }, [authUser, roleDoc]);

  // Orders failing (for example before the new rules are published) must not
  // take down machines, the dashboard, or sign-in.
  useEffect(() => {
    if (!authUser) return;
    const unsub = subscribeToOrders(
      (data) => {
        setOrders(data);
        setOrdersError(null);
      },
      (err) => setOrdersError(err)
    );
    return unsub;
  }, [authUser]);

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
              <Dashboard machines={machines} loading={loading} tickets={tickets} role={role} currentUserEmail={authUser.email} standCount={standCount} reviveQueueCount={partCounts.reviveQueueCount || 0} />
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
                orders={orders}
                standCount={standCount}
                tickets={tickets}
                role={role}
                currentUserEmail={authUser.email}
                parts={parts}
              />
            </Gate>
          }
        />
        <Route
          path="/parts"
          element={
            <Gate role={role} allow={[ROLES.ADMIN, ROLES.PRODUCTION]}>
              <PartsPage parts={parts} role={role} currentUserEmail={authUser.email} error={partsError} />
            </Gate>
          }
        />
        <Route
          path="/revive"
          element={
            <Gate role={role} allow={[ROLES.ADMIN, ROLES.PRODUCTION]}>
              <ReviveQueuePage items={reviveQueue} currentUserEmail={authUser.email} error={reviveError} />
            </Gate>
          }
        />
        <Route
          path="/orders"
          element={
            <Gate role={role} allow={[ROLES.ADMIN, ROLES.SALES, ROLES.PRODUCTION]}>
              <OrdersList orders={orders} machines={machines} role={role} ordersError={ordersError} />
            </Gate>
          }
        />
        <Route
          path="/orders/new"
          element={
            <Gate role={role} allow={[ROLES.ADMIN, ROLES.SALES]}>
              <OrderDetail
                orders={orders}
                machines={machines}
                role={role}
                currentUserEmail={authUser.email}
                creating
              />
            </Gate>
          }
        />
        <Route
          path="/orders/:groupNumber"
          element={
            <Gate role={role} allow={[ROLES.ADMIN, ROLES.SALES, ROLES.PRODUCTION, ROLES.INSTALLATION]}>
              <OrderDetail
                orders={orders}
                machines={machines}
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
