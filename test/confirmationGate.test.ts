import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { confirmProceed } from "../src/runtime/confirmationGate.js";

describe("confirmation gate", () => {
  it("mutation: non-tty without --yes stops", async () => {
    const ok = await confirmProceed({ yesFlag: false, isTTY: false });
    assert.equal(ok, false);
  });

  it("allows --yes without a tty", async () => {
    const ok = await confirmProceed({ yesFlag: true, isTTY: false });
    assert.equal(ok, true);
  });
});
