// Closing a customer cycle and opening the next one. Active QC fields are
// reset so the same machineNumber can be tested, packed, and sold again.
// The previous dispatch / delivery / installation / order link / warranty
// (and the QC that went with them) stay on `cycles`.

import {
  emptyDelivery,
  emptyDispatch,
  emptyFinalPacking,
  emptyInstallation,
  emptyPackingChecklist,
  emptyPackingSentBack,
  emptyPhotos,
  emptyResistanceRows,
  emptyWarranty,
} from "../constants.js";

export function currentCycleNumber(machine) {
  const archived = Array.isArray(machine?.cycles) ? machine.cycles.length : 0;
  const stored = Number(machine?.cycle);
  if (Number.isInteger(stored) && stored > 0) return stored;
  return archived + 1;
}

export function cycleCount(machine) {
  return currentCycleNumber(machine);
}

export function isRefurbished(machine) {
  const archived = Array.isArray(machine?.cycles) ? machine.cycles.length : 0;
  return archived > 0 || currentCycleNumber(machine) > 1;
}

function copy(value) {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
}

function requireDate(value, label) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must be a date (YYYY-MM-DD).`);
  return text;
}

function cleanPhotos(photos) {
  return (Array.isArray(photos) ? photos : [])
    .filter((photo) => photo && photo.url && photo.path)
    .map((photo) => ({ url: photo.url, path: photo.path }));
}

export function planReturn(machine, input, { user, now, photos = [] } = {}) {
  if (!machine) throw new Error("Machine not found.");
  if (machine.intake && !machine.intake.refurb?.completedAt) {
    throw new Error("This machine already has an open return. Finish refurbishment before recording another.");
  }
  const date = requireDate(input?.date, "Return date");
  const receivedAt = requireDate(input?.receivedAt, "Received at workshop");
  const reason = String(input?.reason || "").trim();
  if (!reason) throw new Error("Enter a reason for the return.");
  const fromGroupNo = String(input?.fromGroupNo ?? machine.groupNumber ?? "").trim();
  const notes = String(input?.notes || "").trim();
  const cycle = currentCycleNumber(machine);
  const recordedAt = now || new Date().toISOString();
  const recordedBy = user || "";
  const safePhotos = cleanPhotos(photos);

  const snapshot = {
    cycle,
    groupNumber: String(machine.groupNumber || "").trim(),
    dispatch: copy(machine.dispatch) || emptyDispatch(),
    delivery: copy(machine.delivery) || emptyDelivery(),
    installation: copy(machine.installation) || emptyInstallation(),
    warranty: copy(machine.warranty) || emptyWarranty(),
    resistance: copy(machine.resistance) || emptyResistanceRows(),
    temperature: copy(machine.temperature) || { temp: "", time: "" },
    photos: copy(machine.photos) || emptyPhotos(),
    packingChecklist: copy(machine.packingChecklist) || emptyPackingChecklist(),
    packingSentBack: copy(machine.packingSentBack) || emptyPackingSentBack(),
    finalPacking: copy(machine.finalPacking) || emptyFinalPacking(),
    sectionMeta: copy(machine.sectionMeta) || {},
    intake: copy(machine.intake),
    return: {
      date,
      reason,
      fromGroupNo,
      receivedAt,
      notes,
      photos: safePhotos.map((photo) => ({ ...photo })),
      recordedAt,
      recordedBy,
    },
    closedAt: recordedAt,
  };

  const reset = {
    cycle: cycle + 1,
    cycles: [...(Array.isArray(machine.cycles) ? machine.cycles : []), snapshot],
    groupNumber: "",
    resistance: emptyResistanceRows(),
    temperature: { temp: "", time: "" },
    photos: emptyPhotos(),
    packingChecklist: emptyPackingChecklist(),
    packingSentBack: emptyPackingSentBack(),
    finalPacking: emptyFinalPacking(),
    dispatch: emptyDispatch(),
    delivery: emptyDelivery(),
    installation: emptyInstallation(),
    warranty: emptyWarranty(),
    intake: {
      date,
      reason,
      fromGroupNo,
      receivedAt,
      notes,
      photos: safePhotos.map((photo) => ({ ...photo })),
      recordedAt,
      recordedBy,
      refurb: { startedAt: null, completedAt: "", completedBy: "", lines: [] },
    },
  };

  return {
    snapshot,
    reset,
    unlinkGroup: snapshot.groupNumber,
    cycleClosed: cycle,
    nextCycle: cycle + 1,
  };
}

export function planReturnUpdate(machine, patch) {
  if (!machine?.intake) throw new Error("Record a return before editing it.");
  if (machine.intake.refurb?.completedAt) {
    throw new Error("Refurbishment is already complete, so this return is closed.");
  }
  const next = {
    ...machine.intake,
    photos: cleanPhotos(machine.intake.photos),
    refurb: machine.intake.refurb || { startedAt: null, completedAt: "", completedBy: "", lines: [] },
  };
  if (patch?.date != null) next.date = requireDate(patch.date, "Return date");
  if (patch?.receivedAt != null) next.receivedAt = requireDate(patch.receivedAt, "Received at workshop");
  if (patch?.reason != null) {
    const reason = String(patch.reason).trim();
    if (!reason) throw new Error("Enter a reason for the return.");
    next.reason = reason;
  }
  if (patch?.notes != null) next.notes = String(patch.notes).trim();
  if (patch?.fromGroupNo != null) next.fromGroupNo = String(patch.fromGroupNo).trim();
  if (Array.isArray(patch?.addPhotos) && patch.addPhotos.length) {
    next.photos = [...next.photos, ...cleanPhotos(patch.addPhotos)];
  }
  if (patch?.removePhotoPath) {
    next.photos = next.photos.filter((photo) => photo.path !== patch.removePhotoPath);
  }
  return { intake: next };
}

export function planRefurbComplete(machine, { date, user, now } = {}) {
  if (!machine?.intake) throw new Error("Record a return before completing refurbishment.");
  if (machine.intake.refurb?.completedAt) throw new Error("Refurbishment is already complete.");
  const completedAt = requireDate(date, "Completion date");
  const refurb = machine.intake.refurb || { lines: [] };
  return {
    intake: {
      ...machine.intake,
      refurb: {
        ...refurb,
        lines: Array.isArray(refurb.lines) ? refurb.lines : [],
        startedAt: refurb.startedAt || now || new Date().toISOString(),
        completedAt,
        completedBy: user || "",
      },
    },
  };
}

export function withRefurbLine(machine, line, { now, user } = {}) {
  const refurb = machine.intake?.refurb || { lines: [] };
  const lines = Array.isArray(refurb.lines) ? refurb.lines : [];
  return {
    ...machine.intake,
    refurb: {
      ...refurb,
      startedAt: refurb.startedAt || now || new Date().toISOString(),
      completedAt: refurb.completedAt || "",
      completedBy: refurb.completedBy || "",
      lines: [...lines, { ...line, createdAt: now || new Date().toISOString(), createdBy: user || line.createdBy || "" }],
    },
  };
}
