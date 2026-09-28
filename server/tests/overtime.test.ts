import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calcOvertime } from "../src/lib/overtime.js";

describe("overtime", () => {
  it("40 worked hours -> 40 reg / 0 ot", () => {
    assert.deepEqual(calcOvertime({ workedHours: 40, eligible: true }), { reg: 40, ot: 0, overridden: false });
  });
  it("41 worked hours -> 40 reg / 1 ot", () => {
    assert.deepEqual(calcOvertime({ workedHours: 41, eligible: true }), { reg: 40, ot: 1, overridden: false });
  });
  it("40 worked + 8 leave hours -> leave never counts toward OT", () => {
    assert.deepEqual(calcOvertime({ workedHours: 40, eligible: true }), { reg: 40, ot: 0, overridden: false });
  });
  it("exempt employee gets no automatic OT", () => {
    assert.deepEqual(calcOvertime({ workedHours: 45, eligible: false }), { reg: 45, ot: 0, overridden: false });
  });
  it("manual override with reason wins", () => {
    assert.deepEqual(
      calcOvertime({ workedHours: 45, eligible: true, overrideHours: 3, overrideReason: "holiday week" }),
      { reg: 40, ot: 3, overridden: true }
    );
  });
  it("override without reason is rejected", () => {
    assert.throws(() => calcOvertime({ workedHours: 45, eligible: true, overrideHours: 3 }), /override_reason_required/);
    assert.throws(() => calcOvertime({ workedHours: 45, eligible: true, overrideHours: 3, overrideReason: "  " }), /override_reason_required/);
  });
});
