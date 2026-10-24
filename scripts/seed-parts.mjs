// Seed the parts catalog. Dry run unless --commit is passed.
//
//   node scripts/seed-parts.mjs
//   node scripts/seed-parts.mjs --file scripts/parts-catalog.csv
//
// Writes only after you opt in. Admin edits to revivable and frequency are
// kept unless --force is passed. revivedStock is never changed.
//
//   GOOGLE_APPLICATION_CREDENTIALS=/path/service-account.json \
//     node scripts/seed-parts.mjs --commit
//
//   node scripts/seed-parts.mjs --commit --force --service-account /path/key.json

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parsePartsCsv, planSeedPart } from "../src/domain/partsCatalog.js";

const DEFAULT_FILE = new URL("./parts-catalog.csv", import.meta.url);

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return "";
  return process.argv[index + 1] || "";
}

function hasFlag(name) {
  return process.argv.includes(name);
}

export function planCatalogSeed(parts, existingByCode, { force = false } = {}) {
  return parts.map((row) => planSeedPart(existingByCode.get(row.code) || null, row, { force }));
}

function summarize(parts, plans) {
  const count = (action) => plans.filter((item) => item.action === action).length;
  return {
    rows: parts.length,
    revivable: parts.filter((part) => part.revivable).length,
    common: parts.filter((part) => part.frequency === "common").length,
    occasional: parts.filter((part) => part.frequency === "occasional").length,
    create: count("create"),
    update: count("update"),
    unchanged: count("unchanged"),
    skippedRevivable: plans.filter((item) => item.skippedRevivable).length,
    skippedFrequency: plans.filter((item) => item.skippedFrequency).length,
  };
}

async function openFirestore() {
  const { initializeApp, applicationDefault, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const keyPath = arg("--service-account");
  if (keyPath) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, "utf8"))) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({ credential: applicationDefault() });
  } else {
    throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS or pass --service-account <json-file>.");
  }
  return getFirestore();
}

async function loadExisting(db) {
  const snap = await db.collection("parts").get();
  const byCode = new Map();
  snap.docs.forEach((docSnap) => {
    byCode.set(docSnap.id, { code: docSnap.id, ...docSnap.data() });
  });
  return byCode;
}

async function commitPlans(db, plans) {
  const { FieldValue } = await import("firebase-admin/firestore");
  let batch = db.batch();
  let pending = 0;
  let written = 0;
  for (const item of plans) {
    if (item.action === "unchanged") continue;
    const ref = db.collection("parts").doc(item.id);
    const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedBy: "seed" };
    if (item.action === "create") {
      batch.set(ref, { ...item.data, ...stamp, createdAt: FieldValue.serverTimestamp(), createdBy: "seed" });
    } else {
      batch.set(ref, { ...item.data, ...stamp }, { merge: true });
    }
    pending += 1;
    written += 1;
    if (pending === 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending) await batch.commit();
  return written;
}

async function main() {
  const filePath = arg("--file") || DEFAULT_FILE;
  const force = hasFlag("--force");
  const commit = hasFlag("--commit");
  const text = readFileSync(filePath, "utf8");
  const parsed = parsePartsCsv(text);
  if (parsed.errors.length) {
    console.error(parsed.errors.join("\n"));
    process.exit(1);
  }

  let existing = new Map();
  let readLive = false;
  let db = null;
  if (commit || process.env.GOOGLE_APPLICATION_CREDENTIALS || arg("--service-account")) {
    try {
      db = await openFirestore();
      existing = await loadExisting(db);
      readLive = true;
    } catch (err) {
      if (commit) throw err;
      console.error(`Could not read Firestore (${err.message}). Showing a plan against an empty catalog.`);
    }
  }

  const plans = planCatalogSeed(parsed.parts, existing, { force });
  const summary = summarize(parsed.parts, plans);
  console.log(
    [
      commit ? "Commit requested." : "Dry run only. No Firestore writes.",
      readLive ? `Read ${existing.size} existing parts.` : "Firestore was not read. This plan assumes an empty catalog.",
      `CSV rows: ${summary.rows}`,
      `Revivable defaults: ${summary.revivable}`,
      `Common: ${summary.common}`,
      `Occasional: ${summary.occasional}`,
      `Create: ${summary.create}`,
      `Update: ${summary.update}`,
      `Unchanged: ${summary.unchanged}`,
      `Admin revivable flags left alone: ${summary.skippedRevivable}`,
      `Admin frequency flags left alone: ${summary.skippedFrequency}`,
      force ? "Force is on: admin revivable and frequency edits will be overwritten." : "Force is off: admin revivable and frequency edits are kept.",
    ].join("\n")
  );

  if (!commit) return;
  const written = await commitPlans(db, plans);
  console.log(`Wrote ${written} parts. revivedStock was not changed.`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
