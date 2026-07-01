import { Link } from "react-router-dom";
import { PACKING_CHECKLIST_ITEMS } from "../constants";
import { missingPackingItems } from "../utils/status";
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
