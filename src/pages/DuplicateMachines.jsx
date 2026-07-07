import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import StatusTag from "../components/StatusTag.jsx";
import { computeStatus } from "../utils/status";
import { mergeDuplicateMachines } from "../utils/machinesApi";

export default function DuplicateMachines({ machines, currentUserEmail }) {
  const [merging, setMerging] = useState(null);
  const [mergedGroups, setMergedGroups] = useState([]);

  const groups = useMemo(() => {
    const byNumber = {};
    machines.forEach((m) => {
      byNumber[m.machineNumber] = byNumber[m.machineNumber] || [];
      byNumber[m.machineNumber].push(m);
    });
    return Object.values(byNumber).filter((g) => g.length > 1);
  }, [machines]);

  async function handleMerge(group) {
    const number = group[0].machineNumber;
    if (
      !window.confirm(
        `Merge ${group.length} records for "${number}" into one? The most advanced one (by status) will be kept as the base, filled in with any data from the others. This can't be undone.`
      )
    ) {
      return;
    }
    setMerging(number);
    try {
      await mergeDuplicateMachines(group, { userEmail: currentUserEmail });
      setMergedGroups((prev) => [...prev, number]);
    } catch (err) {
      alert("Merge failed: " + err.message);
    }
    setMerging(null);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Duplicate Machines</h1>
        </div>
      </div>

      <div className="panel">
        <div className="section-sub">
          Machines sharing the same machine number — usually from being added
          twice by mistake. Merging keeps the most advanced record as the
          base and fills in anything missing from the others, then removes
          the extra copies.
        </div>

        {groups.length === 0 ? (
          <div className="empty-state">No duplicate machine numbers found.</div>
        ) : (
          groups.map((group) => {
            const number = group[0].machineNumber;
            const isMerging = merging === number;
            const justMerged = mergedGroups.includes(number);
            return (
              <div key={number} className="panel" style={{ background: "var(--panel-raised)", marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
                  <div style={{ fontWeight: 600 }}>{number} — {group.length} copies</div>
                  <button
                    className="btn btn-primary"
                    onClick={() => handleMerge(group)}
                    disabled={isMerging || justMerged}
                  >
                    {justMerged ? "Merged" : isMerging ? "Merging…" : "Merge into one"}
                  </button>
                </div>
                <div className="checklist">
                  {group.map((m) => (
                    <div className="checklist-item" key={m.id}>
                      <Link to={`/machine/${m.id}`} className="link name">
                        {m.machineNumber}
                      </Link>
                      <StatusTag status={computeStatus(m)} />
                      <span className="helper-text">
                        {m.dispatch?.date ? `Dispatched ${m.dispatch.date}` : "Not dispatched"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
