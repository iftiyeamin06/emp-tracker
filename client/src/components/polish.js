import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Shared polish primitives (inline styles only — no UI library in v1).
// Muted CASH pill for cash-paid rows. Distinct but not loud.
export function CashBadge() {
    return (_jsx("span", { style: {
            fontSize: 11,
            fontWeight: 600,
            background: "#f3f4f6",
            color: "#4b5563",
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            padding: "1px 8px",
            marginLeft: 6,
            whiteSpace: "nowrap",
        }, children: "CASH" }));
}
export function Logo({ size = 40 }) {
    return (_jsx("span", { "aria-label": "Employee Tracker logo", style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: size,
            height: size,
            borderRadius: size / 4,
            background: "#1d4ed8",
            color: "#fff",
            fontWeight: 700,
            fontSize: size / 2.4,
            letterSpacing: 0.5,
            userSelect: "none",
        }, children: "ET" }));
}
export function Card({ children }) {
    return (_jsx("div", { style: {
            maxWidth: 400,
            margin: "8vh auto",
            padding: 32,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
            background: "#fff",
            textAlign: "center",
        }, children: children }));
}
export function EmptyState({ title, hint, action }) {
    return (_jsxs("div", { style: { padding: "32px 16px", textAlign: "center", color: "#4b5563" }, children: [_jsx("p", { style: { fontSize: 18, margin: "0 0 8px" }, children: title }), hint && _jsx("p", { style: { margin: "0 0 16px", fontSize: 14 }, children: hint }), action] }));
}
// Loading skeleton (role=status so tests + screen readers see "Loading").
export function Skeleton({ rows = 5, cols = 8 }) {
    return (_jsx("div", { role: "status", "aria-label": "Loading", style: { padding: "8px 0" }, children: Array.from({ length: rows }, (_, r) => (_jsx("div", { style: { display: "flex", gap: 8, marginBottom: 8 }, children: Array.from({ length: cols }, (_, c) => (_jsx("div", { style: {
                    height: 16,
                    flex: c === 0 ? "0 0 120px" : 1,
                    borderRadius: 4,
                    background: "linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)",
                } }, c))) }, r))) }));
}
// Friendly error: soft box with a title, plain-language message, optional retry.
// Never a raw stack trace or bare red text.
export function Notice({ title, message, onRetry }) {
    return (_jsxs("div", { role: "alert", style: {
            border: "1px solid #fecaca",
            background: "#fef2f2",
            borderRadius: 8,
            padding: "12px 16px",
            margin: "12px 0",
            color: "#7f1d1d",
        }, children: [_jsxs("p", { style: { margin: "0 0 4px", fontWeight: 600 }, children: ["\u26A0 ", title] }), _jsx("p", { style: { margin: 0 }, children: message }), onRetry && (_jsx("button", { onClick: onRetry, style: { marginTop: 8 }, children: "Try again" }))] }));
}
// Horizontal-scroll wrapper so wide grids scroll on mobile instead of crushing.
export function ScrollX({ children }) {
    return _jsx("div", { style: { overflowX: "auto", WebkitOverflowScrolling: "touch" }, children: children });
}
