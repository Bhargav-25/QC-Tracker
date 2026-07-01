import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createMachine } from "../utils/machinesApi";

export default function AddMachine() {
  const [machineNumber, setMachineNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!machineNumber.trim()) {
      setErrorMsg("Enter a machine number before saving.");
      return;
    }
    setSaving(true);
    setErrorMsg("");
    try {
      const id = await createMachine(machineNumber.trim());
      navigate(`/machine/${id}`);
    } catch (err) {
      setErrorMsg("Could not save machine: " + err.message);
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">New Record</div>
          <h1>Add Machine</h1>
        </div>
      </div>

      <div className="panel" style={{ maxWidth: 460 }}>
        <div className="section-title">Machine number</div>
        <div className="section-sub">
          This creates the machine record. Once saved it enters "Assembly stage" —
          you'll then move through resistance testing, temperature testing, photos,
          and packing from its detail page.
        </div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Machine Number</label>
            <input
              type="text"
              placeholder="e.g. MC-1042"
              value={machineNumber}
              onChange={(e) => setMachineNumber(e.target.value)}
              autoFocus
            />
          </div>
          {errorMsg && (
            <div className="helper-text" style={{ color: "var(--rust)", marginBottom: 12 }}>
              {errorMsg}
            </div>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save & Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
