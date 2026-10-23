import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import OrderForm from "./OrderForm.jsx";
import OrderStatusTag from "../components/OrderStatusTag.jsx";
import PaymentTag from "../components/PaymentTag.jsx";
import StatusTag from "../components/StatusTag.jsx";
import { STATUS } from "../constants.js";
import { canAssignOrderMachine, canEditOrders, canOpenMachine } from "../utils/access.js";
import { assignMachineToOrder, createOrder, unassignMachineFromOrder, updateOrder } from "../utils/ordersApi.js";
import { computeStatus } from "../utils/status.js";
import {
  ORDER_STATUSES,
  displayBench,
  displayOrderStatus,
  displayYesNo,
  formatDisplayDate,
  isSafeGroupId,
  machineForOrder,
  maskContact,
  normalizeGroupNumber,
  telHref,
} from "../domain/orderModel.js";

function packedOn(machine) {
  const meta = machine.sectionMeta?.finalPacking?.updatedAt;
  if (meta?.toDate) return formatDisplayDate(meta.toDate().toISOString().slice(0, 10));
  return "";
}

function Kv({ label, children, wide = false }) {
  return (
    <div className={"kv" + (wide ? " kv-wide" : "")}>
      <span className="kv-label">{label}</span>
      <div>{children}</div>
    </div>
  );
}

