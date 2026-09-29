import { post } from "../api/client";
import { c, font } from "./theme";
import { Logo } from "./polish";
import type { SessionUser } from "../features/auth/LoginPage";

const NAV: { hash: string; label: string; roles: SessionUser["role"][] }[] = [
  { hash: "#/timecards", label: "Timecards", roles: ["ADMIN"] },
  { hash: "#/employees", label: "Employees", roles: ["ADMIN"] },
  { hash: "#/report", label: "Report", roles: ["OWNER"] },
];

export function Sidebar({ role, route }: { role: SessionUser["role"]; route: string }) {
  return (
    <aside style={{ width: 220, flexShrink: 0, background: c.card, borderRight: `1px solid ${c.border}`, padding: 16, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 16px" }}>
        <Logo size={32} />
        <span style={{ ...font.section }}>Tracker</span>
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {NAV.filter((n) => n.roles.includes(role)).map((n) => {
          const active = route === n.hash;
          return (
            <a
              key={n.hash}
              href={n.hash}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                textDecoration: "none",
                fontSize: 14,
                fontWeight: active ? 600 : 400,
                color: active ? c.primary : c.ink,
                background: active ? "#eff6ff" : "transparent",
              }}
            >
              {n.label}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}

export function TopBar({ title, me, onLogout }: { title: string; me: SessionUser; onLogout: () => void }) {
  const logout = async () => {
    try {
      await post("/api/auth/logout");
    } finally {
      onLogout();
    }
  };

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 24px",
        background: c.card,
        borderBottom: `1px solid ${c.border}`,
      }}
    >
      <h1 style={{ ...font.title, margin: 0 }}>{title}</h1>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={font.muted}>
          {me.email} ({me.role})
        </span>
        <button onClick={logout}>Log out</button>
      </div>
    </header>
  );
}
