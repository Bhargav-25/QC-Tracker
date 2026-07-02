import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import AddMachine from "./pages/AddMachine.jsx";
import MachineDetail from "./pages/MachineDetail.jsx";
import Notifications from "./pages/Notifications.jsx";
import { subscribeToMachines } from "./utils/machinesApi";
import { subscribeToStandInventory } from "./utils/inventoryApi";
import { subscribeToTickets } from "./utils/ticketsApi";
import { missingPackingItems, isWarrantyExpiringSoon } from "./utils/status";

export default function App() {
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [standCount, setStandCount] = useState(0);
  const [tickets, setTickets] = useState([]);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    const unsub = subscribeToStandInventory(setStandCount);
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeToTickets(setTickets);
    return unsub;
  }, []);

  const missingPackingCount = machines.reduce(
    (sum, m) => sum + missingPackingItems(m).length,
    0
  );
  const warrantyExpiringCount = machines.filter((m) =>
    isWarrantyExpiringSoon(m)
  ).length;
  const notificationCount = missingPackingCount + warrantyExpiringCount;

  if (error) {
    return (
      <div style={{ padding: 40, fontFamily: "monospace", color: "#d95d39" }}>
        Could not connect to Firebase: {error.message}
        <br />
        Check your .env file has the correct Firebase config values.
      </div>
    );
  }

  return (
    <Layout missingCount={notificationCount}>
      <Routes>
        <Route
          path="/"
          element={
            <Dashboard
              machines={machines}
              loading={loading}
              standCount={standCount}
              tickets={tickets}
            />
          }
        />
        <Route path="/machine/new" element={<AddMachine />} />
        <Route
          path="/machine/:id"
          element={
            <MachineDetail
              machines={machines}
              standCount={standCount}
              tickets={tickets}
            />
          }
        />
        <Route
          path="/notifications"
          element={<Notifications machines={machines} />}
        />
      </Routes>
    </Layout>
  );
}
