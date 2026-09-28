import { useEffect, useState } from "react";
import { get } from "./api/client";
import LoginPage, { type SessionUser } from "./features/auth/LoginPage";
import ReportPage from "./features/report/ReportPage";
import TimecardPage from "./features/timecards/TimecardPage";
import TopBar from "./components/TopBar";

const HOME: Record<SessionUser["role"], string> = { OWNER: "#/report", ADMIN: "#/timecards" };
const KNOWN = ["#/login", "#/report", "#/timecards", "#/"];

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
  const [health, setHealth] = useState<any>(null);
  const [me, setMe] = useState<SessionUser | null | undefined>(undefined); // undefined = loading
  const route = useHashRoute();

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch((e) => setHealth({ status: "error: " + e }));
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
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 720 }}>
      <h1>Employee Tracker</h1>
      <p>API status: {health ? JSON.stringify(health.status) : "loading…"}</p>
      {!me ? (
        route === "#/login" && <LoginPage onSuccess={(u) => setMe(u)} />
      ) : (
        <>
          <TopBar me={me} onLogout={logout} />
          {route === "#/report" && (me.role === "OWNER" ? <ReportPage /> : <p>Access denied.</p>)}
          {route === "#/timecards" && (me.role === "ADMIN" ? <TimecardPage /> : <p>Access denied.</p>)}
        </>
      )}
    </main>
  );
}
