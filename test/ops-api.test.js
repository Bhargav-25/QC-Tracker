import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STATUS } from "../src/constants.js";
import { keysMatch } from "../src/domain/apiKey.js";
import {
  MAX_INSTALLATION_PHOTO_BYTES,
  OPS_ACTOR,
  OPS_AUDIT_ACTOR,
  SERVER_TIMESTAMP,
  applyOpsWrite,
  buildMachineUpdate,
  handleOpsHttp,
  installationPhotoPath,
  placeInstallationPhoto,
  todayIst,
} from "../src/domain/opsHttp.js";
import { toPublicMachine } from "../src/domain/machinesHttp.js";
import { computeStatus } from "../src/utils/status.js";

const OPS_KEY = "ops-write-key";
const ORDERS_KEY = "orders-write-key";
const READ_KEY = "machines-read-key";
const SECRET = "do-not-leak";
const NOW = new Date("2026-10-26T18:29:00.000Z"); // 23:59 IST, still 26 Oct
const NEXT_IST_DAY = new Date("2026-10-26T18:30:00.000Z"); // 00:00 IST on 27 Oct

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20, 1)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16, 2),
]);

function headers(key, scheme = "x-api-key") {
  if (scheme === "bearer") return { authorization: `Bearer ${key}` };
  return { "x-api-key": key };
}

function packed(overrides = {}) {
  return {
    id: "m1",
    machineNumber: "X34M005",
    groupNumber: "G1435",
    updatedAt: "2026-10-01T00:00:00.000Z",
    resistance: [{ current: 4, eccentric: SECRET, concentric: "" }],
    photos: { ropeBurn: [{ url: SECRET, path: SECRET }] },
    finalPacking: {
      machineBolted: { url: SECRET },
      fastnersBox: { url: SECRET },
      frontCover: { url: SECRET },
      finalPacked: { url: SECRET },
    },
    dispatch: {
      dispatched: false,
      date: "",
      comment: "keep-me",
      includeStand: true,
      courier: "",
      trackingNumber: "",
      accessoriesSeparate: true,
      accessoriesCourier: "Delhivery",
      accessoriesTracking: "ACC",
      accessoriesSentOn: "2026-10-01",
      accessoriesStatus: "In transit",
    },
    delivery: { delivered: false, date: "" },
    installation: {
      installed: false,
      date: "",
      photos: [{ url: SECRET, path: "machines/m1/installation/old.jpg" }, null],
      video: { url: SECRET, path: "machines/m1/installation/old.mp4" },
      installedBy: "",
    },
    sectionMeta: { finalPacking: { updatedAt: "2026-10-01T00:00:00.000Z", updatedBy: "production@example.com" } },
    ...overrides,
  };
}

function call(overrides = {}) {
  return handleOpsHttp({
    method: "POST",
    urlPath: "/v1/machines/X34M005/dispatch",
    headers: headers(OPS_KEY),
    body: { courier: "DP World", trackingNumber: "DP9981" },
    expectedKey: OPS_KEY,
    machines: [packed()],
    orders: [],
    order: null,
    now: NOW,
    ...overrides,
  });
}

