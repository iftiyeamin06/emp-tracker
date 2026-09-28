import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertTransition } from "../src/lib/periodTransitions.js";
import { assertPeriodOpen } from "../src/lib/periodLock.js";

const throwsStatus = (fn: () => void, status: number, pattern: RegExp) => {
  try {
    fn();
  } catch (e: any) {
    assert.equal(e.status, status);
    assert.match(e.message, pattern);
    return;
  }
  assert.fail("expected throw");
};

describe("period workflow", () => {
  it("OPEN -> SUBMITTED by admin", () => assertTransition("OPEN", "SUBMITTED", "ADMIN"));
  it("SUBMITTED -> APPROVED by owner", () => assertTransition("SUBMITTED", "APPROVED", "OWNER"));
  it("SUBMITTED -> RETURNED by owner with reason", () =>
    assertTransition("SUBMITTED", "RETURNED", "OWNER", "fix Tuesday"));
  it("RETURNED -> OPEN with reason", () => assertTransition("RETURNED", "OPEN", "ADMIN", "fixed"));
  it("APPROVED -> OPEN by owner with reason", () => assertTransition("APPROVED", "OPEN", "OWNER", "payroll error"));
  it("admin cannot approve", () => throwsStatus(() => assertTransition("SUBMITTED", "APPROVED", "ADMIN"), 403, /cannot_move/));
  it("admin cannot reopen approved", () => throwsStatus(() => assertTransition("APPROVED", "OPEN", "ADMIN", "x"), 403, /cannot_move/));
  it("return without reason is rejected", () => throwsStatus(() => assertTransition("SUBMITTED", "RETURNED", "OWNER"), 422, /reason_required/));
  it("reopen without reason is rejected", () => throwsStatus(() => assertTransition("APPROVED", "OPEN", "OWNER"), 422, /reason_required/));
  it("OPEN -> APPROVED directly is rejected", () => throwsStatus(() => assertTransition("OPEN", "APPROVED", "OWNER"), 422, /not_allowed/));
  it("owner cannot approve without required data (no skipping validation)", () =>
    throwsStatus(() => assertTransition("OPEN", "SUBMITTED", "OWNER"), 403, /cannot_move/));
});

describe("period lock guard", () => {
  const stub = (status?: string) => ({
    query: async (): Promise<[any[], unknown]> => [status ? [{ status }] : [], []],
  });
  it("OPEN passes", async () => await assertPeriodOpen(stub("OPEN"), 1));
  it("SUBMITTED blocks admin edits", async () => {
    await assert.rejects(() => assertPeriodOpen(stub("SUBMITTED"), 1), /submitted_locked/);
  });
  it("APPROVED blocks edits", async () => {
    await assert.rejects(() => assertPeriodOpen(stub("APPROVED"), 1), /approved_locked/);
  });
  it("missing period is 404", async () => {
    await assert.rejects(() => assertPeriodOpen(stub(undefined), 9), /not_found/);
  });
});
