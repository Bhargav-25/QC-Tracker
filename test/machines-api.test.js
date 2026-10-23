import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STATUS } from "../src/constants.js";
import { keysMatch, presentedApiKey } from "../src/domain/apiKey.js";
import {
  batchFromMachineNumber,
  handleMachinesHttp,
  parseMachinesQuery,
  toPublicMachine,
} from "../src/domain/machinesHttp.js";
import { computeStatus } from "../src/utils/status.js";

const READ_KEY = "machines-read-key";
const ORDERS_KEY = "orders-write-key";
const SECRET_URL = "https://secret.example/machines/m1/rope.jpg";
const SECRET_PATH = "machines/m1/rope.jpg";
const SECRET_EMAIL = "person@example.com";

function headers(key, scheme = "x-api-key") {
  if (scheme === "bearer") return { authorization: `Bearer ${key}` };
  return { "x-api-key": key };
}

function call(overrides) {
  return handleMachinesHttp({
    method: "GET",
    urlPath: "/machines",
    query: {},
    headers: headers(READ_KEY),
    expectedKey: READ_KEY,
    machines: [],
    stand: null,
    ...overrides,
  });
}

const packedPhotos = {
  machineBolted: { url: SECRET_URL, path: SECRET_PATH },
  fastnersBox: { url: SECRET_URL, path: SECRET_PATH },
  frontCover: { url: SECRET_URL, path: SECRET_PATH },
  finalPacked: { url: SECRET_URL, path: SECRET_PATH },
};

function baseMachine(overrides = {}) {
  return {
    id: "m1",
    machineNumber: "X33M002",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    createdBy: SECRET_EMAIL,
    resistance: [{ current: 4, eccentric: "", concentric: "" }],
    temperature: { temp: "", time: "" },
    photos: { ropeBurn: [], shoulderPulley: [], led: [], armEnd: [] },
    packingChecklist: { ankleStrap: false },
    finalPacking: {
      machineBolted: null,
      fastnersBox: null,
      frontCover: null,
      finalPacked: null,
    },
    dispatch: { dispatched: false, date: "", comment: SECRET_URL, includeStand: false },
    delivery: { delivered: false, date: "" },
    installation: { installed: false, date: "", photos: [], video: null, installedBy: SECRET_EMAIL },
    warranty: { note: SECRET_URL },
    sectionMeta: {},
    ...overrides,
  };
}

describe("api key", () => {
  it("accepts the read key from X-API-Key or Authorization Bearer", () => {
    assert.equal(keysMatch(READ_KEY, presentedApiKey(headers(READ_KEY))), true);
    assert.equal(keysMatch(READ_KEY, presentedApiKey(headers(READ_KEY, "bearer"))), true);
  });

  it("rejects a missing key, a wrong key, and the orders write key", () => {
    assert.equal(keysMatch(READ_KEY, ""), false);
    assert.equal(keysMatch(READ_KEY, "nope"), false);
    assert.equal(keysMatch(READ_KEY, ORDERS_KEY), false);
    assert.equal(keysMatch(ORDERS_KEY, READ_KEY), false);
    assert.equal(keysMatch("", READ_KEY), false);
    assert.equal(keysMatch(READ_KEY, "x".repeat(300)), false);
    assert.equal(presentedApiKey({}), "");
  });
});

