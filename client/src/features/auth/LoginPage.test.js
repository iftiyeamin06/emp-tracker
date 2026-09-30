import { jsx as _jsx } from "react/jsx-runtime";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import LoginPage from "./LoginPage";
const ok = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
const fail = () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
describe("LoginPage (shadcn)", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });
    it("posts the credentials and hands the user to onSuccess", async () => {
        const bodies = [];
        fetch.mockImplementation((_url, init) => {
            bodies.push(JSON.parse(String(init?.body)));
            return ok({ user: { email: "a@x.com", role: "ADMIN" } });
        });
        const onSuccess = vi.fn();
        render(_jsx(LoginPage, { onSuccess: onSuccess }));
        fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@x.com" } });
        fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
        fireEvent.click(screen.getByRole("button", { name: "Log in" }));
        await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ email: "a@x.com", role: "ADMIN" }));
        expect(bodies).toEqual([{ email: "a@x.com", password: "secret" }]);
    });
    it("shows the error alert on bad credentials", async () => {
        fetch.mockImplementation(() => fail());
        render(_jsx(LoginPage, { onSuccess: vi.fn() }));
        fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@x.com" } });
        fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
        fireEvent.click(screen.getByRole("button", { name: "Log in" }));
        expect(await screen.findByRole("alert")).toBeTruthy();
        expect(screen.getByText("Couldn't sign you in")).toBeTruthy();
    });
});
