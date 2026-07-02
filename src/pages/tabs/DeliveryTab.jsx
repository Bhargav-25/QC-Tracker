import { useState } from "react";
import { updateMachine } from "../../utils/machinesApi";
import SectionMeta from "../../components/SectionMeta.jsx";

export default function DeliveryTab({ machine, currentUserEmail }) {
  const canDeliver = machine.dispatch?.dispatched;
  const [delivered, setDelivered] = useState(machine.delivery?.delivered || false);
  const [date, setDate] = useState(machine.delivery?.date || "");
  const [saving, setSaving] = useState(false);

  function handleMark() {
    setDelivered(true);
    if (!date) setDate(new Date().toISOString().slice(0, 10));
  }

  async function handleSave() {
    setSaving(true);
    await updateMachine(
      machine.id,
      { delivery: { delivered, date } },
      { userEmail: currentUserEmail, section: "delivery", machineNumber: machine.machineNumber }
    );
    setSaving(false);
  }

  if (!canDeliver) {
    return (
      <div className="panel" style={{ maxWidth: 480 }}>
        <div className="section-title">Delivery</div>
        <div className="empty-state">
          This machine hasn't been dispatched yet. Mark it as dispatched first,
          on the Dispatch tab.
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ maxWidth: 480 }}>
      <div className="section-title">Delivery</div>
      <div className="section-sub">
        Mark this machine as delivered once it reaches the customer.
      </div>
      <SectionMeta meta={machine.sectionMeta?.delivery} />

      {!delivered ? (
        <button className="btn btn-primary" onClick={handleMark}>
          Mark as Delivered
        </button>
      ) : (
        <div className="helper-text" style={{ color: "var(--teal)", marginBottom: 16 }}>
          Marked as delivered.{" "}
          <button className="btn btn-ghost" onClick={() => setDelivered(false)}>
            Undo
          </button>
        </div>
      )}

      <div className="field" style={{ marginTop: 16 }}>
        <label>Date of delivery</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
