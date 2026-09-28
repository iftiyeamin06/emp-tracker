import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import EmployeesPage from "./EmployeesPage";

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
const fail = (status: number) => Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) } as Response);

const list = (extra: unknown[] = []) => ({
  data: [
    { id: 1, employee_number: "E1", full_name: "Amy Example", hire_date: "2026-09-01",
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
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Added")).toBeTruthy();
    expect(posts.length).toBe(1);
    expect(posts[0]).toEqual({
      employee_number: "E2",
      full_name: "Bob New",
      hire_date: "2026-10-01",
      compensation: { pay_type: "SALARY", rate: 900, overtime_status: "NON_EXEMPT", classification: undefined },
    });
    expect(await screen.findByText("Bob New")).toBeTruthy(); // refetched list
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
});