describe("ops function source", () => {
  const ops = readFileSync(new URL("../functions/opsApi.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");

  it("exports a separate function whose only secret is the ops write key", () => {
    assert.match(index, /export \{ opsApi \} from "\.\/opsApi\.js"/);
    assert.match(ops, /defineSecret\("OPS_WRITE_API_KEY"\)/);
    assert.match(ops, /secrets:\s*\[opsWriteApiKey\]/);
    assert.equal(ops.includes("ordersApiKey"), false);
    assert.equal(ops.includes("machinesReadApiKey"), false);
  });

  it("writes the audit log in the same batch or transaction as the machine change", () => {
    assert.match(ops, /audit\.userEmail !== OPS_AUDIT_ACTOR/);
    assert.match(ops, /timestamp: FieldValue\.serverTimestamp\(\)/);
    assert.equal(ops.includes("async function writeAudit"), false);
    assert.equal(ops.includes("console.warn"), true);

    const apply = ops.slice(ops.indexOf("async function applyWrite"), ops.indexOf("async function commitPhoto"));
    assert.match(apply, /const batch = db\.batch\(\)/);
    assert.match(apply, /batch\.update\(db\.collection\("machines"\)/);
    assert.match(apply, /batch\.set\(db\.collection\("auditLog"\)\.doc\(\), auditWrite\(write\.audit\)\)/);
    const commitAt = apply.indexOf("await batch.commit()");
    const syncAt = apply.indexOf("await syncFulfillment");
    assert.ok(commitAt > 0 && syncAt > commitAt);

    const photo = ops.slice(ops.indexOf("async function commitPhoto"), ops.indexOf("async function commitAssign"));
    const auditRefAt = photo.indexOf('const auditRef = db.collection("auditLog").doc()');
    const txAt = photo.indexOf("await db.runTransaction");
    const updateAt = photo.indexOf("tx.update(");
    const setAt = photo.indexOf("tx.set(auditRef, auditWrite(upload.audit))");
    assert.ok(auditRefAt > 0 && auditRefAt < txAt && updateAt > txAt && setAt > updateAt);
    assert.equal(photo.slice(0, setAt).includes("tx.set(auditRef"), false);

    const assign = ops.slice(ops.indexOf("async function commitAssign"), ops.indexOf("export const opsApi"));
    const assignTx = assign.indexOf("await db.runTransaction");
    const replan = assign.indexOf("planAssign(");
    const machineUpdate = assign.indexOf('tx.update(\n      db.collection("machines")');
    const orderSet = assign.indexOf('tx.set(db.collection("orders")');
    const orderUpdate = assign.indexOf('tx.update(db.collection("orders")');
    const auditSet = assign.indexOf("tx.set(auditRef, auditWrite(plan.audit))");
    assert.ok(assignTx > 0 && replan > assignTx && machineUpdate > replan);
    assert.ok(orderSet > machineUpdate && orderUpdate > orderSet && auditSet > orderUpdate);
  });
});

describe("ops api auth", () => {
  it("accepts only the ops key, from X-API-Key or Bearer", () => {
    assert.equal(keysMatch(OPS_KEY, ORDERS_KEY), false);
    assert.equal(keysMatch(OPS_KEY, READ_KEY), false);
    const bearer = call({ headers: headers(OPS_KEY, "bearer") });
    assert.equal(bearer.status, 200);
    for (const key of ["", ORDERS_KEY, READ_KEY, "nope"]) {
      const result = call({ headers: headers(key), expectedKey: key === "" ? "" : OPS_KEY });
      assert.equal(result.status, 401);
      const body = JSON.stringify(result.body);
      assert.equal(body.includes("X34M005"), false);
      assert.equal(body.includes(SECRET), false);
      assert.equal(result.write, undefined);
    }
  });
});

describe("ops api lookup", () => {
  it("returns machine number and status for a group, and nothing else", () => {
    const result = call({
      method: "GET",
      urlPath: "/v1/groups/G1435",
      body: {},
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      ok: true,
      machineNumber: "X34M005",
      machineId: "m1",
      groupNumber: "G1435",
      status: STATUS.PACKED,
    });
    assert.equal(JSON.stringify(result.body).includes(SECRET), false);
  });

  it("prefers the order's machine link over another machine with the same group number", () => {
    const other = packed({ id: "m-other", machineNumber: "X34M099", updatedAt: "2026-10-20T00:00:00.000Z" });
    const linked = packed({ id: "m-linked", machineNumber: "X34M005", groupNumber: "" });
    const result = call({
      method: "GET",
      urlPath: "/groups/G1435",
      machines: [other, linked],
      order: { id: "G1435", groupNumber: "G1435", machineId: "m-linked", machineNumber: "X34M005" },
    });
    assert.equal(result.body.machineNumber, "X34M005");
    assert.equal(result.body.machineId, "m-linked");
  });

  it("uses the order machine number, then a machine.groupNumber, and rejects an ambiguous group", () => {
    const byNumber = call({
      method: "GET",
      urlPath: "/v1/groups/G1435",
      machines: [packed({ groupNumber: "" })],
      order: { id: "G1435", groupNumber: "G1435", machineId: "", machineNumber: "X34M005" },
    });
    assert.equal(byNumber.body.machineId, "m1");

    const byGroup = call({
      method: "GET",
      urlPath: "/v1/groups/G1435",
      machines: [packed()],
      order: { id: "G1435", groupNumber: "G1435", machineId: "", machineNumber: "" },
    });
    assert.equal(byGroup.body.machineNumber, "X34M005");

    const ambiguous = call({
      method: "GET",
      urlPath: "/v1/groups/G1435",
      machines: [packed(), packed({ id: "m2", machineNumber: "X34M006" })],
      order: null,
    });
    assert.equal(ambiguous.status, 409);
    assert.match(ambiguous.body.error, /More than one machine/);
  });

  it("decodes a group number that contains a slash and 404s when nothing is linked", () => {
    const found = call({
      method: "GET",
      urlPath: "/v1/groups/G338%2F9",
      machines: [packed({ groupNumber: "G338/9" })],
      order: { id: "G338~9", groupNumber: "G338/9", machineId: "m1", machineNumber: "X34M005" },
    });
    assert.equal(found.status, 200);
    assert.equal(found.body.groupNumber, "G338/9");

    const missing = call({ method: "GET", urlPath: "/v1/groups/G9999", machines: [], order: null });
    assert.equal(missing.status, 404);
    assert.match(missing.body.error, /No machine linked to G9999/);
  });
});

describe("ops api dispatch", () => {
  it("fills the dispatch section the way the app does and stamps who wrote it", () => {
    const machine = packed();
    const result = call({
      machines: [machine],
      body: {
        shipper: "DP World",
        trackingNumber: "DP9981",
        trackingUrl: "https://track.example/DP9981",
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.unchanged, false);
    assert.equal(result.body.status, STATUS.DISPATCHED);
    assert.equal(result.body.updatedBy, OPS_ACTOR);
    assert.equal(result.body.dispatch.courier, "DP World");
    assert.equal(result.body.dispatch.date, "2026-10-26");
    assert.deepEqual(Object.keys(result.write.fields).sort(), ["dispatch", "updatedBy"]);
    assert.equal(result.write.fields.updatedBy, OPS_ACTOR);
    assert.equal(result.write.sectionStamps.length, 1);
    assert.equal(result.write.sectionStamps[0], "dispatch");
    assert.equal(result.write.fulfillmentStatus, STATUS.DISPATCHED);
    assert.equal(OPS_AUDIT_ACTOR, "ops-bot");
    assert.deepEqual(result.write.audit, {
      userEmail: "ops-bot",
      machineId: "m1",
      machineNumber: "X34M005",
      groupNumber: "G1435",
      section: "dispatch",
      action:
        "marked dispatched X34M005 group G1435: status Packed → Dispatched courier — → DP World tracking — → DP9981 link — → https://track.example/DP9981 date — → 2026-10-26",
    });
    assert.equal(Object.hasOwn(result.write.audit, "timestamp"), false);

    const dispatch = result.write.fields.dispatch;
    assert.equal(dispatch.dispatched, true);
    assert.equal(dispatch.comment, "keep-me");
    assert.equal(dispatch.includeStand, true);
    assert.equal(dispatch.accessoriesCourier, "Delhivery");
    assert.equal(dispatch.accessoriesTracking, "ACC");
    assert.equal(dispatch.trackingLink, "https://track.example/DP9981");
    assert.equal(result.write.fields.resistance, undefined);
    assert.equal(result.write.fields.photos, undefined);
    assert.equal(result.write.fields.finalPacking, undefined);
    assert.equal(result.write.fields.delivery, undefined);

    const update = buildMachineUpdate(result.write);
    assert.equal(update.updatedAt, SERVER_TIMESTAMP);
    assert.equal(update["sectionMeta.dispatch"].updatedBy, OPS_ACTOR);
    assert.equal(update["sectionMeta.dispatch"].updatedAt, SERVER_TIMESTAMP);
    assert.equal(Object.hasOwn(update, "sectionMeta"), false);
    assert.equal(update.resistance, undefined);

    const projected = applyOpsWrite(machine, result.write, NOW.toISOString());
    assert.equal(computeStatus(projected), STATUS.DISPATCHED);
    assert.equal(toPublicMachine(projected).status, STATUS.DISPATCHED);
    assert.equal(toPublicMachine(projected).statusReachedAt[STATUS.DISPATCHED], NOW.toISOString());
    assert.equal(toPublicMachine(projected).sectionTimestamps.dispatch, NOW.toISOString());
    assert.equal(toPublicMachine(projected).sectionTimestamps.finalPacking, "2026-10-01T00:00:00.000Z");
    assert.equal(projected.resistance[0].eccentric, SECRET);
  });

  it("defaults the date to today in IST and keeps a date that was already stored", () => {
    assert.equal(todayIst(NOW), "2026-10-26");
    assert.equal(todayIst(NEXT_IST_DAY), "2026-10-27");
    const rolled = call({ now: NEXT_IST_DAY, body: { courier: "Allcargo", trackingLink: "https://track.example/a" } });
    assert.equal(rolled.body.dispatch.date, "2026-10-27");
    assert.equal(rolled.body.dispatch.trackingNumber, "https://track.example/a");
    assert.equal(rolled.body.dispatch.courier, "Allcargo");

    const kept = call({
      now: NEXT_IST_DAY,
      machines: [packed({ dispatch: { ...packed().dispatch, date: "2026-10-20" } })],
      body: { courier: "Delhivery", trackingNumber: "7788" },
    });
    assert.equal(kept.body.dispatch.date, "2026-10-20");
  });

  it("is idempotent when the same tracking is sent again", () => {
    const first = call();
    const machine = applyOpsWrite(packed(), first.write, NOW.toISOString());
    const second = call({ machines: [machine], now: NEXT_IST_DAY });
    assert.equal(second.status, 200);
    assert.equal(second.body.unchanged, true);
    assert.equal(second.write, undefined);
    assert.equal(second.upload, undefined);
    assert.equal(second.body.dispatch.date, "2026-10-26");
    assert.equal(second.body.status, STATUS.DISPATCHED);

    const changed = call({
      machines: [machine],
      body: { courier: "DP World", trackingNumber: "NEW-1" },
    });
    assert.equal(changed.body.unchanged, false);
    assert.equal(changed.write.fields.dispatch.trackingNumber, "NEW-1");
    assert.equal(changed.write.fields.dispatch.comment, "keep-me");
    assert.equal(changed.write.fields.dispatch.includeStand, true);
    assert.equal(changed.write.audit.userEmail, "ops-bot");
    assert.equal(changed.write.audit.groupNumber, "G1435");
    assert.match(changed.write.audit.action, /^updated dispatch X34M005 group G1435: /);
    assert.match(changed.write.audit.action, /status Dispatched → Dispatched/);
    assert.match(changed.write.audit.action, /courier DP World → DP World/);
    assert.match(changed.write.audit.action, /tracking DP9981 → NEW-1/);
    assert.match(changed.write.audit.action, /link — → —/);
    assert.match(changed.write.audit.action, /date 2026-10-26 → 2026-10-26/);
    assert.equal(changed.write.fulfillmentStatus, null);
    assert.equal(Object.keys(changed.write.fields).sort().join(), "dispatch,updatedBy");
  });

  it("rejects missing tracking, bad links, and any field outside dispatch", () => {
    assert.equal(call({ body: { courier: "DP World" } }).status, 400);
    assert.equal(call({ body: { trackingNumber: "1" } }).status, 400);
    assert.equal(call({ body: { courier: "DP World", trackingLink: "javascript:alert(1)" } }).status, 400);
    const extra = call({ body: { courier: "DP World", trackingNumber: "1", resistance: [] } });
    assert.equal(extra.status, 400);
    assert.equal(extra.write, undefined);
    assert.equal(extra.upload, undefined);
    assert.match(extra.body.error, /courier, trackingNumber, trackingLink, and date/);
    const badDate = call({ body: { courier: "DP World", trackingNumber: "1", date: "26-10-2026" } });
    assert.equal(badDate.status, 400);
  });

  it("addresses the machine by number or group and does not allow other methods", () => {
    const byGroup = call({
      urlPath: "/opsApi/v1/groups/G1435/dispatch",
      order: { id: "G1435", groupNumber: "G1435", machineId: "m1", machineNumber: "X34M005" },
    });
    assert.equal(byGroup.status, 200);
    assert.equal(byGroup.body.machineNumber, "X34M005");

    const removed = call({ method: "DELETE" });
    assert.equal(removed.status, 405);
    assert.equal(removed.allow, "POST");
    const lookupWrite = call({ method: "POST", urlPath: "/v1/groups/G1435" });
    assert.equal(lookupWrite.status, 405);
    assert.equal(lookupWrite.allow, "GET");
    assert.equal(call({ urlPath: "/v1/machines/X34M005" }).status, 404);
    assert.equal(call({ urlPath: "/v1/machines/nope/dispatch", machines: [packed()] }).status, 404);
  });
});

describe("ops api installation", () => {
  it("refuses to mark installed until the machine is dispatched or delivered", () => {
    const blocked = call({ urlPath: "/v1/machines/X34M005/installation", body: {} });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /Packed/);
    assert.match(blocked.body.error, /X34M005/);
    assert.equal(blocked.write, undefined);
    assert.equal(blocked.upload, undefined);

    const photos = call({
      urlPath: "/v1/machines/X34M005/installation/photos",
      body: { data: JPEG.toString("base64"), contentType: "image/jpeg" },
    });
    assert.equal(photos.status, 409);
    assert.equal(photos.write, undefined);
    assert.equal(photos.upload, undefined);
  });

  it("marks a dispatched machine installed and keeps photos, video, and the dispatch section", () => {
    const machine = packed({
      dispatch: { dispatched: true, date: "2026-10-20", courier: "DP World", trackingNumber: "DP9981", comment: "keep-me" },
    });
    const result = call({
      urlPath: "/v1/groups/G1435/installation",
      machines: [machine],
      order: { id: "G1435", groupNumber: "G1435", machineId: "m1", machineNumber: "X34M005" },
      body: { notes: "Lobby install\ncustomer present", installer: "Ravi" },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.status, STATUS.INSTALLED);
    assert.equal(result.body.installation.date, "2026-10-26");
    assert.equal(result.body.installation.installedBy, "Ravi");
    assert.equal(result.body.installation.notes, "Lobby install\ncustomer present");
    assert.equal(result.body.updatedBy, OPS_ACTOR);
    assert.deepEqual(result.write.fields.installation.photos, machine.installation.photos);
    assert.deepEqual(result.write.fields.installation.video, machine.installation.video);
    assert.equal(result.write.fields.dispatch, undefined);
    assert.equal(result.write.sectionStamps[0], "installation");
    assert.equal(result.write.fulfillmentStatus, STATUS.INSTALLED);
    assert.equal(result.write.audit.userEmail, "ops-bot");
    assert.equal(result.write.audit.machineNumber, "X34M005");
    assert.equal(result.write.audit.groupNumber, "G1435");
    assert.equal(result.write.audit.section, "installation");
    assert.match(
      result.write.audit.action,
      /^marked installed X34M005 group G1435: status Dispatched → Installed date — → 2026-10-26 /
    );
    assert.match(result.write.audit.action, /installer — → Ravi/);
    assert.match(result.write.audit.action, /notes — → Lobby install\ncustomer present/);

    const projected = applyOpsWrite(machine, result.write, NOW.toISOString());
    assert.equal(computeStatus(projected), STATUS.INSTALLED);
    assert.equal(toPublicMachine(projected).statusReachedAt[STATUS.INSTALLED], NOW.toISOString());
    assert.equal(projected.dispatch.courier, "DP World");
    assert.equal(projected.photos.ropeBurn[0].url, SECRET);

    const again = call({
      urlPath: "/v1/machines/X34M005/installation",
      machines: [projected],
      now: NEXT_IST_DAY,
      body: { notes: "Lobby install\ncustomer present", installer: "Ravi" },
    });
    assert.equal(again.body.unchanged, true);
    assert.equal(again.write, undefined);
    assert.equal(again.body.installation.date, "2026-10-26");

    const moved = call({
      urlPath: "/v1/machines/X34M005/installation",
      machines: [projected],
      body: { date: "2026-10-27", installer: "Ravi", notes: "Lobby install\ncustomer present" },
    });
    assert.match(moved.write.audit.action, /^updated installation X34M005 group G1435: /);
    assert.match(moved.write.audit.action, /status Installed → Installed/);
    assert.match(moved.write.audit.action, /date 2026-10-26 → 2026-10-27/);
    assert.equal(moved.write.audit.action.includes("installer"), false);
    assert.equal(moved.write.audit.action.includes("notes"), false);
  });

  it("allows installation after delivery when dispatch was not flagged", () => {
    const machine = packed({
      delivery: { delivered: true, date: "2026-10-24" },
    });
    const result = call({
      urlPath: "/v1/machines/X34M005/installation",
      machines: [machine],
      body: { date: "2026-10-25" },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.installation.date, "2026-10-25");
    assert.equal(result.body.status, STATUS.INSTALLED);
    assert.match(result.write.audit.action, /status Delivered → Installed/);
    assert.match(result.write.audit.action, /date — → 2026-10-25/);
    assert.equal(result.write.audit.userEmail, "ops-bot");
  });
});

describe("ops api installation photos", () => {
  const dispatched = () =>
    packed({
      dispatch: { dispatched: true, date: "2026-10-20", courier: "DP World", trackingNumber: "1" },
    });

  it("plans one image onto the app's installation path and fills an empty slot", () => {
    assert.equal(MAX_INSTALLATION_PHOTO_BYTES, 8 * 1024 * 1024);
    const machine = dispatched();
    const result = call({
      urlPath: "/v1/machines/X34M005/installation/photos",
      machines: [machine],
      body: {
        filename: "../../My Photo.JPG",
        contentType: "image/jpeg",
        data: JPEG.toString("base64"),
        id: "job-42",
      },
    });
    assert.equal(result.status, 201);
    assert.equal(result.body, undefined);
    assert.equal(result.upload.contentType, "image/jpeg");
    assert.equal(result.upload.entry.clientId, "job-42");
    assert.equal(result.upload.entry.lat, null);
    assert.equal(result.upload.entry.lng, null);
    assert.equal(result.upload.contentHash, createHash("sha256").update(JPEG).digest("hex"));
    assert.equal(result.upload.path.includes(".."), false);
    assert.equal(
      result.upload.path,
      installationPhotoPath(machine.id, "My_Photo.jpg", NOW.getTime())
    );
    assert.match(result.upload.path, /^machines\/m1\/installation\/\d+-My_Photo\.jpg$/);
    assert.deepEqual(result.upload.sectionStamps, ["installation"]);
    assert.equal(result.upload.audit.userEmail, "ops-bot");
    assert.equal(result.upload.audit.machineId, "m1");
    assert.equal(result.upload.audit.machineNumber, "X34M005");
    assert.equal(result.upload.audit.groupNumber, "G1435");
    assert.equal(result.upload.audit.section, "installation");
    assert.equal(
      result.upload.audit.action,
      `uploaded installation photo My_Photo.jpg sha256 ${result.upload.contentHash} on X34M005 group G1435`
    );

    const placed = placeInstallationPhoto(machine, result.upload.entry);
    assert.equal(placed.photos[1], result.upload.entry);
    assert.equal(placed.photos[0].path, "machines/m1/installation/old.jpg");
    assert.equal(computeStatus({ ...machine, installation: { ...machine.installation, photos: placed.photos } }), STATUS.DISPATCHED);
  });

  it("does not add a second photo when the bytes or the client id were already stored", () => {
    const hash = createHash("sha256").update(JPEG).digest("hex");
    const existing = {
      url: "https://example.com/already.jpg",
      path: "machines/m1/installation/1-a.jpg",
      contentHash: hash,
      clientId: "job-42",
    };
    const machine = dispatched();
    machine.installation = { ...machine.installation, photos: [existing] };
    const byHash = call({
      urlPath: "/v1/machines/X34M005/installation/photos",
      machines: [machine],
      body: { data: JPEG.toString("base64"), contentType: "image/jpeg", id: "other-id" },
    });
    assert.equal(byHash.status, 200);
    assert.equal(byHash.body.duplicate, true);
    assert.equal(byHash.body.photo.path, existing.path);
    assert.equal(byHash.upload, undefined);
    assert.equal(byHash.write, undefined);

    const other = Buffer.concat([JPEG, Buffer.from([9])]);
    const byId = call({
      urlPath: "/v1/groups/G1435/installation/photos",
      machines: [machine],
      body: { data: other.toString("base64"), id: "job-42" },
    });
    assert.equal(byId.status, 200);
    assert.equal(byId.body.duplicate, true);
    assert.equal(byId.body.photo.clientId, "job-42");
  });

  it("rejects the wrong type, a non-image, a data URL mismatch, and a fifth photo", () => {
    const machine = dispatched();
    const wrongType = call({
      urlPath: "/v1/machines/X34M005/installation/photos",
      machines: [machine],
      body: { data: PNG.toString("base64"), contentType: "image/jpeg" },
    });
    assert.equal(wrongType.status, 400);
    assert.equal(wrongType.upload, undefined);
    assert.match(wrongType.body.error, /does not match/);

    const textFile = call({
      urlPath: "/v1/machines/X34M005/installation/photos",
      machines: [machine],
      body: { data: Buffer.from("<svg></svg>").toString("base64"), contentType: "image/svg+xml" },
    });
    assert.equal(textFile.status, 400);

    const dataUrl = call({
      urlPath: "/v1/machines/X34M005/installation/photos",
      machines: [machine],
      body: { data: `data:image/png;base64,${PNG.toString("base64")}` },
    });
    assert.equal(dataUrl.status, 201);
    assert.equal(dataUrl.upload.contentType, "image/png");

    const huge = call({
      urlPath: "/v1/machines/X34M005/installation/photos",
      machines: [machine],
      maxPhotoBytes: 16,
      body: { data: JPEG.toString("base64"), contentType: "image/jpeg" },
    });
    assert.equal(huge.status, 413);
    assert.equal(huge.upload, undefined);

    const fullPhotos = [0, 1, 2, 3].map((index) => ({ url: SECRET, path: `p${index}`, contentHash: `h${index}` }));
    const full = call({
      urlPath: "/v1/machines/X34M005/installation/photos",
      machines: [packed({ ...dispatched(), installation: { ...dispatched().installation, photos: fullPhotos } })],
      body: { data: JPEG.toString("base64") },
    });
    assert.equal(full.status, 409);
    assert.equal(full.upload, undefined);
    assert.match(full.body.error, /4 installation photos/);
  });

  it("names the group from the order link when the machine has none", () => {
    const result = call({
      urlPath: "/v1/groups/G1435/installation/photos",
      machines: [packed({ groupNumber: "", dispatch: { dispatched: true, date: "2026-10-20", courier: "DP World", trackingNumber: "1" } })],
      order: { id: "G1435", groupNumber: "G1435", machineId: "m1", machineNumber: "X34M005" },
      body: { data: JPEG.toString("base64"), contentType: "image/jpeg", filename: "lobby.jpg" },
    });
    assert.equal(result.status, 201);
    assert.equal(result.upload.audit.groupNumber, "G1435");
    assert.match(result.upload.audit.action, /on X34M005 group G1435$/);
  });
});

describe("ops api machine list and assignment", () => {
  function at(iso) {
    return { updatedAt: iso, updatedBy: "production@example.com" };
  }

  it("lists machines oldest packed first and leaves out everything else", () => {
    const older = packed({
      id: "m-old",
      machineNumber: "X33M001",
      groupNumber: "",
      sectionMeta: { finalPacking: at("2026-09-01T00:00:00.000Z") },
    });
    const newer = packed({
      id: "m-new",
      machineNumber: "X34M005",
      groupNumber: "",
      cycles: [{ cycle: 1 }],
      sectionMeta: { finalPacking: at("2026-10-01T00:00:00.000Z") },
    });
    const dispatched = packed({
      id: "m-out",
      machineNumber: "X35M002",
      groupNumber: "G9",
      dispatch: { dispatched: true, date: "2026-10-02" },
      sectionMeta: { finalPacking: at("2026-08-01T00:00:00.000Z"), dispatch: at("2026-10-02T00:00:00.000Z") },
    });
    const machines = [newer, dispatched, older];
    const orders = [{ id: "G1435", groupNumber: "G1435", machineId: "m-old", machineNumber: "X33M001" }];
    const listed = call({
      method: "GET",
      urlPath: "/v1/machines",
      query: { status: "Packed" },
      machines,
      orders,
    });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.count, 2);
    assert.equal(listed.write, undefined);
    assert.equal(listed.assign, undefined);
    assert.deepEqual(listed.body.machines, [
      {
        machineNumber: "X33M001",
        status: STATUS.PACKED,
        packedAt: "2026-09-01T00:00:00.000Z",
        refurbished: false,
        groupNumber: "G1435",
        batch: 33,
      },
      {
        machineNumber: "X34M005",
        status: STATUS.PACKED,
        packedAt: "2026-10-01T00:00:00.000Z",
        refurbished: true,
        groupNumber: null,
        batch: 34,
      },
    ]);
    assert.equal(JSON.stringify(listed.body).includes(SECRET), false);

    const both = call({
      method: "GET",
      urlPath: "/opsApi/v1/machines",
      query: { status: ["Packed", "Dispatched"] },
      machines,
      orders,
    });
    assert.deepEqual(both.body.machines.map((machine) => machine.machineNumber), ["X35M002", "X33M001", "X34M005"]);

    const comma = call({
      method: "GET",
      urlPath: "/v1/machines",
      query: { status: "packed,Dispatched", limit: "1" },
      machines,
      orders,
    });
    assert.equal(comma.body.count, 1);
    assert.equal(comma.body.machines[0].machineNumber, "X35M002");
    assert.equal(comma.body.machines[0].packedAt, "2026-08-01T00:00:00.000Z");

    assert.equal(call({ method: "GET", urlPath: "/v1/machines", query: { status: "Returned" }, machines }).status, 400);
    assert.equal(call({ method: "GET", urlPath: "/v1/machines", query: { limit: "0" }, machines }).status, 400);
    const denied = call({ method: "GET", urlPath: "/v1/machines", headers: headers(ORDERS_KEY), machines });
    assert.equal(denied.status, 401);
    assert.equal(JSON.stringify(denied.body).includes("X34M005"), false);
    assert.equal(call({ method: "POST", urlPath: "/v1/machines", machines }).status, 405);
  });

  it("assigns a packed machine the way the order page does, and logs ops-bot once", () => {
    const machine = packed({ groupNumber: "", cycles: [{ cycle: 1 }] });
    const order = { id: "G1435", groupNumber: "G1435", machineId: "", machineNumber: "", customer: "Dr Shouvick", contact: SECRET };
    const result = call({
      method: "POST",
      urlPath: "/v1/groups/G1435/assign",
      body: { machineNumber: "X34M005", reason: "auto", note: "oldest packed" },
      machines: [machine],
      orders: [order],
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.unchanged, false);
    assert.equal(result.body.createdOrder, false);
    assert.equal(result.body.refurbished, true);
    assert.equal(result.body.status, STATUS.PACKED);
    assert.equal(result.assign.createOrder, null);
    assert.equal(result.assign.orderId, "G1435");
    assert.deepEqual(result.assign.clearMachineIds, []);
    assert.equal(result.assign.orderUpdate.machineId, "m1");
    assert.equal(result.assign.orderUpdate.machineNumber, "X34M005");
    assert.equal(result.assign.orderUpdate.fulfillmentStatus, STATUS.PACKED);
    assert.equal(result.assign.orderUpdate.updatedBy, OPS_ACTOR);
    assert.equal(result.assign.orderUpdate.customer, undefined);
    assert.equal(result.assign.audit.userEmail, "ops-bot");
    assert.equal(result.assign.audit.section, "order");
    assert.match(result.assign.audit.action, /^assign machine X34M005 group G1435 /);
    assert.match(result.assign.audit.action, /reason auto/);
    assert.match(result.assign.audit.action, /machine — → X34M005/);
    assert.match(result.assign.audit.action, /group — → G1435/);
    assert.match(result.assign.audit.action, /note oldest packed/);
    assert.equal(JSON.stringify(result.assign).includes(SECRET), false);

    const linkedMachine = { ...machine, groupNumber: "G1435" };
    const linkedOrder = {
      ...order,
      machineId: "m1",
      machineNumber: "X34M005",
      fulfillmentStatus: STATUS.PACKED,
    };
    const again = call({
      method: "POST",
      urlPath: "/v1/groups/G1435/assign",
      body: { machineNumber: "X34M005", reason: "auto" },
      machines: [linkedMachine],
      orders: [linkedOrder],
    });
    assert.equal(again.body.unchanged, true);
    assert.equal(again.assign, undefined);

    const lookup = call({
      method: "GET",
      urlPath: "/v1/groups/G1435",
      machines: [linkedMachine],
      order: linkedOrder,
    });
    assert.equal(lookup.status, 200);
    assert.equal(lookup.body.machineNumber, "X34M005");
    assert.equal(lookup.body.machineId, "m1");
    assert.equal(lookup.body.groupNumber, "G1435");
    assert.equal(lookup.body.status, STATUS.PACKED);
  });

  it("creates a missing order, rejects conflicts, and replaces a link only with force", () => {
    const machine = packed({ groupNumber: "" });
    const created = call({
      method: "POST",
      urlPath: "/v1/groups/G1500/assign",
      body: { machineNumber: "X34M005", reason: "reserved", customer: "New clinic", city: "Pune" },
      machines: [machine],
      orders: [],
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.createdOrder, true);
    assert.equal(created.assign.orderUpdate, null);
    assert.equal(created.assign.createOrder.groupNumber, "G1500");
    assert.equal(created.assign.createOrder.customer, "New clinic");
    assert.equal(created.assign.createOrder.city, "Pune");
    assert.equal(created.assign.createOrder.status, "Please Ship");
    assert.equal(created.assign.createOrder.payment, "Paid");
    assert.equal(created.assign.createOrder.machineId, "m1");
    assert.equal(created.assign.createOrder.machineNumber, "X34M005");
    assert.equal(created.assign.createOrder.contact, "");
    assert.equal(created.assign.createOrder.address, "");
    assert.equal(created.assign.createOrder.createdBy, OPS_ACTOR);
    assert.match(created.assign.audit.action, /reason reserved/);
    assert.match(created.assign.audit.action, /created order/);

    const testing = packed({
      groupNumber: "",
      finalPacking: { ...packed().finalPacking, finalPacked: null },
    });
    const notPacked = call({
      method: "POST",
      urlPath: "/v1/groups/G1435/assign",
      body: { machineNumber: "X34M005" },
      machines: [testing],
      orders: [{ id: "G1435", groupNumber: "G1435" }],
    });
    assert.equal(notPacked.status, 409);
    assert.match(notPacked.body.error, /Only a Packed machine/);
    assert.equal(notPacked.assign, undefined);

    const taken = call({
      method: "POST",
      urlPath: "/v1/groups/G1435/assign",
      body: { machineNumber: "X34M005", force: true },
      machines: [packed({ groupNumber: "G9999" })],
      orders: [{ id: "G1435", groupNumber: "G1435" }],
    });
    assert.equal(taken.status, 409);
    assert.match(taken.body.error, /already assigned to G9999/);
    assert.equal(taken.assign, undefined);

    const other = packed({ id: "m-old", machineNumber: "X33M001", groupNumber: "G1435" });
    const blocked = call({
      method: "POST",
      urlPath: "/v1/groups/G1435/assign",
      body: { machineNumber: "X34M005" },
      machines: [machine, other],
      orders: [{ id: "G1435", groupNumber: "G1435", machineId: "m-old", machineNumber: "X33M001" }],
    });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /already assigned to X33M001/);
    assert.match(blocked.body.error, /force:true/);

    const forced = call({
      method: "POST",
      urlPath: "/v1/groups/G1435/assign",
      body: { machineNumber: "X34M005", force: true, reason: "auto" },
      machines: [machine, other],
      orders: [{ id: "G1435", groupNumber: "G1435", machineId: "m-old", machineNumber: "X33M001" }],
    });
    assert.equal(forced.status, 200);
    assert.deepEqual(forced.assign.clearMachineIds, ["m-old"]);
    assert.match(forced.assign.audit.action, /machine X33M001 → X34M005/);
    assert.equal(forced.assign.orderUpdate.machineId, "m1");

    assert.equal(
      call({
        method: "POST",
        urlPath: "/v1/groups/G1435/assign",
        body: { machineNumber: "NOPE" },
        machines: [machine],
        orders: [],
      }).status,
      404
    );
    assert.equal(
      call({
        method: "POST",
        urlPath: "/v1/groups/G1435/assign",
        body: { machineNumber: "X34M005", reason: "manual" },
        machines: [machine],
      }).status,
      400
    );
  });
});
