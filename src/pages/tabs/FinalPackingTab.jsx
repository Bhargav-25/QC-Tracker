import { useState } from "react";
import { FINAL_PACKING_ITEMS } from "../../constants";
import {
  updateMachine,
  uploadMachinePhoto,
  deleteMachinePhoto,
} from "../../utils/machinesApi";

export default function FinalPackingTab({ machine }) {
  const [busyKey, setBusyKey] = useState(null);
  const finalPacking = machine.finalPacking || {};

  async function handleUpload(itemKey, file, existing) {
    if (!file) return;
    setBusyKey(itemKey);
    try {
      const { url, path } = await uploadMachinePhoto(
        machine.id,
        `finalPacking-${itemKey}`,
        file
      );
      // If replacing, clean up the old file after the new one is safely uploaded.
      if (existing?.path) {
        await deleteMachinePhoto(existing.path);
      }
      const next = { ...finalPacking, [itemKey]: { url, path } };
      await updateMachine(machine.id, { finalPacking: next });
    } catch (err) {
      alert("Upload failed: " + err.message);
    }
    setBusyKey(null);
  }

  async function handleRemove(itemKey) {
    const existing = finalPacking[itemKey];
    setBusyKey(itemKey);
    if (existing?.path) {
      await deleteMachinePhoto(existing.path);
    }
    const next = { ...finalPacking, [itemKey]: null };
    await updateMachine(machine.id, { finalPacking: next });
    setBusyKey(null);
  }

  const allDone = FINAL_PACKING_ITEMS.every((item) => finalPacking[item.key]?.url);

  return (
    <div className="panel">
      <div className="section-title">Final packing</div>
      <div className="section-sub">
        Upload one photo for each step to confirm it's done. Once all four have a
        photo, this machine's status becomes "Packed". If a photo comes out
        blurry or wrong, use "Replace" to swap it — no need to remove it first.
      </div>

      {FINAL_PACKING_ITEMS.map((item) => {
        const photo = finalPacking[item.key];
        const busy = busyKey === item.key;
        return (
          <div className="photo-category" key={item.key}>
            <h4>{item.label}</h4>
            <div className={"photo-count" + (photo?.url ? " complete" : "")}>
              {photo?.url ? "Photo uploaded" : "No photo yet"}
            </div>
            <div className="photo-grid" style={{ maxWidth: 220 }}>
              {photo?.url ? (
                <div className="photo-slot">
                  <img src={photo.url} alt={item.label} />
                  <button className="remove-btn" onClick={() => handleRemove(item.key)} disabled={busy}>
                    Remove
                  </button>
                  <label
                    style={{
                      position: "absolute",
                      bottom: 4,
                      left: 4,
                      right: 4,
                      background: "rgba(21,23,26,0.85)",
                      color: "var(--amber)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      textAlign: "center",
                      padding: "3px 0",
                      borderRadius: 2,
                      cursor: "pointer",
                    }}
                  >
                    {busy ? "Uploading…" : "Replace"}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      disabled={busy}
                      onChange={(e) => handleUpload(item.key, e.target.files[0], photo)}
                    />
                  </label>
                </div>
              ) : (
                <div className="photo-slot">
                  <label>
                    {busy ? "Uploading…" : "+ Add photo"}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      disabled={busy}
                      onChange={(e) => handleUpload(item.key, e.target.files[0], null)}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {allDone && (
        <span className="helper-text" style={{ color: "var(--teal)" }}>
          All steps complete — will show as Packed
        </span>
      )}
    </div>
  );
}
