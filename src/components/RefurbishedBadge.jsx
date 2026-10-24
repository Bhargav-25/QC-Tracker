import { cycleCount, isRefurbished } from "../utils/status";

export default function RefurbishedBadge({ machine }) {
  if (!isRefurbished(machine)) return null;
  return <span className="refurbished-badge">Refurbished · cycle {cycleCount(machine)}</span>;
}
