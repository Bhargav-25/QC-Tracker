import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import StatusTag from "../components/StatusTag.jsx";
import { computeStatus } from "../utils/status";
import ResistanceTab from "./tabs/ResistanceTab.jsx";
import TemperatureTab from "./tabs/TemperatureTab.jsx";
import PhotosTab from "./tabs/PhotosTab.jsx";
import PackingChecklistTab from "./tabs/PackingChecklistTab.jsx";
import FinalPackingTab from "./tabs/FinalPackingTab.jsx";
import DispatchTab from "./tabs/DispatchTab.jsx";

const TABS = [
  { key: "resistance", label: "Resistance" },
  { key: "temperature", label: "Temperature" },
  { key: "photos", label: "Photos" },
  { key: "packing", label: "Packing Checklist" },
  { key: "finalPacking", label: "Final Packing" },
  { key: "dispatch", label: "Dispatch" },
];

export default function MachineDetail({ machines }) {
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

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Machine Record</div>
          <h1>{machine.machineNumber}</h1>
        </div>
        <StatusTag status={status} />
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
      {tab === "dispatch" && <DispatchTab machine={machine} />}
    </div>
  );
}
