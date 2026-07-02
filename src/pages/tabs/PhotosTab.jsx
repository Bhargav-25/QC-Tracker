import { useState } from "react";
import { PHOTO_CATEGORIES } from "../../constants";
import {
  updateMachine,
  uploadMachinePhoto,
  deleteMachinePhoto,
} from "../../utils/machinesApi";
import SectionMeta from "../../components/SectionMeta.jsx";

export default function PhotosTab({ machine, currentUserEmail }) {
  const [busyKey, setBusyKey] = useState(null);
  const photos = machine.photos || {};
  const meta = { userEmail: currentUserEmail, section: "photos", machineNumber: machine.machineNumber };

  async function handleUpload(categoryKey, file) {
    if (!file) return;
    setBusyKey(categoryKey + ":add");
    try {
      const { url, path } = await uploadMachinePhoto(machine.id, categoryKey, file);
      const current = photos[categoryKey] || [];
      const next = { ...photos, [categoryKey]: [...current, { url, path }] };
      await updateMachine(machine.id, { photos: next }, meta);
    } catch (err) {
      alert("Upload failed: " + err.message);
    }
    setBusyKey(null);
  }

  async function handleReplace(categoryKey, index, file) {
    if (!file) return;
    setBusyKey(categoryKey + ":" + index);
    try {
      const existing = photos[categoryKey][index];
      const { url, path } = await uploadMachinePhoto(machine.id, categoryKey, file);
      if (existing?.path) {
        await deleteMachinePhoto(existing.path);
      }
      const nextList = photos[categoryKey].map((p, i) =>
        i === index ? { url, path } : p
      );
      await updateMachine(machine.id, { photos: { ...photos, [categoryKey]: nextList } }, meta);
    } catch (err) {
      alert("Replace failed: " + err.message);
    }
    setBusyKey(null);
  }

  async function handleRemove(categoryKey, index) {
    const item = photos[categoryKey][index];
    setBusyKey(categoryKey + ":" + index);
    await deleteMachinePhoto(item.path);
    const next = {
      ...photos,
      [categoryKey]: photos[categoryKey].filter((_, i) => i !== index),
    };
    await updateMachine(machine.id, { photos: next }, meta);
    setBusyKey(null);
  }

  return (
    <div className="panel">
      <div className="section-title">Testing stage photos</div>
      <div className="section-sub">
        Upload the required photos for each testing stage. If a photo isn't
        clear, use "Replace" to swap it without losing the slot.
      </div>
      <SectionMeta meta={machine.sectionMeta?.photos} />

      {PHOTO_CATEGORIES.map((cat) => {
        const list = photos[cat.key] || [];
        const complete = list.length >= cat.count;
        const slotCount = Math.max(list.length, cat.count);
        const slots = Array.from({ length: slotCount });

        return (
          <div className="photo-category" key={cat.key}>
            <h4>{cat.label}</h4>
            <div className={"photo-count" + (complete ? " complete" : "")}>
              {list.length} / {cat.count} photos uploaded
              {complete ? " — complete" : ""}
            </div>
            <div className="photo-grid">
              {slots.map((_, i) => {
                const item = list[i];
                const busy = busyKey === cat.key + ":" + i || busyKey === cat.key + ":add";

                if (item) {
                  return (
                    <div className="photo-slot" key={i}>
                      <img src={item.url} alt={`${cat.label} ${i + 1}`} />
                      <button
                        className="remove-btn"
                        onClick={() => handleRemove(cat.key, i)}
                        disabled={busy}
                      >
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
                          onChange={(e) => handleReplace(cat.key, i, e.target.files[0])}
                        />
                      </label>
                    </div>
                  );
                }
                return (
                  <div className="photo-slot" key={i}>
                    <label>
                      {busy ? "Uploading…" : `+ Photo ${i + 1}`}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        disabled={busy}
                        onChange={(e) => handleUpload(cat.key, e.target.files[0])}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
