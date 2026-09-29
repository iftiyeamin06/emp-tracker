import type React from "react";

// Design tokens — single source for the v1 look. Inline styles only.
export const c = {
  primary: "#2563eb",
  bg: "#f9fafb",
  card: "#ffffff",
  border: "#e5e7eb",
  muted: "#6b7280",
  ink: "#111827",
  danger: "#dc2626",
  success: "#16a34a",
  warning: "#d97706",
};

export const font = {
  title: { fontSize: 24, fontWeight: 600, color: c.ink },
  section: { fontSize: 16, fontWeight: 500, color: c.ink },
  th: { fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.4, color: c.muted },
  body: { fontSize: 14, fontWeight: 400, color: c.ink },
  muted: { fontSize: 12, fontWeight: 400, color: c.muted },
} as const;

const btnBase: React.CSSProperties = {
  height: 36,
  padding: "0 16px",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
  border: "1px solid transparent",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  whiteSpace: "nowrap",
};

export const btnPrimary: React.CSSProperties = { ...btnBase, background: c.primary, color: "#fff" };
export const btnSecondary: React.CSSProperties = { ...btnBase, background: "#fff", borderColor: "#d1d5db", color: c.ink };
export const btnGhost: React.CSSProperties = { ...btnBase, background: "transparent", color: c.primary };
export const btnOff: React.CSSProperties = { opacity: 0.45, cursor: "not-allowed" };

export const card: React.CSSProperties = {
  background: c.card,
  border: `1px solid ${c.border}`,
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(16,24,40,0.06)",
};

export const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  ...font.body,
  background: "#fff",
};

export const th: React.CSSProperties = {
  ...font.th,
  background: "#f9fafb",
  padding: "10px 12px",
  textAlign: "left",
  whiteSpace: "nowrap",
  position: "sticky",
  top: 0,
  zIndex: 2,
  borderBottom: `1px solid ${c.border}`,
};

export const td: React.CSSProperties = { padding: "6px 10px", borderBottom: `1px solid ${c.border}` };

export const field: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: 14,
  background: "#fff",
};

// Row hover + spinner need real CSS (inline styles can't do :hover/@keyframes).
export const hoverCss = `
.tc-row:hover td { background: #f8fafc; }
.tc-date:focus { outline: 2px solid #2563eb; outline-offset: 1px; }
@keyframes tc-spin { to { transform: rotate(360deg); } }
.tc-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%; animation: tc-spin .7s linear infinite; display: inline-block; }
`;
