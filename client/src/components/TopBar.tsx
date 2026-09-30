import { Moon, Sun } from "lucide-react";
import { post } from "../api/client";
import type { SessionUser } from "../features/auth/LoginPage";
import { Logo } from "./polish";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

const NAV: { hash: string; label: string; roles: SessionUser["role"][] }[] = [
  { hash: "#/timecards", label: "Timecards", roles: ["ADMIN"] },
  { hash: "#/employees", label: "Employees", roles: ["ADMIN"] },
  { hash: "#/report", label: "Report", roles: ["OWNER"] },
];

export function Sidebar({ role, route }: { role: SessionUser["role"]; route: string }) {
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-card p-4">
      <div className="flex items-center gap-2.5 px-2 pb-4 pt-2">
        <Logo size={32} />
        <span className="text-base font-medium">Tracker</span>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.filter((n) => n.roles.includes(role)).map((n) => {
          const active = route === n.hash;
          return (
            <Button
              key={n.hash}
              asChild
              variant={active ? "secondary" : "ghost"}
              className={cn("w-full justify-start", active && "font-semibold")}
            >
              <a href={n.hash}>{n.label}</a>
            </Button>
          );
        })}
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
    <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <div className="flex items-center gap-2">
        <span className="mr-1 text-sm text-muted-foreground">
          {me.email} ({me.role})
        </span>
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
