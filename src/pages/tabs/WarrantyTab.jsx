import { useState } from "react";
import { updateMachine } from "../../utils/machinesApi";
import { warrantyEndDate, warrantyDaysRemaining } from "../../utils/status";
import { DEFAULT_WARRANTY_YEARS } from "../../constants";
import SectionMeta from "../../components/SectionMeta.jsx";

export default function WarrantyTab({ machine, currentUserEmail }) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [months, setMonths] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const installDate = machine.installation?.date;
  const extensions = machine.warranty?.extensions || [];
  const endDate = warrantyEndDate(machine);
  const daysRemaining = warrantyDaysRemaining(machine);

  async function handleAddExtension(e) {
    e.preventDefault();
    setErrorMsg("");
    if (!invoiceNumber.trim() || !invoiceDate || !months || Number(months) <= 0) {
      setErrorMsg("Fill in invoice number, invoice date, and months to extend.");
      return;
    }
    setSaving(true);
    const next = [
      ...extensions,
      {
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        months: Number(months),
        addedAt: new Date().toISOString(),
      },
    ];
    await updateMachine(
      machine.id,
      { warranty: { extensions: next } },
      { userEmail: currentUserEmail, section: "warranty", machineNumber: machine.machineNumber, action: `added ${months}-month warranty extension (invoice ${invoiceNumber.trim()})` }
    );
    setInvoiceNumber("");
    setInvoiceDate("");
    setMonths("");
    setSaving(false);
  }

  async function handleRemoveExtension(index) {
    if (!window.confirm("Remove this warranty extension?")) return;
    const next = extensions.filter((_, i) => i !== index);
    await updateMachine(
      machine.id,
      { warranty: { extensions: next } },
      { userEmail: currentUserEmail, section: "warranty", machineNumber: machine.machineNumber, action: "removed a warranty extension" }
    );
  }

  if (!installDate) {
    return (
      <div className="panel" style={{ maxWidth: 560 }}>
        <div className="section-title">Warranty</div>
        <div className="empty-state">
          Warranty starts counting from the installation date. Set that on
          the Installation tab first.
        </div>
      </div>
    );
  }

  const expired = daysRemaining !== null && daysRemaining < 0;
  const expiringSoon = daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 10;

  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <div className="section-title">Warranty</div>
      <div className="section-sub">
        Defaults to {DEFAULT_WARRANTY_YEARS} year from the installation date
        ({installDate}), plus any extensions recorded below.
      </div>
      <SectionMeta meta={machine.sectionMeta?.warranty} />

      <div
        className="panel"
        style={{
          background: "var(--panel-raised)",
          marginBottom: 24,
          borderColor: expired ? "var(--rust)" : expiringSoon ? "var(--amber)" : "var(--line)",
        }}
      >
        <div className="eyebrow">Warranty ends</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 22, marginTop: 4 }}>
          {endDate.toLocaleDateString()}
        </div>
        <div
          className="helper-text"
          style={{
            marginTop: 6,
            color: expired ? "var(--rust)" : expiringSoon ? "var(--amber)" : "var(--paper-dim)",
          }}
        >
          {expired
            ? `Expired ${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? "" : "s"} ago`
            : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining`}
        </div>
      </div>

      <div className="section-title" style={{ fontSize: 14 }}>Extension history</div>
      {extensions.length === 0 ? (
        <div className="helper-text" style={{ marginBottom: 20 }}>No extensions added yet.</div>
      ) : (
        <div className="checklist" style={{ marginBottom: 20 }}>
          {extensions.map((ext, i) => (
            <div className="checklist-item" key={i}>
              <span className="name">
                +{ext.months} month{Number(ext.months) === 1 ? "" : "s"} — Invoice{" "}
                <strong>{ext.invoiceNumber}</strong> ({ext.invoiceDate})
              </span>
              <button className="btn btn-ghost" onClick={() => handleRemoveExtension(i)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="section-title" style={{ fontSize: 14 }}>Add extension</div>
      <form onSubmit={handleAddExtension}>
        <div className="field-row">
          <div className="field" style={{ flex: 1 }}>
            <label>Invoice number</label>
            <input
              type="text"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="e.g. INV-2044"
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Invoice date</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Extend by (months)</label>
            <input
              type="number"
              min="1"
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              placeholder="e.g. 12"
            />
          </div>
        </div>
        {errorMsg && (
          <div className="helper-text" style={{ color: "var(--rust)", marginBottom: 12 }}>
            {errorMsg}
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Add extension"}
        </button>
      </form>
    </div>
  );
}
