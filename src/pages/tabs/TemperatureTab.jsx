import { useState } from "react";
import { updateMachine } from "../../utils/machinesApi";
import SectionMeta from "../../components/SectionMeta.jsx";

export default function TemperatureTab({ machine, currentUserEmail }) {
  const [temp, setTemp] = useState(machine.temperature?.temp || "");
  const [time, setTime] = useState(machine.temperature?.time || "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  async function handleSave() {
    setSaving(true);
    await updateMachine(
      machine.id,
      { temperature: { temp, time } },
      { userEmail: currentUserEmail, section: "temperature", machineNumber: machine.machineNumber }
    );
    setSaving(false);
    setSavedAt(new Date());
  }

  return (
    <div className="panel" style={{ maxWidth: 460 }}>
      <div className="section-title">Temperature limit test</div>
      <div className="section-sub">
        Record the temperature reached and how long it took to get there.
      </div>
      <SectionMeta meta={machine.sectionMeta?.temperature} />

      <div className="field-row">
        <div className="field" style={{ flex: 1 }}>
          <label>Temperature (°C)</label>
          <input
            type="number"
            step="0.1"
            value={temp}
            onChange={(e) => setTemp(e.target.value)}
            placeholder="e.g. 65"
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Time (minutes)</label>
          <input
            type="number"
            step="0.1"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="e.g. 12"
          />
        </div>
      </div>

      <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        {savedAt && !saving && (
          <span className="helper-text">Saved {savedAt.toLocaleTimeString()}</span>
        )}
      </div>
    </div>
  );
}
