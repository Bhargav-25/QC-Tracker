import { Link } from "react-router-dom";
import StatusTag from "../components/StatusTag.jsx";
import { computeStatus } from "../utils/status";
import { ROLES, STATUS } from "../constants";

function MachineRow({ machine }) {
  const status = computeStatus(machine);
  return (
    <tr>
      <td className="mno">
        <Link to={`/machine/${machine.id}`} className="link">
          {machine.machineNumber}
        </Link>
      </td>
      <td>
        <StatusTag status={status} />
      </td>
    </tr>
  );
}

function MachineTable({ machines, emptyText }) {
  if (machines.length === 0) {
    return <div className="empty-state">{emptyText}</div>;
  }
  return (
    <div className="table-scroll">
      <table className="machine-table" style={{ minWidth: 320 }}>
        <thead>
          <tr>
            <th>Machine No.</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => (
            <MachineRow key={m.id} machine={m} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MachinesList({ machines, role, currentUserEmail }) {
  if (role === ROLES.INSTALLATION) {
    const withStatus = machines.map((m) => ({ ...m, _status: computeStatus(m) }));
    const available = withStatus.filter(
      (m) => (m._status === STATUS.DISPATCHED || m._status === STATUS.DELIVERED)
    );
    const installedByMe = withStatus.filter(
      (m) => m.installation?.installedBy === currentUserEmail
    );

    return (
      <div>
        <div className="page-header">
          <div>
            <div className="eyebrow">Installation</div>
            <h1>Machines</h1>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="section-title">Available for delivery / installation</div>
          <div className="section-sub">Machines that have been dispatched and are ready for you.</div>
          <MachineTable machines={available} emptyText="Nothing waiting on you right now." />
        </div>

        <div className="panel">
          <div className="section-title">Installed by you ({installedByMe.length})</div>
          <MachineTable machines={installedByMe} emptyText="You haven't installed any machines yet." />
        </div>
      </div>
    );
  }

  // Production (and anyone else who lands here): full list.
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Production</div>
          <h1>Machines</h1>
        </div>
        <Link to="/machine/new" className="btn btn-primary">
          + Add Machine
        </Link>
      </div>
      <div className="panel">
        <MachineTable machines={machines} emptyText="No machines yet." />
      </div>
    </div>
  );
}
