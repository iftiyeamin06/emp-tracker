import { useEffect, useState } from "react";
import { get } from "./api/client";
import { c } from "./components/theme";
import { Skeleton } from "./components/polish";
import LoginPage, { type SessionUser } from "./features/auth/LoginPage";
import ReportPage from "./features/report/ReportPage";
import TimecardPage from "./features/timecards/TimecardPage";
import EmployeesPage from "./features/employees/EmployeesPage";
import { Sidebar, TopBar } from "./components/TopBar";

const HOME: Record<SessionUser["role"], string> = { OWNER: "#/report", ADMIN: "#/timecards" };
const KNOWN = ["#/login", "#/report", "#/timecards", "#/employees", "#/"];
const TITLES: Record<string, string> = {
  "#/report": "Weekly Report",
  "#/timecards": "Timecards",
  "#/employees": "Employees",
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
  const route = useHashRoute();

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

  if (me === undefined) {
    return (
      <main style={{ fontFamily: "system-ui", padding: 24 }}>
        <Skeleton rows={3} cols={4} />
      </main>
    );
  }

  if (!me) {
    return (
      <main style={{ fontFamily: "system-ui" }}>
        {route === "#/login" && <LoginPage onSuccess={(u) => setMe(u)} />}
      </main>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: c.bg, fontFamily: "system-ui" }}>
      <Sidebar role={me.role} route={route} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <TopBar title={TITLES[route] ?? "Employee Tracker"} me={me} onLogout={logout} />
        <main style={{ padding: 24 }}>
          {route === "#/report" && (me.role === "OWNER" ? <ReportPage /> : <p>Access denied.</p>)}
          {route === "#/timecards" && (me.role === "ADMIN" ? <TimecardPage /> : <p>Access denied.</p>)}
          {route === "#/employees" && (me.role === "ADMIN" ? <EmployeesPage /> : <p>Access denied.</p>)}
        </main>
      </div>
    </div>
  );
}
