import { useState } from "react";
import { updateMachine } from "../../utils/machinesApi";
import { decrementStandForDispatch, returnStandToInventory } from "../../utils/inventoryApi";
import SectionMeta from "../../components/SectionMeta.jsx";
import { ACCESSORY_SHIP_STATUSES, COURIERS } from "../../domain/orderModel.js";

export default function DispatchTab({ machine, standCount, currentUserEmail }) {
  const dispatch = machine.dispatch || {};
  const [dispatched, setDispatched] = useState(dispatch.dispatched || false);
  const [date, setDate] = useState(dispatch.date || "");
  const [comment, setComment] = useState(dispatch.comment || "");
  const [includeStand, setIncludeStand] = useState(dispatch.includeStand || false);
  const [courier, setCourier] = useState(dispatch.courier || "");
  const [trackingNumber, setTrackingNumber] = useState(dispatch.trackingNumber || "");
  const [accessoriesSeparate, setAccessoriesSeparate] = useState(Boolean(dispatch.accessoriesSeparate));
  const [accessoriesCourier, setAccessoriesCourier] = useState(dispatch.accessoriesCourier || "");
  const [accessoriesTracking, setAccessoriesTracking] = useState(dispatch.accessoriesTracking || "");
  const [accessoriesSentOn, setAccessoriesSentOn] = useState(dispatch.accessoriesSentOn || "");
  const [accessoriesStatus, setAccessoriesStatus] = useState(dispatch.accessoriesStatus || "Not sent");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const alreadyDispatchedWithStand = machine.dispatch?.dispatched && machine.dispatch?.includeStand;

  function handleMarkDispatched() {
    setDispatched(true);
    if (!date) {
      setDate(new Date().toISOString().slice(0, 10));
    }
  }

  async function handleSave() {
    setErrorMsg("");
    setSaving(true);

    const wasDispatchedWithStand = machine.dispatch?.dispatched && machine.dispatch?.includeStand;
    const nowDispatchedWithStand = dispatched && includeStand;
    const standMeta = { userEmail: currentUserEmail, machineId: machine.id, machineNumber: machine.machineNumber };

    try {
      if (nowDispatchedWithStand && !wasDispatchedWithStand) {
        await decrementStandForDispatch(standMeta);
      } else if (!nowDispatchedWithStand && wasDispatchedWithStand) {
        await returnStandToInventory(standMeta);
      }

      await updateMachine(
        machine.id,
        {
          dispatch: {
            dispatched,
            date,
            comment,
            includeStand,
            courier,
            trackingNumber,
            accessoriesSeparate,
            accessoriesCourier,
            accessoriesTracking,
            accessoriesSentOn,
            accessoriesStatus,
          },
        },
        { userEmail: currentUserEmail, section: "dispatch", machineNumber: machine.machineNumber }
      );
    } catch (err) {
      setErrorMsg(err.message);
      setSaving(false);
      return;
    }
    setSaving(false);
  }

  const standCheckboxDisabled = !dispatched || (!includeStand && standCount <= 0);

  return (
    <div className="panel dispatch-panel" style={{ maxWidth: 560 }}>
      <div className="section-title">Dispatch</div>
      <div className="section-sub">
        Mark this machine as dispatched once it has left the facility.
      </div>
      <SectionMeta meta={machine.sectionMeta?.dispatch} />

      {!dispatched ? (
        <button className="btn btn-primary" onClick={handleMarkDispatched}>
          Mark as Dispatched
        </button>
      ) : (
        <div className="helper-text" style={{ color: "var(--teal)", marginBottom: 16 }}>
          Marked as dispatched.{" "}
          <button className="btn btn-ghost" onClick={() => setDispatched(false)}>
            Undo
          </button>
        </div>
      )}

      <div className="field" style={{ marginTop: 16 }}>
        <label>Date of dispatch</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="field">
        <label>Courier</label>
        <div className="segmented" role="group" aria-label="Courier">
          {COURIERS.map((name) => (
            <button
              key={name}
              type="button"
              className={courier === name ? "active" : ""}
              onClick={() => setCourier(courier === name ? "" : name)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Tracking no.</label>
        <input
          type="text"
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
          placeholder="Tracking number"
        />
      </div>

      <div className="field">
        <label>Comment / remark</label>
        <textarea
          rows={3}
          style={{ width: "100%", fontFamily: "var(--font-body)" }}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Any remarks about this machine or its dispatch…"
        />
      </div>

      <div className="checklist-item" style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", marginBottom: 16 }}>
        <input
          type="checkbox"
          checked={includeStand}
          disabled={standCheckboxDisabled}
          onChange={(e) => setIncludeStand(e.target.checked)}
        />
        <span className="name">Include machine stand with this dispatch</span>
        <span className="helper-text" style={{ marginLeft: "auto" }}>
          {standCount} in stock
        </span>
      </div>
      {!includeStand && standCount <= 0 && dispatched && !alreadyDispatchedWithStand && (
        <div className="helper-text" style={{ color: "var(--rust)", marginTop: -10, marginBottom: 16 }}>
          No machine stands left in inventory — add stock from the Stand Inventory page before including one.
        </div>
      )}

      <div className="accessories-block">
        <div className="section-title">Accessories</div>
        <label className="toggle-row">
          <span>Shipped separately from machine</span>
          <input
            type="checkbox"
            checked={accessoriesSeparate}
            onChange={(e) => setAccessoriesSeparate(e.target.checked)}
          />
        </label>

        {accessoriesSeparate && (
          <>
            <div className="field">
              <label>Accessories courier</label>
              <div className="segmented" role="group" aria-label="Accessories courier">
                {COURIERS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={accessoriesCourier === name ? "active" : ""}
                    onClick={() => setAccessoriesCourier(accessoriesCourier === name ? "" : name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>Tracking no.</label>
                <input
                  type="text"
                  value={accessoriesTracking}
                  onChange={(e) => setAccessoriesTracking(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Sent on</label>
                <input
                  type="date"
                  value={accessoriesSentOn}
                  onChange={(e) => setAccessoriesSentOn(e.target.value)}
                />
              </div>
            </div>

            <div className="field">
              <label>Accessories status</label>
              <div className="segmented" role="group" aria-label="Accessories status">
                {ACCESSORY_SHIP_STATUSES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={accessoriesStatus === name ? "active" : ""}
                    onClick={() => setAccessoriesStatus(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {errorMsg && (
        <div className="helper-text" style={{ color: "var(--rust)", marginBottom: 12 }}>
          {errorMsg}
        </div>
      )}

      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save dispatch"}
      </button>
    </div>
  );
}
