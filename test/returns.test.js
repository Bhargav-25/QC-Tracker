import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STATUS } from "../src/constants.js";
import { planReturn, planRefurbComplete } from "../src/domain/machineCycle.js";
import {
  planRefurbLine,
  planUndoRefurbLine,
  planResolveRevive,
  parsePartQty,
} from "../src/domain/partLedger.js";
import {
  COMMON_CODE_ORDER,
  groupPartsForPicker,
  parsePartsCsv,
  partDisplayName,
  planSeedPart,
} from "../src/domain/partsCatalog.js";
import { planCatalogSeed } from "../scripts/seed-parts.mjs";
import { handleMachinesHttp, toPublicMachine } from "../src/domain/machinesHttp.js";
import { computeStatus } from "../src/utils/status.js";

const SECRET_URL = "https://secret.example/return.jpg";
const SECRET_PATH = "machines/m1/return/photo.jpg";

function installedMachine(overrides = {}) {
  return {
    id: "m1",
    machineNumber: "X33M002",
    groupNumber: "G1443",
    cycle: 1,
    cycles: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    dispatch: { dispatched: true, date: "2026-02-02", includeStand: true, courier: "Safexpress", trackingNumber: "1847" },
    delivery: { delivered: true, date: "2026-02-10" },
    installation: {
      installed: true,
      date: "2026-02-12",
      photos: [{ url: SECRET_URL, path: SECRET_PATH }],
      installedBy: "tech@example.com",
    },
    warranty: { extensions: [{ months: 3, invoiceNumber: "INV-9", invoiceDate: "2026-03-01" }] },
    resistance: [{ current: 4, eccentric: "1", concentric: "2" }],
    photos: { ropeBurn: [{ url: SECRET_URL, path: SECRET_PATH }] },
    finalPacking: { machineBolted: { url: SECRET_URL, path: SECRET_PATH } },
    sectionMeta: { installation: { updatedAt: "2026-02-12T00:00:00.000Z", updatedBy: "tech@example.com" } },
    ...overrides,
  };
}

const plate = {
  code: "0000018",
  name: "Arm Plate - 1",
  group: "Arm",
  unit: "pcs",
  revivable: true,
  revivedStock: 2,
};

const plastic = {
  code: "0000041",
  name: "Slider Rope guide 1 Big - 3D Printed",
  group: "Slider",
  unit: "pcs",
  revivable: false,
  revivedStock: 0,
};

