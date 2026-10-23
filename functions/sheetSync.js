import { google } from "googleapis";
import {
  ORDERS_SHEET_ID,
  ORDERS_SHEET_TAB,
  buildSheetWrite,
  daysLeftFormula,
  daysSinceShippedFormula,
  quoteSheetTab,
} from "../src/domain/sheetRow.js";

const tab = quoteSheetTab(ORDERS_SHEET_TAB);

function sheetsClient(serviceAccountJson) {
  const credentials = typeof serviceAccountJson === "string"
    ? JSON.parse(serviceAccountJson)
    : serviceAccountJson;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// Grid data keeps blank cells, so a missing group number in column A does not
// shift the rows underneath it. values.get would skip those blanks.
async function findGroupRow(sheets, groupNumber) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: ORDERS_SHEET_ID,
    ranges: [`${tab}!A:A`],
    includeGridData: true,
    fields: "sheets(data(rowData(values(formattedValue))))",
  });
  const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
  for (let i = 2; i < rowData.length; i += 1) {
    const value = rowData[i]?.values?.[0]?.formattedValue || "";
    if (String(value).trim() === groupNumber) return i + 1;
  }
  return null;
}

async function writeRow(sheets, rowNumber, throughY, warrantyPeriod, { formulas }) {
  const data = [
    { range: `${tab}!A${rowNumber}:Y${rowNumber}`, values: [throughY] },
    { range: `${tab}!AA${rowNumber}`, values: [[warrantyPeriod]] },
  ];
  if (formulas) {
    data.push(
      { range: `${tab}!Z${rowNumber}`, values: [[daysSinceShippedFormula(rowNumber)]] },
      { range: `${tab}!AB${rowNumber}`, values: [[daysLeftFormula(rowNumber)]] }
    );
  }
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: ORDERS_SHEET_ID,
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });
}

export async function syncOrderToSheet(serviceAccountJson, order, machine) {
  if (!serviceAccountJson || !String(serviceAccountJson).trim()) {
    console.warn("SHEETS_SERVICE_ACCOUNT is empty; skipping sheet sync.");
    return { skipped: true };
  }
  if (!order?.groupNumber) return { skipped: true };

  const sheets = sheetsClient(serviceAccountJson);
  const { throughY, warrantyPeriod } = buildSheetWrite(order, machine);
  const existingRow = await findGroupRow(sheets, order.groupNumber);
  if (existingRow) {
    await writeRow(sheets, existingRow, throughY, warrantyPeriod, { formulas: false });
    return { row: existingRow, created: false };
  }

  const appended = await sheets.spreadsheets.values.append({
    spreadsheetId: ORDERS_SHEET_ID,
    range: `${tab}!A:Y`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [throughY] },
  });
  const updated = appended.data.updates?.updatedRange || "";
  const match = updated.match(/!(?:[A-Z]+)(\d+)/);
  const rowNumber = match ? Number(match[1]) : null;
  if (!rowNumber) {
    throw new Error(`Sheet append for ${order.groupNumber} did not report a row.`);
  }
  await writeRow(sheets, rowNumber, throughY, warrantyPeriod, { formulas: true });
  return { row: rowNumber, created: true };
}
