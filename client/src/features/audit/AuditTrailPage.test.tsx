import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import AuditTrailPage from "./AuditTrailPage";

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);

describe("AuditTrailPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders newest-first audit rows", async () => {
    (fetch as any).mockImplementation(() =>
      ok({ data: { rows: [
        { id: 9, occurred_at: "2026-10-01T10:00:00", actor_user_id: 1, actor_email: "o@x.com", actor_name: "Owner", action: "period.approve", entity_table: "pay_periods", entity_id: 7, reason: null },
      ] } })
    );
    render(<AuditTrailPage />);
    expect(await screen.findByText("Audit Trail")).toBeTruthy();
    expect(screen.getByText("period.approve")).toBeTruthy();
    expect(screen.getByText("o@x.com")).toBeTruthy();
    expect(screen.getByText("pay_periods #7")).toBeTruthy();
  });
});
