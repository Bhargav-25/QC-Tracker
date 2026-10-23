import { useState } from "react";
import { ORDER_PAYMENTS, ORDER_STATUSES } from "../domain/orderModel.js";

const YES_NO = ["Yes", "No"];
const BENCHES = ["NONE", "Incline", "Flat", "PRO"];
const GLASS = ["Metal", "Glass"];

function withCurrent(options, current) {
  const value = String(current || "").trim();
  if (value && !options.includes(value)) return [value, ...options];
  return options;
}

function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export default function OrderForm({ initial, creating, saving, errorMsg, onSubmit, onCancel }) {
  const [draft, setDraft] = useState(() => ({
    groupNumber: initial?.groupNumber || "",
    status: ORDER_STATUSES.includes(initial?.status) ? initial.status : "",
    payment: initial?.payment || "Paid",
    orderDate: initial?.orderDate || "",
    customer: initial?.customer || "",
    contact: initial?.contact || "",
    city: initial?.city || "",
    address: initial?.address || "",
    comments: initial?.comments || "",
    orderType: initial?.orderType || "",
    warranty: initial?.warranty || "Default, 1 year total warranty",
    paymentStatus: initial?.paymentStatus || "",
    tab: initial?.tab || "No",
    accessories: initial?.accessories || "Yes",
    hanger: initial?.hanger || "No",
    bench: initial?.bench || "NONE",
    glassMetal: initial?.glassMetal || "Metal",
  }));

  function set(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(draft);
  }

  const payments = withCurrent(ORDER_PAYMENTS, draft.payment);
  const benches = withCurrent(BENCHES, draft.bench);
  const glassOptions = withCurrent(GLASS, draft.glassMetal);

  return (
    <form onSubmit={handleSubmit}>
      {creating && (
        <Field label="Group number">
          <input
            value={draft.groupNumber}
            onChange={(e) => set("groupNumber", e.target.value)}
            placeholder="G1458"
            autoFocus
          />
        </Field>
      )}

      <div className="field-row">
        <Field label="Status">
          <select value={draft.status} onChange={(e) => set("status", e.target.value)}>
            <option value="" disabled>
              Choose status…
            </option>
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payment">
          <select value={draft.payment} onChange={(e) => set("payment", e.target.value)}>
            {payments.map((payment) => (
              <option key={payment} value={payment}>
                {payment}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Order date">
        <input type="date" value={draft.orderDate || ""} onChange={(e) => set("orderDate", e.target.value)} />
      </Field>

      <Field label="Customer">
        <input value={draft.customer} onChange={(e) => set("customer", e.target.value)} />
      </Field>

      <div className="field-row">
        <Field label="Contact">
          <input value={draft.contact} onChange={(e) => set("contact", e.target.value)} inputMode="tel" />
        </Field>
        <Field label="City">
          <input value={draft.city} onChange={(e) => set("city", e.target.value)} />
        </Field>
      </div>

      <Field label="Address">
        <textarea rows={3} value={draft.address} onChange={(e) => set("address", e.target.value)} />
      </Field>

      <Field label="Comments">
        <textarea rows={3} value={draft.comments} onChange={(e) => set("comments", e.target.value)} />
      </Field>

      <div className="field-row">
        <Field label="Order type">
          <input
            value={draft.orderType}
            onChange={(e) => set("orderType", e.target.value)}
            placeholder="Personal use"
          />
        </Field>
        <Field label="Warranty">
          <input value={draft.warranty} onChange={(e) => set("warranty", e.target.value)} />
        </Field>
      </div>

      <Field label="Payment status">
        <input
          value={draft.paymentStatus}
          onChange={(e) => set("paymentStatus", e.target.value)}
          placeholder="Optional note about the payment"
        />
      </Field>

      <div className="section-title" style={{ marginTop: 8 }}>Add-ons</div>
      <div className="field-row">
        <Field label="Tab">
          <select value={draft.tab} onChange={(e) => set("tab", e.target.value)}>
            {withCurrent(YES_NO, draft.tab).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </Field>
        <Field label="Accessories">
          <select value={draft.accessories} onChange={(e) => set("accessories", e.target.value)}>
            {withCurrent(YES_NO, draft.accessories).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="field-row">
        <Field label="Hanger">
          <select value={draft.hanger} onChange={(e) => set("hanger", e.target.value)}>
            {withCurrent(YES_NO, draft.hanger).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </Field>
        <Field label="Bench type">
          <select value={draft.bench} onChange={(e) => set("bench", e.target.value)}>
            {benches.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Glass / metal">
        <select value={draft.glassMetal} onChange={(e) => set("glassMetal", e.target.value)}>
          {glassOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </Field>

      {initial?.sheetStatus && !ORDER_STATUSES.includes(initial.sheetStatus) && (
        <div className="helper-text" style={{ marginBottom: 12 }}>
          Imported sheet status is “{initial.sheetStatus}”. Saving a sales status here replaces it on the sheet mirror.
        </div>
      )}

      {errorMsg && (
        <div className="helper-text" style={{ color: "var(--rust)", marginBottom: 12 }}>
          {errorMsg}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : creating ? "Create order" : "Save order"}
        </button>
        {onCancel && (
          <button className="btn btn-ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
