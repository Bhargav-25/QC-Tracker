import { useState } from "react";
import { updateMachine, uploadMachinePhoto, deleteMachinePhoto } from "../../utils/machinesApi";
import { INSTALLATION_PHOTO_COUNT } from "../../constants";

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
  const installation = machine.installation || { photos: [], video: null };
  const [date, setDate] = useState(installation.date || "");
  const [uploadingSlot, setUploadingSlot] = useState(null); // "photo-0", "video", etc.
  const [saving, setSaving] = useState(false);
  const [geoWarning, setGeoWarning] = useState("");

  async function captureWithLocation(file, slotKey) {
    setUploadingSlot(slotKey);
    setGeoWarning("");
    try {
      const [{ url, path }, coords] = await Promise.all([
        uploadMachinePhoto(machine.id, "installation", file),
        getCurrentPosition(),
      ]);
      if (!coords) {
        setGeoWarning("Uploaded, but location couldn't be captured — check location permission for this site.");
      }
      setUploadingSlot(null);
      return { url, path, lat: coords?.lat ?? null, lng: coords?.lng ?? null, capturedAt: new Date().toISOString() };
    } catch (err) {
      setUploadingSlot(null);
      alert("Upload failed: " + err.message);
      return null;
    }
  }

  async function handleUploadPhoto(index, file) {
    if (!file) return;
    const entry = await captureWithLocation(file, "photo-" + index);
    if (!entry) return;
    const photos = [...(installation.photos || [])];
    photos[index] = entry;
    const nextLocation = installation.location || { lat: entry.lat, lng: entry.lng };
    await updateMachine(machine.id, {
      installation: { ...installation, photos, location: entry.lat ? nextLocation : installation.location },
    });
  }

  async function handleRemovePhoto(index) {
    const photo = installation.photos[index];
    if (photo?.path) await deleteMachinePhoto(photo.path);
    const photos = [...installation.photos];
    photos[index] = null;
    await updateMachine(machine.id, { installation: { ...installation, photos } });
  }

  async function handleUploadVideo(file) {
    if (!file) return;
    const entry = await captureWithLocation(file, "video");
    if (!entry) return;
    const nextLocation = installation.location || { lat: entry.lat, lng: entry.lng };
    await updateMachine(machine.id, {
      installation: { ...installation, video: entry, location: entry.lat ? nextLocation : installation.location },
    });
  }

  async function handleRemoveVideo() {
    if (installation.video?.path) await deleteMachinePhoto(installation.video.path);
    await updateMachine(machine.id, { installation: { ...installation, video: null } });
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

  const photoSlots = Array.from({ length: INSTALLATION_PHOTO_COUNT });
  const photosDone = (installation.photos || []).filter(Boolean).length;

  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <div className="section-title">Installation</div>
      <div className="section-sub">
        Upload {INSTALLATION_PHOTO_COUNT} photos and 1 video from the install —
        each one automatically records the location it was taken at. This
        date starts the warranty countdown.
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

      {geoWarning && (
        <div className="helper-text" style={{ color: "var(--amber)", marginBottom: 8 }}>
          {geoWarning}
        </div>
      )}

      <div className="photo-category">
        <h4>Photos</h4>
        <div className={"photo-count" + (photosDone >= INSTALLATION_PHOTO_COUNT ? " complete" : "")}>
          {photosDone} / {INSTALLATION_PHOTO_COUNT} uploaded
        </div>
        <div className="photo-grid">
          {photoSlots.map((_, i) => {
            const photo = installation.photos?.[i];
            const busy = uploadingSlot === "photo-" + i;
            return photo ? (
              <div className="photo-slot" key={i}>
                <img src={photo.url} alt={`Installation ${i + 1}`} />
                <button className="remove-btn" onClick={() => handleRemovePhoto(i)} disabled={busy}>
                  Remove
                </button>
              </div>
            ) : (
              <div className="photo-slot" key={i}>
                <label>
                  {busy ? "Uploading…" : `+ Photo ${i + 1}`}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={busy}
                    onChange={(e) => handleUploadPhoto(i, e.target.files[0])}
                  />
                </label>
              </div>
            );
          })}
        </div>
      </div>

      <div className="photo-category">
        <h4>Video</h4>
        <div className={"photo-count" + (installation.video ? " complete" : "")}>
          {installation.video ? "1 / 1 uploaded" : "0 / 1 uploaded"}
        </div>
        <div className="photo-grid" style={{ maxWidth: 150 }}>
          {installation.video ? (
            <div className="photo-slot">
              <video src={installation.video.url} controls style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button className="remove-btn" onClick={handleRemoveVideo} disabled={uploadingSlot === "video"}>
                Remove
              </button>
            </div>
          ) : (
            <div className="photo-slot">
              <label>
                {uploadingSlot === "video" ? "Uploading…" : "+ Add video"}
                <input
                  type="file"
                  accept="video/*"
                  capture="environment"
                  disabled={uploadingSlot === "video"}
                  onChange={(e) => handleUploadVideo(e.target.files[0])}
                />
              </label>
            </div>
          )}
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
