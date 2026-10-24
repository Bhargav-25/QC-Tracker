import { useEffect, useMemo, useState } from "react";
import { groupPartsForPicker, partDisplayName } from "../../domain/partsCatalog.js";
import { addRefurbLine, completeRefurb, undoRefurbLine } from "../../utils/returnsApi";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function RefurbTab({ machine, parts = [], currentUserEmail, preview = false }) {
  const intake = machine.intake;
  const refurb = intake?.refurb || {};
  const completed = Boolean(refurb.completedAt);
  const [query, setQuery] = useState("");
  const [partCode, setPartCode] = useState("");
  const [qty, setQty] = useState("1");
  const [source, setSource] = useState("New");
  const [disposition, setDisposition] = useState("Scrap");
  const [completedAt, setCompletedAt] = useState(refurb.completedAt || today());
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [extraLines, setExtraLines] = useState([]);

  const grouped = useMemo(() => groupPartsForPicker(parts, query), [parts, query]);
  const selected = parts.find((part) => part.code === partCode || part.id === partCode) || null;
  const stock = Number(selected?.revivedStock || 0);
  const revivable = selected?.revivable === true;
  const unit = selected?.unit === "mtr" ? "mtr" : "pcs";

  useEffect(() => {
    if (selected && !revivable && disposition === "Revive") setDisposition("Scrap");
    if (selected && source === "Revived" && stock <= 0) setSource("New");
  }, [selected, revivable, disposition, source, stock]);

  function choose(part) {
    setPartCode(part.code || part.id);
    setErrorMsg("");
    if (part.unit === "mtr") setQty((current) => (current === "1" ? "1" : current));
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (preview) {
      if (!selected) return;
      setExtraLines((rows) => [
        ...rows,
        {
          id: `preview-${rows.length}`,
          partCode: selected.code,
          partName: selected.name,
          qty: Number(qty) || 1,
          unit,
          source,
          disposition,
          undone: false,
        },
      ]);
      setErrorMsg("");
      return;
    }
    setSaving(true);
    setErrorMsg("");
    try {
      await addRefurbLine({
        machineId: machine.id,
        partCode: selected?.code || partCode,
        qty,
        source,
        disposition,
        userEmail: currentUserEmail,
      });
      setQty("1");
    } catch (err) {
      setErrorMsg(err.message);
    }
    setSaving(false);
  }

  async function handleUndo(lineId) {
    if (!window.confirm("Undo this replacement? A reversing ledger entry is written. The original entry stays.")) return;
    if (preview) {
      setExtraLines((rows) => rows.map((line) => (line.id === lineId ? { ...line, undone: true } : line)));
      return;
    }
    setSaving(true);
    setErrorMsg("");
    try {
      await undoRefurbLine({ machineId: machine.id, lineId, userEmail: currentUserEmail });
    } catch (err) {
      setErrorMsg(err.message);
    }
    setSaving(false);
  }

  async function handleComplete(e) {
    e.preventDefault();
    if (!window.confirm(`Mark refurbishment complete on ${completedAt}? The machine then goes back through testing and packing.`)) return;
    if (preview) {
      window.alert("Preview only. A real save marks refurbishment complete and returns this cycle to testing.");
      return;
    }
    setSaving(true);
    setErrorMsg("");
    try {
      await completeRefurb({ machineId: machine.id, date: completedAt, userEmail: currentUserEmail });
    } catch (err) {
      setErrorMsg(err.message);
    }
    setSaving(false);
  }

  if (!intake) {
    return (
      <div className="panel">
        <div className="section-title">Refurbish</div>
        <div className="empty-state">Record a return before logging replacement parts.</div>
      </div>
    );
  }

  const lines = [...(Array.isArray(refurb.lines) ? refurb.lines : []), ...extraLines];

  return (
    <div className="panel">
      <div className="section-title">Refurbish</div>
      <div className="section-sub">
        Log each part that was fitted, where it came from, and what happened to the part that came off.
        Only coated parts flagged revivable can go to the revive queue. Revived stock cannot drop below zero.
      </div>
      {completed && (
        <div className="helper-text" style={{ marginBottom: 12 }}>
          Refurbishment completed {refurb.completedAt}. This cycle can be tested, packed, and linked to a new order.
        </div>
      )}
      {errorMsg && (
        <div className="helper-text" style={{ color: "var(--rust)", marginBottom: 12 }}>{errorMsg}</div>
      )}

      {!completed && (
        <form onSubmit={handleAdd}>
          <div className="section-title" style={{ fontSize: 16 }}>Common</div>
          <div className="chip-row">
            {grouped.common.map((part) => (
              <button
                key={part.code}
                type="button"
                className={"chip" + (partCode === part.code ? " active" : "")}
                onClick={() => choose(part)}
              >
                {part.label}
              </button>
            ))}
            {grouped.common.length === 0 && <div className="helper-text">No common parts in the catalog yet.</div>}
          </div>
          <div className="section-title" style={{ fontSize: 16 }}>Occasional</div>
          <div className="chip-row">
            {grouped.occasional.map((part) => (
              <button
                key={part.code}
                type="button"
                className={"chip" + (partCode === part.code ? " active" : "")}
                onClick={() => choose(part)}
              >
                {part.label}
              </button>
            ))}
            {grouped.occasional.length === 0 && <div className="helper-text">No occasional parts in the catalog yet.</div>}
          </div>
          <div className="field">
            <label>All parts</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search code, name, or group"
            />
            <select value={partCode} onChange={(e) => setPartCode(e.target.value)} required>
              <option value="">Select a part</option>
              {grouped.matches.map((part) => (
                <option key={part.code} value={part.code}>
                  {part.code} — {part.label} ({part.unit}{part.revivable ? ", revivable" : ""})
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Qty ({selected ? unit : "pcs or mtr"})</label>
              <input
                type="number"
                min={unit === "mtr" ? "0.001" : "1"}
                step={unit === "mtr" ? "0.001" : "1"}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
                style={{ width: 120 }}
              />
            </div>
            <div className="field">
              <label>Fitted part</label>
              <label className="choice">
                <input type="radio" name="source" checked={source === "New"} onChange={() => setSource("New")} /> New
              </label>
              <label className="choice" style={{ color: stock > 0 ? "var(--paper)" : "var(--paper-dim)" }}>
                <input
                  type="radio"
                  name="source"
                  checked={source === "Revived"}
                  disabled={!selected || stock <= 0}
                  onChange={() => setSource("Revived")}
                />{" "}
                Revived{selected ? ` (${stock} in stock)` : ""}
              </label>
            </div>
            <div className="field">
              <label>Removed part</label>
              <label className="choice">
                <input type="radio" name="disposition" checked={disposition === "Scrap"} onChange={() => setDisposition("Scrap")} /> Scrap
              </label>
              <label className="choice" style={{ color: revivable ? "var(--paper)" : "var(--paper-dim)" }}>
                <input
                  type="radio"
                  name="disposition"
                  checked={disposition === "Revive"}
                  disabled={!revivable}
                  onChange={() => setDisposition("Revive")}
                />{" "}
                Revive queue
              </label>
              {selected && !revivable && (
                <div className="helper-text">This part is not revivable, so the removed one can only be scrapped.</div>
              )}
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving || !selected}>
            {saving ? "Saving…" : "Log replacement"}
          </button>
        </form>
      )}

      <div style={{ marginTop: 22 }}>
        <div className="section-title" style={{ fontSize: 16 }}>Replacements this cycle</div>
        {lines.length === 0 ? (
          <div className="helper-text">No parts logged yet.</div>
        ) : (
          <div className="table-scroll">
            <table className="machine-table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Qty</th>
                  <th>Fitted</th>
                  <th>Removed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} style={line.undone ? { opacity: 0.45 } : undefined}>
                    <td>{partDisplayName({ code: line.partCode, name: line.partName })} <span className="helper-text">{line.partCode}</span></td>
                    <td>{line.qty} {line.unit}</td>
                    <td>{line.source}</td>
                    <td>{line.disposition === "Revive" ? "Revive queue" : "Scrap"}{line.undone ? " · undone" : ""}</td>
                    <td>
                      {!line.undone && (
                        <button className="btn btn-ghost" type="button" disabled={saving} onClick={() => handleUndo(line.id)}>
                          Undo
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!completed && (
        <form onSubmit={handleComplete} style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Refurb complete</label>
            <input type="date" value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Mark refurb complete"}
          </button>
        </form>
      )}
    </div>
  );
}
