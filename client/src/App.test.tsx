import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import App from "./App";

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
const fail = (status = 401) => Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) } as Response);

const grid = {
  period: { id: 7, status: "SUBMITTED" },
  rows: [
    {
      employee: { id: 1, full_name: "Amy Example", employee_number: "E1" },
      entry: { bonus_amount: "0", reimbursement_amount: "0" },
      computed: { reg_hours: "40", ot_hours: "0", holiday_hours: "0", sick_safe_paid_hours: "0", vacation_hours: "0" },
    },
  ],
};

const periods = [
  { id: 7, start_date: "2026-10-05", end_date: "2026-10-11", status: "SUBMITTED" },
];

function mockApi(me: unknown) {
  (fetch as any).mockImplementation((url: string) => {
    if (url.includes("/api/health")) return ok({ status: "ok" });
    if (url.includes("/api/auth/me")) return me ? ok({ user: me }) : fail();
    if (url.includes("/api/pay-periods")) return ok({ data: periods });
    if (url.includes("/api/timecards")) return ok({ data: grid });
    return fail(404);
  });
}

describe("App routing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    window.location.hash = "";
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("unauthenticated visit to #/report redirects to #/login", async () => {
    mockApi(null);
    window.location.hash = "#/report";
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/login"));
    expect(await screen.findByRole("button", { name: "Log in" })).toBeTruthy();
  });

  it("admin visiting #/report sees Access denied", async () => {
    mockApi({ email: "a@x.com", role: "ADMIN" });
    window.location.hash = "#/report";
    render(<App />);
    expect(await screen.findByText("Access denied.")).toBeTruthy();
    expect(window.location.hash).toBe("#/report");
  });

  it("owner visiting #/report renders the report", async () => {
    mockApi({ email: "o@x.com", role: "OWNER" });
    window.location.hash = "#/report";
    render(<App />);
    expect(await screen.findByText("Amy Example")).toBeTruthy();
  });

  it("report sub-links open weekly and monthly modes (owner only)", async () => {
    mockApi({ email: "o@x.com", role: "OWNER" });
    window.location.hash = "#/report/monthly";
    const { unmount } = render(<App />);
    expect(await screen.findByLabelText("Month")).toBeTruthy(); // monthly mode from hash
    expect(screen.queryByRole("button", { name: "Weekly" })).toBeNull(); // locked: no mode toggle
    expect(screen.getByText("Weekly Report", { selector: "nav a" })).toBeTruthy();
    expect(screen.getByText("Monthly Report", { selector: "nav a" })).toBeTruthy();
    unmount();
    cleanup();
    mockApi({ email: "a@x.com", role: "ADMIN" });
    window.location.hash = "#/timecards";
    render(<App />);
    await screen.findByText("Timecards", { selector: "nav a" });
    expect(screen.queryByText("Weekly Report", { selector: "nav a" })).toBeNull();
    expect(screen.queryByText("Monthly Report", { selector: "nav a" })).toBeNull();
  });

  it("logout clears the session and redirects to #/login", async () => {
    const calls: string[] = [];
    (fetch as any).mockImplementation((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/api/health")) return ok({ status: "ok" });
      if (url.includes("/api/auth/me")) return ok({ user: { email: "o@x.com", role: "OWNER" } });
      if (url.includes("/api/auth/logout")) return ok({ ok: true });
      if (url.includes("/api/pay-periods")) return ok({ data: [] });
      return ok({ data: grid });
    });
    window.location.hash = "#/report";
    render(<App />);
    fireEvent.click(await screen.findByText("Log out"));
    await waitFor(() => expect(window.location.hash).toBe("#/login"));
    expect(calls).toContain("POST /api/auth/logout");
    expect(await screen.findByRole("button", { name: "Log in" })).toBeTruthy();
  });

  it("sidebar shows role-filtered nav links", async () => {
    mockApi({ email: "a@x.com", role: "ADMIN" });
    window.location.hash = "#/timecards";
    const { unmount } = render(<App />);
    const tLink = await screen.findByText("Timecards", { selector: "nav a" });
    expect(tLink).toBeTruthy();
    const nav = tLink.closest("nav");
    expect(nav?.textContent).toContain("Employees");
    expect(nav?.textContent).not.toContain("Report");
    unmount();
    cleanup();
    mockApi({ email: "o@x.com", role: "OWNER" });
    window.location.hash = "#/report";
    render(<App />);
    const nav2 = await screen.findByText("Report", { selector: "nav a" });
    expect(nav2).toBeTruthy();
  });

  it("owner visiting #/employees sees the roster read-only (no mutations)", async () => {
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/employees")) {
        return ok({ data: [
          { id: 1, employee_number: "E1", full_name: "Amy Example", hire_date: "2026-09-01", termination_date: null, payment_method: "DIRECT_DEPOSIT", compensation: null },
        ] });
      }
      if (url.includes("/api/auth/me")) return ok({ user: { email: "o@x.com", role: "OWNER" } });
      return fail(404);
    });
    window.location.hash = "#/employees";
    render(<App />);
    expect(await screen.findByText("Amy Example")).toBeTruthy();
    expect(screen.queryByText("Access denied.")).toBeNull();
    expect(screen.queryByText("Add Employee")).toBeNull();
    expect(screen.queryByText("Terminate")).toBeNull();
    expect(screen.queryByText("Delete")).toBeNull();
    expect(screen.getByText("View")).toBeTruthy();
  });
});
