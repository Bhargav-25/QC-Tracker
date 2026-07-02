import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createTicket } from "../utils/ticketsApi";
import { TICKET_STATUSES, emptyTicketDraft } from "../constants";

export default function MaintenanceAdmin({ machines, tickets, currentUserEmail }) {
  const [statusFilter, setStatusFilter] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [machineId, setMachineId] = useState("");
  const [draft, setDraft] = useState(emptyTicketDraft());
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const machineNumberById = useMemo(() => {
    const map = {};
    machines.forEach((m) => (map[m.id] = m.machineNumber));
    return map;
  }, [machines]);

  const sorted = [...tickets].sort((a, b) => (a.date < b.date ? 1 : -1));
  const visible = statusFilter === "All" ? sorted : sorted.filter((t) => t.status === statusFilter);

  async function handleCreate(e) {
    e.preventDefault();
    setErrorMsg("");
    if (!machineId) {
      setErrorMsg("Choose a machine.");
      return;
    }
    if (!draft.issueName.trim()) {
      setErrorMsg("Enter an issue name.");
      return;
    }
    setSaving(true);
    await createTicket(machineId, draft, {
      userEmail: currentUserEmail,
      machineNumber: machineNumberById[machineId],
    });
    setDraft(emptyTicketDraft());
    setMachineId("");
    setShowForm(false);
    setSaving(false);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Maintenance</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "+ Raise Ticket"}
        </button>
      </div>

      {showForm && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="section-title">Raise a ticket</div>
          <form onSubmit={handleCreate}>
            <div className="field">
              <label>Machine</label>
              <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
                <option value="">Choose a machine…</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>{m.machineNumber}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Issue name</label>
              <input
                type="text"
                value={draft.issueName}
                onChange={(e) => setDraft({ ...draft, issueName: e.target.value })}
                placeholder="e.g. Cable fraying"
              />
            </div>
            <div className="field">
              <label>Description</label>
              <textarea
                rows={2}
                style={{ width: "100%", fontFamily: "var(--font-body)" }}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <div className="field" style={{ maxWidth: 220 }}>
              <label>Date</label>
              <input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </div>
            {errorMsg && (
              <div className="helper-text" style={{ color: "var(--rust)", marginBottom: 12 }}>
                {errorMsg}
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Adding…" : "Add ticket"}
            </button>
          </form>
        </div>
      )}

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
          <div className="section-title">All tickets ({visible.length})</div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 160 }}>
            <option value="All">All statuses</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {visible.length === 0 ? (
          <div className="empty-state">No tickets match this filter.</div>
        ) : (
          <div className="checklist">
            {visible.map((t) => (
              <div className="checklist-item" key={t.id} style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>
                    <Link to={`/machine/${t.machineId}`} className="link">
                      {machineNumberById[t.machineId] || "Unknown machine"}
                    </Link>
                    {" — "}
                    {t.issueName}
                  </div>
                  <div className="helper-text">{t.date}</div>
                </div>
                <span
                  className={
                    "status-tag " +
                    (t.status === "Closed" ? "packed" : t.status === "In Progress" ? "testing" : "assembly")
                  }
                >
                  {t.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
