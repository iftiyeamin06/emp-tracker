import { jsx as _jsx } from "react/jsx-runtime";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import EmployeesPage from "./EmployeesPage";
const ok = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
const fail = (status) => Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) });
const list = (extra = []) => ({
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
        const posts = [];
        let calls = 0;
        fetch.mockImplementation((url, init) => {
            if ((init?.method ?? "GET") === "POST") {
                posts.push(JSON.parse(String(init?.body)));
                return ok({ data: { employee: { id: 2 }, compensation: { id: 3 } } });
            }
            calls += 1;
            return ok(list(calls > 1 ? [{ id: 2, employee_number: "E2", full_name: "Bob New", hire_date: "2026-10-01", compensation: null }] : []));
        });
        render(_jsx(EmployeesPage, {}));
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
        expect(amyRow?.textContent).toContain("Cash"); // roster Payment column
    });
    it("error path: shows the error and keeps form state", async () => {
        fetch.mockImplementation((url, init) => {
            if ((init?.method ?? "GET") === "POST")
                return fail(409);
            return ok(list());
        });
        render(_jsx(EmployeesPage, {}));
        await screen.findByText("Amy Example");
        fireEvent.click(screen.getByText("Add Employee"));
        fireEvent.change(screen.getByLabelText("Employee number"), { target: { value: "E1" } });
        fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Dupe" } });
        fireEvent.change(screen.getByLabelText("Hire date"), { target: { value: "2026-10-01" } });
        fireEvent.change(screen.getByLabelText("Rate"), { target: { value: "10" } });
        fireEvent.click(screen.getByRole("button", { name: "Add" }));
        expect(await screen.findByText("That employee number is already taken.")).toBeTruthy();
        expect(screen.getByLabelText("Employee number").value).toBe("E1"); // state kept
    });
    it("terminate confirms, PUTs the date, and refetches", async () => {
        const puts = [];
        fetch.mockImplementation((url, init) => {
            if ((init?.method ?? "GET") === "PUT") {
                puts.push({ url, body: JSON.parse(String(init?.body)) });
                return ok({ data: { employee: { id: 1 } } });
            }
            return ok(list());
        });
        window.confirm = vi.fn().mockReturnValue(true);
        render(_jsx(EmployeesPage, {}));
        await screen.findByText("Amy Example");
        fireEvent.click(screen.getByText("Terminate"));
        await screen.findByText("Amy Example"); // refetched
        expect(puts.length).toBe(1);
        expect(puts[0].url).toBe("/api/employees/1");
        expect(/^\d{4}-\d{2}-\d{2}$/.test(puts[0].body.termination_date)).toBe(true);
        window.confirm = undefined;
    });
    it("terminate cancel makes no call; rehire sends null", async () => {
        const calls = [];
        const puts = [];
        fetch.mockImplementation((url, init) => {
            calls.push(`${init?.method ?? "GET"} ${url}`);
            if ((init?.method ?? "GET") === "PUT") {
                puts.push(JSON.parse(String(init?.body)));
                return ok({ data: { employee: { id: 9 } } });
            }
            return ok({ data: [{ id: 9, employee_number: "E9", full_name: "Gone Person", hire_date: "2026-09-01", termination_date: "2026-10-01", compensation: null }] });
        });
        window.confirm = vi.fn().mockReturnValue(false);
        render(_jsx(EmployeesPage, {}));
        await screen.findByText("Gone Person");
        expect(screen.getByText("Terminated Oct 01, 2026")).toBeTruthy();
        fireEvent.click(screen.getByText("Rehire"));
        expect(calls.filter((c) => c.startsWith("PUT")).length).toBe(0);
        window.confirm = vi.fn().mockReturnValue(true);
        fireEvent.click(screen.getByText("Rehire"));
        expect(calls.filter((c) => c.startsWith("PUT")).length).toBe(1);
        expect(puts[0]).toEqual({ termination_date: null });
        window.confirm = undefined;
    });
    it("delete confirms, DELETEs, and refetches", async () => {
        const calls = [];
        fetch.mockImplementation((url, init) => {
            calls.push(`${init?.method ?? "GET"} ${url}`);
            if ((init?.method ?? "GET") === "DELETE")
                return ok({ data: { deleted: 1 } });
            return ok(list());
        });
        window.confirm = vi.fn().mockReturnValue(true);
        render(_jsx(EmployeesPage, {}));
        await screen.findByText("Amy Example");
        fireEvent.click(screen.getByText("Delete"));
        expect(calls).toContain("DELETE /api/employees/1");
        window.confirm = undefined;
    });
    it("delete cancel makes no call; 409 directs to terminate", async () => {
        const calls = [];
        fetch.mockImplementation((url, init) => {
            calls.push(`${init?.method ?? "GET"} ${url}`);
            if ((init?.method ?? "GET") === "DELETE")
                return fail(409);
            return ok(list());
        });
        window.confirm = vi.fn().mockReturnValue(false);
        render(_jsx(EmployeesPage, {}));
        await screen.findByText("Amy Example");
        fireEvent.click(screen.getByText("Delete"));
        expect(calls.filter((c) => c.startsWith("DELETE")).length).toBe(0);
        window.confirm = vi.fn().mockReturnValue(true);
        fireEvent.click(screen.getByText("Delete"));
        expect(await screen.findByText("Cannot delete — this employee has history. Terminate instead.")).toBeTruthy();
        window.confirm = undefined;
    });
    it("modal opens on Add Employee and closes on Cancel, Escape, and outside click", async () => {
        fetch.mockImplementation(() => ok(list()));
        render(_jsx(EmployeesPage, {}));
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
    it("payment badge shows the correct label per payment_method", async () => {
        fetch.mockImplementation(() => ok({ data: [
                { id: 1, employee_number: "E1", full_name: "Cash Person", hire_date: "2026-09-01", termination_date: null, payment_method: "CASH", compensation: null },
                { id: 2, full_name: "Amy Example", employee_number: "E2", hire_date: "2026-09-01", termination_date: null, payment_method: "DIRECT_DEPOSIT", compensation: null },
                { id: 3, employee_number: "E3", full_name: "Check Person", hire_date: "2026-09-01", termination_date: null, payment_method: "CHECK", compensation: null },
            ] }));
        render(_jsx(EmployeesPage, {}));
        await screen.findByText("Cash Person");
        const cashRow = screen.getByText("Cash Person").closest("tr");
        expect(cashRow?.textContent).toContain("CASH");
        const ddRow = screen.getByText("Amy Example").closest("tr");
        expect(ddRow?.textContent).toContain("Direct Deposit");
        expect(ddRow?.textContent).not.toContain("CASH");
        const checkRow = screen.getByText("Check Person").closest("tr");
        expect(checkRow?.textContent).toContain("Check");
    });
    it("profile drawer renders the sick balance card from mock data", async () => {
        fetch.mockImplementation((url) => {
            if (url === "/api/employees/1/leave") {
                return ok({
                    data: {
                        balances: { SICK_SAFE_PAID: 32 },
                        ledger: [
                            { date: "2026-01-01", leave_type: "SICK_SAFE_PAID", entry_type: "accrual", hours: 40, note: "2026 frontload" },
                            { date: "2026-10-20", leave_type: "SICK_SAFE_PAID", entry_type: "usage", hours: -8, note: "2031-10-13" },
                        ],
                    },
                });
            }
            return ok(list());
        });
        render(_jsx(EmployeesPage, {}));
        await screen.findByText("Amy Example");
        fireEvent.click(screen.getAllByText("View")[0]);
        expect(await screen.findByText("Sick: 32 of 40 hours remaining")).toBeTruthy();
        expect(await screen.findByText("Leave History")).toBeTruthy();
        expect(screen.getByText("2026 frontload")).toBeTruthy();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByText("Sick: 32 of 40 hours remaining")).toBeNull();
    });
});
