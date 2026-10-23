// One-time import. Does not run unless you execute it.
//
// Dry run (no Firebase, no writes):
//   node scripts/import-orders.mjs \
//     --orders /path/orders.xlsx \
//     --machines /path/machine-records.xlsx \
//     --report import-report.json
//
// Commit to Firestore only after you have read the report:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/service-account.json \
//     node scripts/import-orders.mjs --orders ... --machines ... --commit
//
// Existing orders are left untouched. A batch-tab customer is linked only
// when that name matches exactly one order and exactly one machine number,
// and that machine already exists in QC Track.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { parseMachineSheet, parseOrdersMatrix, matchMachinesToOrders } from "../src/domain/importSheets.js";
import { FULFILLMENT_STATUSES, groupNumberToId } from "../src/domain/orderModel.js";
import { computeStatus } from "../src/utils/status.js";

const require = createRequire(import.meta.url);

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return "";
  return process.argv[index + 1] || "";
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function readMatrix(filePath, sheetName) {
  const XLSX = require("xlsx");
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const name = sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`Sheet "${name}" was not found in ${filePath}.`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
  return { workbook, rows, name };
}

function readMachineSheets(filePath) {
  const XLSX = require("xlsx");
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  return workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true }),
  }));
}

export function buildImportPlan(orderRows, machineSheets) {
  const parsedOrders = parseOrdersMatrix(orderRows);
  const sheetReports = [];
  const machineRows = [];
  const skippedRows = [];
  for (const sheet of machineSheets) {
    const parsed = parseMachineSheet(sheet.name, sheet.rows);
    sheetReports.push({
      sheet: parsed.sheet,
      skipped: parsed.skipped,
      reason: parsed.reason || "",
      machineRows: parsed.machines.length,
      skippedRows: parsed.skippedRows.length,
    });
    machineRows.push(...parsed.machines);
    skippedRows.push(...parsed.skippedRows);
  }
  const matched = matchMachinesToOrders(parsedOrders.orders, machineRows);
  return {
    orders: parsedOrders.orders,
    orderIssues: parsedOrders.issues,
    sheetReports,
    skippedRows,
    links: matched.links,
    unmatched: matched.unmatched,
  };
}

function stripOrder(order) {
  const rest = { ...order };
  delete rest.sheetRow;
  return rest;
}

async function commitPlan(plan, report) {
  const { initializeApp, applicationDefault, cert } = await import("firebase-admin/app");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
  const keyPath = arg("--service-account");
  if (keyPath) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, "utf8"))) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({ credential: applicationDefault() });
  } else {
    throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS or pass --service-account <json-file> before --commit.");
  }
  const db = getFirestore();
  const created = [];
  const alreadyThere = [];

  for (const order of plan.orders) {
    const id = groupNumberToId(order.groupNumber);
    const ref = db.collection("orders").doc(id);
    const snap = await ref.get();
    if (snap.exists) {
      alreadyThere.push(order.groupNumber);
      continue;
    }
    await ref.set({
      ...stripOrder(order),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: "import",
      updatedBy: "import",
    });
    created.push(order.groupNumber);
  }

  const linked = [];
  const linkProblems = [];
  for (const link of plan.links) {
    const machines = await db.collection("machines").where("machineNumber", "==", link.machineNumber).get();
    if (machines.empty) {
      linkProblems.push({ ...link, reason: "machine is not in QC Track" });
      continue;
    }
    if (machines.size > 1) {
      linkProblems.push({ ...link, reason: "more than one QC Track machine has this number" });
      continue;
    }
    const machineDoc = machines.docs[0];
    const machine = { id: machineDoc.id, ...machineDoc.data() };
    if (machine.groupNumber && machine.groupNumber !== link.groupNumber) {
      linkProblems.push({ ...link, reason: `machine is already assigned to ${machine.groupNumber}` });
      continue;
    }
    const orderRef = db.collection("orders").doc(groupNumberToId(link.groupNumber));
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      linkProblems.push({ ...link, reason: "order was not imported" });
      continue;
    }
    if (orderSnap.data().machineId && orderSnap.data().machineId !== machine.id) {
      linkProblems.push({ ...link, reason: `order is already assigned to ${orderSnap.data().machineNumber}` });
      continue;
    }
    const status = computeStatus(machine);
    const fulfillmentStatus = FULFILLMENT_STATUSES.includes(status) ? status : "";
    const batch = db.batch();
    batch.update(machineDoc.ref, { groupNumber: link.groupNumber });
    batch.update(orderRef, {
      machineId: machine.id,
      machineNumber: machine.machineNumber,
      fulfillmentStatus,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "import",
    });
    await batch.commit();
    linked.push({ ...link, fulfillmentStatus });
  }

  report.committed = {
    ordersCreated: created.length,
    ordersAlreadyPresent: alreadyThere,
    machinesLinked: linked,
    linkProblems,
  };
}

async function main() {
  const ordersPath = arg("--orders");
  const machinesPath = arg("--machines");
  const reportPath = arg("--report") || "import-report.json";
  if (!ordersPath || !machinesPath) {
    console.error("Usage: node scripts/import-orders.mjs --orders <xlsx> --machines <xlsx> [--report import-report.json] [--commit]");
    process.exit(1);
  }

  const ordersBook = readMatrix(ordersPath, "Move to this slowly");
  const machineSheets = readMachineSheets(machinesPath);
  const plan = buildImportPlan(ordersBook.rows, machineSheets);
  const report = {
    dryRun: !hasFlag("--commit"),
    ordersSheet: ordersBook.name,
    orders: plan.orders.length,
    orderIssues: plan.orderIssues,
    batchSheets: plan.sheetReports,
    skippedBatchRows: plan.skippedRows,
    proposedLinks: plan.links,
    unmatched: plan.unmatched,
  };

  if (hasFlag("--commit")) {
    await commitPlan(plan, report);
    report.dryRun = false;
  }

  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(
    [
      report.dryRun ? "Dry run only. No Firestore writes." : "Committed to Firestore.",
      `Orders ready: ${report.orders}`,
      `Order issues: ${report.orderIssues.length}`,
      `Proposed machine links: ${report.proposedLinks.length}`,
      `Unmatched machine rows: ${report.unmatched.length}`,
      `Batch rows without a machine number or customer: ${report.skippedBatchRows.length}`,
      `Report: ${reportPath}`,
    ].join("\n")
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
