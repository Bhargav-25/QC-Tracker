import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import StatusTag from "../components/StatusTag.jsx";
import { computeStatus, warrantyDaysRemaining } from "../utils/status";
import { ROLES } from "../constants";
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

const ALL_TABS = [
  { key: "resistance", label: "Resistance", roles: [ROLES.ADMIN, ROLES.PRODUCTION] },
  { key: "temperature", label: "Temperature", roles: [ROLES.ADMIN, ROLES.PRODUCTION] },
  { key: "photos", label: "Photos", roles: [ROLES.ADMIN, ROLES.PRODUCTION] },
  { key: "packing", label: "Packing Checklist", roles: [ROLES.ADMIN, ROLES.PRODUCTION] },
  { key: "finalPacking", label: "Final Packing", roles: [ROLES.ADMIN, ROLES.PRODUCTION] },
  { key: "dispatch", label: "Dispatch", roles: [ROLES.ADMIN, ROLES.PRODUCTION] },
  { key: "delivery", label: "Delivery", roles: [ROLES.ADMIN, ROLES.INSTALLATION] },
  { key: "installation", label: "Installation", roles: [ROLES.ADMIN, ROLES.INSTALLATION] },
  { key: "warranty", label: "Warranty", roles: [ROLES.ADMIN] },
  { key: "maintenance", label: "Maintenance", roles: [ROLES.ADMIN] },
];

export default function MachineDetail({ machines, standCount, tickets, role, currentUserEmail }) {
  const { id } = useParams();
  const tabsForRole = ALL_TABS.filter((t) => t.roles.includes(role));
  const [tab, setTab] = useState(tabsForRole[0]?.key || "resistance");
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

  if (tabsForRole.length === 0) {
    return (
      <div>
        <div className="empty-state">
          You don't have access to machine details.{" "}
          <Link to="/" className="link">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const activeTab = tabsForRole.find((t) => t.key === tab) ? tab : tabsForRole[0].key;
  const status = computeStatus(machine);
  const daysRemaining = warrantyDaysRemaining(machine);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Machine Record</div>
          <h1>{machine.machineNumber}</h1>
          {machine.installation?.installedBy && (
            <div className="helper-text">Installed by {machine.installation.installedBy}</div>
          )}
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
        {tabsForRole.map((t) => (
          <button
            key={t.key}
            className={"tab-btn" + (activeTab === t.key ? " active" : "")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "resistance" && <ResistanceTab machine={machine} currentUserEmail={currentUserEmail} />}
      {activeTab === "temperature" && <TemperatureTab machine={machine} currentUserEmail={currentUserEmail} />}
      {activeTab === "photos" && <PhotosTab machine={machine} currentUserEmail={currentUserEmail} />}
      {activeTab === "packing" && <PackingChecklistTab machine={machine} currentUserEmail={currentUserEmail} />}
      {activeTab === "finalPacking" && <FinalPackingTab machine={machine} currentUserEmail={currentUserEmail} />}
      {activeTab === "dispatch" && <DispatchTab machine={machine} standCount={standCount} currentUserEmail={currentUserEmail} />}
      {activeTab === "delivery" && <DeliveryTab machine={machine} currentUserEmail={currentUserEmail} />}
      {activeTab === "installation" && (
        <InstallationTab machine={machine} currentUserEmail={currentUserEmail} />
      )}
      {activeTab === "warranty" && <WarrantyTab machine={machine} currentUserEmail={currentUserEmail} />}
      {activeTab === "maintenance" && (
        <MaintenanceTab machine={machine} tickets={tickets} currentUserEmail={currentUserEmail} />
      )}
    </div>
  );
}
