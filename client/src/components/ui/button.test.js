import { jsx as _jsx } from "react/jsx-runtime";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./button";
describe("shadcn Button (step-1 proof)", () => {
    it("renders children with the default variant classes", () => {
        render(_jsx(Button, { children: "shadcn is live" }));
        const btn = screen.getByRole("button", { name: "shadcn is live" });
        expect(btn.className).toContain("bg-primary");
        expect(btn.className).toContain("text-primary-foreground");
    });
    it("applies variant + className overrides via cn()", () => {
        render(_jsx(Button, { variant: "outline", className: "extra", children: "x" }));
        const btn = screen.getByRole("button", { name: "x" });
        expect(btn.className).toContain("border-input");
        expect(btn.className).toContain("extra");
    });
});
