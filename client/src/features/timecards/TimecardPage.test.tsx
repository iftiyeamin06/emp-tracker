import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import TimecardPage from "./TimecardPage";
import { fmtRange, groupPeriods } from "../../lib/periodOptions";

const periods = [{ id: 3, start_date: "2026-10-05", end_date: "2026-10-10", status: "OPEN" }];

const grid = (status: string) => ({
  period: { id: 3, start_date: "2026-10-05", end_date: "2026-10-10", status },
  rows: [
    {
      employee: { id: 1, full_name: "Amy Example" },
      entry: { bonus_amount: "50.00", reimbursement_amount: "0.00" },
      days: [
        { work_date: "2026-10-05", day_type: "WORK", hours: "8.00" },
        { work_date: "2026-10-06", day_type: "HOLIDAY", hours: "8.00" },
        { work_date: "2026-10-07", day_type: "SICK_SAFE_PAID", hours: "8.00" },
        { work_date: "2026-10-08", day_type: "VACATION", hours: "8.00" },
      ],
      computed: { reg_hours: "8.00", ot_hours: "0.00", holiday_hours: "8.00", sick_safe_paid_hours: "8.00", vacation_hours: "8.00" },
    },
  ],
});

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);

describe("TimecardPage (Stage A)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders day headers Saturday first", async () => {
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: grid("OPEN") })
    );
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    const headers = [...document.querySelectorAll("thead th")].map((h) => h.textContent);
    expect(headers.slice(1, 8)).toEqual(["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"]);
  });

  it("renders employees and days from mocked API", async () => {
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: grid("OPEN") })
    );
    render(<TimecardPage />);
    const row = (await screen.findByText("Amy Example")).closest("tr");
    const cells = [...(row?.querySelectorAll("td") ?? [])].map((c) => c.textContent);
    expect(cells[0]).toBe("Amy Example");
    // Day cells are inputs now — assert values, not textContent.
    const dayVals = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"].map(
      (d) => (screen.getByLabelText(`day-1-${d}`) as HTMLInputElement).value
    );
    expect(dayVals).toEqual(["8", "H8", "S8", "V8", "", "", ""]);
    // Computed cells are disabled inputs — same values, same labels.
    expect((screen.getByLabelText("reg-1") as HTMLInputElement).value).toBe("8");
    expect((screen.getByLabelText("ot-1") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("vac-1") as HTMLInputElement).value).toBe("8");
    expect((screen.getByLabelText("hol-1") as HTMLInputElement).value).toBe("8");
    expect((screen.getByLabelText("sick-1") as HTMLInputElement).value).toBe("8");
    // Bonus/Reimb are inputs now — assert values, not textContent.
    expect((screen.getByLabelText("bonus-1") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("reimb-1") as HTMLInputElement).value).toBe("0");
  });

  it("shows an empty state when the period has no employees", async () => {
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods")
        ? ok({ data: periods })
        : ok({ data: { period: { id: 3, start_date: "2026-10-05", end_date: "2026-10-10", status: "OPEN" }, rows: [] } })
    );
    render(<TimecardPage />);
    expect(await screen.findByText("No employees in this period")).toBeTruthy();
    expect(screen.getByText("Go to Employees").closest("a")).toHaveProperty("href", expect.stringContaining("#/employees"));
  });

  it("non-OPEN period shows the read-only banner", async () => {
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods")
        ? ok({ data: [{ ...periods[0], status: "SUBMITTED" }] })
        : ok({ data: grid("SUBMITTED") })
    );
    render(<TimecardPage />);
    expect(await screen.findByText("Period SUBMITTED — read only")).toBeTruthy();
  });

  const fiveEights = () => ({
    period: { id: 3, start_date: "2026-10-05", end_date: "2026-10-10", status: "OPEN" },
    rows: [
      {
        employee: { id: 1, full_name: "Amy Example" },
        entry: { bonus_amount: "0.00", reimbursement_amount: "0.00" },
        days: ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"].map((d) => ({
          work_date: d,
          day_type: "WORK",
          hours: "8.00",
        })),
        computed: { reg_hours: "40.00", ot_hours: "0.00", holiday_hours: "0.00", sick_safe_paid_hours: "0.00", vacation_hours: "0.00" },
      },
    ],
  });

  const mockOpen = () =>
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: fiveEights() })
    );

  const monInput = () => screen.getByLabelText("day-1-2026-10-05") as HTMLInputElement;

  const regOf = (name: "reg" | "ot" | "vac" | "hol" | "reimb" | "sick") =>
    (screen.getByLabelText(`${name}-1`) as HTMLInputElement).value;

  it("click + Enter updates the cell and recomputes Reg", async () => {
    mockOpen();
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    const input = monInput();
    fireEvent.change(input, { target: { value: "V8" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(monInput().value).toBe("V8");
    expect(regOf("reg")).toBe("32"); // 4 × 8
    expect(await screen.findByText("● Unsaved changes")).toBeTruthy();
  });

  it("Escape reverts without touching state", async () => {
    mockOpen();
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    const input = monInput();
    fireEvent.change(input, { target: { value: "V8" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(monInput().value).toBe("8");
    expect(regOf("reg")).toBe("40");
    expect(screen.queryByText("● Unsaved changes")).toBeNull();
  });

  it("invalid code reverts", async () => {
    mockOpen();
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    const input = monInput();
    fireEvent.change(input, { target: { value: "X9" } });
    fireEvent.blur(input);
    expect(monInput().value).toBe("8");
    expect(screen.queryByText("● Unsaved changes")).toBeNull();
  });

  it("exempt employee previews no OT", async () => {
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods")
        ? ok({ data: periods })
        : ok({ data: {
            period: { id: 3, start_date: "2026-10-05", end_date: "2026-10-10", status: "OPEN" },
            rows: [{
              employee: { id: 1, full_name: "Amy Example", overtime_status: "EXEMPT" },
              entry: { bonus_amount: "0.00", reimbursement_amount: "0.00" },
              days: ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"].map((d) => ({
                work_date: d, day_type: "WORK", hours: "9.00",
              })),
              computed: null,
            }],
          } })
    );
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    const input = screen.getByLabelText("day-1-2026-10-09") as HTMLInputElement; // dirty the row to activate preview
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((screen.getByLabelText("reg-1") as HTMLInputElement).value).toBe("44"); // 4×9+8, no cap
    expect((screen.getByLabelText("ot-1") as HTMLInputElement).value).toBe("0"); // exempt: never OT
  });

  it("HW8 commits and counts as worked", async () => {
    mockOpen();
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    const input = monInput();
    fireEvent.change(input, { target: { value: "hw8" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(monInput().value).toBe("HW8");
    expect(regOf("reg")).toBe("40"); // 4×8 + HW8 8h = 40 worked
  });

  it("accepts numeric hours and recomputes from real hours", async () => {
    mockOpen();
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    const input = monInput();
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(monInput().value).toBe("9");
    expect(regOf("reg")).toBe("40"); // 9 + 4×8 = 41 → reg 40
    expect(regOf("ot")).toBe("1"); // ot 1
    expect(await screen.findByText("● Unsaved changes")).toBeTruthy();
  });

  it("save sends numeric hours through as WORK", async () => {
    const flow = mockSaveFlow(() => ok({ data: { saved: 1 } }));
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    const input = monInput();
    fireEvent.change(input, { target: { value: "7.5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(saveBtn());
    await screen.findByText("Saved");
    expect(flow.puts[0].rows[0].days[0]).toEqual({ work_date: "2026-10-05", day_type: "WORK", hours: 7.5 });
  });

  it("SUBMITTED cells stay read-only (no inputs render)", async () => {
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods")
        ? ok({ data: [{ ...periods[0], status: "SUBMITTED" }] })
        : ok({ data: grid("SUBMITTED") })
    );
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    expect(screen.queryByLabelText("day-1-2026-10-05")).toBeNull();
  });

  const mockSaveFlow = (putImpl: (url: string, init?: RequestInit) => Promise<Response>) => {
    const calls: string[] = [];
    const puts: any[] = [];
    let getCount = 0;
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if ((init?.method ?? "GET") === "PUT") {
        puts.push(JSON.parse(String(init?.body)));
        return putImpl(url, init);
      }
      if (url.includes("/api/pay-periods")) return ok({ data: periods });
      getCount += 1;
      return ok({ data: fiveEights() });
    });
    return { calls, puts, getCount: () => getCount };
  };

  const editMonToV8 = async () => {
    await screen.findByText("Amy Example");
    const row = screen.getByText("Amy Example").closest("tr");
    fireEvent.click(row?.querySelectorAll("td")[1] as Element);
    const input = screen.getByLabelText("day-1-2026-10-05");
    fireEvent.change(input, { target: { value: "V8" } });
    fireEvent.keyDown(input, { key: "Enter" });
  };

  const saveBtn = () => screen.getByRole("button", { name: /^(Save|Saving…)$/ }) as HTMLButtonElement;

  it("Save sends the mapped payload; 200 refetches and clears dirty", async () => {
    const flow = mockSaveFlow(() => ok({ data: { saved: 1 } }));
    render(<TimecardPage />);
    await editMonToV8();
    fireEvent.click(saveBtn());
    await screen.findByText("Saved");
    expect(flow.puts.length).toBe(1);
    const body = flow.puts[0];
    expect(body.rows.length).toBe(1);
    expect(body.rows[0].employee_id).toBe(1);
    expect(body.rows[0].days[0]).toEqual({ work_date: "2026-10-05", day_type: "VACATION", hours: 8 });
    expect(body.rows[0].days[5]).toEqual({ work_date: "2026-10-10", day_type: "WORK", hours: 0 });
    expect(flow.getCount()).toBeGreaterThanOrEqual(2); // initial + refetch
    expect(screen.queryByText("● Unsaved changes")).toBeNull();
  });

  it("save error keeps edits and shows the error", async () => {
    mockSaveFlow(() => Promise.reject(new Error("boom")));
    render(<TimecardPage />);
    await editMonToV8();
    fireEvent.click(saveBtn());
    expect(await screen.findByText("Save failed. Your edits are kept — fix the issue and retry.")).toBeTruthy();
    expect(screen.getByText("● Unsaved changes")).toBeTruthy();
    expect(monInput().value).toBe("V8"); // edit preserved
  });

  it("Save is disabled when clean and while saving", async () => {
    let resolvePut!: (v: Response) => void;
    const gate = new Promise<Response>((resolve) => { resolvePut = resolve; });
    mockSaveFlow(() => gate);
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    expect(saveBtn().disabled).toBe(true);
    await editMonToV8();
    expect(saveBtn().disabled).toBe(false);
    fireEvent.click(saveBtn());
    expect(saveBtn().disabled).toBe(true);
    expect(saveBtn().textContent).toContain("Saving…");
    resolvePut((await ok({ data: { saved: 1 } })) as Response);
    await screen.findByText("Saved");
  });

  const openGrid = () =>
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: fiveEights() })
    );

  const submitBtn = () => screen.getByRole("button", { name: /^(Submit Period|Submitting…)$/ }) as HTMLButtonElement;

  it("Submit visible on OPEN, hidden on SUBMITTED and APPROVED", async () => {
    openGrid();
    const { unmount } = render(<TimecardPage />);
    await screen.findByText("Amy Example");
    expect(submitBtn()).toBeTruthy();
    unmount();
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods")
        ? ok({ data: [{ ...periods[0], status: "SUBMITTED" }] })
        : ok({ data: grid("SUBMITTED") })
    );
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    expect(screen.queryByRole("button", { name: /Submit Period/ })).toBeNull();
  });

  it("Submit disabled while dirty", async () => {
    openGrid();
    render(<TimecardPage />);
    await editMonToV8();
    expect(submitBtn().disabled).toBe(true);
  });

  it("confirm cancel makes no API call", async () => {
    const calls: string[] = [];
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: fiveEights() });
    });
    (window as any).confirm = vi.fn().mockReturnValue(false);
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    fireEvent.click(submitBtn());
    expect(calls.filter((c) => c.startsWith("POST")).length).toBe(0);
    (window as any).confirm = undefined;
  });

  it("successful submit refetches into SUBMITTED read-only", async () => {
    let submitted = false;
    const subGrid = () => {
      const g: any = fiveEights();
      g.period = { ...g.period, status: submitted ? "SUBMITTED" : "OPEN" };
      return g;
    };
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        submitted = true;
        return ok({ data: { period: { id: 3, status: "SUBMITTED" } } });
      }
      if (url.includes("/api/pay-periods")) return ok({ data: periods });
      return ok({ data: subGrid() });
    });
    (window as any).confirm = vi.fn().mockReturnValue(true);
    const { container } = render(<TimecardPage />);
    await screen.findByText("Amy Example");
    fireEvent.click(submitBtn());
    expect(await screen.findByText("Period SUBMITTED — read only")).toBeTruthy();
    expect(submitted).toBe(true);
    expect(screen.queryByRole("button", { name: /^(Save|Submit Period)$/ })).toBeNull(); // toolbar locks
    expect(screen.getByText("New Period")).toBeTruthy(); // period creation stays
    (window as any).confirm = undefined;
  });

  it("submit error shows inline and keeps state", async () => {
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") return Promise.reject(new Error("boom"));
      return url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: fiveEights() });
    });
    (window as any).confirm = vi.fn().mockReturnValue(true);
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    fireEvent.click(submitBtn());
    expect(await screen.findByText("Submit failed. Nothing was changed.")).toBeTruthy();
    (window as any).confirm = undefined;
  });

  it("New Period happy path: posts computed dates, selects the new one", async () => {
    const posts: any[] = [];
    let listCalls = 0;
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        posts.push(JSON.parse(String(init?.body)));
        return ok({ data: { period: { id: 9, start_date: "2026-10-10", end_date: "2026-10-16", pay_date: "2026-10-23", status: "OPEN" } } });
      }
      if (url.includes("/api/pay-periods")) {
        listCalls += 1;
        return ok({ data: listCalls > 1 ? [...periods, { id: 9, start_date: "2026-10-10", end_date: "2026-10-16", pay_date: "2026-10-23", status: "OPEN" }] : periods });
      }
      return ok({ data: fiveEights() });
    });
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    fireEvent.click(screen.getByText("New Period"));
    expect(await screen.findByRole("dialog", { name: "Create New Pay Period" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-10" } });
    expect((screen.getByLabelText("Pay date") as HTMLInputElement).value).toBe("2026-10-23"); // start + 13
    expect(screen.getByText("Saturday, October 10, 2026")).toBeTruthy();
    expect(screen.getByText(/Friday, October 16, 2026/)).toBeTruthy();
    expect(screen.getByText(/Friday, October 23, 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("Amy Example");
    expect(posts.length).toBe(1);
    expect(posts[0]).toEqual({ start_date: "2026-10-10", end_date: "2026-10-16", pay_date: "2026-10-23" });
    expect(screen.queryByRole("dialog", { name: "Create New Pay Period" })).toBeNull(); // closed
  });

  it("New Period overlap error stays inline", async () => {
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") return Promise.reject(Object.assign(new Error("conflict"), { status: 409 }));
      return url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: fiveEights() });
    });
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    fireEvent.click(screen.getByText("New Period"));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-10" } }); // Saturday overlapping the mocked Oct 5–11 week
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("That week overlaps an existing period.")).toBeTruthy();
    expect((screen.getByLabelText("Start date") as HTMLInputElement).value).toBe("2026-10-10"); // kept
  });

  it("non-Saturday start shows inline error and disables Create", async () => {
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: fiveEights() })
    );
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    fireEvent.click(screen.getByText("New Period"));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-12" } }); // Monday
    expect(await screen.findByText("Start date must be a Saturday.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create" }).hasAttribute("disabled")).toBe(true);
  });

  it("modal Cancel closes without creating", async () => {
    const calls: string[] = [];
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: fiveEights() });
    });
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    fireEvent.click(screen.getByText("New Period"));
    expect(await screen.findByRole("dialog", { name: "Create New Pay Period" })).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("dialog", { name: "Create New Pay Period" })).toBeNull();
    expect(calls.filter((c) => c.startsWith("POST")).length).toBe(0);
  });

  it("shows the CASH badge only for cash-paid employees", async () => {
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods")
        ? ok({ data: periods })
        : ok({ data: {
            period: { id: 3, start_date: "2026-10-05", end_date: "2026-10-10", status: "OPEN" },
            rows: [
              { employee: { id: 1, full_name: "Cash Person", payment_method: "CASH" }, entry: null, days: [], computed: null },
              { employee: { id: 2, full_name: "Bank Person", payment_method: "DIRECT_DEPOSIT" }, entry: null, days: [], computed: null },
            ],
          } })
    );
    render(<TimecardPage />);
    await screen.findByText("Cash Person");
    await screen.findByText("Bank Person");
    expect(screen.getAllByText("CASH").length).toBe(1);
    expect(screen.getByText("Cash Person").closest("tr")?.textContent).toContain("CASH");
    expect(screen.getByText("Bank Person").closest("tr")?.textContent).not.toContain("CASH");
  });

  it("fmtRange renders human ranges", async () => {
    expect(fmtRange("2026-10-31", "2026-11-06")).toBe("Oct 31 – Nov 06, 2026");
    expect(fmtRange("2026-10-17", "2026-10-23")).toBe("Oct 17 – Oct 23, 2026");
  });

  it("groupPeriods buckets current / open / approved", async () => {
    const g = groupPeriods(
      [
        { id: 1, start: "2026-10-17", end: "2026-10-23", status: "SUBMITTED" },
        { id: 2, start: "2026-10-24", end: "2026-10-30", status: "OPEN" },
        { id: 3, start: "2026-10-10", end: "2026-10-16", status: "APPROVED" },
      ],
      "2026-10-26"
    );
    expect(g.current.map((o) => o.id)).toEqual([2]);
    expect(g.current[0].label).toBe("🟡 Oct 24 – Oct 30, 2026 — Current Week");
    expect(g.open.map((o) => o.id)).toEqual([1]);
    expect(g.open[0].label).toBe("🔵 Oct 17 – Oct 23, 2026 — Submitted");
    expect(g.approved.map((o) => o.id)).toEqual([3]);
  });

  it("selector groups options and steppers move selection", async () => {
    const seen: string[] = [];
    // Weeks around the real today so one of them is the current week.
    const toYmd = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const now = new Date();
    const saturday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 1) % 7));
    const prevSaturday = new Date(saturday.getTime() - 7 * 86400000);
    const plus = (d: Date, n: number): string => toYmd(new Date(d.getTime() + n * 86400000));
    const cur = { id: 3, start_date: toYmd(saturday), end_date: plus(saturday, 6), status: "OPEN" };
    const older = { id: 2, start_date: toYmd(prevSaturday), end_date: plus(prevSaturday, 6), status: "OPEN" };
    (fetch as any).mockImplementation((url: string) => {
      seen.push(url);
      if (url.includes("/api/pay-periods")) {
        return ok({ data: [cur, older] });
      }
      return ok({ data: { period: cur, rows: [] } });
    });
    render(<TimecardPage />);
    await screen.findByText("No employees in this period");
    expect(document.querySelector('optgroup[label="Active / Current Week"]')).toBeTruthy();
    expect(document.querySelector('optgroup[label="Open / Action Required"]')).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Previous week"));
    await screen.findByText("No employees in this period");
    expect(seen.filter((u) => u.includes(`/api/timecards/${older.id}`)).length).toBeGreaterThanOrEqual(1);
  });

  it("year filter and archived toggle narrow the selector", async () => {
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/pay-periods")) {
        return ok({ data: [
          { id: 3, start_date: "2026-10-24", end_date: "2026-10-30", status: "OPEN" },
          { id: 2, start_date: "2025-10-18", end_date: "2025-10-24", status: "APPROVED" },
        ] });
      }
      return ok({ data: { period: { id: 3, status: "OPEN" }, rows: [] } });
    });
    render(<TimecardPage />);
    await screen.findByText("No employees in this period");
    expect(document.querySelector('optgroup[label="Approved / Closed"]')).toBeNull();
    fireEvent.click(screen.getByLabelText("Include Archived/Approved Periods"));
    expect(document.querySelector('optgroup[label="Approved / Closed"]')).toBeNull(); // still 2026-only
    const yearSelect = screen.getByLabelText("Year") as HTMLSelectElement;
    expect([...yearSelect.options].map((o) => o.value)).toEqual(["2026", "2025"]);
    fireEvent.change(yearSelect, { target: { value: "2025" } });
    expect(document.querySelector('optgroup[label="Approved / Closed"]')).toBeTruthy();
  });
});
