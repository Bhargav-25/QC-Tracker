import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STATUS } from "../src/constants.js";
import { OPS_ACTOR, OPS_AUDIT_ACTOR, applyOpsWrite, handleOpsHttp } from "../src/domain/opsHttp.js";
import { computeStatus, warrantyDaysRemaining } from "../src/utils/status.js";

const OPS_KEY = "ops-write-key";
const NOW = new Date("2026-11-13T09:00:00.000Z");

const PACKING = {
  machineBolted: { url: "u1", path: "p1" },
  fastnersBox: { url: "u2", path: "p2" },
  frontCover: { url: "u3", path: "p3" },
  finalPacked: { url: "u4", path: "p4" },
};

function photo(n) {
  return {
    url: `https://storage.example/machines/m42/installation/${n}.jpg`,
    path: `machines/m42/installation/${n}.jpg`,
    lat: null,
    lng: null,
    capturedAt: "2026-11-13T08:00:00.000Z",
    contentHash: `hash${n}`,
    clientId: null,
  };
}

function wronglyInstalled(overrides = {}) {
  return {
    id: "m42",
    machineNumber: "X34M42",
    groupNumber: "G1492",
    updatedAt: "2026-11-13T08:30:00.000Z",
    finalPacking: PACKING,
    dispatch: {
      dispatched: true,
      date: "2026-11-13",
      comment: "machine remark",
      includeStand: false,
      courier: "Local – Bangalore",
      trackingNumber: "LB-77",
      trackingLink: "",
      accessoriesSeparate: false,
      accessoriesCourier: "",
      accessoriesTracking: "",
      accessoriesSentOn: "",
      accessoriesStatus: "Not sent",
    },
    delivery: { delivered: false, date: "" },
    installation: {
      installed: true,
      date: "2026-11-13",
      installedBy: "Syed Mateen",
      notes: "",
      photos: [photo(1), photo(2), photo(3)],
      video: null,
      location: null,
    },
    cycles: [],
    cycle: 1,
    intake: null,
    sectionMeta: { finalPacking: { updatedAt: "2026-11-01T00:00:00.000Z", updatedBy: "production@example.com" } },
    ...overrides,
  };
}

function packedUnlinked(overrides = {}) {
  return {
    id: "m41",
    machineNumber: "X34M41",
    groupNumber: "",
    updatedAt: "2026-11-01T00:00:00.000Z",
    finalPacking: PACKING,
    dispatch: { dispatched: false, date: "", courier: "", trackingNumber: "", includeStand: false },
    delivery: { delivered: false, date: "" },
    installation: { installed: false, date: "", photos: [], video: null, installedBy: "" },
    sectionMeta: { finalPacking: { updatedAt: "2026-11-01T00:00:00.000Z", updatedBy: "production@example.com" } },
    ...overrides,
  };
}

const g1492 = () => ({
  id: "G1492",
  groupNumber: "G1492",
  machineId: "m42",
  machineNumber: "X34M42",
  fulfillmentStatus: STATUS.INSTALLED,
});

function reset({ machine = wronglyInstalled(), machines, orders = [g1492()], body, method = "POST", urlPath } = {}) {
  return handleOpsHttp({
    method,
    urlPath: urlPath || "/v1/machines/X34M42/reset",
    headers: { "x-api-key": OPS_KEY },
    body: body === undefined ? { reason: "Wrong machine linked to G1492", groupNumber: "G1492" } : body,
    expectedKey: OPS_KEY,
    machines: machines || [machine],
    orders,
    order: null,
    now: NOW,
  });
}

describe("ops reset source", () => {
  const ops = readFileSync(new URL("../functions/opsApi.js", import.meta.url), "utf8");

  it("re-plans and commits the machine, order unlinks, and audit row in one transaction", () => {
    const fn = ops.slice(ops.indexOf("async function commitReset"), ops.indexOf("export const opsApi"));
    const txAt = fn.indexOf("await db.runTransaction");
    const readAt = fn.indexOf("readResetContext(db, (ref) => tx.get(ref)");
    const planAt = fn.indexOf("planOpsReset(");
    const machineAt = fn.indexOf('tx.update(\n      db.collection("machines")');
    const orderAt = fn.indexOf('tx.update(db.collection("orders")');
    const auditAt = fn.indexOf("tx.set(auditRef, auditWrite(planned.write.audit))");
    assert.ok(txAt > 0 && readAt > txAt && planAt > readAt);
    assert.ok(machineAt > planAt && orderAt > machineAt && auditAt > orderAt);
    const handler = ops.slice(ops.indexOf("if (result.commit)"), ops.indexOf("if (result.upload)"));
    assert.match(handler, /await commitReset\(db, result\.commit\)/);
  });

  it("does not delete storage files", () => {
    const fn = ops.slice(ops.indexOf("async function readResetContext"), ops.indexOf("export const opsApi"));
    assert.equal(fn.includes(".delete("), false);
    assert.equal(fn.includes("getStorage"), false);
  });
});

