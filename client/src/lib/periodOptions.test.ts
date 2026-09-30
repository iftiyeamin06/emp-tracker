import { describe, expect, it } from "vitest";
import { availableYears, defaultYear, filterPeriods } from "./periodOptions";

const P = [
  { id: 1, start: "2026-10-24", end: "2026-10-30", status: "OPEN" },
  { id: 2, start: "2026-10-17", end: "2026-10-23", status: "APPROVED" },
  { id: 3, start: "2031-10-04", end: "2031-10-10", status: "OPEN" },
];

describe("period filters", () => {
  it("availableYears lists newest-first", () => {
    expect(availableYears(P)).toEqual(["2031", "2026"]);
  });

  it("defaultYear prefers the current year, else latest", () => {
    expect(defaultYear(P, "2026-10-26")).toBe("2026");
    expect(defaultYear(P, "2030-01-01")).toBe("2031");
    expect(defaultYear([], "2026-10-26")).toBeNull();
  });

  it("filterPeriods hides approved unless included", () => {
    expect(filterPeriods(P, { year: "2026", includeArchived: false }).map((p) => p.id)).toEqual([1]);
    expect(filterPeriods(P, { year: "2026", includeArchived: true }).map((p) => p.id)).toEqual([1, 2]);
    expect(filterPeriods(P, { year: "2031", includeArchived: false }).map((p) => p.id)).toEqual([3]);
  });
});
