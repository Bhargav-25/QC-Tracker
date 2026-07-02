import { useMemo, useState } from "react";
import { createTicket, updateTicket } from "../../utils/ticketsApi";
import { uploadMachinePhoto, deleteMachinePhoto } from "../../utils/machinesApi";
import { TICKET_STATUSES, emptyTicketDraft } from "../../constants";

function TicketCard({ ticket, machineId }) {
  const [status, setStatus] = useState(ticket.status);
  const [scheduledResolutionDate, setScheduledResolutionDate] = useState(
    ticket.scheduledResolutionDate || ""
  );
  const [solution, setSolution] = useState(ticket.solution || "");
  const [photo, setPhoto] = useState(ticket.photo || null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const isClosing = status === "Closed";

  async function handlePhotoUpload(file) {
    if (!file) return;
    setUploading(true);
    try {
      const { url, path } = await uploadMachinePhoto(machineId, "maintenance", file);
      if (photo?.path) await deleteMachinePhoto(photo.path);
      setPhoto({ url, path });
    } catch (err) {
      alert("Upload failed: " + err.message);
    }
    setUploading(false);
  }

  async function handleRemovePhoto() {
    if (photo?.path) await deleteMachinePhoto(photo.path);
    setPhoto(null);
  }

  async function handleSave() {
    setSaving(true);
    await updateTicket(ticket.id, { status, scheduledResolutionDate, solution, photo });
    setSaving(false);
  }

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{ticket.issueName}</div>
          <div className="helper-text">Reported {ticket.date}</div>
        </div>
        <span
          className={
            "status-tag " +
            (ticket.status === "Closed" ? "packed" : ticket.status === "In Progress" ? "testing" : "assembly")
          }
        >
          {status}
        </span>
      </div>

      {ticket.description && (
        <p style={{ marginTop: 12, marginBottom: 12, fontSize: 13.5, color: "var(--paper-dim)" }}>
          {ticket.description}
        </p>
      )}

      <div className="field-row">
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label>Scheduled resolution date</label>
          <input
            type="date"
            value={scheduledResolutionDate}
            onChange={(e) => setScheduledResolutionDate(e.target.value)}
          />
        </div>
      </div>

      {isClosing && (
        <>
          <div className="field">
            <label>Solution provided</label>
            <textarea
              rows={2}
              style={{ width: "100%", fontFamily: "var(--font-body)" }}
              value={solution}
              onChange={(e) => setSolution(e.target.value)}
              placeholder="What fixed it…"
            />
          </div>
          <div className="field">
            <label>Photo (optional)</label>
            <div className="photo-grid" style={{ maxWidth: 150 }}>
              {photo ? (
                <div className="photo-slot">
                  <img src={photo.url} alt="Resolution" />
                  <button className="remove-btn" onClick={handleRemovePhoto}>Remove</button>
                </div>
              ) : (
                <div className="photo-slot">
                  <label>
                    {uploading ? "Uploading…" : "+ Add photo"}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      disabled={uploading}
                      onChange={(e) => handlePhotoUpload(e.target.files[0])}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

export default function MaintenanceTab({ machine, tickets }) {
  const [draft, setDraft] = useState(emptyTicketDraft());
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const machineTickets = tickets
    .filter((t) => t.machineId === machine.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const issueSuggestions = useMemo(() => {
    const names = new Set(tickets.map((t) => t.issueName).filter(Boolean));
    return Array.from(names).sort();
  }, [tickets]);

  async function handleCreate(e) {
    e.preventDefault();
    setErrorMsg("");
    if (!draft.issueName.trim()) {
      setErrorMsg("Enter an issue name.");
      return;
    }
    setSaving(true);
    await createTicket(machine.id, draft);
    setDraft(emptyTicketDraft());
    setSaving(false);
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="section-title">New maintenance ticket</div>
        <form onSubmit={handleCreate}>
          <div className="field">
            <label>Issue name</label>
            <input
              type="text"
              list="issue-name-suggestions"
              value={draft.issueName}
              onChange={(e) => setDraft({ ...draft, issueName: e.target.value })}
              placeholder="e.g. Cable fraying"
            />
            <datalist id="issue-name-suggestions">
              {issueSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label>Description</label>
            <textarea
              rows={2}
              style={{ width: "100%", fontFamily: "var(--font-body)" }}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="What's wrong, reported by whom, etc."
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

      <div className="section-title" style={{ marginBottom: 12 }}>
        Ticket history ({machineTickets.length})
      </div>
      {machineTickets.length === 0 ? (
        <div className="empty-state">No maintenance tickets for this machine yet.</div>
      ) : (
        machineTickets.map((t) => <TicketCard key={t.id} ticket={t} machineId={machine.id} />)
      )}
    </div>
  );
}
