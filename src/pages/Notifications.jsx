import { Link } from "react-router-dom";
import { PACKING_CHECKLIST_ITEMS } from "../constants";
import { missingPackingItems, warrantyDaysRemaining, isWarrantyExpiringSoon } from "../utils/status";
import { updateMachine } from "../utils/machinesApi";

const LABELS = PACKING_CHECKLIST_ITEMS.reduce((acc, item) => {
  acc[item.key] = item.label;
  return acc;
}, {});

export default function Notifications({ machines }) {
  const rows = [];
  machines.forEach((m) => {
    missingPackingItems(m).forEach((key) => {
      rows.push({ machine: m, key });
    });
  });

  const warrantyRows = machines
    .filter((m) => isWarrantyExpiringSoon(m))
    .map((m) => ({ machine: m, days: warrantyDaysRemaining(m) }))
    .sort((a, b) => a.days - b.days);

  async function handleMarkSent(machine, key) {
    const sentBack = { ...(machine.packingSentBack || {}), [key]: true };
    await updateMachine(machine.id, { packingSentBack: sentBack });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Alerts</div>
          <h1>Notifications</h1>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="section-title">Warranty expiring soon</div>
        <div className="section-sub">
          Machines whose warranty ends within 10 days, or has already expired.
        </div>

        {warrantyRows.length === 0 ? (
          <div className="empty-state">No warranties expiring soon.</div>
        ) : (
          warrantyRows.map(({ machine, days }) => (
            <div className="notif-item" key={machine.id} style={{ borderLeftColor: days < 0 ? "var(--rust)" : "var(--amber)" }}>
              <span className="mno">
                <Link to={`/machine/${machine.id}`} className="link">
                  {machine.machineNumber}
                </Link>
              </span>
              <span className="missing" style={{ color: days < 0 ? "var(--rust)" : "var(--amber)" }}>
                {days < 0
                  ? `Warranty expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`
                  : `Warranty expires in ${days} day${days === 1 ? "" : "s"}`}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="panel">
        <div className="section-title">Missing packing items</div>
        <div className="section-sub">
          These items were not marked as included in the shipped box. Send the
          part separately, then mark it as sent to clear the alert.
        </div>

        {rows.length === 0 ? (
          <div className="empty-state">Nothing missing right now.</div>
        ) : (
          rows.map(({ machine, key }) => (
            <div className="notif-item" key={machine.id + key}>
              <span className="mno">
                <Link to={`/machine/${machine.id}`} className="link">
                  {machine.machineNumber}
                </Link>
              </span>
              <span className="missing">Missing: {LABELS[key]}</span>
              <span className="actions">
                <button
                  className="btn btn-primary"
                  onClick={() => handleMarkSent(machine, key)}
                >
                  Mark sent
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
