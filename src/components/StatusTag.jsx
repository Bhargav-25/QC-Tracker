import { STATUS } from "../constants";

const classMap = {
  [STATUS.ASSEMBLY]: "assembly",
  [STATUS.TESTING]: "testing",
  [STATUS.PACKED]: "packed",
  [STATUS.DISPATCHED]: "dispatched",
  [STATUS.DELIVERED]: "delivered",
  [STATUS.INSTALLED]: "installed",
};

export default function StatusTag({ status }) {
  return (
    <span className={`status-tag ${classMap[status] || "assembly"}`}>
      {status}
    </span>
  );
}
