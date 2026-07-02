import { useState } from "react";
import { PACKING_CHECKLIST_ITEMS } from "../../constants";
import { updateMachine } from "../../utils/machinesApi";
import SectionMeta from "../../components/SectionMeta.jsx";

export default function PackingChecklistTab({ machine, currentUserEmail }) {
  const [checklist, setChecklist] = useState(machine.packingChecklist);
  const [saving, setSaving] = useState(false);
  const sentBack = machine.packingSentBack || {};

  function toggle(key) {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSave() {
    setSaving(true);
    await updateMachine(
      machine.id,
      { packingChecklist: checklist },
      { userEmail: currentUserEmail, section: "packing", machineNumber: machine.machineNumber }
    );
    setSaving(false);
  }

  const missingCount = PACKING_CHECKLIST_ITEMS.filter(
    (item) => !checklist[item.key] && !sentBack[item.key]
  ).length;

  return (
    <div className="panel">
      <div className="section-title">Packing checklist — items included in the box</div>
      <div className="section-sub">
        Mark each item as you place it in the box shipped to the customer. Anything
        left unmarked when saved will show up in Notifications so it can be sent
        separately.
      </div>
      <SectionMeta meta={machine.sectionMeta?.packing} />

      <div className="checklist">
        {PACKING_CHECKLIST_ITEMS.map((item) => (
          <div className="checklist-item" key={item.key}>
            <input
              type="checkbox"
              checked={checklist[item.key]}
              onChange={() => toggle(item.key)}
            />
            <span className="name">{item.label}</span>
            {!checklist[item.key] && sentBack[item.key] && (
              <span className="helper-text" style={{ color: "var(--teal)" }}>
                Sent separately
              </span>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save checklist"}
        </button>
        {missingCount > 0 && (
          <span className="helper-text" style={{ color: "var(--rust)" }}>
            {missingCount} item{missingCount > 1 ? "s" : ""} not marked yet
          </span>
        )}
      </div>
    </div>
  );
}
