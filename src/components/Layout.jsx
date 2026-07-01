import { NavLink } from "react-router-dom";

export default function Layout({ children, missingCount = 0 }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="mark">QC TRACK</div>
          <div className="sub">Machine QC &amp; Dispatch</div>
        </div>
        <nav>
          <NavLink
            to="/"
            end
            className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/machine/new"
            className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
          >
            Add Machine
          </NavLink>
          <NavLink
            to="/notifications"
            className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
          >
            Notifications
            {missingCount > 0 && <span className="nav-badge">{missingCount}</span>}
          </NavLink>
        </nav>
      </aside>
      <main className="main-area">{children}</main>
    </div>
  );
}
