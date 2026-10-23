import { STATUS } from "../constants.js";
import StatusTag from "./StatusTag.jsx";

const EXTRA = {
  "Pause Shipment": "pause",
  "Please Ship": "ship",
  Cancelled: "cancelled",
};

export default function OrderStatusTag({ status }) {
  if (Object.values(STATUS).includes(status)) {
    return <StatusTag status={status} />;
  }
  const tone = EXTRA[status] || "legacy";
  return <span className={`status-tag ${tone}`}>{status || "—"}</span>;
}
