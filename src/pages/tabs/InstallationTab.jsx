import { useState } from "react";
import { updateMachine } from "../../utils/machinesApi";

export default function InstallationTab({ machine }) {
  const canInstall = machine.delivery?.delivered;
  const [installed, setInstalled] = useState(machine.installation?.installed || false);
  const [date, setDate] = useState(machine.installation?.date || "");
  const [saving, setSaving] = useState(false);

  function handleMark() {
    setInstalled(true);
    if (!date) setDate(new Date().toISOString().slice(0, 10));
  }

  async function handleSave() {
    setSaving(true);
    await updateMachine(machine.id, { installation: { installed, date } });
    setSaving(false);
  }

  if (!canInstall) {
    return (
      <div className="panel" style={{ maxWidth: 480 }}>
        <div className="section-title">Installation</div>
        <div className="empty-state">
          This machine hasn't been marked as delivered yet. Do that first, on
          the Delivery tab.
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ maxWidth: 480 }}>
      <div className="section-title">Installation</div>
      <div className="section-sub">
        Mark this machine as installed once it's set up and running at the
        customer's site. This date starts the warranty countdown.
      </div>

      {!installed ? (
        <button className="btn btn-primary" onClick={handleMark}>
          Mark as Installed
        </button>
      ) : (
        <div className="helper-text" style={{ color: "var(--teal)", marginBottom: 16 }}>
          Marked as installed.{" "}
          <button className="btn btn-ghost" onClick={() => setInstalled(false)}>
            Undo
          </button>
        </div>
      )}

      <div className="field" style={{ marginTop: 16 }}>
        <label>Date of installation</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
