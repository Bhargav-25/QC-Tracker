import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import OrderStatusTag from "../components/OrderStatusTag.jsx";
import PaymentTag from "../components/PaymentTag.jsx";
import { canEditOrders } from "../utils/access.js";
import {
  displayOrderStatus,
  formatDisplayDate,
  machineForOrder,
  orderHasMachine,
} from "../domain/orderModel.js";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "Please Ship", label: "Please Ship" },
  { id: "Pause Shipment", label: "Pause Shipment" },
  { id: "Cancelled", label: "Cancelled" },
  { id: "assigned", label: "Assigned" },
];

function matchesFilter(order, filter, machine) {
  if (filter === "all") return true;
  if (filter === "assigned") return orderHasMachine(order);
  return displayOrderStatus(order, machine) === filter;
}

function matchesQuery(order, machine, query) {
  if (!query) return true;
  const haystack = [
    order.groupNumber,
    order.customer,
    order.city,
    order.contact,
    order.machineNumber,
    machine?.machineNumber,
    order.address,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export default function OrdersList({ orders, machines, role, ordersError }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const query = search.trim().toLowerCase();

  const decorated = useMemo(
    () =>
      orders.map((order) => ({
        order,
        machine: machineForOrder(order, machines),
      })),
    [orders, machines]
  );

  const searched = decorated.filter(({ order, machine }) => matchesQuery(order, machine, query));
  const counts = { all: searched.length, assigned: 0 };
  for (const item of searched) {
    const status = displayOrderStatus(item.order, item.machine);
    counts[status] = (counts[status] || 0) + 1;
    if (orderHasMachine(item.order)) counts.assigned += 1;
  }
  const visible = searched
    .filter(({ order, machine }) => matchesFilter(order, filter, machine))
    .slice()
    .sort((a, b) => {
      const byDate = (b.order.orderDate || "").localeCompare(a.order.orderDate || "");
      if (byDate) return byDate;
      return (b.order.groupNumber || "").localeCompare(a.order.groupNumber || "", undefined, { numeric: true });
    });

  return (
    <div className="orders-wrap">
      <div className="page-header">
        <div>
          <div className="eyebrow">Sales</div>
          <h1>Orders</h1>
        </div>
        {canEditOrders(role) && (
          <Link to="/orders/new" className="btn btn-primary">
            + New order
          </Link>
        )}
      </div>

      {ordersError && (
        <div className="panel" style={{ marginBottom: 16, borderColor: "var(--rust)" }}>
          <div className="section-title">Orders are not available</div>
          <div className="section-sub" style={{ marginBottom: 0 }}>
            {ordersError.code === "permission-denied"
              ? "Publish the updated Firestore rules (they add the orders collection and the Sales role), then reload."
              : ordersError.message}
          </div>
        </div>
      )}

      <div className="field">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search group no, customer, city, phone..."
          aria-label="Search orders"
        />
      </div>

      <div className="filter-chips" role="tablist" aria-label="Filter orders">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={"chip" + (filter === item.id ? " active" : "")}
            onClick={() => setFilter(item.id)}
          >
            {item.label} {counts[item.id] || 0}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">
          {orders.length === 0 ? "No orders yet." : "No orders match that filter."}
        </div>
      ) : (
        <div className="order-list">
          {visible.map(({ order, machine }) => {
            const status = displayOrderStatus(order, machine);
            const machineLabel = machine?.machineNumber || order.machineNumber || "— No machine yet";
            return (
              <Link
                key={order.id || order.groupNumber}
                to={`/orders/${encodeURIComponent(order.groupNumber)}`}
                className="order-card"
              >
                <div className="order-card-top">
                  <span className="order-gn">{order.groupNumber}</span>
                  <PaymentTag payment={order.payment} />
                  <span className="order-date">{formatDisplayDate(order.orderDate)}</span>
                </div>
                <div className="order-customer">{order.customer || "No customer name"}</div>
                <div className="order-card-bottom">
                  <div>
                    <div className="order-city">{order.city || "—"}</div>
                    <div className={"order-machine" + (machine || order.machineNumber ? " linked" : "")}>
                      {machineLabel}
                    </div>
                  </div>
                  <OrderStatusTag status={status} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
