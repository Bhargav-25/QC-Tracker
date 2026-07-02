import { useState } from "react";
import { Link } from "react-router-dom";
import StatusTag from "../components/StatusTag.jsx";
import {
  computeStatus,
  isInCurrentMonth,
  warrantyDaysRemaining,
  missingPackingItems,
  isWarrantyExpiringSoon,
} from "../utils/status";
import { STATUS, ROLES } from "../constants";
import { deleteMachine } from "../utils/machinesApi";

export default function Dashboard({ machines, loading, tickets, role }) {
  const [filter, setFilter] = useState("All");
  const isDashboardOnly = role === ROLES.DASHBOARD;

  const withStatus = machines.map((m) => ({ ...m, _status: computeStatus(m) }));

  const counts = {
    [STATUS.ASSEMBLY]: 0,
    [STATUS.TESTING]: 0,
    [STATUS.PACKED]: 0,
    [STATUS.DISPATCHED]: 0,
    [STATUS.DELIVERED]: 0,
    [STATUS.INSTALLED]: 0,
  };
  withStatus.forEach((m) => counts[m._status]++);

  const packedMachines = withStatus.filter((m) => m._status === STATUS.PACKED);

  const dispatchedThisMonth = machines.filter((m) => isInCurrentMonth(m.dispatch?.date)).length;
  const maintenanceThisMonth = tickets.filter((t) => isInCurrentMonth(t.date)).length;

  const missingPackingCount = machines.reduce((sum, m) => sum + missingPackingItems(m).length, 0);
  const warrantyExpiringCount = machines.filter((m) => isWarrantyExpiringSoon(m)).length;

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
        {!isDashboardOnly && (
          <Link to="/machine/new" className="btn btn-primary">
            + Add Machine
          </Link>
        )}
      </div>

      <div className="stat-row">
        <button className="stat-card" onClick={() => setFilter(STATUS.ASSEMBLY)} style={{ textAlign: "left" }}>
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
        <button className="stat-card" onClick={() => setFilter(STATUS.DELIVERED)} style={{ textAlign: "left" }}>
          <div className="num">{counts[STATUS.DELIVERED]}</div>
          <div className="label">Delivered</div>
        </button>
        <button className="stat-card" onClick={() => setFilter(STATUS.INSTALLED)} style={{ textAlign: "left" }}>
          <div className="num">{counts[STATUS.INSTALLED]}</div>
          <div className="label">Installed</div>
        </button>
        <div className="stat-card accent-amber">
          <div className="num">{dispatchedThisMonth}</div>
          <div className="label">Dispatched this month</div>
        </div>
        <div className="stat-card accent-amber">
          <div className="num">{maintenanceThisMonth}</div>
          <div className="label">Maintenance this month</div>
        </div>
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

      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="section-title">Notifications</div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <Link to="/notifications" className="status-tag" style={{ color: missingPackingCount > 0 ? "var(--rust)" : "var(--paper-dim)" }}>
            {missingPackingCount} missing packing item{missingPackingCount === 1 ? "" : "s"}
          </Link>
          <Link to="/notifications" className="status-tag" style={{ color: warrantyExpiringCount > 0 ? "var(--amber)" : "var(--paper-dim)" }}>
            {warrantyExpiringCount} warrant{warrantyExpiringCount === 1 ? "y" : "ies"} expiring soon
          </Link>
        </div>
      </div>

      {!isDashboardOnly && (
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
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
            <div className="table-scroll">
              <table className="machine-table">
                <thead>
                  <tr>
                    <th>Machine No.</th>
                    <th>Status</th>
                    <th>Dispatch date</th>
                    <th>Warranty</th>
                    <th>Comment</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((m) => {
                    const days = warrantyDaysRemaining(m);
                    return (
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
                        <td style={{ color: days !== null && days < 0 ? "var(--rust)" : days !== null && days <= 10 ? "var(--amber)" : undefined }}>
                          {days === null ? "—" : days < 0 ? `Expired ${Math.abs(days)}d ago` : `${days}d left`}
                        </td>
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
