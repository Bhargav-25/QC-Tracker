import { useState } from "react";
import { Link } from "react-router-dom";
import { partDisplayName } from "../domain/partsCatalog.js";
import { resolveReviveItem, undoReviveResolution } from "../utils/returnsApi";

function when(value) {
  if (!value) return "—";
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);
  }
  if (typeof value === "string") return value.slice(0, 10);
  return "—";
}

export default function ReviveQueuePage({ items = [], currentUserEmail, error, preview = false }) {
  const [busyId, setBusyId] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [localItems, setLocalItems] = useState(items);
  const rows = preview ? localItems : items;
  const queued = rows.filter((item) => item.status === "queued");
  const resolved = rows.filter((item) => item.status === "revived" || item.status === "failed");

  async function run(id, action, previewStatus) {
    if (preview) {
      setLocalItems((current) => current.map((item) => (item.id === id ? { ...item, status: previewStatus } : item)));
      return;
    }
    setBusyId(id);
    setErrorMsg("");
    try {
      await action();
    } catch (err) {
      setErrorMsg(err.message);
    }
    setBusyId("");
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Workshop</div>
          <h1>Revive queue</h1>
        </div>
      </div>
      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="section-title">Waiting for acid dip and recoat</div>
        <div className="section-sub">
          Parts whose coating was damaged. Mark Revived when they are back in stock, or Failed to scrap them.
          Either action writes the part ledger. Undo writes a reversing entry and does not delete the original.
        </div>
        {(error || errorMsg) && (
          <div className="helper-text" style={{ color: "var(--rust)", marginBottom: 12 }}>
            {error?.message || errorMsg}
          </div>
        )}
        {queued.length === 0 ? (
          <div className="empty-state">Nothing in the revive queue.</div>
        ) : (
          <div className="table-scroll">
            <table className="machine-table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Qty</th>
                  <th>From machine</th>
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {queued.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {partDisplayName({ code: item.partCode, name: item.partName })}
                      <div className="helper-text">{item.partCode}</div>
                    </td>
                    <td>{item.qty} {item.unit}</td>
                    <td>
                      {item.machineId ? (
                        <Link className="link" to={`/machine/${item.machineId}`}>{item.machineNumber}</Link>
                      ) : (
                        item.machineNumber
                      )}
                    </td>
                    <td>{when(item.createdAt)}</td>
                    <td style={{ display: "flex", gap: 8 }}>
                      <button
                        className="btn btn-primary"
                        disabled={busyId === item.id}
                        onClick={() => run(item.id, () => resolveReviveItem({ itemId: item.id, outcome: "revived", userEmail: currentUserEmail }), "revived")}
                      >
                        Revived
                      </button>
                      <button
                        className="btn btn-ghost"
                        disabled={busyId === item.id}
                        onClick={() => run(item.id, () => resolveReviveItem({ itemId: item.id, outcome: "failed", userEmail: currentUserEmail }), "failed")}
                      >
                        Failed
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="section-title">Resolved</div>
        {resolved.length === 0 ? (
          <div className="helper-text">No resolved items yet.</div>
        ) : (
          <div className="table-scroll">
            <table className="machine-table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Qty</th>
                  <th>Machine</th>
                  <th>Result</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((item) => (
                  <tr key={item.id}>
                    <td>{partDisplayName({ code: item.partCode, name: item.partName })}</td>
                    <td>{item.qty} {item.unit}</td>
                    <td>{item.machineNumber}</td>
                    <td>{item.status === "revived" ? "Revived" : "Failed · scrap"}</td>
                    <td>
                      <button
                        className="btn btn-ghost"
                        disabled={busyId === item.id}
                        onClick={() => run(item.id, () => undoReviveResolution({ itemId: item.id, userEmail: currentUserEmail }), "queued")}
                      >
                        Undo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
