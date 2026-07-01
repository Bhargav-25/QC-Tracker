import { useState } from "react";
import { updateMachine } from "../../utils/machinesApi";

export default function DispatchTab({ machine }) {
  const [dispatched, setDispatched] = useState(machine.dispatch?.dispatched || false);
  const [date, setDate] = useState(machine.dispatch?.date || "");
  const [comment, setComment] = useState(machine.dispatch?.comment || "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await updateMachine(machine.id, {
      dispatch: { dispatched, date, comment },
    });
    setSaving(false);
  }

  function handleMarkDispatched() {
    setDispatched(true);
    if (!date) {
      setDate(new Date().toISOString().slice(0, 10));
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 480 }}>
      <div className="section-title">Dispatch</div>
      <div className="section-sub">
        Mark this machine as dispatched once it has left the facility.
      </div>

      {!dispatched ? (
        <button className="btn btn-primary" onClick={handleMarkDispatched}>
          Mark as Dispatched
        </button>
      ) : (
        <div
          className="helper-text"
          style={{ color: "var(--teal)", marginBottom: 16 }}
        >
          Marked as dispatched.{" "}
          <button className="btn btn-ghost" onClick={() => setDispatched(false)}>
            Undo
          </button>
        </div>
      )}

      <div className="field" style={{ marginTop: 16 }}>
        <label>Date of dispatch</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <div className="field">
        <label>Comment / remark</label>
        <textarea
          rows={3}
          style={{ width: "100%", fontFamily: "var(--font-body)" }}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Any remarks about this machine or its dispatch…"
        />
      </div>

      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
