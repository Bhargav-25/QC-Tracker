export default function SectionMeta({ meta }) {
  if (!meta?.updatedBy) return null;
  const date = meta.updatedAt?.toDate ? meta.updatedAt.toDate() : null;
  return (
    <div className="helper-text" style={{ marginBottom: 16 }}>
      Last updated by <strong>{meta.updatedBy}</strong>
      {date ? ` on ${date.toLocaleString()}` : ""}
    </div>
  );
}
