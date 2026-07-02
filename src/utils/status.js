import { STATUS, DEFAULT_WARRANTY_YEARS, WARRANTY_EXPIRY_WARNING_DAYS } from "../constants";

// Derives the current lifecycle status of a machine from its data.
// This is computed, not stored, so it can never drift out of sync —
// except for the manual lifecycle actions (Dispatched / Delivered /
// Installed), which are deliberate one-way steps rather than computed state.
export function computeStatus(machine) {
  if (!machine) return STATUS.ASSEMBLY;

  if (machine.installation?.installed) return STATUS.INSTALLED;
  if (machine.delivery?.delivered) return STATUS.DELIVERED;
  if (machine.dispatch?.dispatched) return STATUS.DISPATCHED;

  const fp = machine.finalPacking || {};
  const finalPackingDone =
    fp.machineBolted?.url && fp.fastnersBox?.url && fp.frontCover?.url && fp.finalPacked?.url;
  if (finalPackingDone) return STATUS.PACKED;

  const resistanceStarted = (machine.resistance || []).some(
    (row) => row.eccentric !== "" || row.concentric !== ""
  );
  const temperatureStarted =
    machine.temperature?.temp || machine.temperature?.time;
  const photosStarted = Object.values(machine.photos || {}).some(
    (arr) => Array.isArray(arr) && arr.length > 0
  );
  const packingStarted = Object.values(machine.packingChecklist || {}).some(
    Boolean
  );
  const finalPackingStarted = Object.values(fp).some((v) => v?.url);

  if (
    resistanceStarted ||
    temperatureStarted ||
    photosStarted ||
    packingStarted ||
    finalPackingStarted
  ) {
    return STATUS.TESTING;
  }

  return STATUS.ASSEMBLY;
}

export function missingPackingItems(machine) {
  const checklist = machine.packingChecklist || {};
  const sentBack = machine.packingSentBack || {};
  return Object.keys(checklist).filter(
    (key) => !checklist[key] && !sentBack[key]
  );
}

// --- Warranty -------------------------------------------------------------

// Warranty starts on the installation date, runs 1 year by default, and can
// be pushed out further by any number of recorded extensions (each in whole
// months, tied to an invoice).
export function warrantyEndDate(machine) {
  const installDate = machine.installation?.date;
  if (!installDate) return null;

  const end = new Date(installDate + "T00:00:00");
  end.setFullYear(end.getFullYear() + DEFAULT_WARRANTY_YEARS);

  const extensions = machine.warranty?.extensions || [];
  extensions.forEach((ext) => {
    end.setMonth(end.getMonth() + Number(ext.months || 0));
  });

  return end;
}

export function warrantyDaysRemaining(machine) {
  const end = warrantyEndDate(machine);
  if (!end) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((end.getTime() - today.getTime()) / msPerDay);
}

export function isWarrantyExpiringSoon(machine) {
  const days = warrantyDaysRemaining(machine);
  if (days === null) return false;
  return days <= WARRANTY_EXPIRY_WARNING_DAYS;
}

// --- Date helpers -----------------------------------------------------------

export function isInCurrentMonth(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}
