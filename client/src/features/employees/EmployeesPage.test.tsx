import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import EmployeesPage from "./EmployeesPage";

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
const fail = (status: number) => Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) } as Response);

const list = (extra: unknown[] = []) => ({
  data: [
    { id: 1, employee_number: "E1", full_name: "Amy Example", hire_date: "2026-09-01", payment_method: "CASH",
      compensation: { pay_type: "HOURLY", rate: "18.00", overtime_status: "NON_EXEMPT", classification: null } },
    ...extra,
  ],
});

describe("EmployeesPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("happy path: submits the mapped payload, refetches, toasts", async () => {
    const posts: any[] = [];
    let calls = 0;
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        posts.push(JSON.parse(String(init?.body)));
        return ok({ data: { employee: { id: 2 }, compensation: { id: 3 } } });
      }
      calls += 1;
      return ok(list(calls > 1 ? [{ id: 2, employee_number: "E2", full_name: "Bob New", hire_date: "2026-10-01", compensation: null }] : []));
    });
    render(<EmployeesPage />);
    await screen.findByText("Amy Example");
    fireEvent.click(screen.getByText("Add Employee"));
    fireEvent.change(screen.getByLabelText("Employee number"), { target: { value: "E2" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Bob New" } });
    fireEvent.change(screen.getByLabelText("Hire date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Pay type"), { target: { value: "S" } });
    fireEvent.change(screen.getByLabelText("Rate"), { target: { value: "900" } });
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "CASH" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Added")).toBeTruthy();
    expect(posts.length).toBe(1);
    expect(posts[0]).toEqual({
      employee_number: "E2",
      full_name: "Bob New",
      hire_date: "2026-10-01",
      payment_method: "CASH",
      compensation: { pay_type: "SALARY", rate: 900, overtime_status: "NON_EXEMPT", classification: undefined },
    });
    expect(await screen.findByText("Bob New")).toBeTruthy(); // refetched list
    const amyRow = screen.getByText("Amy Example").closest("tr");
    expect(amyRow?.textContent).toContain("CASH"); // roster CASH badge
  });

  it("error path: shows the error and keeps form state", async () => {
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") return fail(409);
      return ok(list());
    });
    render(<EmployeesPage />);
    await screen.findByText("Amy Example");
    fireEvent.click(screen.getByText("Add Employee"));
    fireEvent.change(screen.getByLabelText("Employee number"), { target: { value: "E1" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Dupe" } });
    fireEvent.change(screen.getByLabelText("Hire date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Rate"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("That employee number is already taken.")).toBeTruthy();
    expect((screen.getByLabelText("Employee number") as HTMLInputElement).value).toBe("E1"); // state kept
  });

  it("terminate confirms, PUTs the date, and refetches", async () => {
    const puts: any[] = [];
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PUT") {
        puts.push({ url, body: JSON.parse(String(init?.body)) });
        return ok({ data: { employee: { id: 1 } } });
      }
      return ok(list());
    });
    (window as any).confirm = vi.fn().mockReturnValue(true);
    render(<EmployeesPage />);
    await screen.findByText("Amy Example");
    fireEvent.click(screen.getByText("Terminate"));
    await screen.findByText("Amy Example"); // refetched
    expect(puts.length).toBe(1);
    expect(puts[0].url).toBe("/api/employees/1");
    expect(/^\d{4}-\d{2}-\d{2}$/.test(puts[0].body.termination_date)).toBe(true);
    (window as any).confirm = undefined;
  });

  it("terminate cancel makes no call; rehire sends null", async () => {
    const calls: string[] = [];
    const puts: any[] = [];
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if ((init?.method ?? "GET") === "PUT") {
        puts.push(JSON.parse(String(init?.body)));
        return ok({ data: { employee: { id: 9 } } });
      }
      return ok({ data: [{ id: 9, employee_number: "E9", full_name: "Gone Person", hire_date: "2026-09-01", termination_date: "2026-10-01", compensation: null }] });
    });
    (window as any).confirm = vi.fn().mockReturnValue(false);
    render(<EmployeesPage />);
    await screen.findByText("Gone Person");
    fireEvent.click(screen.getByText("Rehire"));
    expect(calls.filter((c) => c.startsWith("PUT")).length).toBe(0);
    (window as any).confirm = vi.fn().mockReturnValue(true);
    fireEvent.click(screen.getByText("Rehire"));
    expect(calls.filter((c) => c.startsWith("PUT")).length).toBe(1);
    expect(puts[0]).toEqual({ termination_date: null });
    (window as any).confirm = undefined;
  });

  it("delete confirms, DELETEs, and refetches", async () => {
    const calls: string[] = [];
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if ((init?.method ?? "GET") === "DELETE") return ok({ data: { deleted: 1 } });
      return ok(list());
    });
    (window as any).confirm = vi.fn().mockReturnValue(true);
    render(<EmployeesPage />);
    await screen.findByText("Amy Example");
    fireEvent.click(screen.getByText("Delete"));
    expect(calls).toContain("DELETE /api/employees/1");
    (window as any).confirm = undefined;
  });

  it("delete cancel makes no call; 409 directs to terminate", async () => {
    const calls: string[] = [];
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if ((init?.method ?? "GET") === "DELETE") return fail(409);
      return ok(list());
    });
    (window as any).confirm = vi.fn().mockReturnValue(false);
    render(<EmployeesPage />);
    await screen.findByText("Amy Example");
    fireEvent.click(screen.getByText("Delete"));
    expect(calls.filter((c) => c.startsWith("DELETE")).length).toBe(0);
    (window as any).confirm = vi.fn().mockReturnValue(true);
    fireEvent.click(screen.getByText("Delete"));
    expect(await screen.findByText("Cannot delete — this employee has history. Terminate instead.")).toBeTruthy();
    (window as any).confirm = undefined;
  });

  it("modal opens on Add Employee and closes on Cancel, Escape, and outside click", async () => {
    (fetch as any).mockImplementation(() => ok(list()));
    render(<EmployeesPage />);
    await screen.findByText("Amy Example");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Add Employee"));
    expect(await screen.findByRole("dialog", { name: "Add Employee" })).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Add Employee"));
    expect(await screen.findByRole("dialog", { name: "Add Employee" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Add Employee"));
    expect(await screen.findByRole("dialog", { name: "Add Employee" })).toBeTruthy();
    fireEvent.click(screen.getByRole("presentation", { hidden: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("year/week/month dropdowns filter the summary totals", async () => {
    const periods = [
      { id: 10, start_date: "2026-10-12", end_date: "2026-10-18" },
      { id: 9, start_date: "2026-10-05", end_date: "2026-10-11" },
      { id: 8, start_date: "2026-09-28", end_date: "2026-10-04" },
      { id: 7, start_date: "2025-10-06", end_date: "2025-10-12" },
    ];
    const grid = (c: { reg: number; ot: number; hol: number; sick: number; vac: number; days?: { day_type: string; hours: string }[] }) => ({
      period: { id: 9, status: "OPEN" },
      rows: [{
        employee: { id: 1 },
        days: c.days ?? [],
        computed: { reg_hours: String(c.reg), ot_hours: String(c.ot), holiday_hours: String(c.hol), sick_safe_paid_hours: String(c.sick), vacation_hours: String(c.vac) },
      }],
    });
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/pay-periods")) return ok({ data: periods });
      if (url.includes("/api/timecards/10")) return ok({ data: grid({ reg: 20, ot: 0, hol: 0, sick: 0, vac: 0, days: [{ day_type: "HW8", hours: "8.00" }] }) });
      if (url.includes("/api/timecards/9")) return ok({ data: grid({ reg: 40, ot: 5, hol: 8, sick: 4, vac: 2 }) });
      if (url.includes("/api/timecards/8")) return ok({ data: grid({ reg: 32, ot: 0, hol: 0, sick: 0, vac: 0 }) });
      if (url.includes("/api/timecards/7")) return ok({ data: grid({ reg: 10, ot: 0, hol: 0, sick: 0, vac: 0 }) });
      return ok(list());
    });
    render(<EmployeesPage />);
    await screen.findByText("Amy Example");
    const yearSelect = screen.getByLabelText("Summary year") as HTMLSelectElement;
    expect([...yearSelect.options].map((o) => o.value)).toEqual(["2026", "2025"]);
    // weekly defaults to the latest 2026 week (HW8 day only)
    expect(await screen.findByText("20 hrs")).toBeTruthy();
    expect(screen.getByText("8 hrs")).toBeTruthy(); // HW
    fireEvent.change(screen.getByLabelText("Summary week"), { target: { value: "9" } });
    expect(await screen.findByText("45 hrs")).toBeTruthy();
    expect(screen.getByText("5 hrs")).toBeTruthy(); // amber OT badge
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    // October 2026: 20 + 45 worked, 8 HW, 8 hol
    expect(await screen.findByText("65 hrs")).toBeTruthy();
    expect(screen.getAllByText("8 hrs")).toHaveLength(2);
    const monthSelect = screen.getByLabelText("Summary month") as HTMLSelectElement;
    expect([...monthSelect.options].map((o) => o.value)).toEqual(["2026-10", "2026-09"]);
    fireEvent.change(monthSelect, { target: { value: "2026-09" } });
    expect(await screen.findByText("32 hrs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yearly (YTD)" }));
    // 2026: 20 + 45 + 32 = 97; week/month dropdowns hidden
    expect(await screen.findByText("97 hrs")).toBeTruthy();
    expect(screen.queryByLabelText("Summary week")).toBeNull();
    expect(screen.queryByLabelText("Summary month")).toBeNull();
    fireEvent.change(yearSelect, { target: { value: "2025" } });
    expect(await screen.findByText("10 hrs")).toBeTruthy();
  });
});
