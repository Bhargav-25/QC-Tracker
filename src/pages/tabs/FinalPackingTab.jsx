import { useState } from "react";
import { FINAL_PACKING_ITEMS } from "../../constants";
import { updateMachine } from "../../utils/machinesApi";

export default function FinalPackingTab({ machine }) {
  const [steps, setSteps] = useState(machine.finalPacking);
  const [saving, setSaving] = useState(false);

  function toggle(key) {
    setSteps((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSave() {
    setSaving(true);
    await updateMachine(machine.id, { finalPacking: steps });
    setSaving(false);
  }

  const allDone = FINAL_PACKING_ITEMS.every((item) => steps[item.key]);

  return (
    <div className="panel">
      <div className="section-title">Final packing</div>
      <div className="section-sub">
        Complete these steps to move the machine into packed inventory. Once all
        four are marked, this machine's status becomes "Packed".
      </div>

      <div className="checklist">
        {FINAL_PACKING_ITEMS.map((item) => (
          <div className="checklist-item" key={item.key}>
            <input
              type="checkbox"
              checked={steps[item.key]}
              onChange={() => toggle(item.key)}
            />
            <span className="name">{item.label}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        {allDone && (
          <span className="helper-text" style={{ color: "var(--teal)" }}>
            All steps complete — will show as Packed
          </span>
        )}
      </div>
    </div>
  );
}
