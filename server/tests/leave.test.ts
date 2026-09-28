import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accruedByHours, adjustmentRequiresReason, frontloadedBalance, isOverdrawn } from "../src/lib/leave.js";

describe("leave", () => {
  it("accrues 1h per 30h worked", () => assert.equal(accruedByHours(90, 1 / 30), 3));
  it("front-loaded balance subtracts usage", () => assert.equal(frontloadedBalance([40], [8]), 32));
  it("paid, unpaid and prenatal all use the same balance math", () => {
    assert.equal(frontloadedBalance([32], [8]), 24); // protected unpaid grant
    assert.equal(frontloadedBalance([20], [4]), 16); // prenatal grant
  });
  it("overdraw attempt is detected", () => {
    assert.equal(isOverdrawn(32, 40), true);
    assert.equal(isOverdrawn(32, 32), false);
  });
  it("manual adjustment requires a reason, usage does not", () => {
    assert.equal(adjustmentRequiresReason("ADJUSTMENT"), true);
    assert.equal(adjustmentRequiresReason("USAGE"), false);
    assert.equal(adjustmentRequiresReason("ACCRUAL"), false);
  });
});
