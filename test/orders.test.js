import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STATUS } from "../src/constants.js";
import {
  blankOrder,
  canonicalOrderStatus,
  displayOrderStatus,
  groupNumberToId,
  maskContact,
  warrantyYears,
} from "../src/domain/orderModel.js";
import {
  SHEET_HEADERS,
  accessoriesSheetCells,
  buildSheetWrite,
  courierSheetCells,
  daysLeftFormula,
  daysSinceShippedFormula,
  sheetStatusCell,
} from "../src/domain/sheetRow.js";
import {
  matchMachinesToOrders,
  parseMachineSheet,
  parseOrdersMatrix,
} from "../src/domain/importSheets.js";
import { matchRoutes } from "react-router";
import { handleOrdersHttp, matchOrdersRoute } from "../src/domain/ordersHttp.js";

const packedMachine = {
  id: "m1",
  machineNumber: "X33M050",
  finalPacking: {
    machineBolted: { url: "a" },
    fastnersBox: { url: "b" },
    frontCover: { url: "c" },
    finalPacked: { url: "d" },
  },
  dispatch: { dispatched: false },
  delivery: { delivered: false },
  installation: { installed: false },
};

describe("order ids and display status", () => {
  it("encodes slashes so the group number can be a document id", () => {
    assert.equal(groupNumberToId("G1458"), "G1458");
    assert.equal(groupNumberToId(" G338/9 "), "G338~9");
  });

  it("keeps the sales status until a packed machine is linked", () => {
    const order = blankOrder("G1458", { status: "Please Ship", payment: "COD" });
    assert.equal(displayOrderStatus(order, null), "Please Ship");
    assert.equal(displayOrderStatus(order, packedMachine), STATUS.PACKED);
  });

  it("lets Cancelled win over a linked machine", () => {
    const order = blankOrder("G1", { status: "Cancelled" });
    const dispatched = {
      ...packedMachine,
      dispatch: { dispatched: true, date: "2026-10-21" },
    };
    assert.equal(displayOrderStatus(order, dispatched), "Cancelled");
  });

  it("shows a historical sheet status when no sales status was stored", () => {
    const order = blankOrder("G323", { status: "", sheetStatus: "Installed", payment: "Paid" });
    assert.equal(displayOrderStatus(order, null), "Installed");
    assert.equal(displayOrderStatus({ ...order, machineNumber: "X33M001", fulfillmentStatus: "Dispatched" }, null), "Dispatched");
  });

  it("masks a phone the way the order card does", () => {
    assert.equal(maskContact("98366999982"), "98366 ···82");
    assert.equal(maskContact(9885509409), "98855 ···09");
  });

  it("reads total warranty years", () => {
    assert.equal(warrantyYears("Default, 1 year total warranty"), 1);
    assert.equal(warrantyYears("2 year extended, 3 year total warranty"), 3);
  });

  it("canonicalizes status case", () => {
    assert.equal(canonicalOrderStatus("please ship"), "Please Ship");
    assert.equal(canonicalOrderStatus("Installed"), "");
  });
});

describe("sheet mirror row", () => {
  it("keeps the historical column count and leaves formula columns out of the write", () => {
    assert.equal(SHEET_HEADERS.length, 28);
    const order = blankOrder("G1458", {
      status: "Please Ship",
      payment: "COD",
      customer: "Dr Shouvick",
      city: "Kolkata",
      tab: "No",
      accessories: "Yes",
      hanger: "Yes",
      bench: "NONE",
      glassMetal: "Metal",
      warranty: "Default, 1 year total warranty",
      sheetStatus: "Please Ship",
    });
    const { throughY, warrantyPeriod } = buildSheetWrite(order, null);
    assert.equal(throughY.length, 25);
    assert.equal(throughY[0], "G1458");
    assert.equal(throughY[1], "Please Ship");
    assert.equal(throughY[9], "NO");
    assert.equal(throughY[10], "YES");
    assert.equal(warrantyPeriod, 1);
  });

  it("writes the machine status and courier into the existing columns", () => {
    const order = blankOrder("G1443", { status: "Please Ship", payment: "Paid", sheetStatus: "Installed" });
    const machine = {
      ...packedMachine,
      machineNumber: "X33M047",
      dispatch: {
        dispatched: true,
        date: "2026-10-21",
        courier: "Safexpress",
        trackingNumber: "18471189815",
        accessoriesSeparate: true,
        accessoriesCourier: "Delhivery",
        accessoriesTracking: "2780 4413 096",
        accessoriesStatus: "In transit",
      },
    };
    assert.equal(sheetStatusCell(order, machine), STATUS.DISPATCHED);
    assert.deepEqual(courierSheetCells(order, machine), { smartr: "", safexpress: "18471189815" });
    assert.deepEqual(accessoriesSheetCells(order, machine), {
      accStatus: "In Transit",
      accTracking: "Delhivery 2780 4413 096",
    });
    const { throughY } = buildSheetWrite(order, machine);
    assert.equal(throughY[16], "2026-10-21");
    assert.equal(throughY[19], "18471189815");
  });

  it("preserves an imported Installed label when no machine is linked", () => {
    const order = blankOrder("G323", { status: "", sheetStatus: "Installed", smartr: "", safexpress: "100012033929" });
    assert.equal(sheetStatusCell(order, null), "Installed");
    assert.deepEqual(courierSheetCells(order, null), { smartr: "", safexpress: "100012033929" });
  });

  it("builds the two formulas for a newly appended row", () => {
    assert.match(daysSinceShippedFormula(10), /U10/);
    assert.match(daysLeftFormula(10), /AA10/);
    assert.match(daysLeftFormula(10), /X10/);
  });
});

