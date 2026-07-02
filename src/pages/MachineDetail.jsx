import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import StatusTag from "../components/StatusTag.jsx";
import { computeStatus, warrantyDaysRemaining } from "../utils/status";
import ResistanceTab from "./tabs/ResistanceTab.jsx";
import TemperatureTab from "./tabs/TemperatureTab.jsx";
import PhotosTab from "./tabs/PhotosTab.jsx";
import PackingChecklistTab from "./tabs/PackingChecklistTab.jsx";
import FinalPackingTab from "./tabs/FinalPackingTab.jsx";
import DispatchTab from "./tabs/DispatchTab.jsx";
import DeliveryTab from "./tabs/DeliveryTab.jsx";
import InstallationTab from "./tabs/InstallationTab.jsx";
import WarrantyTab from "./tabs/WarrantyTab.jsx";
import MaintenanceTab from "./tabs/MaintenanceTab.jsx";

const TABS = [
  { key: "resistance", label: "Resistance" },
  { key: "temperature", label: "Temperature" },
  { key: "photos", label: "Photos" },
  { key: "packing", label: "Packing Checklist" },
  { key: "finalPacking", label: "Final Packing" },
  { key: "dispatch", label: "Dispatch" },
  { key: "delivery", label: "Delivery" },
  { key: "installation", label: "Installation" },
  { key: "warranty", label: "Warranty" },
  { key: "maintenance", label: "Maintenance" },
];

export default function MachineDetail({ machines, standCount, tickets }) {
  const { id } = useParams();
  const [tab, setTab] = useState("resistance");
  const machine = machines.find((m) => m.id === id);

  if (!machine) {
    return (
      <div>
        <div className="empty-state">
          Machine not found, or still loading.{" "}
          <Link to="/" className="link">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const status = computeStatus(machine);
  const daysRemaining = warrantyDaysRemaining(machine);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Machine Record</div>
          <h1>{machine.machineNumber}</h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {daysRemaining !== null && (
            <span
              className={"status-tag " + (daysRemaining < 0 ? "dispatched" : daysRemaining <= 10 ? "testing" : "packed")}
              style={daysRemaining < 0 ? { color: "var(--rust)" } : undefined}
            >
              {daysRemaining < 0
                ? `Warranty expired ${Math.abs(daysRemaining)}d ago`
                : `Warranty: ${daysRemaining}d left`}
            </span>
          )}
          <StatusTag status={status} />
        </div>
      </div>

      <div className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={"tab-btn" + (tab === t.key ? " active" : "")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "resistance" && <ResistanceTab machine={machine} />}
      {tab === "temperature" && <TemperatureTab machine={machine} />}
      {tab === "photos" && <PhotosTab machine={machine} />}
      {tab === "packing" && <PackingChecklistTab machine={machine} />}
      {tab === "finalPacking" && <FinalPackingTab machine={machine} />}
      {tab === "dispatch" && <DispatchTab machine={machine} standCount={standCount} />}
      {tab === "delivery" && <DeliveryTab machine={machine} />}
      {tab === "installation" && <InstallationTab machine={machine} />}
      {tab === "warranty" && <WarrantyTab machine={machine} />}
      {tab === "maintenance" && <MaintenanceTab machine={machine} tickets={tickets} />}
    </div>
  );
}
