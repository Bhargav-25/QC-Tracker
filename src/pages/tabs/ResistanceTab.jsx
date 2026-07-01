import { useState } from "react";
import { updateMachine } from "../../utils/machinesApi";

export default function ResistanceTab({ machine }) {
  const [rows, setRows] = useState(machine.resistance);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  function handleChange(index, field, value) {
    const next = rows.map((row, i) =>
      i === index ? { ...row, [field]: value } : row
    );
    setRows(next);
  }

  async function handleSave() {
    setSaving(true);
    await updateMachine(machine.id, { resistance: rows });
    setSaving(false);
    setSavedAt(new Date());
  }

  return (
    <div className="panel">
      <div className="section-title">Resistance test</div>
      <div className="section-sub">
        Enter resistance in kgs for eccentric and concentric mode at each fixed current value.
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Current value (A)</th>
            <th>Eccentric (kg)</th>
            <th>Concentric (kg)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.current}>
              <td className="current-val">{row.current}</td>
              <td>
                <input
                  type="number"
                  step="0.1"
                  value={row.eccentric}
                  onChange={(e) => handleChange(i, "eccentric", e.target.value)}
                  placeholder="—"
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.1"
                  value={row.concentric}
                  onChange={(e) => handleChange(i, "concentric", e.target.value)}
                  placeholder="—"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12 }}>
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
