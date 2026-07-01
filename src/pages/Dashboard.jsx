import { useState } from "react";
import { Link } from "react-router-dom";
import StatusTag from "../components/StatusTag.jsx";
import { computeStatus } from "../utils/status";
import { STATUS } from "../constants";
import { deleteMachine } from "../utils/machinesApi";

export default function Dashboard({ machines, loading }) {
  const [filter, setFilter] = useState("All");

  const withStatus = machines.map((m) => ({ ...m, _status: computeStatus(m) }));

  const counts = {
    [STATUS.ASSEMBLY]: 0,
    [STATUS.TESTING]: 0,
    [STATUS.PACKED]: 0,
    [STATUS.DISPATCHED]: 0,
  };
  withStatus.forEach((m) => counts[m._status]++);

  const packedMachines = withStatus.filter((m) => m._status === STATUS.PACKED);

  const visible =
    filter === "All" ? withStatus : withStatus.filter((m) => m._status === filter);

  async function handleDelete(id, machineNumber) {
    if (window.confirm(`Delete machine ${machineNumber}? This cannot be undone.`)) {
      await deleteMachine(id);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Overview</div>
          <h1>Dashboard</h1>
        </div>
        <Link to="/machine/new" className="btn btn-primary">
          + Add Machine
        </Link>
      </div>

      <div className="stat-row">
        <button className="stat-card" onClick={() => setFilter(STATUS.ASSEMBLY)} style={{ textAlign: "left", border: "1px solid var(--line)" }}>
          <div className="num">{counts[STATUS.ASSEMBLY]}</div>
          <div className="label">Assembly stage</div>
        </button>
        <button className="stat-card accent-amber" onClick={() => setFilter(STATUS.TESTING)} style={{ textAlign: "left" }}>
          <div className="num">{counts[STATUS.TESTING]}</div>
          <div className="label">Testing</div>
        </button>
        <button className="stat-card accent-teal" onClick={() => setFilter(STATUS.PACKED)} style={{ textAlign: "left" }}>
          <div className="num">{counts[STATUS.PACKED]}</div>
          <div className="label">Packed inventory</div>
        </button>
        <button className="stat-card" onClick={() => setFilter(STATUS.DISPATCHED)} style={{ textAlign: "left" }}>
          <div className="num">{counts[STATUS.DISPATCHED]}</div>
          <div className="label">Dispatched</div>
        </button>
      </div>

      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="section-title">Packed inventory — machine numbers</div>
        <div className="section-sub">
          Machines that have finished final packing and are ready to dispatch.
        </div>
        {packedMachines.length === 0 ? (
          <div className="helper-text">No machines currently sitting in packed inventory.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {packedMachines.map((m) => (
              <Link
                key={m.id}
                to={`/machine/${m.id}`}
                className="status-tag packed"
                style={{ fontSize: 12.5, padding: "6px 12px" }}
              >
                {m.machineNumber}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div className="section-title">All machines</div>
          {filter !== "All" && (
            <button className="btn btn-ghost" onClick={() => setFilter("All")}>
              Clear filter: {filter} ✕
            </button>
          )}
        </div>

        {loading ? (
          <div className="empty-state">Loading machines…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            {machines.length === 0
              ? "No machines added yet. Click \"Add Machine\" to create the first one."
              : "No machines match this filter."}
          </div>
        ) : (
          <table className="machine-table">
            <thead>
              <tr>
                <th>Machine No.</th>
                <th>Status</th>
                <th>Dispatch date</th>
                <th>Comment</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr key={m.id}>
                  <td className="mno">
                    <Link to={`/machine/${m.id}`} className="link">
                      {m.machineNumber}
                    </Link>
                  </td>
                  <td>
                    <StatusTag status={m._status} />
                  </td>
                  <td>{m.dispatch?.date || "—"}</td>
                  <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.dispatch?.comment || "—"}
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost"
                      onClick={() => handleDelete(m.id, m.machineNumber)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
