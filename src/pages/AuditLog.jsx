import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { subscribeToAuditLog } from "../utils/auditApi";

const OPS_BOT = "ops-bot";

export default function AuditLog({ entries: provided }) {
  const live = provided == null;
  const [entries, setEntries] = useState(provided || []);
  const [loading, setLoading] = useState(live);
  const [search, setSearch] = useState("");
  const [actor, setActor] = useState("");

  useEffect(() => {
    if (!live) {
      setEntries(provided);
      setLoading(false);
      return undefined;
    }
    const unsub = subscribeToAuditLog((data) => {
      setEntries(data);
      setLoading(false);
    });
    return unsub;
  }, [live, provided]);

  const actors = Array.from(
    new Set([OPS_BOT, ...entries.map((entry) => entry.userEmail).filter(Boolean)])
  ).sort((a, b) => a.localeCompare(b));

  const filtered = entries.filter((e) => {
    if (actor && e.userEmail !== actor) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.userEmail?.toLowerCase().includes(q) ||
      e.machineNumber?.toLowerCase().includes(q) ||
      e.groupNumber?.toLowerCase().includes(q) ||
      e.section?.toLowerCase().includes(q) ||
      e.action?.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Audit Log</h1>
        </div>
      </div>

      <div className="panel">
        <div className="section-sub">
          Every save is recorded here with who did it and when — most recent
          first, showing the last {entries.length} entries.
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          <div className="field" style={{ maxWidth: 220, marginBottom: 0 }}>
            <label>User</label>
            <select value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">Everyone</option>
              {actors.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ maxWidth: 320, marginBottom: 0, flex: 1 }}>
            <label>Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by user, machine, group, section…"
            />
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">No matching activity.</div>
        ) : (
          <div className="table-scroll">
            <table className="machine-table" style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Machine</th>
                  <th>Section</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const date = e.timestamp?.toDate ? e.timestamp.toDate() : null;
                  return (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{date ? date.toLocaleString() : "…"}</td>
                      <td>{e.userEmail}</td>
                      <td>
                        {e.machineId ? (
                          <Link to={`/machine/${e.machineId}`} className="link">
                            {e.machineNumber || e.machineId}
                          </Link>
                        ) : (
                          e.machineNumber || "—"
                        )}
                        {e.groupNumber ? <div className="helper-text">{e.groupNumber}</div> : null}
                      </td>
                      <td>{e.section || "—"}</td>
                      <td style={{ whiteSpace: "pre-wrap", minWidth: 280 }}>{e.action}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
