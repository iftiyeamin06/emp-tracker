import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Moon, Sun } from "lucide-react";
import { post } from "../api/client";
import { Logo } from "./polish";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
const NAV = [
    { hash: "#/timecards", label: "Timecards", roles: ["ADMIN"] },
    { hash: "#/employees", label: "Employees", roles: ["ADMIN", "OWNER"] },
    { hash: "#/report", label: "Report", roles: ["OWNER"] },
];
export function Sidebar({ role, route }) {
    return (_jsxs("aside", { className: "flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-card p-4", children: [_jsxs("div", { className: "flex items-center gap-2.5 px-2 pb-4 pt-2", children: [_jsx(Logo, { size: 32 }), _jsx("span", { className: "text-base font-medium", children: "Tracker" })] }), _jsx("nav", { className: "flex flex-col gap-1", children: NAV.filter((n) => n.roles.includes(role)).map((n) => {
                    const active = route === n.hash;
                    return (_jsx(Button, { asChild: true, variant: active ? "secondary" : "ghost", className: cn("w-full justify-start", active && "font-semibold"), children: _jsx("a", { href: n.hash, children: n.label }) }, n.hash));
                }) })] }));
}
export function TopBar({ title, me, onLogout, darkMode, onToggleTheme }) {
    const logout = async () => {
        try {
            await post("/api/auth/logout");
        }
        finally {
            onLogout();
        }
    };
    return (_jsxs("header", { className: "flex items-center justify-between border-b border-border bg-card px-6 py-4", children: [_jsx("h1", { className: "text-xl font-semibold tracking-tight", children: title }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("span", { className: "mr-1 text-sm text-muted-foreground", children: [me.email, " (", me.role, ")"] }), _jsxs(Button, { type: "button", variant: "outline", size: "sm", onClick: onToggleTheme, "aria-label": `Switch to ${darkMode ? "light" : "dark"} mode`, "aria-pressed": darkMode, children: [darkMode ? _jsx(Sun, {}) : _jsx(Moon, {}), darkMode ? "Light" : "Dark"] }), _jsx(Button, { variant: "ghost", size: "sm", onClick: logout, children: "Log out" })] })] }));
}
