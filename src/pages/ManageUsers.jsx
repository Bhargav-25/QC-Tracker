import { useState } from "react";
import { ALL_ROLES } from "../constants";
import { setUserRole, removeUser } from "../utils/authApi";

export default function ManageUsers({ users }) {
  const [savingId, setSavingId] = useState(null);

  async function handleRoleChange(uid, role) {
    setSavingId(uid);
    await setUserRole(uid, role || null);
    setSavingId(null);
  }

  async function handleRemove(uid, email) {
    if (window.confirm(`Remove access for ${email}? They'll need to be re-added to sign in again.`)) {
      await removeUser(uid);
    }
  }

  const pending = users.filter((u) => !u.role);
  const assigned = users.filter((u) => u.role);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Manage Users</h1>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="section-title">How to add someone</div>
        <div className="section-sub">
          1. In the Firebase console, go to Authentication → Users → Add user,
          and create their email + password there. 2. Have them sign in once
          on this site — they'll appear below with no role. 3. Pick a role
          for them here.
        </div>
      </div>

      {pending.length > 0 && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="section-title">Waiting for a role ({pending.length})</div>
          <div className="checklist">
            {pending.map((u) => (
              <div className="checklist-item" key={u.id}>
                <span className="name">{u.email}</span>
                <select
                  defaultValue=""
                  disabled={savingId === u.id}
                  onChange={(e) => handleRoleChange(u.id, e.target.value)}
                >
                  <option value="" disabled>Assign role…</option>
                  {ALL_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="section-title">All users ({assigned.length})</div>
        {assigned.length === 0 ? (
          <div className="empty-state">No roles assigned yet.</div>
        ) : (
          <div className="checklist">
            {assigned.map((u) => (
              <div className="checklist-item" key={u.id}>
                <span className="name">{u.email}</span>
                <select
                  value={u.role}
                  disabled={savingId === u.id}
                  onChange={(e) => handleRoleChange(u.id, e.target.value)}
                >
                  {ALL_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <button className="btn btn-ghost" onClick={() => handleRemove(u.id, u.email)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
