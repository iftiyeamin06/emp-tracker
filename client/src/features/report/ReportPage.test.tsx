import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ReportPage from "./ReportPage";

const periods = [
  { id: 7, start_date: "2026-10-05", end_date: "2026-10-11", status: "SUBMITTED" },
  { id: 6, start_date: "2026-09-28", end_date: "2026-10-04", status: "APPROVED" },
];

const grid = (status: string) => ({
  period: { id: 7, status },
  rows: [
    {
      employee: { id: 1, full_name: "Amy Example", employee_number: "E1" },
      entry: { bonus_amount: "100.00", reimbursement_amount: "20.00" },
      computed: { reg_hours: "40.00", ot_hours: "5.00", holiday_hours: "0.00", sick_safe_paid_hours: "8.00", vacation_hours: "0.00" },
    },
  ],
});

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);

describe("ReportPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the table with mocked API data", async () => {
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: grid("SUBMITTED") })
    );
    render(<ReportPage />);
    expect(await screen.findByText("Amy Example")).toBeTruthy();
    expect(screen.getByText("40").closest("tr")?.textContent).toContain("Amy Example");
    const cells = screen.getByText("Amy Example").closest("tr")?.querySelectorAll("td");
    expect([...(cells ?? [])].map((c) => c.textContent)).toEqual(["Amy Example", "40", "5", "0", "8", "0", "100", "20"]);
  });

  it("approve button POSTs and refetches into the Approved badge", async () => {
    const calls: string[] = [];
    let approved = false;
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/approve")) {
        approved = true;
        return ok({ data: { period: { id: 7, status: "APPROVED" } } });
      }
      if (url.includes("/api/pay-periods")) return ok({ data: periods });
      return ok({ data: grid(approved ? "APPROVED" : "SUBMITTED") });
    });
    render(<ReportPage />);
    const btn = await screen.findByText("Approve");
    fireEvent.click(btn);
    expect(await screen.findByText("Approved")).toBeTruthy();
    expect(calls).toContain("POST /api/pay-periods/7/approve");
    expect(calls.filter((c) => c === "GET /api/timecards/7").length).toBeGreaterThanOrEqual(2);
  });

  it("shows a loading skeleton while fetching", async () => {
    (fetch as any).mockReturnValue(new Promise(() => {})); // never resolves
    const { unmount } = render(<ReportPage />);
    expect(screen.getByRole("status")).toBeTruthy();
    unmount();
  });

  it("shows an error state when timecards fail", async () => {
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods") ? ok({ data: periods }) : Promise.reject(new Error("down"))
    );
    render(<ReportPage />);
    expect(await screen.findByText("Could not load timecards.")).toBeTruthy();
  });

  it("shows empty states for no periods and no rows", async () => {
    (fetch as any).mockImplementation(() => ok({ data: [] }));
    const { unmount } = render(<ReportPage />);
    expect(await screen.findByText("No pay periods yet")).toBeTruthy();
    unmount();
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: { period: { id: 7, status: "OPEN" }, rows: [] } })
    );
    render(<ReportPage />);
    expect(await screen.findByText("No employees in this period")).toBeTruthy();
  });
});