export default function OrderDetail({ orders, machines, role, currentUserEmail, creating = false }) {
  const params = useParams();
  const navigate = useNavigate();
  const groupFromRoute = params.groupNumber ? decodeURIComponent(params.groupNumber) : "";
  const order = creating
    ? null
    : orders.find((item) => item.groupNumber === groupFromRoute || item.id === groupFromRoute);

  const [editing, setEditing] = useState(creating);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [machineQuery, setMachineQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const machine = order ? machineForOrder(order, machines) : null;
  const display = order ? displayOrderStatus(order, machine) : "";

  const packedChoices = useMemo(() => {
    const q = machineQuery.trim().toLowerCase();
    return machines
      .filter((item) => computeStatus(item) === STATUS.PACKED && !item.groupNumber)
      .filter((item) => !q || item.machineNumber?.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => (a.machineNumber || "").localeCompare(b.machineNumber || "", undefined, { numeric: true }));
  }, [machines, machineQuery]);

  async function handleSave(draft) {
    setErrorMsg("");
    const groupNumber = normalizeGroupNumber(creating ? draft.groupNumber : order.groupNumber);
    if (!groupNumber) {
      setErrorMsg("Enter a group number.");
      return;
    }
    if (!isSafeGroupId(groupNumber)) {
      setErrorMsg("That group number can't be saved. Avoid a bare \".\" or an empty value.");
      return;
    }
    if (!draft.customer.trim()) {
      setErrorMsg("Enter the customer name.");
      return;
    }
    if (!ORDER_STATUSES.includes(draft.status)) {
      setErrorMsg("Choose Pause Shipment, Please Ship, or Cancelled.");
      return;
    }
    if (!draft.payment) {
      setErrorMsg("Choose a payment.");
      return;
    }
    if (creating && orders.some((item) => item.groupNumber === groupNumber)) {
      setErrorMsg(`Order ${groupNumber} already exists.`);
      return;
    }
    setSaving(true);
    try {
      if (creating) {
        await createOrder({ ...draft, groupNumber }, currentUserEmail);
        navigate(`/orders/${encodeURIComponent(groupNumber)}`, { replace: true });
      } else {
        await updateOrder(order.groupNumber, draft, currentUserEmail);
        setEditing(false);
      }
    } catch (err) {
      setErrorMsg(err.message || "Could not save the order.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssign() {
    const selected = packedChoices.find((item) => item.id === selectedId);
    if (!selected || !order) return;
    setErrorMsg("");
    setAssigning(true);
    try {
      await assignMachineToOrder({ order, machine: selected, userEmail: currentUserEmail });
      setSelectedId("");
    } catch (err) {
      setErrorMsg(err.message || "Could not assign that machine.");
    } finally {
      setAssigning(false);
    }
  }

  async function handleUnassign() {
    if (!order) return;
    if (!window.confirm(`Unassign ${order.machineNumber || "the machine"} from ${order.groupNumber}?`)) return;
    setErrorMsg("");
    setAssigning(true);
    try {
      await unassignMachineFromOrder({ order, machine, userEmail: currentUserEmail });
    } catch (err) {
      setErrorMsg(err.message || "Could not unassign the machine.");
    } finally {
      setAssigning(false);
    }
  }

  if (!creating && !order) {
    return (
      <div className="orders-wrap">
        <Link to="/orders" className="back-link">← Orders</Link>
        <div className="empty-state">
          Order not found, or still loading.
        </div>
      </div>
    );
  }

  const phone = order ? maskContact(order.contact) : "";
  const call = order ? telHref(order.contact) : "";
  const linkedNumber = machine?.machineNumber || order?.machineNumber;
  const selected = packedChoices.find((item) => item.id === selectedId);

  return (
    <div className="orders-wrap">
      <Link to="/orders" className="back-link">← Orders</Link>

      <div className="order-heading">
        <div className="eyebrow">Order</div>
        <div className="order-heading-row">
          <h1>{creating ? "New order" : order.groupNumber}</h1>
          {!creating && <OrderStatusTag status={display} />}
        </div>
      </div>

      <section className="panel order-section">
        <div className="section-head">
          <div className="section-title">Customer</div>
          {canEditOrders(role) && !editing && (
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <OrderForm
            initial={order}
            creating={creating}
            saving={saving}
            errorMsg={errorMsg}
            onSubmit={handleSave}
            onCancel={creating ? null : () => { setEditing(false); setErrorMsg(""); }}
          />
        ) : (
          <div className="kv-grid">
            <Kv label="Name"><strong>{order.customer || "—"}</strong></Kv>
            <Kv label="Contact">
              <span>{phone || "—"}</span>
              {call && (
                <a className="link call-link" href={call}>Call</a>
              )}
            </Kv>
            <Kv label="City">{order.city || "—"}</Kv>
            <Kv label="Address" wide>
              <span className="pre-wrap">{order.address || "—"}</span>
            </Kv>
          </div>
        )}
      </section>

      {!editing && order && (
        <>
          <section className="panel order-section">
            <div className="section-title">Payment & order</div>
            <div className="kv-grid">
              <Kv label="Payment"><PaymentTag payment={order.payment} /></Kv>
              <Kv label="Order date">{formatDisplayDate(order.orderDate) || "—"}</Kv>
              <Kv label="Order type">{order.orderType || "—"}</Kv>
              <Kv label="Warranty">{order.warranty || "—"}</Kv>
              <Kv label="Payment status">{order.paymentStatus || "—"}</Kv>
              <Kv label="Comments" wide>
                <span className="pre-wrap">{order.comments || "—"}</span>
              </Kv>
            </div>
          </section>

          <section className="panel order-section">
            <div className="section-title">Add-ons</div>
            <div className="addon-grid">
              <Kv label="Tab">{displayYesNo(order.tab) || "—"}</Kv>
              <Kv label="Accessories">{displayYesNo(order.accessories) || "—"}</Kv>
              <Kv label="Hanger">{displayYesNo(order.hanger) || "—"}</Kv>
              <Kv label="Bench">{displayBench(order.bench)}</Kv>
              <Kv label="Glass / metal">{order.glassMetal || "—"}</Kv>
            </div>
          </section>

          <section className="panel order-section">
            <div className="section-head">
              <div className="section-title">Machine</div>
              <span className="eyebrow">{linkedNumber ? linkedNumber : "None assigned"}</span>
            </div>

            {linkedNumber ? (
              <div className="assigned-machine">
                <div>
                  <div className="order-gn">{linkedNumber}</div>
                  {machine && canOpenMachine(role) ? (
                    <Link to={`/machine/${machine.id}`} className="link">Open machine record</Link>
                  ) : (
                    <div className="helper-text">
                      {machine ? "Machine record" : "This machine isn't in QC Track yet."}
                    </div>
                  )}
                </div>
                {machine ? (
                  <StatusTag status={computeStatus(machine)} />
                ) : (
                  order.fulfillmentStatus && <OrderStatusTag status={order.fulfillmentStatus} />
                )}
              </div>
            ) : (
              <div className="section-sub">
                Pick a Packed machine for this order. Its status (Dispatched, Delivered, Installed) will show here automatically.
              </div>
            )}

            {!linkedNumber && canAssignOrderMachine(role) && (
              <>
                <div className="field">
                  <input
                    type="search"
                    value={machineQuery}
                    onChange={(e) => setMachineQuery(e.target.value)}
                    placeholder="Search machine no..."
                    aria-label="Search packed machines"
                  />
                </div>
                {packedChoices.length === 0 ? (
                  <div className="empty-state">No unassigned Packed machines.</div>
                ) : (
                  <div className="machine-picker">
                    {packedChoices.map((item) => {
                      const when = packedOn(item);
                      return (
                        <label key={item.id} className={"picker-row" + (selectedId === item.id ? " selected" : "")}>
                          <input
                            type="radio"
                            name="assign-machine"
                            checked={selectedId === item.id}
                            onChange={() => setSelectedId(item.id)}
                          />
                          <span>
                            <span className="order-gn">{item.machineNumber}</span>
                            <span className="helper-text">{when ? `Packed · ${when}` : "Packed"}</span>
                          </span>
                          <StatusTag status={STATUS.PACKED} />
                        </label>
                      );
                    })}
                  </div>
                )}
                <p className="helper-text">Only unassigned Packed machines are listed.</p>
                <button
                  type="button"
                  className="btn btn-primary assign-btn"
                  disabled={!selected || assigning}
                  onClick={handleAssign}
                >
                  {assigning ? "Assigning…" : `Assign ${selected?.machineNumber || "machine"} to ${order.groupNumber}`}
                </button>
              </>
            )}

            {linkedNumber && canAssignOrderMachine(role) && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginTop: 12 }}
                disabled={assigning}
                onClick={handleUnassign}
              >
                {assigning ? "Updating…" : "Unassign machine"}
              </button>
            )}

            {!linkedNumber && !canAssignOrderMachine(role) && (
              <div className="helper-text">No machine yet. Production assigns a Packed machine from this page.</div>
            )}

            {errorMsg && !editing && (
              <div className="helper-text" style={{ color: "var(--rust)", marginTop: 12 }}>
                {errorMsg}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
