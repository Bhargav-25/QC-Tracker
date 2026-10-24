import { useState } from "react";
import ViewableImage from "../../components/ViewableImage.jsx";
import { deleteMachinePhoto, uploadMachinePhoto } from "../../utils/machinesApi";
import { recordMachineReturn, updateReturnDetails } from "../../utils/returnsApi";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function when(value) {
  if (!value) return "—";
  if (typeof value === "string") return value.slice(0, 10);
  return "—";
}

export default function ReturnTab({ machine, currentUserEmail, preview = false }) {
  const intake = machine.intake;
  const open = Boolean(intake) && !intake.refurb?.completedAt;
  const closed = Boolean(intake?.refurb?.completedAt);
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState("");
  const [fromGroupNo, setFromGroupNo] = useState(machine.groupNumber || "");
  const [receivedAt, setReceivedAt] = useState(today());
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  async function handleRecord(e) {
    e.preventDefault();
    const from = fromGroupNo.trim() || machine.groupNumber || "no linked order";
    const ok = window.confirm(
      `Archive cycle ${machine.cycle || (machine.cycles?.length || 0) + 1} of ${machine.machineNumber} ` +
        `(order ${from}, dispatch, delivery, installation, and warranty) and clear the active record ` +
        `so it can be tested and linked to a new order? The machine number stays the same.`
    );
    if (!ok) return;
    if (preview) {
      setErrorMsg("");
      setFiles([]);
      window.alert("Preview only. A real save archives this cycle and clears the active checks.");
      return;
    }
    setSaving(true);
    setErrorMsg("");
    try {
      const photos = [];
      for (const file of files) {
        photos.push(await uploadMachinePhoto(machine.id, "return", file));
      }
      await recordMachineReturn({
        machineId: machine.id,
        input: { date, reason, fromGroupNo, receivedAt, notes },
        photos,
        userEmail: currentUserEmail,
      });
      setFiles([]);
      setReason("");
      setNotes("");
    } catch (err) {
      setErrorMsg(err.message);
    }
    setSaving(false);
  }

  async function handleAddPhoto(file) {
    if (!file) return;
    setSaving(true);
    setErrorMsg("");
    try {
      const photo = await uploadMachinePhoto(machine.id, "return", file);
      await updateReturnDetails({
        machineId: machine.id,
        patch: { addPhotos: [photo] },
        userEmail: currentUserEmail,
      });
    } catch (err) {
      setErrorMsg(err.message);
    }
    setSaving(false);
  }

  async function handleRemovePhoto(photo) {
    setSaving(true);
    setErrorMsg("");
    try {
      await deleteMachinePhoto(photo.path);
      await updateReturnDetails({
        machineId: machine.id,
        patch: { removePhotoPath: photo.path },
        userEmail: currentUserEmail,
      });
    } catch (err) {
      setErrorMsg(err.message);
    }
    setSaving(false);
  }

  const cycles = Array.isArray(machine.cycles) ? machine.cycles : [];

  return (
    <div className="panel" style={{ maxWidth: 760 }}>
      <div className="section-title">Machine return</div>
      <div className="section-sub">
        The machine number stays {machine.machineNumber}. Recording a return archives this
        cycle (dispatch, delivery, installation, order link, and warranty) and clears the
        active checks so the machine can be refurbished, re-tested, and sold again.
      </div>
      {errorMsg && (
        <div className="helper-text" style={{ color: "var(--rust)", marginBottom: 12 }}>
          {errorMsg}
        </div>
      )}

      {!intake && (
        <form onSubmit={handleRecord}>
          <div className="field-row">
            <div className="field">
              <label>Return date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="field">
              <label>Received at workshop</label>
              <input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} required />
            </div>
            <div className="field">
              <label>From group no.</label>
              <input value={fromGroupNo} onChange={(e) => setFromGroupNo(e.target.value)} placeholder={machine.groupNumber || "G1443"} />
            </div>
          </div>
          <div className="field">
            <label>Reason</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the customer sent it back" required />
          </div>
          <div className="field">
            <label>Inspection notes</label>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What the workshop found" />
          </div>
          <div className="field">
            <label>Inspection photos</label>
            <input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            {files.length > 0 && <div className="helper-text">{files.length} photo{files.length === 1 ? "" : "s"} ready to upload</div>}
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Record return"}
          </button>
        </form>
      )}

      {intake && (
        <div>
          <div className="helper-text" style={{ marginBottom: 12 }}>
            {closed ? "Refurbishment is complete. This return is closed." : open ? "Return recorded. Refurbishment has not been completed." : ""}
          </div>
          <div className="field-row">
            <div className="field"><label>Return date</label><div>{intake.date || "—"}</div></div>
            <div className="field"><label>Received at workshop</label><div>{intake.receivedAt || "—"}</div></div>
            <div className="field"><label>From group no.</label><div>{intake.fromGroupNo || "—"}</div></div>
          </div>
          <div className="field"><label>Reason</label><div>{intake.reason || "—"}</div></div>
          <div className="field"><label>Inspection notes</label><div>{intake.notes || "—"}</div></div>
          <div className="photo-grid">
            {(intake.photos || []).map((photo) => (
              <div className="photo-slot" key={photo.path}>
                <ViewableImage src={photo.url} alt="Return inspection" />
                {open && (
                  <button className="remove-btn" type="button" disabled={saving} onClick={() => handleRemovePhoto(photo)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          {open && (
            <div className="field">
              <label>Add inspection photo</label>
              <input type="file" accept="image/*" disabled={saving} onChange={(e) => handleAddPhoto(e.target.files?.[0])} />
            </div>
          )}
        </div>
      )}

      {cycles.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div className="section-title">Previous cycles</div>
          <div className="section-sub">Cycle 1 is the first customer. The machine number did not change.</div>
          {cycles.map((cycle) => (
            <div key={`${cycle.cycle}-${cycle.closedAt || ""}`} className="checklist-item">
              <span className="name">
                Cycle {cycle.cycle}
                {cycle.groupNumber ? ` · ${cycle.groupNumber}` : ""}
                {cycle.return?.date ? ` · returned ${when(cycle.return.date)}` : ""}
                {cycle.dispatch?.date ? ` · dispatched ${cycle.dispatch.date}` : ""}
                {cycle.installation?.date ? ` · installed ${cycle.installation.date}` : ""}
              </span>
              <span className="helper-text">{cycle.return?.reason || ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
