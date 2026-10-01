import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import SickHoursPage from "./SickHoursPage";

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);

describe("SickHoursPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists every employee with balance and sick history", async () => {
    (fetch as any).mockImplementation((url: string) => {
      if (url === "/api/employees/1/leave") {
        return ok({
          data: {
            balances: { SICK_SAFE_PAID: 32 },
            ledger: [
              { date: "2026-01-01", leave_type: "SICK_SAFE_PAID", entry_type: "USAGE", hours: -8, note: "2026-10-06" },
            ],
          },
        });
      }
      if (url === "/api/employees/2/leave") {
        return ok({ data: { balances: { SICK_SAFE_PAID: 40 }, ledger: [] } });
      }
      return ok({ data: [
        { id: 1, employee_number: "E1", full_name: "Amy Example" },
        { id: 2, employee_number: "E2", full_name: "Bob New" },
      ] });
    });
    render(<SickHoursPage />);
    expect(await screen.findByText("Amy Example")).toBeTruthy();
    expect(screen.getByText("Bob New")).toBeTruthy();
    // uppercase ENUM value from MySQL must still match
    expect(screen.getByText("Oct 06, 2026")).toBeTruthy();
    expect(screen.getByText("Sick Leave Balance: 32 hrs remaining")).toBeTruthy();
    expect(screen.getByText("No sick days taken.")).toBeTruthy(); // Bob's card
  });
});
