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

  it("monthly mode fetches by month and renders summed rows", async () => {
    const calls: string[] = [];
    (fetch as any).mockImplementation((url: string) => {
      calls.push(url);
      if (url.includes("/api/reports/monthly")) {
        return ok({ data: { month: "2026-10", rows: [
          { employee_id: 1, name: "Amy Example", reg: 80, ot: 0, hol: 0, sick: 8, vacation: 0, bonus: 0, reimb: 0 },
        ] } });
      }
      return ok({ data: periods });
    });
    render(<ReportPage />);
    fireEvent.click(await screen.findByText("Monthly"));
    expect(await screen.findByText("Amy Example")).toBeTruthy();
    expect(calls.some((c) => c.includes("/api/reports/monthly?month="))).toBe(true);
  });

  it("monthly OT shows the summed per-week value, never recomputed", async () => {
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/reports/monthly")) {
        return ok({ data: { month: "2026-10", rows: [
          { employee_id: 1, name: "Amy Example", reg: 75, ot: 5, hol: 0, sick: 0, vacation: 0, bonus: 0, reimb: 0 },
        ] } });
      }
      return ok({ data: periods });
    });
    render(<ReportPage />);
    fireEvent.click(await screen.findByText("Monthly"));
    const row = (await screen.findByText("Amy Example")).closest("tr");
    const cells = [...(row?.querySelectorAll("td") ?? [])].map((c) => c.textContent);
    expect(cells).toEqual(["Amy Example", "75", "5", "0", "0", "0", "0", "0"]);
  });

  it("monthly mode shows the per-week breakdown", async () => {
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/reports/monthly")) {
        return ok({ data: { month: "2026-10", rows: [
          { employee_id: 1, name: "Amy Example", reg: 75, ot: 5, hol: 0, sick: 0, vacation: 0, bonus: 0, reimb: 0,
            weeks: [
              { week_start: "2026-09-28", week_end: "2026-10-04", reg: 40, ot: 5 },
              { week_start: "2026-10-05", week_end: "2026-10-11", reg: 35, ot: 0 },
            ] },
        ] } });
      }
      return ok({ data: periods });
    });
    render(<ReportPage />);
    fireEvent.click(await screen.findByText("Monthly"));
    expect(await screen.findByText("By week")).toBeTruthy();
    expect(screen.getByText("2026-09-28 → 2026-10-04")).toBeTruthy();
    expect(screen.getByText("2026-10-05 → 2026-10-11")).toBeTruthy();
  });

  it("mode persists after settling: Monthly stays monthly, Weekly returns", async () => {
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods")
        ? ok({ data: periods })
        : url.includes("/api/reports/monthly")
          ? ok({ data: { month: "2026-10", rows: [] } })
          : ok({ data: grid("SUBMITTED") })
    );
    render(<ReportPage />);
    await screen.findByText("Amy Example"); // weekly settled
    fireEvent.click(screen.getByText("Monthly"));
    expect(await screen.findByLabelText("Month")).toBeTruthy(); // monthly UI
    expect(screen.getByRole("heading", { name: "Monthly report" })).toBeTruthy(); // heading follows mode
    expect(screen.queryByRole("combobox")).toBeNull(); // weekly dropdown gone
    await new Promise((r) => setTimeout(r, 200)); // let all fetches/state settle
    expect(screen.getByLabelText("Month")).toBeTruthy(); // still monthly, not snapped back
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByText("Weekly"));
    expect(await screen.findByText("Amy Example")).toBeTruthy(); // back to weekly
    expect(screen.getByRole("heading", { name: "Weekly report" })).toBeTruthy();
  });

  it("shows the CASH badge only for cash-paid employees", async () => {
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods")
        ? ok({ data: periods })
        : ok({ data: {
            period: { id: 7, status: "SUBMITTED" },
            rows: [
              { employee: { id: 1, full_name: "Cash Person", employee_number: "E1", payment_method: "CASH" },
                entry: null, computed: { reg_hours: "40", ot_hours: "0", holiday_hours: "0", sick_safe_paid_hours: "0", vacation_hours: "0" } },
              { employee: { id: 2, full_name: "Bank Person", employee_number: "E2", payment_method: "CHECK" },
                entry: null, computed: { reg_hours: "40", ot_hours: "0", holiday_hours: "0", sick_safe_paid_hours: "0", vacation_hours: "0" } },
            ],
          } })
    );
    render(<ReportPage />);
    await screen.findByText("Cash Person");
    await screen.findByText("Bank Person");
    expect(screen.getAllByText("CASH").length).toBe(1);
    expect(screen.getByText("Bank Person").closest("tr")?.textContent).not.toContain("CASH");
  });
});
