import { STATUS } from "../constants";

// Derives the current lifecycle status of a machine from its data.
// This is computed, not stored, so it can never drift out of sync —
// except for "Dispatched", which is a manual, one-way action.
export function computeStatus(machine) {
  if (!machine) return STATUS.ASSEMBLY;

  if (machine.dispatch?.dispatched) return STATUS.DISPATCHED;

  const fp = machine.finalPacking || {};
  const finalPackingDone =
    fp.machineBolted && fp.fastnersBox && fp.frontCover && fp.finalPacked;
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
  const finalPackingStarted = Object.values(fp).some(Boolean);

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
