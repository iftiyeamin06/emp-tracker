import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { get } from "./api/client";
import { Skeleton } from "./components/polish";
import LoginPage from "./features/auth/LoginPage";
import ReportPage from "./features/report/ReportPage";
import TimecardPage from "./features/timecards/TimecardPage";
import EmployeesPage from "./features/employees/EmployeesPage";
import { Sidebar, TopBar } from "./components/TopBar";
import "./theme.css";
const HOME = { OWNER: "#/report", ADMIN: "#/timecards" };
const KNOWN = ["#/login", "#/report", "#/timecards", "#/employees", "#/"];
const TITLES = {
    "#/report": "Reports",
    "#/timecards": "Timecards",
    "#/employees": "Employees",
};
function useHashRoute() {
    const [hash, setHash] = useState(window.location.hash || "#/");
    useEffect(() => {
        const onChange = () => setHash(window.location.hash || "#/");
        window.addEventListener("hashchange", onChange);
        return () => window.removeEventListener("hashchange", onChange);
    }, []);
    return hash;
}
export default function App() {
    const [me, setMe] = useState(undefined); // undefined = loading
    const [darkMode, setDarkMode] = useState(() => window.localStorage.getItem("emp-tracker-theme") === "dark");
    const route = useHashRoute();
    useEffect(() => {
        get("/api/auth/me")
            .then((j) => setMe(j.user))
            .catch(() => setMe(null)); // single session check, cached in top-level state
    }, []);
    // Central guard: unauthenticated + protected -> #/login; logged-in on #/login
    // or #/ -> role home; unknown route -> #/. Wrong role renders Access denied
    // below (never a login redirect — the user IS logged in).
    useEffect(() => {
        if (me === undefined)
            return;
        if (!me) {
            if (route !== "#/login")
                window.location.hash = "#/login";
        }
        else if (route === "#/login" || route === "#/") {
            window.location.hash = HOME[me.role];
        }
        else if (!KNOWN.includes(route)) {
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
        return (_jsx("main", { className: "p-6", children: _jsx(Skeleton, { rows: 3, cols: 4 }) }));
    }
    if (!me) {
        return (_jsx("main", { children: route === "#/login" && _jsx(LoginPage, { onSuccess: (u) => setMe(u) }) }));
    }
    return (_jsxs("div", { className: "flex min-h-screen bg-muted/40", children: [_jsx(Sidebar, { role: me.role, route: route }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col", children: [_jsx(TopBar, { title: TITLES[route] ?? "Employee Tracker", me: me, onLogout: logout, darkMode: darkMode, onToggleTheme: () => setDarkMode((dark) => !dark) }), _jsxs("main", { className: "p-6", children: [route === "#/report" && (me.role === "OWNER" ? _jsx(ReportPage, {}) : _jsx("p", { children: "Access denied." })), route === "#/timecards" && (me.role === "ADMIN" ? _jsx(TimecardPage, {}) : _jsx("p", { children: "Access denied." })), route === "#/employees" && (me.role === "ADMIN" ? _jsx(EmployeesPage, {}) : me.role === "OWNER" ? _jsx(EmployeesPage, { readOnly: true }) : _jsx("p", { children: "Access denied." }))] })] })] }));
}
