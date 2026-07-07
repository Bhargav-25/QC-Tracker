import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { createMachine, findMachineByNumber } from "../utils/machinesApi";

export default function AddMachine({ currentUserEmail }) {
  const [machineNumber, setMachineNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [duplicateOf, setDuplicateOf] = useState(null);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMsg("");
    setDuplicateOf(null);
    if (!machineNumber.trim()) {
      setErrorMsg("Enter a machine number before saving.");
      return;
    }
    setSaving(true);
    try {
      const existing = await findMachineByNumber(machineNumber);
      if (existing) {
        setDuplicateOf(existing);
        setSaving(false);
        return;
      }
      const id = await createMachine(machineNumber.trim(), currentUserEmail);
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
              onChange={(e) => {
                setMachineNumber(e.target.value);
                setDuplicateOf(null);
              }}
              autoFocus
            />
          </div>
          {errorMsg && (
            <div className="helper-text" style={{ color: "var(--rust)", marginBottom: 12 }}>
              {errorMsg}
            </div>
          )}
          {duplicateOf && (
            <div
              className="helper-text"
              style={{ color: "var(--rust)", marginBottom: 12, border: "1px solid var(--rust)", borderRadius: "var(--radius)", padding: 12 }}
            >
              Machine number "{duplicateOf.machineNumber}" already exists.{" "}
              <Link to={`/machine/${duplicateOf.id}`} className="link">
                Open the existing record
              </Link>{" "}
              instead of creating a duplicate.
            </div>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Checking…" : "Save & Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