describe("return cycles and status", () => {
  it("archives the customer cycle, keeps the machine number, and resets the active record", () => {
    const machine = installedMachine();
    const plan = planReturn(
      machine,
      { date: "2026-10-18", reason: "Coating worn", fromGroupNo: "G1443", receivedAt: "2026-10-20", notes: "Arm plate" },
      { user: "workshop@example.com", now: "2026-10-20T09:00:00.000Z", photos: [{ url: SECRET_URL, path: SECRET_PATH }] }
    );
    assert.equal(plan.cycleClosed, 1);
    assert.equal(plan.nextCycle, 2);
    assert.equal(plan.unlinkGroup, "G1443");
    assert.equal(plan.snapshot.groupNumber, "G1443");
    assert.equal(plan.snapshot.dispatch.dispatched, true);
    assert.equal(plan.snapshot.installation.installed, true);
    assert.equal(plan.snapshot.warranty.extensions[0].invoiceNumber, "INV-9");
    assert.equal(plan.snapshot.return.reason, "Coating worn");
    assert.equal(plan.reset.groupNumber, "");
    assert.equal(plan.reset.cycle, 2);
    assert.equal(plan.reset.dispatch.dispatched, false);
    assert.equal(plan.reset.delivery.delivered, false);
    assert.equal(plan.reset.installation.installed, false);
    assert.equal(plan.reset.installation.date, "");
    assert.deepEqual(plan.reset.warranty.extensions, []);
    assert.equal(plan.reset.resistance[0].eccentric, "");
    assert.equal(plan.reset.intake.fromGroupNo, "G1443");
    assert.equal(computeStatus({ ...machine, ...plan.reset }), STATUS.RETURNED);
  });

  it("uses Returned, then Refurbishing, then the normal cycle once refurb is complete", () => {
    const returned = { ...installedMachine(), ...planReturn(installedMachine(), {
      date: "2026-10-18", reason: "Back", fromGroupNo: "G1443", receivedAt: "2026-10-20", notes: "",
    }, { now: "2026-10-20T09:00:00.000Z" }).reset };

    const refurbishing = {
      ...returned,
      intake: {
        ...returned.intake,
        refurb: {
          startedAt: "2026-10-21T00:00:00.000Z",
          completedAt: "",
          lines: [{ id: "l1", undone: false, partCode: "0000018" }],
        },
      },
    };
    const completed = {
      ...planRefurbComplete(refurbishing, { date: "2026-10-22", user: "workshop@example.com", now: "2026-10-22T00:00:00.000Z" }),
    };
    const packed = {
      ...refurbishing,
      intake: { ...refurbishing.intake, refurb: { ...refurbishing.intake.refurb, completedAt: "2026-10-22" } },
      finalPacking: {
        machineBolted: { url: "x" },
        fastnersBox: { url: "x" },
        frontCover: { url: "x" },
        finalPacked: { url: "x" },
      },
    };

    const stages = [returned, refurbishing, { ...refurbishing, ...completed }, packed];
    assert.equal(computeStatus(returned), STATUS.RETURNED);
    assert.equal(computeStatus(refurbishing), STATUS.REFURBISHING);
    assert.equal(computeStatus({ ...refurbishing, ...completed }), STATUS.ASSEMBLY);
    assert.equal(computeStatus(packed), STATUS.PACKED);
    for (const machine of stages) {
      assert.equal(toPublicMachine(machine).status, computeStatus(machine));
    }
  });

  it("does not put storage urls from a past cycle on the machines API", () => {
    const plan = planReturn(installedMachine(), {
      date: "2026-10-18", reason: "Back", fromGroupNo: "G1443", receivedAt: "2026-10-20", notes: "Chipped coating",
    }, { now: "2026-10-20T09:00:00.000Z", photos: [{ url: SECRET_URL, path: SECRET_PATH }] });
    const machine = { ...installedMachine(), ...plan.reset, updatedAt: "2026-10-20T09:00:00.000Z" };
    const pub = toPublicMachine(machine);
    const encoded = JSON.stringify(pub);
    assert.equal(pub.cycle, 2);
    assert.equal(pub.refurbished, true);
    assert.equal(pub.cycles[0].groupNo, "G1443");
    assert.equal(pub.cycles[0].installation.installed, true);
    assert.equal(pub.cycles[0].warranty.extensions[0].months, 3);
    assert.equal(pub.cycles[0].return.photoCount, 1);
    assert.equal(pub.return.photoCount, 1);
    assert.equal(pub.return.reason, "Back");
    assert.equal(pub.status, STATUS.RETURNED);
    for (const leak of [SECRET_URL, SECRET_PATH, "tech@example.com", "https://", "gs://"]) {
      assert.equal(encoded.includes(leak), false, leak);
    }
    const keys = [];
    JSON.stringify(pub, (key, value) => {
      keys.push(key);
      return value;
    });
    assert.equal(keys.some((key) => /url|path|storage/i.test(key)), false);
  });
});

