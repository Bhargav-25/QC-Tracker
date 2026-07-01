import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import AddMachine from "./pages/AddMachine.jsx";
import MachineDetail from "./pages/MachineDetail.jsx";
import Notifications from "./pages/Notifications.jsx";
import { subscribeToMachines } from "./utils/machinesApi";
import { missingPackingItems } from "./utils/status";

export default function App() {
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  const missingCount = machines.reduce(
    (sum, m) => sum + missingPackingItems(m).length,
    0
  );

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
    <Layout missingCount={missingCount}>
      <Routes>
        <Route path="/" element={<Dashboard machines={machines} loading={loading} />} />
        <Route path="/machine/new" element={<AddMachine />} />
        <Route path="/machine/:id" element={<MachineDetail machines={machines} />} />
        <Route path="/notifications" element={<Notifications machines={machines} />} />
      </Routes>
    </Layout>
  );
}
