import { useEffect, useMemo, useState } from "react";
import { partDisplayName } from "../domain/partsCatalog.js";
import { ROLES } from "../constants";
import { updatePartFrequency, updatePartRevivable } from "../utils/partsApi";

function frequencyLabel(value) {
  if (value === "common") return "Common";
  if (value === "occasional") return "Occasional";
  return "—";
}

export default function PartsPage({ parts = [], role, currentUserEmail, error, preview = false }) {
  const [query, setQuery] = useState("");
  const [busyCode, setBusyCode] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [localParts, setLocalParts] = useState(parts);
  const isAdmin = role === ROLES.ADMIN;
  useEffect(() => {
    if (!preview) setLocalParts(parts);
  }, [parts, preview]);
  const catalog = preview ? localParts : parts;
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      catalog.filter((part) => {
        if (!q) return true;
        const name = partDisplayName(part);
        return [part.code, part.name, name, part.group, part.frequency].some((value) =>
          String(value || "").toLowerCase().includes(q)
        );
      }),
    [catalog, q]
  );

  async function changeRevivable(part, revivable) {
    const code = part.code || part.id;
    if (preview) {
      setLocalParts((rows) => rows.map((item) => ((item.code || item.id) === code ? { ...item, revivable } : item)));
      return;
    }
    setBusyCode(code);
    setErrorMsg("");
    try {
      await updatePartRevivable(code, revivable, currentUserEmail);
    } catch (err) {
      setErrorMsg(err.message);
    }
    setBusyCode("");
  }

  async function changeFrequency(part, frequency) {
    const code = part.code || part.id;
    const value = frequency === "common" || frequency === "occasional" ? frequency : null;
    if (preview) {
      setLocalParts((rows) => rows.map((item) => ((item.code || item.id) === code ? { ...item, frequency: value } : item)));
      return;
    }
    setBusyCode(code);
    setErrorMsg("");
    try {
      await updatePartFrequency(code, frequency, currentUserEmail);
    } catch (err) {
      setErrorMsg(err.message);
    }
    setBusyCode("");
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Catalog</div>
          <h1>Parts</h1>
        </div>
      </div>
      <div className="panel">
        <div className="section-title">IMS parts</div>
        <div className="section-sub">
          Codes are the IMS item ids. Revivable and frequency are defaults: revivable is a guess for
          coated metal, and frequency is which parts Bhargav says get replaced most. An admin can change
          either flag here. A later catalog seed keeps those edits unless it is run with --force.
          Hooks is shown as Hooks (carabiners).
        </div>
        {(error || errorMsg) && (
          <div className="helper-text" style={{ color: "var(--rust)", marginBottom: 12 }}>
            {error?.message || errorMsg}
          </div>
        )}
        <div className="field" style={{ maxWidth: 320 }}>
          <label>Search</label>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Code, name, or group" />
        </div>
        <div className="table-scroll">
          <table className="machine-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Group</th>
                <th>Unit</th>
                <th>Revivable</th>
                <th>Frequency</th>
                <th>Revived stock</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((part) => {
                const code = part.code || part.id;
                const busy = busyCode === code;
                return (
                  <tr key={code}>
                    <td className="mno">{code}</td>
                    <td>{partDisplayName(part)}</td>
                    <td>{part.group}</td>
                    <td>{part.unit}</td>
                    <td>
                      {isAdmin ? (
                        <input
                          type="checkbox"
                          checked={part.revivable === true}
                          disabled={busy}
                          onChange={(e) => changeRevivable(part, e.target.checked)}
                          aria-label={`${code} revivable`}
                        />
                      ) : part.revivable ? "Yes" : "No"}
                    </td>
                    <td>
                      {isAdmin ? (
                        <select
                          value={part.frequency || ""}
                          disabled={busy}
                          onChange={(e) => changeFrequency(part, e.target.value)}
                          aria-label={`${code} frequency`}
                        >
                          <option value="">—</option>
                          <option value="common">Common</option>
                          <option value="occasional">Occasional</option>
                        </select>
                      ) : (
                        frequencyLabel(part.frequency)
                      )}
                    </td>
                    <td>{Number(part.revivedStock || 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visible.length === 0 && <div className="empty-state">No parts yet. Seed the catalog, then reload.</div>}
      </div>
    </div>
  );
}