describe("machines read API", () => {
  it("returns 401 without echoing machine data", () => {
    const result = call({
      headers: headers(ORDERS_KEY),
      machines: [baseMachine()],
    });
    assert.equal(result.status, 401);
    assert.equal(JSON.stringify(result.body).includes("X33M002"), false);
    assert.equal(JSON.stringify(result.body).includes(SECRET_URL), false);
  });

  it("returns 405 for writes and does not include a machine", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const result = call({ method, machines: [baseMachine()] });
      assert.equal(result.status, 405);
      assert.equal(result.allow, "GET");
      assert.equal(result.body.machine, undefined);
      assert.equal(result.body.machines, undefined);
    }
  });

  it("uses the same status as the app for every stage", () => {
    const stages = [
      baseMachine(),
      baseMachine({
        resistance: [{ current: 4, eccentric: "1", concentric: "" }],
        sectionMeta: { resistance: { updatedAt: "2026-01-05T00:00:00.000Z", updatedBy: SECRET_EMAIL } },
      }),
      baseMachine({
        finalPacking: packedPhotos,
        sectionMeta: { finalPacking: { updatedAt: "2026-01-20T00:00:00.000Z" } },
      }),
      baseMachine({
        finalPacking: packedPhotos,
        dispatch: { dispatched: true, date: "2026-02-02", includeStand: true, courier: "Safexpress", trackingNumber: "1847" },
        sectionMeta: { dispatch: { updatedAt: "2026-02-02T00:00:00.000Z" }, finalPacking: { updatedAt: "2026-01-20T00:00:00.000Z" } },
      }),
      baseMachine({
        finalPacking: packedPhotos,
        dispatch: { dispatched: true, date: "2026-02-02" },
        delivery: { delivered: true, date: "2026-02-10" },
        sectionMeta: { delivery: { updatedAt: "2026-02-10T00:00:00.000Z" } },
      }),
      baseMachine({
        finalPacking: packedPhotos,
        dispatch: { dispatched: true, date: "2026-02-02" },
        delivery: { delivered: true, date: "2026-02-10" },
        installation: {
          installed: true,
          date: "2026-02-12",
          photos: [{ url: SECRET_URL, path: SECRET_PATH }, null, { url: SECRET_URL, path: SECRET_PATH }],
          video: { url: SECRET_URL, path: SECRET_PATH },
        },
        sectionMeta: { installation: { updatedAt: "2026-02-12T00:00:00.000Z" } },
      }),
    ];
    for (const machine of stages) {
      assert.equal(toPublicMachine(machine).status, computeStatus(machine));
    }
    assert.equal(toPublicMachine(stages[0]).status, STATUS.ASSEMBLY);
    assert.equal(toPublicMachine(stages[1]).status, STATUS.TESTING);
    assert.equal(toPublicMachine(stages[2]).status, STATUS.PACKED);
    assert.equal(toPublicMachine(stages[3]).status, STATUS.DISPATCHED);
    assert.equal(toPublicMachine(stages[4]).status, STATUS.DELIVERED);
    assert.equal(toPublicMachine(stages[5]).status, STATUS.INSTALLED);
  });

  it("estimates when each status was reached and keeps every section timestamp", () => {
    const machine = baseMachine({
      photos: { ropeBurn: [{ url: SECRET_URL, path: SECRET_PATH }, { url: SECRET_URL, path: SECRET_PATH }] },
      finalPacking: packedPhotos,
      dispatch: {
        dispatched: true,
        date: "2026-03-01",
        includeStand: true,
        courier: "Delhivery",
        trackingNumber: "TRK1",
        accessoriesSeparate: true,
        accessoriesCourier: "Smartr",
        accessoriesTracking: "ACC1",
        accessoriesSentOn: "2026-03-02",
        accessoriesStatus: "In transit",
        comment: SECRET_URL,
      },
      groupNumber: "G1458",
      sectionMeta: {
        resistance: { updatedAt: "2026-01-08T00:00:00.000Z", updatedBy: SECRET_EMAIL },
        photos: { updatedAt: { toDate: () => new Date("2026-01-04T00:00:00.000Z") }, updatedBy: SECRET_EMAIL },
        finalPacking: { updatedAt: "2026-01-20T12:00:00.000Z" },
        dispatch: { updatedAt: "2026-03-01T08:00:00.000Z" },
      },
    });
    const pub = toPublicMachine(machine);
    assert.equal(pub.status, computeStatus(machine));
    assert.equal(pub.batch, 33);
    assert.equal(pub.groupNo, "G1458");
    assert.equal(pub.photos.ropeBurn, 2);
    assert.equal(pub.photos.led, 0);
    assert.equal(pub.finalPacking.machineBolted, true);
    assert.equal(pub.finalPacking.fastnersBox, true);
    assert.deepEqual(pub.dispatch, {
      dispatched: true,
      date: "2026-03-01",
      includeStand: true,
      courier: "Delhivery",
      trackingNumber: "TRK1",
      accessoriesSeparate: true,
      accessoriesCourier: "Smartr",
      accessoriesTracking: "ACC1",
      accessoriesSentOn: "2026-03-02",
      accessoriesStatus: "In transit",
    });
    assert.equal(pub.statusReachedAt[STATUS.ASSEMBLY], "2026-01-01T00:00:00.000Z");
    assert.equal(pub.statusReachedAt[STATUS.TESTING], "2026-01-04T00:00:00.000Z");
    assert.equal(pub.statusReachedAt[STATUS.PACKED], "2026-01-20T12:00:00.000Z");
    assert.equal(pub.statusReachedAt[STATUS.DISPATCHED], "2026-03-01T08:00:00.000Z");
    assert.equal(pub.statusReachedAt[STATUS.DELIVERED], null);
    assert.equal(pub.statusReachedAt[STATUS.INSTALLED], null);
    assert.equal(pub.sectionTimestamps.photos, "2026-01-04T00:00:00.000Z");
    assert.equal(pub.sectionTimestamps.resistance, "2026-01-08T00:00:00.000Z");
    assert.equal(pub.sectionTimestamps.temperature, null);
    assert.equal(batchFromMachineNumber("not-a-machine"), null);
  });

  it("leaves Packed unset until all four final-packing photos exist", () => {
    const partial = baseMachine({
      finalPacking: { ...packedPhotos, finalPacked: null },
      sectionMeta: { finalPacking: { updatedAt: "2026-01-20T00:00:00.000Z" } },
    });
    const pub = toPublicMachine(partial);
    assert.equal(pub.status, STATUS.TESTING);
    assert.equal(pub.status, computeStatus(partial));
    assert.equal(pub.statusReachedAt[STATUS.PACKED], null);
    assert.equal(pub.finalPacking.finalPacked, false);
    assert.equal(pub.finalPacking.machineBolted, true);
  });

  it("does not return urls, storage paths, or staff emails", () => {
    const machine = baseMachine({
      photos: {
        ropeBurn: [{ url: SECRET_URL, path: SECRET_PATH }],
        shoulderPulley: [],
        led: [],
        armEnd: [],
      },
      finalPacking: packedPhotos,
      installation: {
        installed: true,
        date: "2026-02-12",
        photos: [{ url: SECRET_URL, path: SECRET_PATH }],
        video: { url: "https://secret.example/video.mp4", path: "machines/m1/video.mp4" },
        location: { lat: 1, lng: 2 },
      },
      sectionMeta: { photos: { updatedAt: "2026-01-04T00:00:00.000Z", updatedBy: SECRET_EMAIL } },
    });
    const pub = toPublicMachine(machine);
    const encoded = JSON.stringify(pub);
    assert.equal(pub.installationPhotos, 1);
    assert.equal(pub.hasVideo, true);
    for (const leak of [SECRET_URL, SECRET_PATH, SECRET_EMAIL, "video.mp4", "firebasestorage", "https://", "gs://"]) {
      assert.equal(encoded.includes(leak), false, leak);
    }
    const keys = [];
    JSON.stringify(pub, (key, value) => {
      keys.push(key);
      return value;
    });
    assert.equal(keys.some((key) => /url|path|storage/i.test(key)), false);
  });

  it("filters by updatedSince and status, then pages in updatedAt, id order", () => {
    const machines = [
      baseMachine({ id: "b", machineNumber: "X33M002", updatedAt: "2026-04-02T00:00:00.000Z" }),
      baseMachine({
        id: "a",
        machineNumber: "X34M010",
        updatedAt: "2026-04-02T00:00:00.000Z",
        finalPacking: packedPhotos,
      }),
      baseMachine({
        id: "c",
        machineNumber: "X10M001",
        updatedAt: "2026-03-01T00:00:00.000Z",
        dispatch: { dispatched: true, date: "2026-03-01" },
        finalPacking: packedPhotos,
      }),
      baseMachine({ id: "d", machineNumber: "DEMO", updatedAt: "2026-01-01T00:00:00.000Z" }),
    ];

    const filtered = call({
      query: { updatedSince: "2026-03-01T00:00:00.000Z", status: "Packed, Dispatched" },
      machines,
    });
    assert.equal(filtered.status, 200);
    assert.deepEqual(
      filtered.body.machines.map((machine) => machine.machineNumber),
      ["X10M001", "X34M010"]
    );
    assert.equal(filtered.body.machines[0].status, STATUS.DISPATCHED);
    assert.equal(filtered.body.machines[1].status, STATUS.PACKED);
    assert.equal(filtered.body.machines[1].batch, 34);
    assert.equal(filtered.body.nextPageToken, null);

    const first = call({ query: { limit: "1", status: "Assembly" }, machines });
    assert.equal(first.body.machines.map((machine) => machine.id).join(), "d");
    const second = call({
      query: { limit: "1", status: "Assembly", pageToken: first.body.nextPageToken },
      machines,
    });
    assert.deepEqual(second.body.machines.map((machine) => machine.id), ["b"]);
    assert.equal(second.body.nextPageToken, null);

    assert.equal(parseMachinesQuery({}).limit, 200);
    assert.equal(parseMachinesQuery({ limit: "5000" }).limit, 1000);
    assert.equal(call({ query: { limit: "0" } }).status, 400);
    assert.equal(call({ query: { updatedSince: "yesterday" } }).status, 400);
    assert.equal(call({ query: { status: "Shipped" } }).status, 400);
    assert.equal(call({ query: { pageToken: "!!!" } }).status, 400);
    assert.equal(call({ query: { status: "Assembly" }, machines }).body.machines.length, 2);
  });

  it("reads one machine and the stand count", () => {
    const machines = [
      baseMachine({ id: "old", updatedAt: "2026-01-01T00:00:00.000Z" }),
      baseMachine({ id: "new", updatedAt: "2026-06-01T00:00:00.000Z", groupNumber: "G9" }),
    ];
    const one = call({ urlPath: "/machines/x33m002", machines });
    assert.equal(one.status, 200);
    assert.equal(one.body.machine.id, "new");
    assert.equal(one.body.machine.groupNo, "G9");
    assert.equal(one.body.machine.machineNumber, "X33M002");

    const missing = call({ urlPath: "/machines/X99M000", machines });
    assert.equal(missing.status, 404);

    const stand = call({
      urlPath: "/inventory/machine-stand",
      stand: { count: 6, updatedAt: "2026-05-01T00:00:00.000Z", note: SECRET_URL },
    });
    assert.deepEqual(stand.body, {
      ok: true,
      count: 6,
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    const empty = call({ urlPath: "/v1/inventory/machine-stand" });
    assert.deepEqual(empty.body, { ok: true, count: 0, updatedAt: null });
  });
});

describe("machines function source", () => {
  const src = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const apiBlock = src.slice(src.indexOf("export const api"), src.indexOf("async function syncGroups"));
  const machinesBlock = src.slice(src.indexOf("export const machinesApi"), src.indexOf("export const syncOrderToSheet"));

  it("keeps the read key off the orders function and the write key off the machines function", () => {
    assert.match(apiBlock, /secrets:\s*\[ordersApiKey\]/);
    assert.equal(apiBlock.includes("machinesReadApiKey"), false);
    assert.match(machinesBlock, /secrets:\s*\[machinesReadApiKey\]/);
    assert.equal(machinesBlock.includes("ordersApiKey"), false);
  });

  it("only reads Firestore from the machines handler", () => {
    assert.match(machinesBlock, /\.get\(/);
    assert.equal(/\.(set|update|delete|create|add)\(/.test(machinesBlock), false);
  });
});
