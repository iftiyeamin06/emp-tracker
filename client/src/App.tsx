import { useEffect, useState } from "react";
import { get } from "./api/client";
import { Skeleton } from "./components/polish";
import LoginPage, { type SessionUser } from "./features/auth/LoginPage";
import ReportPage from "./features/report/ReportPage";
import SickHoursPage from "./features/leave/SickHoursPage";
import AuditTrailPage from "./features/audit/AuditTrailPage";
import TimecardPage from "./features/timecards/TimecardPage";
import EmployeesPage from "./features/employees/EmployeesPage";
import { Sidebar, TopBar, MobileDrawer } from "./components/TopBar";
import "./theme.css";

const HOME: Record<SessionUser["role"], string> = { OWNER: "#/report", ADMIN: "#/timecards" };
const KNOWN = ["#/login", "#/report", "#/report/weekly", "#/report/monthly", "#/timecards", "#/employees", "#/sick", "#/audit", "#/"];
const TITLES: Record<string, string> = {
  "#/report": "Reports",
  "#/report/weekly": "Weekly Report",
  "#/report/monthly": "Monthly Report",
  "#/timecards": "Timecards",
  "#/employees": "Employees",
  "#/sick": "Sick Hours",
  "#/audit": "Audit Trail",
};

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export default function App() {
  const [me, setMe] = useState<SessionUser | null | undefined>(undefined); // undefined = loading
  const [darkMode, setDarkMode] = useState(() => window.localStorage.getItem("emp-tracker-theme") === "dark");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const route = useHashRoute();

  useEffect(() => {
    setDrawerOpen(false); // navigating closes the mobile drawer
  }, [route]);

  useEffect(() => {
    get<{ user: SessionUser }>("/api/auth/me")
      .then((j) => setMe(j.user))
      .catch(() => setMe(null)); // single session check, cached in top-level state
  }, []);

  // Central guard: unauthenticated + protected -> #/login; logged-in on #/login
  // or #/ -> role home; unknown route -> #/. Wrong role renders Access denied
  // below (never a login redirect — the user IS logged in).
  useEffect(() => {
    if (me === undefined) return;
    if (!me) {
      if (route !== "#/login") window.location.hash = "#/login";
    } else if (route === "#/login" || route === "#/") {
      window.location.hash = HOME[me.role];
    } else if (!KNOWN.includes(route)) {
      window.location.hash = "#/";
    }
  }, [me, route]);

  const logout = () => {
    setMe(null);
    window.location.hash = "#/login";
  };

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    window.localStorage.setItem("emp-tracker-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  if (me === undefined) {
    return (
      <main className="p-6">
        <Skeleton rows={3} cols={4} />
      </main>
    );
  }

  if (!me) {
    return (
      <main>
        {route === "#/login" && <LoginPage onSuccess={(u) => setMe(u)} />}
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-muted/40">
      <Sidebar role={me.role} route={route} />
      <MobileDrawer role={me.role} route={route} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={TITLES[route] ?? "HourBook"} me={me} onLogout={logout} onMenu={() => setDrawerOpen(true)} darkMode={darkMode} onToggleTheme={() => setDarkMode((dark) => !dark)} />
        <main className="p-4 md:p-6">
          {(route === "#/report" || route === "#/report/weekly" || route === "#/report/monthly") &&
            (me.role === "OWNER" ? (
              <ReportPage
                key={route}
                initialMode={route === "#/report/monthly" ? "monthly" : "weekly"}
                lockMode={route !== "#/report"}
              />
            ) : (
              <p>Access denied.</p>
            ))}
          {route === "#/sick" && <SickHoursPage />}
          {route === "#/audit" && (me.role === "OWNER" ? <AuditTrailPage /> : <p>Access denied.</p>)}
          {route === "#/timecards" && (me.role === "ADMIN" ? <TimecardPage /> : <p>Access denied.</p>)}
          {route === "#/employees" && (me.role === "ADMIN" ? <EmployeesPage /> : me.role === "OWNER" ? <EmployeesPage readOnly /> : <p>Access denied.</p>)}
        </main>
      </div>
    </div>
  );
}