describe("part ledger", () => {
  const machine = {
    id: "m1",
    machineNumber: "X33M002",
    cycle: 2,
    intake: { refurb: { startedAt: null, completedAt: "", lines: [] } },
  };

  it("rejects revive for a non-revivable part and blocks revived stock at zero", () => {
    assert.throws(
      () => planRefurbLine({
        part: plastic,
        qty: 1,
        source: "New",
        disposition: "Revive",
        machine,
        user: "a@b.c",
        ids: { line: "l", fit: "f", removed: "r", revive: "q" },
      }),
      /not revivable/
    );
    assert.throws(
      () => planRefurbLine({
        part: { ...plate, revivedStock: 0 },
        qty: 1,
        source: "Revived",
        disposition: "Scrap",
        machine,
        user: "a@b.c",
        ids: { line: "l", fit: "f", removed: "r", revive: "q" },
      }),
      /No revived/
    );
    assert.throws(() => parsePartQty("1.5", "pcs"), /whole numbers/);
    assert.equal(parsePartQty("1.25", "mtr"), 1.25);
    assert.equal(parsePartQty("0002", "pcs"), 2);
  });

  it("writes the fit and the removal together, and undo appends reversals", () => {
    const planned = planRefurbLine({
      part: plate,
      qty: 1,
      source: "Revived",
      disposition: "Revive",
      machine,
      user: "a@b.c",
      ids: { line: "line-1", fit: "fit-1", removed: "sent-1", revive: "queue-1" },
    });
    assert.deepEqual(planned.movements.map((row) => row.type), ["REVIVED_PART_USED", "SENT_TO_REVIVE"]);
    assert.equal(planned.stockDelta, -1);
    assert.equal(planned.queueDelta, 1);
    assert.equal(planned.reviveItem.partCode, "0000018");
    assert.equal(planned.movements.every((row) => row.reversal === false), true);

    const withLine = {
      ...machine,
      intake: { refurb: { lines: [planned.line] } },
    };
    const undone = planUndoRefurbLine({
      machine: withLine,
      lineId: "line-1",
      reviveItem: { ...planned.reviveItem, status: "queued" },
      user: "a@b.c",
      ids: { fit: "fit-2", removed: "sent-2" },
    });
    assert.equal(undone.movements.length, 2);
    assert.equal(undone.movements[0].qty, -1);
    assert.equal(undone.movements[0].reversal, true);
    assert.equal(undone.movements[0].reversesId, "fit-1");
    assert.equal(undone.movements[1].type, "SENT_TO_REVIVE");
    assert.equal(undone.movements[1].reversesId, "sent-1");
    assert.equal(undone.nextLines[0].undone, true);
    assert.equal(planned.movements[0].id, "fit-1");
    assert.throws(
      () => planUndoRefurbLine({
        machine: withLine,
        lineId: "line-1",
        reviveItem: { status: "revived" },
        user: "a@b.c",
        ids: { fit: "a", removed: "b" },
      }),
      /left the revive queue/
    );
  });

  it("moves a queued part back to stock or to scrap", () => {
    const item = { id: "q", partCode: "0000018", qty: 1, machineNumber: "X33M002", cycle: 2, status: "queued" };
    const revived = planResolveRevive({ item, outcome: "revived", user: "a@b.c", id: "mov-1" });
    assert.equal(revived.movement.type, "REVIVED_TO_STOCK");
    assert.equal(revived.stockDelta, 1);
    assert.equal(revived.queueDelta, -1);
    const failed = planResolveRevive({ item, outcome: "failed", user: "a@b.c", id: "mov-2" });
    assert.equal(failed.movement.type, "SCRAPPED");
    assert.equal(failed.stockDelta, 0);
  });
});

describe("parts catalog seed", () => {
  const csv = readFileSync(new URL("../scripts/parts-catalog.csv", import.meta.url), "utf8");
  const parsed = parsePartsCsv(csv);

  it("keeps the IMS codes and the frequency defaults", () => {
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.parts.length, 112);
    assert.equal(parsed.parts.filter((part) => part.revivable).length, 30);
    assert.equal(parsed.parts.filter((part) => part.frequency === "common").length, 20);
    assert.equal(parsed.parts.filter((part) => part.frequency === "occasional").length, 10);
    const rope = parsed.parts.find((part) => part.code === "0000055");
    assert.equal(rope.unit, "mtr");
    assert.equal(rope.frequency, "common");
    assert.equal(parsed.parts.find((part) => part.code === "0000044").code, "0000044");
    assert.equal(parsed.parts.some((part) => part.code === "RM_TAB_MOUNT_SHAFT"), true);
    assert.equal(parsed.parts.find((part) => part.code === "0000056").name, "Hooks (carabiners)");
    assert.equal(partDisplayName({ code: "0000056", name: "Hooks" }), "Hooks (carabiners)");
    assert.deepEqual(
      parsed.parts.filter((part) => part.frequency === "common").map((part) => part.code).sort(),
      [...COMMON_CODE_ORDER].sort()
    );
  });

  it("does not overwrite admin revivable or frequency edits unless forced", () => {
    const row = parsed.parts.find((part) => part.code === "0000018");
    const existing = {
      code: "0000018",
      name: row.name,
      group: row.group,
      unit: row.unit,
      revivable: false,
      revivableEdited: true,
      frequency: "common",
      frequencyEdited: true,
      revivedStock: 4,
    };
    const kept = planSeedPart(existing, row, { force: false });
    assert.equal(kept.data.revivable, undefined);
    assert.equal(kept.data.frequency, undefined);
    assert.equal(kept.data.revivedStock, undefined);
    assert.equal(kept.skippedRevivable, true);
    assert.equal(kept.skippedFrequency, true);

    const forced = planSeedPart(existing, row, { force: true });
    assert.equal(forced.data.revivable, row.revivable);
    assert.equal(forced.data.frequency, row.frequency);
    assert.equal(forced.data.revivedStock, undefined);

    const renamed = planSeedPart(
      { ...existing, name: "Hooks", revivableEdited: false, frequencyEdited: false, frequency: null },
      { ...row, name: "Hooks (carabiners)" },
      { force: false }
    );
    assert.equal(renamed.data.name, "Hooks (carabiners)");
  });

  it("orders common chips before occasional, then the searchable list", () => {
    const { common, occasional, matches } = groupPartsForPicker(parsed.parts, "hook");
    assert.equal(common[0].code, "0000170");
    assert.equal(common.find((part) => part.code === "0000056").label, "Hooks (carabiners)");
    assert.equal(occasional[0].code, "0000047");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].code, "0000056");
    const plans = planCatalogSeed(parsed.parts, new Map(), {});
    assert.equal(plans.every((item) => item.action === "create"), true);
  });
});

