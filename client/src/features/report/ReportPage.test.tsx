import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
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
    expect(screen.getAllByText("40")[0].closest("tr")?.textContent).toContain("Amy Example");
    const cells = screen.getByText("Amy Example").closest("tr")?.querySelectorAll("td");
    expect([...(cells ?? [])].map((c) => c.textContent)).toEqual(["Amy Example", "40", "5", "0", "8", "0", "$100.00", "$20.00"]);
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
    await screen.findByText("🔵 SUBMITTED (Pending CEO Approval)"); // status settled: Approve enabled
    const btn = await screen.findByText("Approve");
    fireEvent.click(btn);
    expect(await screen.findByText("🟢 APPROVED")).toBeTruthy();
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
      if (url.includes("/api/reports/monthly")) {        return ok({ data: { month: "2026-10", rows: [
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
      if (url.includes("/api/reports/monthly")) {        return ok({ data: { month: "2026-10", rows: [
          { employee_id: 1, name: "Amy Example", reg: 75, ot: 5, hol: 0, sick: 0, vacation: 0, bonus: 0, reimb: 0 },
        ] } });
      }
      return ok({ data: periods });
    });
    render(<ReportPage />);
    fireEvent.click(await screen.findByText("Monthly"));
    const row = (await screen.findByText("Amy Example")).closest("tr");
    const cells = [...(row?.querySelectorAll("td") ?? [])].map((c) => c.textContent);
    expect(cells).toEqual(["Amy Example", "75", "5", "0", "0", "0", "$0.00", "$0.00"]);
  });

  it("monthly mode shows the per-week breakdown", async () => {
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/reports/monthly")) {        return ok({ data: { month: "2026-10", rows: [
          { employee_id: 1, name: "Amy Example", reg: 75, ot: 5, hol: 0, sick: 0, vacation: 0, bonus: 0, reimb: 0,
            weeks: [
              { week_start: "2026-09-28", week_end: "2026-10-04", reg: 40, ot: 5, hol: 8, sick: 0, vacation: 0, bonus: 50, reimb: 10 },
              { week_start: "2026-10-05", week_end: "2026-10-11", reg: 35, ot: 0, hol: 0, sick: 8, vacation: 0, bonus: 0, reimb: 0 },
            ] },
        ] } });
      }
      return ok({ data: periods });
    });
    render(<ReportPage />);
    fireEvent.click(await screen.findByText("Monthly"));
    expect(await screen.findByText("By week")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "▶ Amy Example" }));
    expect(screen.getByText("Sep 28 – Oct 04, 2026")).toBeTruthy();
    expect(screen.getByText("Oct 05 – Oct 11, 2026")).toBeTruthy();
    const sub = screen.getByText("Sep 28 – Oct 04, 2026").closest("tr");
    expect([...(sub?.querySelectorAll("td") ?? [])].map((c) => c.textContent))
      .toEqual(["", "Sep 28 – Oct 04, 2026", "40", "5", "8", "0", "0", "$50.00", "$10.00"]);
  });

  it("accordion collapses back on second click", async () => {
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/reports/monthly")) {        return ok({ data: { month: "2026-10", rows: [
          { employee_id: 1, name: "Amy Example", reg: 75, ot: 5, hol: 0, sick: 0, vacation: 0, bonus: 0, reimb: 0,
            weeks: [{ week_start: "2026-10-05", week_end: "2026-10-11", reg: 75, ot: 5 }] },
        ] } });
      }
      return ok({ data: periods });
    });
    render(<ReportPage />);
    fireEvent.click(await screen.findByText("Monthly"));
    await screen.findByText("By week");
    fireEvent.click(screen.getByRole("button", { name: "▶ Amy Example" }));
    expect(screen.getByText("Oct 05 – Oct 11, 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "▼ Amy Example" }));
    expect(screen.queryByText("Oct 05 – Oct 11, 2026")).toBeNull();
  });

  it("KPI cards show summed totals with amber OT", async () => {
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/reports/monthly")) {        return ok({ data: { month: "2026-10", rows: [
          { employee_id: 1, name: "Amy Example", reg: 75, ot: 5, hol: 8, sick: 8, vacation: 0, bonus: 100, reimb: 20 },
        ] } });
      }
      return ok({ data: periods });
    });
    render(<ReportPage />);
    fireEvent.click(await screen.findByText("Monthly"));
    expect(await screen.findByText("Total Worked Hours")).toBeTruthy();
    expect(screen.getByText("80")).toBeTruthy(); // 75 + 5
    expect(screen.getByText("Overtime Hours")).toBeTruthy();
    expect(screen.getByText("16")).toBeTruthy(); // 8 sick + 8 hol
    expect(screen.getByText("$120.00")).toBeTruthy(); // 100 + 20
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
    expect(screen.queryByLabelText("Period")).toBeNull(); // weekly dropdown gone
    await new Promise((r) => setTimeout(r, 200)); // let all fetches/state settle
    expect(screen.getByLabelText("Month")).toBeTruthy(); // still monthly, not snapped back
    expect(screen.queryByLabelText("Period")).toBeNull();
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

  it("reopen posts the reason and returns the period to OPEN", async () => {
    const posts: any[] = [];
    let approved = true;
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/reopen")) {
        posts.push(JSON.parse(String(init?.body)));
        approved = false;
        return ok({ data: { period: { id: 7, status: "OPEN" } } });
      }
      if (url.includes("/api/pay-periods")) return ok({ data: periods });
      return ok({ data: grid(approved ? "APPROVED" : "OPEN") });
    });
    render(<ReportPage />);
    await screen.findByText("Amy Example");
    fireEvent.click(screen.getByText("Reopen"));
    expect(await screen.findByRole("dialog", { name: "Reopen period" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Reopen reason"), { target: { value: "payroll error" } });
    const dialog = await screen.findByRole("dialog", { name: "Reopen period" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reopen" }));
    await screen.findByText("🟡 OPEN (Awaiting Submission)");
    expect(posts).toEqual([{ reason: "payroll error" }]);
    expect(screen.queryByText("🟢 APPROVED")).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("reopen requires a reason and Cancel closes cleanly", async () => {
    const calls: string[] = [];
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/api/pay-periods")) return ok({ data: periods });
      return ok({ data: grid("APPROVED") });
    });
    render(<ReportPage />);
    await screen.findByText("Amy Example");
    fireEvent.click(screen.getByText("Reopen"));
    const dialog = await screen.findByRole("dialog", { name: "Reopen period" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reopen" })); // empty reason
    expect(await screen.findByText("A reason is required to reopen.")).toBeTruthy();
    expect(calls.filter((c) => c.includes("/reopen")).length).toBe(0);
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("dialog", { name: "Reopen period" })).toBeNull();
  });

  it("weekly selector groups options and steppers move selection", async () => {    const seen: string[] = [];
    (fetch as any).mockImplementation((url: string) => {
      seen.push(url);
      if (url.includes("/api/pay-periods")) {
        return ok({ data: [
          { id: 3, start_date: "2026-10-24", end_date: "2026-10-30", status: "OPEN" },
          { id: 2, start_date: "2026-10-17", end_date: "2026-10-23", status: "APPROVED" },
        ] });
      }
      return ok({ data: { period: { id: 3, status: "OPEN" }, rows: [] } });
    });
    render(<ReportPage />);
    await screen.findByText("No employees in this period");
    expect(document.querySelector('optgroup[label="Open / Action Required"]')).toBeTruthy();
    expect(document.querySelector('optgroup[label="Approved / Closed"]')).toBeNull(); // archived hidden by default
    fireEvent.click(screen.getByLabelText("Include Archived/Approved Periods"));
    expect(document.querySelector('optgroup[label="Approved / Closed"]')).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Previous week"));
    expect(seen.filter((u) => u.includes("/api/timecards/2")).length).toBeGreaterThanOrEqual(1);
  });

  it("employee names are plain text with no leave drill-down", async () => {
    const seen: string[] = [];
    (fetch as any).mockImplementation((url: string) => {
      seen.push(url);
      return url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: grid("SUBMITTED") });
    });
    render(<ReportPage />);
    await screen.findByText("Amy Example");
    expect(screen.queryByRole("button", { name: "Amy Example" })).toBeNull();
    expect(screen.queryByText(/Sick:.*hours remaining/)).toBeNull();
    expect(seen.filter((u) => u.includes("/leave")).length).toBe(0);
  });

  const alertsMock = (alerts: unknown) => (url: string) => {
    if (url.includes("/api/dashboard")) return ok({ data: { alerts } });
    return url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: grid("SUBMITTED") });
  };

  it("alerts card shows All clear when there are none", async () => {
    (fetch as any).mockImplementation(alertsMock([]));
    render(<ReportPage />);
    await screen.findByText("Amy Example");
    expect(await screen.findByText("Needs your attention")).toBeTruthy();
    expect(screen.getByText("All clear")).toBeTruthy();
  });

  it("alerts card renders one row per alert, red first", async () => {
    (fetch as any).mockImplementation(alertsMock([
      { code: "overtime", severity: "amber", employee_id: 1, employee_name: "Amy Example", message: "5 OT hours this week", detail: { ot_hours: 5 } },
      { code: "awaiting_approval", severity: "yellow", employee_id: null, employee_name: null, message: "Awaiting approval since 2026-10-05, 0 days ago", detail: {} },
    ]));
    render(<ReportPage />);
    await screen.findByText("Amy Example");
    expect(await screen.findByText(/5 OT hours this week/)).toBeTruthy();
    const row = screen.getByText(/5 OT hours this week/).closest("li");
    expect(row?.textContent).toContain("Amy Example");
    expect(screen.getByText(/Awaiting approval since/)).toBeTruthy();
  });

  it("alerts card shows Checking... while loading", async () => {
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/dashboard")) return new Promise(() => {}); // never resolves
      return url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: grid("SUBMITTED") });
    });
    render(<ReportPage />);
    await screen.findByText("Amy Example");
    expect(screen.getByText("Checking...")).toBeTruthy();
  });

  it("alerts card shows Unable to load alerts on error", async () => {
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/dashboard")) return Promise.reject(new Error("down"));
      return url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: grid("SUBMITTED") });
    });
    render(<ReportPage />);
    await screen.findByText("Amy Example");
    expect(await screen.findByText("Unable to load alerts")).toBeTruthy();
  });

  it("alert dots match severity: red #dc2626, amber #d97706", async () => {
    (fetch as any).mockImplementation(alertsMock([
      { code: "overtime", severity: "amber", employee_id: 1, employee_name: "Amy Example", message: "5 OT hours this week", detail: {} },
      { code: "leave_overdraw", severity: "red", employee_id: 1, employee_name: "Amy Example", message: "Sick leave overdraw by 8 hours", detail: {} },
    ]));
    render(<ReportPage />);
    await screen.findByText("Amy Example");
    const dot = (re: RegExp) => screen.getByText(re).closest("li")?.querySelector("span[aria-hidden]")?.className ?? "";
    expect(dot(/5 OT hours this week/)).toContain("bg-[#d97706]");
    expect(dot(/Sick leave overdraw by 8 hours/)).toContain("bg-[#dc2626]");
  });
});
