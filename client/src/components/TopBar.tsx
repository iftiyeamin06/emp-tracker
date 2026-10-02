import { Fragment } from "react";
import { Moon, Sun } from "lucide-react";
import { post } from "../api/client";
import type { SessionUser } from "../features/auth/LoginPage";
import { Logo } from "./polish";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

const NAV: { hash: string; label: string; roles: SessionUser["role"][]; children?: { hash: string; label: string }[] }[] = [
  { hash: "#/timecards", label: "Timecards", roles: ["ADMIN"] },
  { hash: "#/employees", label: "Employees", roles: ["ADMIN", "OWNER"] },
  { hash: "#/sick", label: "Sick Hours", roles: ["ADMIN", "OWNER"] },
  { hash: "#/audit", label: "Audit Trail", roles: ["OWNER"] },
  {
    hash: "#/report",
    label: "Report",
    roles: ["OWNER"],
    children: [
      { hash: "#/report/weekly", label: "Weekly Report" },
      { hash: "#/report/monthly", label: "Monthly Report" },
    ],
  },
];

function NavLink({ hash, label, active, sub = false }: { hash: string; label: string; active: boolean; sub?: boolean }) {
  return (
    <Button
      asChild
      variant={active ? "secondary" : "ghost"}
      className={cn(
        "relative w-full justify-start",
        sub && "pl-8 text-sm font-normal",
        active && "bg-accent font-semibold text-accent-foreground"
      )}
    >
      <a href={hash}>
        {active && (
          <span aria-hidden className="absolute inset-y-1 left-0 w-1 rounded-full bg-primary" />
        )}
        {label}
      </a>
    </Button>
  );
}

export function Sidebar({ role, route }: { role: SessionUser["role"]; route: string }) {
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-card p-4">
      <div className="flex items-center gap-2.5 px-2 pb-4 pt-2">
        <Logo size={32} />
        <span className="text-base font-medium">Tracker</span>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.filter((n) => n.roles.includes(role)).map((n) => (
          <Fragment key={n.hash}>
            <NavLink hash={n.hash} label={n.label} active={route === n.hash} />
            {n.children?.map((c) => (
              <NavLink key={c.hash} hash={c.hash} label={c.label} active={route === c.hash} sub />
            ))}
          </Fragment>
        ))}
      </nav>
    </aside>
  );
}

export function TopBar({ title, me, onLogout, darkMode, onToggleTheme }: { title: string; me: SessionUser; onLogout: () => void; darkMode: boolean; onToggleTheme: () => void }) {
  const logout = async () => {
    try {
      await post("/api/auth/logout");
    } finally {
      onLogout();
    }
  };

  return (
    <header className="flex items-center justify-between border-b border-border/60 bg-background/95 px-6 py-4 backdrop-blur-md">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <div className="flex items-center gap-2">
        <span className="mr-1 text-sm text-muted-foreground">{me.email}</span>
        <Badge
          variant="outline"
          className="border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          {me.role}
        </Badge>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onToggleTheme}
          aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`}
          aria-pressed={darkMode}
        >
          {darkMode ? <Sun /> : <Moon />}
          {darkMode ? "Light" : "Dark"}
        </Button>
        <Button variant="ghost" size="sm" onClick={logout}>
          Log out
        </Button>
      </div>
    </header>
  );
}
