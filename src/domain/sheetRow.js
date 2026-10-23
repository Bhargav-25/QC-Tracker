import { computeStatus } from "../utils/status.js";
import {
  FULFILLMENT_STATUSES,
  canonicalOrderStatus,
  sheetYesNo,
  toIsoDate,
  warrantyYears,
} from "./orderModel.js";

// "Move to this slowly" — row 1 is owners, row 2 is headers, data starts on row 3.
// Columns Z (Days since Shipped) and AB (Days Left Under Warranty) are formulas.
// The mirror writes A:Y and AA only, and copies the formulas onto brand new rows.
export const ORDERS_SHEET_ID = "1oCZ75jD-Xw2peBZZ2DSp2z9gFRsdQtXy3XSAZZ34WHE";
export const ORDERS_SHEET_TAB = "Move to this slowly";
export const SHEET_HEADER_ROWS = 2;

export const SHEET_HEADERS = [
  "Group No",
  "Status",
  "Payment",
  "Order Date",
  "Customer",
  "Comments",
  "City",
  "Address",
  "Contact",
  "Tab",
  "Accessories",
  "Hanger",
  "Bench",
  "Glass/Metal",
  "Warranty",
  "Order Type",
  "Shipping Date",
  "Payment Status",
  "Smartr",
  "Safexpress",
  "Acc Status ",
  "Acc Tracking ",
  "Installation Pending",
  "Installation Date",
  "Comments",
  "Days since Shipped",
  "Warranty Period",
  "Days Left Under Warranty",
];

export function quoteSheetTab(name = ORDERS_SHEET_TAB) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function text(value) {
  if (value == null) return "";
  return String(value);
}

// Status cell written back to the sheet.
// A linked machine's Packed/Dispatched/Delivered/Installed replaces the sales
// status (unless the order was cancelled). With no machine, a historical
// sheet status such as Installed is preserved so the mirror does not flatten
// old rows to Please Ship.
export function sheetStatusCell(order, machine) {
  const sales = canonicalOrderStatus(order?.status);
  if (sales === "Cancelled") return "Cancelled";
  if (machine) {
    const computed = computeStatus(machine);
    if (FULFILLMENT_STATUSES.includes(computed)) return computed;
  }
  // A sales status set in the app wins over a historical sheet label.
  // Imported rows whose status was Installed/Shipped/etc. store that label
  // in sheetStatus and leave status blank, so the mirror keeps the old cell.
  if (sales) return sales;
  if (order?.sheetStatus) return text(order.sheetStatus);
  return text(order?.status || "");
}

export function courierSheetCells(order, machine) {
  const dispatch = machine?.dispatch;
  const legacy = {
    smartr: text(order?.smartr || ""),
    safexpress: text(order?.safexpress || ""),
  };
  if (!dispatch?.courier) return legacy;
  const tracking = text(dispatch.trackingNumber || "").trim();
  if (dispatch.courier === "Smartr") return { smartr: tracking, safexpress: "" };
  if (dispatch.courier === "Safexpress") return { smartr: "", safexpress: tracking };
  // Delhivery and Other have no column of their own. The Safexpress column is
  // where non-Smartr tracking has always lived (numbers, Porter, Private Vehicle).
  const labelled = dispatch.courier === "Other"
    ? tracking
    : [dispatch.courier, tracking].filter(Boolean).join(" ");
  return { smartr: "", safexpress: labelled };
}

const ACCESSORY_STATUS_TO_SHEET = {
  "Not sent": "",
  "In transit": "In Transit",
  Delivered: "Delivered",
};

export function accessoriesSheetCells(order, machine) {
  const dispatch = machine?.dispatch;
  if (!dispatch?.accessoriesSeparate) {
    return {
      accStatus: text(order?.accStatus || ""),
      accTracking: text(order?.accTracking || ""),
    };
  }
  const mapped = ACCESSORY_STATUS_TO_SHEET[dispatch.accessoriesStatus];
  const tracking = [dispatch.accessoriesCourier, dispatch.accessoriesTracking]
    .map((part) => text(part).trim())
    .filter(Boolean)
    .join(" ");
  return {
    accStatus: mapped != null ? mapped : text(dispatch.accessoriesStatus || ""),
    accTracking: tracking,
  };
}

export function installationPendingCell(order, machine) {
  if (machine?.installation?.installed) return "No";
  if (order?.installationPending) return text(order.installationPending);
  if (machine?.dispatch?.dispatched || machine?.delivery?.delivered) return "To be Done";
  return "";
}

export function shippingDateCell(order, machine) {
  if (machine?.dispatch?.dispatched && machine.dispatch.date) return toIsoDate(machine.dispatch.date);
  return toIsoDate(order?.shippingDate || "");
}

export function installationDateCell(order, machine) {
  if (machine?.installation?.installed && machine.installation.date) {
    return toIsoDate(machine.installation.date);
  }
  return toIsoDate(order?.installationDate || "");
}

// Columns A–Y (25 cells) plus the Warranty Period value for column AA.
export function buildSheetWrite(order, machine) {
  const courier = courierSheetCells(order, machine);
  const accessories = accessoriesSheetCells(order, machine);
  const throughY = [
    text(order.groupNumber),
    sheetStatusCell(order, machine),
    text(order.payment || ""),
    toIsoDate(order.orderDate || ""),
    text(order.customer || ""),
    text(order.comments || ""),
    text(order.city || ""),
    text(order.address || ""),
    text(order.contact || ""),
    sheetYesNo(order.tab),
    sheetYesNo(order.accessories),
    sheetYesNo(order.hanger),
    text(order.bench || ""),
    text(order.glassMetal || ""),
    text(order.warranty || ""),
    text(order.orderType || ""),
    shippingDateCell(order, machine),
    text(order.paymentStatus || ""),
    courier.smartr,
    courier.safexpress,
    accessories.accStatus,
    accessories.accTracking,
    installationPendingCell(order, machine),
    installationDateCell(order, machine),
    text(order.sheetComments || ""),
  ];
  const period = warrantyYears(order.warranty, order.warrantyPeriod === "" || order.warrantyPeriod == null ? "" : order.warrantyPeriod);
  return { throughY, warrantyPeriod: period === "" || period == null ? "" : period };
}

export function daysSinceShippedFormula(rowNumber) {
  return `=if(isblank(U${rowNumber}),, if(U${rowNumber}<> "Delivered",today()-Q${rowNumber},"N/A"))`;
}

export function daysLeftFormula(rowNumber) {
  return `=IF(DATE(YEAR(X${rowNumber}) + AA${rowNumber}, MONTH(X${rowNumber}), DAY(X${rowNumber})) - TODAY() > 0, DATE(YEAR(X${rowNumber}) + AA${rowNumber}, MONTH(X${rowNumber}), DAY(X${rowNumber})) - TODAY(), "Out of Warranty")`;
}
