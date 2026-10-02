import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import HolidaysPage from "./HolidaysPage";

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);

describe("HolidaysPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("groups holiday and worked-holiday dates per employee", async () => {
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/timecards/")) {
        return ok({ data: { rows: [
          {
            employee: { id: 1, full_name: "Amy Example", employee_number: "E1" },
            days: [
              { work_date: "2026-10-09", day_type: "HOLIDAY", hours: "8.00" },
              { work_date: "2026-10-10", day_type: "WORK", hours: "8.00" },
            ],
          },
          {
            employee: { id: 2, full_name: "Bob New", employee_number: "E2" },
            days: [{ work_date: "2026-10-09", day_type: "HOLIDAY_WORKED", hours: "8.00" }],
          },
        ] } });
      }
      return ok({ data: [{ id: 7 }] });
    });
    render(<HolidaysPage />);
    expect(await screen.findByText("Amy Example")).toBeTruthy();
    expect(screen.getByText("Bob New")).toBeTruthy();
    expect(screen.getAllByText("Oct 09, 2026")).toHaveLength(2);
    expect(screen.getByText("Worked holiday")).toBeTruthy(); // Bob's kind
    expect(screen.queryByText("Oct 10, 2026")).toBeNull(); // WORK day excluded
  });
});
