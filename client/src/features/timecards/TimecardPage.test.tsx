import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import TimecardPage from "./TimecardPage";

const periods = [{ id: 3, start_date: "2026-10-05", end_date: "2026-10-11", status: "OPEN" }];

const grid = (status: string) => ({
  period: { id: 3, start_date: "2026-10-05", end_date: "2026-10-11", status },
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

  it("renders employees and days from mocked API", async () => {
    (fetch as any).mockImplementation((url: string) =>
      url.includes("/api/pay-periods") ? ok({ data: periods }) : ok({ data: grid("OPEN") })
    );
    render(<TimecardPage />);
    const row = (await screen.findByText("Amy Example")).closest("tr");
    const cells = [...(row?.querySelectorAll("td") ?? [])].map((c) => c.textContent);
    expect(cells[0]).toBe("Amy Example");
    expect(cells.slice(1, 8)).toEqual(["8", "H8", "S8", "V8", "–", "–", "–"]);
    expect(cells.slice(8, 13)).toEqual(["8", "0", "8", "8", "8"]);
    // Bonus/Reimb are inputs now — assert values, not textContent.
    expect((screen.getByLabelText("bonus-1") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("reimb-1") as HTMLInputElement).value).toBe("0");
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
    period: { id: 3, start_date: "2026-10-05", end_date: "2026-10-11", status: "OPEN" },
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

  const regOf = () => {
    const row = screen.getByText("Amy Example").closest("tr");
    return [...(row?.querySelectorAll("td") ?? [])].map((c) => c.textContent);
  };

  const clickMon = () => {
    const row = screen.getByText("Amy Example").closest("tr");
    fireEvent.click(row?.querySelectorAll("td")[1] as Element);
  };

  it("click + Enter updates the cell and recomputes Reg", async () => {
    mockOpen();
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    clickMon();
    const input = screen.getByLabelText("day-1-2026-10-05");
    fireEvent.change(input, { target: { value: "V8" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(regOf()[1]).toBe("V8");
    expect(regOf()[8]).toBe("32"); // 4 × 8
    expect(await screen.findByText("● Unsaved changes")).toBeTruthy();
  });

  it("Escape reverts without touching state", async () => {
    mockOpen();
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    clickMon();
    const input = screen.getByLabelText("day-1-2026-10-05");
    fireEvent.change(input, { target: { value: "V8" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(regOf()[1]).toBe("8");
    expect(regOf()[8]).toBe("40");
    expect(screen.queryByText("● Unsaved changes")).toBeNull();
  });

  it("invalid code reverts", async () => {
    mockOpen();
    render(<TimecardPage />);
    await screen.findByText("Amy Example");
    clickMon();
    const input = screen.getByLabelText("day-1-2026-10-05");
    fireEvent.change(input, { target: { value: "X9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(regOf()[1]).toBe("8");
    expect(screen.queryByText("● Unsaved changes")).toBeNull();
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
    const row = screen.getByText("Amy Example").closest("tr");
    expect(row?.querySelectorAll("td")[1].textContent).toBe("V8"); // edit preserved
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
    expect(saveBtn().textContent).toBe("Saving…");
    resolvePut((await ok({ data: { saved: 1 } })) as Response);
    await screen.findByText("Saved");
  });
});