describe("sheet import", () => {
  const ordersMatrix = [
    ["owner"],
    ["Group No", "Status", "Payment", "Order Date", "Customer", "Comments", "City", "Address", "Contact", "Tab", "Accessories", "Hanger", "Bench", "Glass/Metal", "Warranty", "Order Type", "Shipping Date", "Payment Status", "Smartr", "Safexpress", "Acc Status ", "Acc Tracking ", "Installation Pending", "Installation Date", "Comments"],
    ["G1458", "Please Ship", "COD", "2026-10-22", "Dr Shouvick", "paid", "Kolkata", "Tower 2", "98366000082", "NO", "YES", "YES", "NONE", "Metal", "Default, 1 year total warranty", "Personal use"],
    ["G1459", "Pause Shipment", "Advance", "2026-10-22", "Gurminder", "", "New Delhi", "Addr", "9810000000", "NO", "YES", "NO", "NONE", "Metal", "Default, 1 year total warranty", ""],
    ["G323", "Installed", "Paid", "2024-03-05", "Sunny Karnani", "", "Visakhapatnam", "Addr", 9885509409, "YES", "YES", "NO", "Incline", "Metal", "Default, 1 year total warranty", ""],
    ["D12", "Installed", "Paid", "2025-09-01", "IAP Conference", "", "Delhi", "CCI", "9873986698", "YES", "YES", "YES", "Incline", "Metal", "", ""],
    ["D12", "Installed", "Paid", "2026-01-20", "WeWork", "", "Bengaluru", "Infantry Road", "9591965499", "YES", "YES", "YES", "NONE", "Metal", "", ""],
    ["B16", "Installed", "Barter", "2025-08-21", "Aarav Shukla", "", "Bangalore", "Heights", "8182859596", "NO", "YES", "YES", "Incline", "Metal", "", ""],
    ["B16", "Installed", "Barter", "2025-08-21", "Aarav Shukla", "", "Bangalore", "Heights", "8182859596", "NO", "YES", "YES", "Incline", "Metal", "", ""],
  ];

  it("parses orders, keeps historical status, and does not guess duplicate groups", () => {
    const { orders, issues } = parseOrdersMatrix(ordersMatrix);
    const byGroup = Object.fromEntries(orders.map((order) => [order.groupNumber, order]));
    assert.equal(byGroup.G1458.status, "Please Ship");
    assert.equal(byGroup.G1458.payment, "COD");
    assert.equal(byGroup.G1458.contact, "98366000082");
    assert.equal(byGroup.G1459.status, "Pause Shipment");
    assert.equal(byGroup.G323.status, "");
    assert.equal(byGroup.G323.sheetStatus, "Installed");
    assert.equal(byGroup.G323.contact, "9885509409");
    assert.equal(byGroup.B16.customer, "Aarav Shukla");
    assert.equal(byGroup.D12, undefined);
    assert.ok(issues.some((issue) => issue.groupNumber === "D12" && issue.reason.includes("different customers")));
    assert.ok(issues.some((issue) => issue.groupNumber === "B16" && issue.reason.includes("same customer")));
  });

  it("links a batch row only when the customer matches one order and one machine", () => {
    const { orders } = parseOrdersMatrix(ordersMatrix);
    const batch = [
      ["Machine No.", "Status", " Date", "Customer", "City", "Location", "Contact"],
      ["X33M050", "Packed", "2026-10-22", "Dr Shouvick", "Kolkata", "Tower 2", "98366000082"],
      ["X33M051", "Packed", "2026-10-22", "Someone Else", "Pune", "Addr", "9000000000"],
      ["X33M052", "Packed", "2026-10-22", "Aarav Shukla", "Bangalore", "Heights", "8182859596"],
      ["X33M053", "Packed", "2026-10-22", "Aarav Shukla", "Bangalore", "Heights", "8182859596"],
      ["1", "Done", "", "Not a machine", "", "", ""],
    ];
    const parsed = parseMachineSheet("Batch 33", batch);
    assert.equal(parsed.skipped, false);
    assert.equal(parsed.machines.length, 4);
    assert.ok(parsed.skippedRows.some((row) => row.reason === "no machine number"));

    const { links, unmatched } = matchMachinesToOrders(orders, parsed.machines);
    assert.deepEqual(links.map((link) => link.machineNumber), ["X33M050"]);
    assert.equal(links[0].groupNumber, "G1458");
    const reasons = unmatched.map((row) => `${row.machineNumber}:${row.reason}`);
    assert.ok(reasons.some((reason) => reason.includes("X33M051") && reason.includes("no order")));
    assert.ok(reasons.filter((reason) => reason.includes("more than one machine")).length === 2);
  });

  it("reads a batch tab whose machine column header is blank", () => {
    const rows = [
      ["", "Status", " Date", "Customer", "City", "Location", "Contact"],
      ["X17M001", "Shipped", "2024-11-04", "Kishore Karumanchi", "Hyderabad", "Villa 27", 9100667629],
    ];
    const parsed = parseMachineSheet("Batch 17", rows);
    assert.equal(parsed.machines[0].machineNumber, "X17M001");
    assert.equal(parsed.machines[0].customer, "Kishore Karumanchi");
    assert.equal(parsed.machines[0].contact, "9100667629");
  });

  it("does not treat Customer number as the customer name", () => {
    const rows = [
      ["Customer number", "Machine Number", "Status", "Release Date", "City", "Customer", "Location", "Contact"],
      ["", "X05M001", "Shipped", "2022-12-26", "Chennai", "Prabu Yuvaraj", "Anna Nagar", ""],
    ];
    const parsed = parseMachineSheet("Batch 5", rows);
    assert.equal(parsed.machines[0].customer, "Prabu Yuvaraj");
    assert.equal(parsed.machines[0].machineNumber, "X05M001");
  });

  it("skips sheets that are not batch tabs or have no customer header", () => {
    assert.equal(parseMachineSheet("COSTING", [["Customer", "Machine No."]]).skipped, true);
    assert.equal(parseMachineSheet("Batch 1", [["Machine", "Status", "Location"]]).reason, "no customer header");
  });
});

