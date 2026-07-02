import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { subscribeToAuditLog } from "../utils/auditApi";

export default function AuditLog() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const unsub = subscribeToAuditLog((data) => {
      setEntries(data);
      setLoading(false);
    });
    return unsub;
  }, []);

  const filtered = entries.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.userEmail?.toLowerCase().includes(q) ||
      e.machineNumber?.toLowerCase().includes(q) ||
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
        <div className="field" style={{ maxWidth: 320, marginBottom: 16 }}>
          <label>Search</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by user, machine, section…"
          />
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
                          "—"
                        )}
                      </td>
                      <td>{e.section || "—"}</td>
                      <td>{e.action}</td>
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
