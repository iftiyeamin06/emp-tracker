// Shared polish primitives (inline styles only — no UI library in v1).

// Muted CASH pill for cash-paid rows. Distinct but not loud.
export function CashBadge() {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        background: "#f3f4f6",
        color: "#4b5563",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: "1px 8px",
        marginLeft: 6,
        whiteSpace: "nowrap",
      }}
    >
      CASH
    </span>
  );
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span
      aria-label="Employee Tracker logo"
      style={{
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
      }}
    >
      ET
    </span>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 400,
        margin: "8vh auto",
        padding: 32,
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
        background: "#fff",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div style={{ padding: "32px 16px", textAlign: "center", color: "#4b5563" }}>
      <p style={{ fontSize: 18, margin: "0 0 8px" }}>{title}</p>
      {hint && <p style={{ margin: "0 0 16px", fontSize: 14 }}>{hint}</p>}
      {action}
    </div>
  );
}

// Loading skeleton (role=status so tests + screen readers see "Loading").
export function Skeleton({ rows = 5, cols = 8 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Loading" style={{ padding: "8px 0" }}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {Array.from({ length: cols }, (_, c) => (
            <div
              key={c}
              style={{
                height: 16,
                flex: c === 0 ? "0 0 120px" : 1,
                borderRadius: 4,
                background: "linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// Friendly error: soft box with a title, plain-language message, optional retry.
// Never a raw stack trace or bare red text.
export function Notice({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      style={{
        border: "1px solid #fecaca",
        background: "#fef2f2",
        borderRadius: 8,
        padding: "12px 16px",
        margin: "12px 0",
        color: "#7f1d1d",
      }}
    >
      <p style={{ margin: "0 0 4px", fontWeight: 600 }}>⚠ {title}</p>
      <p style={{ margin: 0 }}>{message}</p>
      {onRetry && (
        <button onClick={onRetry} style={{ marginTop: 8 }}>
          Try again
        </button>
      )}
    </div>
  );
}

// Horizontal-scroll wrapper so wide grids scroll on mobile instead of crushing.
export function ScrollX({ children }: { children: React.ReactNode }) {
  return <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>{children}</div>;
}