describe("orders HTTP API", () => {
  it("routes collection, document, and the reserved tickets resource", () => {
    assert.equal(matchOrdersRoute("/v1/orders").kind, "collection");
    assert.equal(matchOrdersRoute("/api/v1/orders/G1458").groupNumber, "G1458");
    assert.equal(matchOrdersRoute("/api/v1/orders/G338%2F9").groupNumber, "G338/9");
    assert.equal(matchOrdersRoute("/v1").kind, "index");
    assert.equal(matchOrdersRoute("/v1/tickets").resource, "tickets");
  });

  it("creates an order and treats a repeat POST as the same order", () => {
    const created = handleOrdersHttp({
      method: "POST",
      urlPath: "/v1/orders",
      body: { groupNumber: "G1458", status: "Please Ship", payment: "COD", customer: "Dr Shouvick", comments: "via bot" },
      existing: null,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.created, true);
    assert.equal(created.body.order.customer, "Dr Shouvick");
    assert.equal(created.id, "G1458");

    const again = handleOrdersHttp({
      method: "POST",
      urlPath: "/v1/orders",
      body: { groupNumber: "G1458", status: "Pause Shipment", payment: "Paid", customer: "Someone else" },
      existing: created.body.order,
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.created, false);
    assert.equal(again.body.order.customer, "Dr Shouvick");
    assert.equal(again.body.order.status, "Please Ship");
  });

  it("patches status, payment, comments, and any other order field", () => {
    const existing = blankOrder("G1458", { status: "Please Ship", payment: "COD", customer: "Dr Shouvick", sheetStatus: "Installed" });
    const patched = handleOrdersHttp({
      method: "PATCH",
      urlPath: "/v1/orders/G1458",
      body: { status: "Pause Shipment", comments: "hold", city: "Kolkata" },
      existing,
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.order.status, "Pause Shipment");
    assert.equal(patched.body.order.comments, "hold");
    assert.equal(patched.body.order.city, "Kolkata");
    assert.equal(patched.body.order.payment, "COD");
    assert.equal(patched.body.order.sheetStatus, "");
    assert.equal(patched.update.machineId, undefined);
  });

  it("rejects bad enums, machine assignment, and a missing order", () => {
    const bad = handleOrdersHttp({
      method: "POST",
      urlPath: "/v1/orders",
      body: { groupNumber: "G1", status: "Ordered", payment: "Paid" },
      existing: null,
    });
    assert.equal(bad.status, 400);

    const assign = handleOrdersHttp({
      method: "PATCH",
      urlPath: "/v1/orders/G1",
      body: { machineId: "abc" },
      existing: blankOrder("G1"),
    });
    assert.equal(assign.status, 400);

    const missing = handleOrdersHttp({
      method: "GET",
      urlPath: "/v1/orders/G404",
      existing: null,
    });
    assert.equal(missing.status, 404);

    const later = handleOrdersHttp({ method: "POST", urlPath: "/v1/tickets", body: {} });
    assert.equal(later.status, 501);
  });
});

describe("order routes", () => {
  it("matches /orders/new instead of treating new as a group number", () => {
    const matches = matchRoutes(
      [
        { path: "/orders" },
        { path: "/orders/new" },
        { path: "/orders/:groupNumber" },
      ],
      "/orders/new"
    );
    assert.equal(matches.at(-1).route.path, "/orders/new");
    assert.equal(matches.at(-1).params.groupNumber, undefined);
  });
});