describe("parts and movement endpoints", () => {
  function call(overrides) {
    return handleMachinesHttp({
      method: "GET",
      urlPath: "/parts",
      query: {},
      headers: { "x-api-key": "machines-read-key" },
      expectedKey: "machines-read-key",
      machines: [],
      stand: null,
      parts: [],
      movements: [],
      ...overrides,
    });
  }

  it("returns the catalog with revived stock and frequency, without staff fields", () => {
    const result = call({
      parts: [{
        id: "0000044",
        code: "0000044",
        name: "Slider Spacer",
        group: "Slider",
        unit: "pcs",
        revivable: false,
        frequency: "occasional",
        revivedStock: 0,
        updatedBy: "admin@example.com",
        revivableUpdatedBy: "admin@example.com",
        updatedAt: "2026-10-20T00:00:00.000Z",
      }, {
        id: "0000056",
        code: "0000056",
        name: "Hooks",
        group: "Main Sub",
        unit: "pcs",
        revivable: false,
        frequency: "common",
        revivedStock: 1,
        updatedAt: "2026-10-21T00:00:00.000Z",
      }],
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.parts[0].code, "0000044");
    assert.equal(result.body.parts[1].name, "Hooks (carabiners)");
    assert.equal(result.body.parts[1].revivedStock, 1);
    assert.equal(result.body.parts[1].frequency, "common");
    assert.equal(JSON.stringify(result.body).includes("admin@example.com"), false);
  });

  it("pages part movements by timestamp and filters type", () => {
    const movements = [
      { id: "a", type: "SCRAPPED", partCode: "0000041", qty: 1, machineNumber: "X33M002", cycle: 2, timestamp: "2026-10-01T00:00:00.000Z", user: "a@b.c", reversal: false, reversesId: "" },
      { id: "b", type: "SENT_TO_REVIVE", partCode: "0000018", qty: 1, machineNumber: "X33M002", cycle: 2, timestamp: "2026-10-02T00:00:00.000Z", user: "a@b.c", reversal: false, reversesId: "" },
      { id: "c", type: "SENT_TO_REVIVE", partCode: "0000018", qty: -1, machineNumber: "X33M002", cycle: 2, timestamp: "2026-10-03T00:00:00.000Z", user: "a@b.c", reversal: true, reversesId: "b" },
    ];
    const filtered = call({
      urlPath: "/part-movements",
      query: { type: "SENT_TO_REVIVE", updatedSince: "2026-10-02T00:00:00.000Z", limit: "1" },
      movements,
    });
    assert.equal(filtered.status, 200);
    assert.deepEqual(filtered.body.movements.map((row) => row.id), ["b"]);
    assert.equal(filtered.body.movements[0].reversal, false);
    const next = call({
      urlPath: "/v1/part-movements",
      query: { type: "SENT_TO_REVIVE", updatedSince: "2026-10-02T00:00:00.000Z", limit: "1", pageToken: filtered.body.nextPageToken },
      movements,
    });
    assert.deepEqual(next.body.movements.map((row) => ({ id: row.id, qty: row.qty, reversesId: row.reversesId })), [
      { id: "c", qty: -1, reversesId: "b" },
    ]);
    assert.equal(next.body.nextPageToken, null);
    assert.equal(call({ urlPath: "/part-movements", query: { type: "USED" }, movements }).status, 400);
    assert.equal(call({ method: "POST", urlPath: "/part-movements", movements }).status, 405);
  });

  it("filters machines by the new statuses", () => {
    const returned = {
      id: "r",
      machineNumber: "X33M040",
      updatedAt: "2026-10-20T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      intake: { recordedAt: "2026-10-20T00:00:00.000Z", refurb: { completedAt: "", lines: [] } },
      dispatch: { dispatched: false },
      delivery: { delivered: false },
      installation: { installed: false },
    };
    const result = call({
      urlPath: "/machines",
      query: { status: "Returned" },
      machines: [returned, { id: "a", machineNumber: "X33M001", updatedAt: "2026-10-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    assert.deepEqual(result.body.machines.map((machine) => machine.machineNumber), ["X33M040"]);
    assert.equal(result.body.machines[0].status, computeStatus(returned));
  });
});