describe("ops reset", () => {
  it("puts a wrongly installed machine back to Packed, unlinks its order, and keeps what it cleared", () => {
    const machine = wronglyInstalled({ dispatchHistory: [{ cycle: 0 }], corrections: [{ kind: "reset", reason: "older" }] });
    const result = reset({ machine });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.unchanged, false);
    assert.equal(result.body.status, STATUS.PACKED);
    assert.equal(result.body.previousStatus, STATUS.INSTALLED);
    assert.equal(result.body.groupNumber, null);
    assert.equal(result.body.previousGroupNumber, "G1492");
    assert.deepEqual(result.body.unlinkedOrders, ["G1492"]);
    assert.equal(result.body.cleared.dispatch.courier, "Local – Bangalore");
    assert.equal(result.body.cleared.installation.installedBy, "Syed Mateen");
    assert.deepEqual(
      result.body.cleared.installation.photos.map((p) => p.path),
      ["machines/m42/installation/1.jpg", "machines/m42/installation/2.jpg", "machines/m42/installation/3.jpg"]
    );
    assert.equal(result.body.cleared.installation.photos[0].contentHash, "hash1");

    const { write, commit } = result;
    assert.equal(commit.kind, "reset");
    assert.equal(commit.machineNumber, "X34M42");
    assert.equal(write.fields.groupNumber, "");
    assert.equal(write.fields.updatedBy, OPS_ACTOR);
    assert.equal(write.fields.dispatch.dispatched, false);
    assert.equal(write.fields.dispatch.date, "");
    assert.equal(write.fields.dispatch.courier, "");
    assert.equal(write.fields.dispatch.comment, "machine remark");
    assert.equal(write.fields.installation.installed, false);
    assert.equal(write.fields.installation.date, "");
    assert.equal(write.fields.installation.installedBy, "");
    assert.deepEqual(write.fields.installation.photos, []);
    assert.deepEqual(write.sectionStamps, ["dispatch", "delivery", "installation"]);
    for (const key of ["cycles", "cycle", "intake", "dispatchHistory", "finalPacking", "warranty"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(write.fields, key), false, key);
    }

    assert.equal(write.fields.corrections.length, 2);
    assert.equal(write.fields.corrections[0].reason, "older");
    const entry = write.fields.corrections[1];
    assert.equal(entry.kind, "reset");
    assert.equal(entry.reason, "Wrong machine linked to G1492");
    assert.equal(entry.statusBefore, STATUS.INSTALLED);
    assert.equal(entry.groupNumber, "G1492");
    assert.deepEqual(entry.orderIds, ["G1492"]);
    assert.equal(entry.recordedAt, NOW.toISOString());
    assert.equal(entry.dispatch.trackingNumber, "LB-77");
    assert.equal(entry.installation.photos.length, 3);
    assert.equal(entry.installation.photos[2].url, photo(3).url);

    assert.equal(write.orderClears.length, 1);
    assert.equal(write.orderClears[0].id, "G1492");
    assert.equal(write.orderClears[0].fields.machineId, "");
    assert.equal(write.orderClears[0].fields.machineNumber, "");
    assert.equal(write.orderClears[0].fields.fulfillmentStatus, "");

    assert.equal(write.audit.userEmail, OPS_AUDIT_ACTOR);
    assert.equal(write.audit.section, "reset");
    assert.equal(write.audit.groupNumber, "G1492");
    assert.match(write.audit.action, /^reset X34M42 to Packed group G1492/);
    assert.match(write.audit.action, /status Installed → Packed/);
    assert.match(write.audit.action, /Local – Bangalore LB-77 on 2026-11-13/);
    assert.match(write.audit.action, /by Syed Mateen/);
    assert.match(write.audit.action, /3 installation file\(s\) kept/);

    const after = applyOpsWrite(machine, write, NOW.toISOString());
    assert.equal(computeStatus(after), STATUS.PACKED);
    assert.equal(warrantyDaysRemaining(after), null);
  });

  it("frees both machines so the swap can be done with assign, dispatch, installation, and photos", () => {
    const m42 = applyOpsWrite(wronglyInstalled(), reset().write, NOW.toISOString());
    const m41 = packedUnlinked();
    const g1492Cleared = { id: "G1492", groupNumber: "G1492", machineId: "", machineNumber: "", fulfillmentStatus: "" };
    const g1491 = { id: "G1491", groupNumber: "G1491", machineId: "", machineNumber: "", fulfillmentStatus: "" };
    const assign = (group, machineNumber) =>
      handleOpsHttp({
        method: "POST",
        urlPath: `/v1/groups/${group}/assign`,
        headers: { "x-api-key": OPS_KEY },
        body: { machineNumber },
        expectedKey: OPS_KEY,
        machines: [m41, m42],
        orders: [g1492Cleared, g1491],
        now: NOW,
      });
    const first = assign("G1492", "X34M41");
    assert.equal(first.status, 200);
    assert.deepEqual(first.assign.clearMachineIds, []);
    const second = assign("G1491", "X34M42");
    assert.equal(second.status, 200);
    assert.equal(second.body.status, STATUS.PACKED);
  });

  it("acts as a plain unassign for a Packed machine that is linked but not shipped", () => {
    const machine = packedUnlinked({ id: "m42", machineNumber: "X34M42", groupNumber: "G1492" });
    const result = reset({ machine });
    assert.equal(result.status, 200);
    assert.equal(result.body.previousStatus, STATUS.PACKED);
    assert.equal(result.write.fields.groupNumber, "");
    assert.equal(Object.prototype.hasOwnProperty.call(result.write.fields, "dispatch"), false);
    assert.deepEqual(result.write.sectionStamps, []);
    assert.equal(result.write.orderClears[0].id, "G1492");
  });

  it("finds the link from the order when the machine's groupNumber is blank", () => {
    const result = reset({ machine: wronglyInstalled({ groupNumber: "" }) });
    assert.equal(result.status, 200);
    assert.equal(result.body.previousGroupNumber, "G1492");
    assert.deepEqual(result.write.orderClears.map((c) => c.id), ["G1492"]);
  });

  it("does not unlink an order that points at a different machine", () => {
    const other = { id: "G1492", groupNumber: "G1492", machineId: "m99", machineNumber: "X34M99" };
    const result = reset({ orders: [other], body: { reason: "fix" } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.write.orderClears, []);
    assert.equal(result.write.fields.groupNumber, "");
  });

  it("is unchanged for a Packed machine with nothing linked or recorded", () => {
    const result = reset({ machine: packedUnlinked({ machineNumber: "X34M42" }), orders: [], body: { reason: "fix" } });
    assert.equal(result.status, 200);
    assert.equal(result.body.unchanged, true);
    assert.equal(result.write, undefined);
    assert.equal(result.commit, undefined);
  });

  it("refuses when the groupNumber guard does not match the current link", () => {
    const result = reset({ body: { reason: "fix", groupNumber: "G1491" } });
    assert.equal(result.status, 409);
    assert.match(result.body.error, /linked to G1492, not G1491/);
    assert.equal(result.write, undefined);
  });

  it("validates the body", () => {
    assert.equal(reset({ body: {} }).status, 400);
    assert.equal(reset({ body: { reason: "  " } }).status, 400);
    assert.equal(reset({ body: { reason: 5 } }).status, 400);
    assert.equal(reset({ body: { reason: "fix", force: true } }).status, 400);
    assert.equal(reset({ body: { reason: "fix", groupNumber: 1492 } }).status, 400);
    assert.equal(reset({ body: [] }).status, 400);
  });

  it("refuses cases it cannot undo safely", () => {
    const openReturn = reset({ machine: wronglyInstalled({ intake: { date: "2026-11-13", reason: "x", refurb: {} } }) });
    assert.equal(openReturn.status, 409);
    assert.match(openReturn.body.error, /open return/);

    const stand = reset({
      machine: wronglyInstalled({ dispatch: { ...wronglyInstalled().dispatch, includeStand: true } }),
    });
    assert.equal(stand.status, 409);
    assert.match(stand.body.error, /stand/);

    const extended = reset({ machine: wronglyInstalled({ warranty: { extensions: [{ months: 6 }] } }) });
    assert.equal(extended.status, 409);
    assert.match(extended.body.error, /warranty extensions/);

    const unpacked = reset({ machine: wronglyInstalled({ finalPacking: { ...PACKING, finalPacked: null } }) });
    assert.equal(unpacked.status, 409);
    assert.match(unpacked.body.error, /would be Testing/);

    const twin = wronglyInstalled({ id: "m42b" });
    const dupes = reset({ machines: [wronglyInstalled(), twin] });
    assert.equal(dupes.status, 409);
    assert.match(dupes.body.error, /More than one machine/);

    for (const result of [openReturn, stand, extended, unpacked, dupes]) {
      assert.equal(result.write, undefined);
      assert.equal(result.commit, undefined);
    }
  });

  it("is POST only, by machine number only, and 404s an unknown machine", () => {
    const get = reset({ method: "GET" });
    assert.equal(get.status, 405);
    assert.equal(get.allow, "POST");
    assert.equal(reset({ urlPath: "/v1/groups/G1492/reset" }).status, 404);
    assert.equal(reset({ urlPath: "/v1/machines/NOPE/reset" }).status, 404);
  });

  it("requires the ops key", () => {
    const result = handleOpsHttp({
      method: "POST",
      urlPath: "/v1/machines/X34M42/reset",
      headers: { "x-api-key": "wrong" },
      body: { reason: "fix" },
      expectedKey: OPS_KEY,
      machines: [wronglyInstalled()],
      orders: [g1492()],
      now: NOW,
    });
    assert.equal(result.status, 401);
    assert.equal(result.write, undefined);
  });
});
