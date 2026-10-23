import { Link } from "react-router-dom";
import PaymentTag from "./PaymentTag.jsx";
import { canOpenOrder } from "../utils/access.js";
import { maskContact, orderAddonSummary } from "../domain/orderModel.js";

export default function MachineOrderCard({ order, role }) {
  if (!order) return null;
  const summary = orderAddonSummary(order);
  const phone = maskContact(order.contact);
  const body = (
    <>
      <div className="machine-order-top">
        <span className="eyebrow">Order</span>
        <span className="order-gn">{order.groupNumber}</span>
        {canOpenOrder(role) && <span className="machine-order-go" aria-hidden="true">→</span>}
      </div>
      <div className="order-customer">{order.customer || "—"}</div>
      <div className="machine-order-meta">
        <span>{order.city || "—"}</span>
        {phone && <span>{phone}</span>}
        <PaymentTag payment={order.payment} />
      </div>
      {summary && <div className="order-summary">{summary}</div>}
    </>
  );

  if (!canOpenOrder(role)) {
    return <div className="machine-order-card">{body}</div>;
  }

  return (
    <Link
      to={`/orders/${encodeURIComponent(order.groupNumber)}`}
      className="machine-order-card"
    >
      {body}
    </Link>
  );
}
