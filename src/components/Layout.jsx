import { NavLink } from "react-router-dom";
import { ROLES } from "../constants";
import { logout } from "../utils/authApi";

const NAV_BY_ROLE = {
  [ROLES.ADMIN]: [
    { to: "/", label: "Dashboard", end: true },
    { to: "/machines", label: "Machines" },
    { to: "/machine/new", label: "Add Machine" },
    { to: "/stand-inventory", label: "Stand Inventory" },
    { to: "/maintenance", label: "Maintenance" },
    { to: "/notifications", label: "Notifications", showBadge: true },
    { to: "/manage-users", label: "Manage Users" },
  ],
  [ROLES.PRODUCTION]: [
    { to: "/machines", label: "Machines", end: true },
    { to: "/machine/new", label: "Add Machine" },
    { to: "/stand-inventory", label: "Stand Inventory" },
    { to: "/notifications", label: "Notifications", showBadge: true },
  ],
  [ROLES.INSTALLATION]: [
    { to: "/machines", label: "Machines", end: true },
  ],
  [ROLES.DASHBOARD]: [
    { to: "/", label: "Dashboard", end: true },
  ],
};

export default function Layout({ children, missingCount = 0, role, userEmail }) {
  const navItems = NAV_BY_ROLE[role] || [];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="mark">QC TRACK</div>
          <div className="sub">{role || "—"}</div>
        </div>
        <nav style={{ flex: 1 }}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
            >
              {item.label}
              {item.showBadge && missingCount > 0 && (
                <span className="nav-badge">{missingCount}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: "12px 20px 0", borderTop: "1px solid var(--line)" }}>
          <div className="helper-text" style={{ marginBottom: 8, wordBreak: "break-all" }}>
            {userEmail}
          </div>
          <button className="btn btn-ghost" onClick={() => logout()} style={{ padding: "6px 0" }}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main-area">{children}</main>
    </div>
  );
}
