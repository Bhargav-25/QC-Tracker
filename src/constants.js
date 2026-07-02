// Fixed current values (amps) tested on every machine, in order.
export const CURRENT_VALUES = [4, 9, 14, 18, 22, 37.5];

export const emptyResistanceRows = () =>
  CURRENT_VALUES.map((current) => ({
    current,
    eccentric: "",
    concentric: "",
  }));

// Photo categories and how many photos each one requires.
export const PHOTO_CATEGORIES = [
  { key: "ropeBurn", label: "Rope burn", count: 2 },
  { key: "shoulderPulley", label: "Shoulder pulley", count: 2 },
  { key: "led", label: "LED", count: 2 },
  { key: "armEnd", label: "Arm end", count: 2 },
];

export const emptyPhotos = () =>
  PHOTO_CATEGORIES.reduce((acc, cat) => {
    acc[cat.key] = [];
    return acc;
  }, {});

// The 7 items that must be included in the box shipped to the customer.
export const PACKING_CHECKLIST_ITEMS = [
  { key: "ankleStrap", label: "Ankle strap" },
  { key: "barbell", label: "Barbell" },
  { key: "dHandle", label: "D Handle" },
  { key: "cloth", label: "Cloth" },
  { key: "tabHolder", label: "Tab holder" },
  { key: "pipeEndCover", label: "Pipe end cover" },
  { key: "fastnersBox", label: "Fastners box" },
];

export const emptyPackingChecklist = () =>
  PACKING_CHECKLIST_ITEMS.reduce((acc, item) => {
    acc[item.key] = false;
    return acc;
  }, {});

export const emptyPackingSentBack = () =>
  PACKING_CHECKLIST_ITEMS.reduce((acc, item) => {
    acc[item.key] = false;
    return acc;
  }, {});

// The final packing / assembly-line steps — one photo proves each step was done.
export const FINAL_PACKING_ITEMS = [
  { key: "machineBolted", label: "Machine bolted", count: 1 },
  { key: "fastnersBox", label: "Fastners Box", count: 1 },
  { key: "frontCover", label: "Front cover", count: 1 },
  { key: "finalPacked", label: "Final packed", count: 1 },
];

export const emptyFinalPacking = () =>
  FINAL_PACKING_ITEMS.reduce((acc, item) => {
    acc[item.key] = null; // will hold { url, path } once a photo is uploaded
    return acc;
  }, {});

export const STATUS = {
  ASSEMBLY: "Assembly stage",
  TESTING: "Testing",
  PACKED: "Packed",
  DISPATCHED: "Dispatched",
};

export const STATUS_ORDER = [
  STATUS.ASSEMBLY,
  STATUS.TESTING,
  STATUS.PACKED,
  STATUS.DISPATCHED,
];
