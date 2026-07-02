import { useState } from "react";
import { updateMachine, uploadMachinePhoto, deleteMachinePhoto } from "../../utils/machinesApi";

function getCurrentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null), // permission denied or unavailable — upload still proceeds
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

export default function InstallationTab({ machine, currentUserEmail }) {
  const canInstall = machine.delivery?.delivered;
  const installation = machine.installation || { photos: [] };
  const [date, setDate] = useState(installation.date || "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [geoWarning, setGeoWarning] = useState("");

  async function handleUploadPhoto(file) {
    if (!file) return;
    setUploading(true);
    setGeoWarning("");
    try {
      const [{ url, path }, coords] = await Promise.all([
        uploadMachinePhoto(machine.id, "installation", file),
        getCurrentPosition(),
      ]);
      if (!coords) {
        setGeoWarning("Photo uploaded, but location couldn't be captured — check location permission for this site.");
      }
      const photoEntry = {
        url,
        path,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        capturedAt: new Date().toISOString(),
      };
      const nextPhotos = [...(installation.photos || []), photoEntry];
      const nextLocation = installation.location || (coords ? coords : null);
      await updateMachine(machine.id, {
        installation: { ...installation, photos: nextPhotos, location: nextLocation },
      });
    } catch (err) {
      alert("Upload failed: " + err.message);
    }
    setUploading(false);
  }

  async function handleRemovePhoto(index) {
    const photo = installation.photos[index];
    if (photo?.path) await deleteMachinePhoto(photo.path);
    const nextPhotos = installation.photos.filter((_, i) => i !== index);
    await updateMachine(machine.id, { installation: { ...installation, photos: nextPhotos } });
  }

  async function handleMarkInstalled() {
    setSaving(true);
    const finalDate = date || new Date().toISOString().slice(0, 10);
    setDate(finalDate);
    await updateMachine(machine.id, {
      installation: {
        ...installation,
        installed: true,
        date: finalDate,
        installedBy: currentUserEmail || installation.installedBy || "",
      },
    });
    setSaving(false);
  }

  async function handleUndo() {
    await updateMachine(machine.id, { installation: { ...installation, installed: false } });
  }

  if (!canInstall) {
    return (
      <div className="panel" style={{ maxWidth: 560 }}>
        <div className="section-title">Installation</div>
        <div className="empty-state">
          This machine hasn't been marked as delivered yet. Do that first, on
          the Delivery tab.
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <div className="section-title">Installation</div>
      <div className="section-sub">
        Upload photos from the install — each one automatically records the
        location it was taken at. This date starts the warranty countdown.
      </div>

      {installation.installedBy && (
        <div className="helper-text" style={{ marginBottom: 14 }}>
          Installed by <strong>{installation.installedBy}</strong>
          {installation.date ? ` on ${installation.date}` : ""}
        </div>
      )}

      {installation.location && (
        <div className="helper-text" style={{ marginBottom: 14 }}>
          Location:{" "}
          <a
            className="link"
            href={`https://maps.google.com/?q=${installation.location.lat},${installation.location.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            {installation.location.lat.toFixed(5)}, {installation.location.lng.toFixed(5)}
          </a>
        </div>
      )}

      <div className="field" style={{ maxWidth: 220 }}>
        <label>Date of installation</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="photo-category">
        <h4>Installation photos ({(installation.photos || []).length})</h4>
        {geoWarning && (
          <div className="helper-text" style={{ color: "var(--amber)", marginBottom: 8 }}>
            {geoWarning}
          </div>
        )}
        <div className="photo-grid">
          {(installation.photos || []).map((p, i) => (
            <div className="photo-slot" key={i}>
              <img src={p.url} alt={`Installation ${i + 1}`} />
              <button className="remove-btn" onClick={() => handleRemovePhoto(i)}>Remove</button>
            </div>
          ))}
          <div className="photo-slot">
            <label>
              {uploading ? "Uploading…" : "+ Add photo"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={uploading}
                onChange={(e) => handleUploadPhoto(e.target.files[0])}
              />
            </label>
          </div>
        </div>
      </div>

      {!installation.installed ? (
        <button className="btn btn-primary" onClick={handleMarkInstalled} disabled={saving}>
          {saving ? "Saving…" : "Mark as Installed"}
        </button>
      ) : (
        <div className="helper-text" style={{ color: "var(--teal)" }}>
          Marked as installed.{" "}
          <button className="btn btn-ghost" onClick={handleUndo}>Undo</button>
        </div>
      )}
    </div>
  );
}
