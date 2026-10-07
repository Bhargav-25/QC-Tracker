import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

function Lightbox({ src, alt, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(10, 11, 13, 0.94)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "56px 12px 12px",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 14px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="link"
          style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
        >
          Open original ↗
        </a>
        <button className="btn" onClick={onClose}>
          Close ✕
        </button>
      </div>
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          borderRadius: 2,
        }}
      />
    </div>,
    document.body
  );
}

// Drop-in replacement for <img>: shows the thumbnail, and tapping it opens
// the full-size image in an overlay.
export default function ViewableImage({ src, alt }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <img src={src} alt={alt} onClick={() => setOpen(true)} style={{ cursor: "zoom-in" }} />
      {open && <Lightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}
