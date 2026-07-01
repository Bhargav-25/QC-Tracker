import { useState } from "react";
import { PHOTO_CATEGORIES } from "../../constants";
import {
  updateMachine,
  uploadMachinePhoto,
  deleteMachinePhoto,
} from "../../utils/machinesApi";

export default function PhotosTab({ machine }) {
  const [busyKey, setBusyKey] = useState(null);
  const photos = machine.photos || {};

  async function handleUpload(categoryKey, file) {
    if (!file) return;
    setBusyKey(categoryKey);
    try {
      const { url, path } = await uploadMachinePhoto(machine.id, categoryKey, file);
      const current = photos[categoryKey] || [];
      const next = { ...photos, [categoryKey]: [...current, { url, path }] };
      await updateMachine(machine.id, { photos: next });
    } catch (err) {
      alert("Upload failed: " + err.message);
    }
    setBusyKey(null);
  }

  async function handleRemove(categoryKey, index) {
    const item = photos[categoryKey][index];
    setBusyKey(categoryKey);
    await deleteMachinePhoto(item.path);
    const next = {
      ...photos,
      [categoryKey]: photos[categoryKey].filter((_, i) => i !== index),
    };
    await updateMachine(machine.id, { photos: next });
    setBusyKey(null);
  }

  return (
    <div className="panel">
      <div className="section-title">Testing stage photos</div>
      <div className="section-sub">
        Upload the required photos for each testing stage.
      </div>

      {PHOTO_CATEGORIES.map((cat) => {
        const list = photos[cat.key] || [];
        const complete = list.length >= cat.count;
        const slots = Array.from({ length: cat.count });

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
                if (item) {
                  return (
                    <div className="photo-slot" key={i}>
                      <img src={item.url} alt={`${cat.label} ${i + 1}`} />
                      <button
                        className="remove-btn"
                        onClick={() => handleRemove(cat.key, i)}
                        disabled={busyKey === cat.key}
                      >
                        Remove
                      </button>
                    </div>
                  );
                }
                return (
                  <div className="photo-slot" key={i}>
                    <label>
                      {busyKey === cat.key ? "Uploading…" : `+ Photo ${i + 1}`}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        disabled={busyKey === cat.key}
                        onChange={(e) => handleUpload(cat.key, e.target.files[0])}
                      />
                    </label>
                  </div>
                );
              })}
              {/* Allow extra photos beyond the minimum count if needed */}
              {list.length > cat.count &&
                list.slice(cat.count).map((item, extraI) => {
                  const i = cat.count + extraI;
                  return (
                    <div className="photo-slot" key={i}>
                      <img src={item.url} alt={`${cat.label} ${i + 1}`} />
                      <button
                        className="remove-btn"
                        onClick={() => handleRemove(cat.key, i)}
                      >
                        Remove
                      </button>
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
