import { useState } from "react";
import { addStandStock } from "../utils/inventoryApi";

export default function StandInventory({ standCount }) {
  const [stockInput, setStockInput] = useState("");
  const [stockSaving, setStockSaving] = useState(false);
  const [stockError, setStockError] = useState("");

  async function handleAddStock(e) {
    e.preventDefault();
    const qty = Number(stockInput);
    if (!qty || qty <= 0) return;
    setStockSaving(true);
    setStockError("");
    try {
      await addStandStock(qty);
      setStockInput("");
    } catch (err) {
      setStockError(err.message);
    }
    setStockSaving(false);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Production</div>
          <h1>Machine Stand Inventory</h1>
        </div>
      </div>

      <div className="panel">
        <div className="section-title">Current stock</div>
        <div className="section-sub">
          This is the pool available to include with dispatches, on each
          machine's Dispatch tab. Add stock here as new stands come in.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 34, color: standCount > 0 ? "var(--paper)" : "var(--rust)" }}>
              {standCount}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--paper-dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              in stock
            </div>
          </div>
          <form onSubmit={handleAddStock} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Add stock</label>
              <input
                type="number"
                min="1"
                value={stockInput}
                onChange={(e) => setStockInput(e.target.value)}
                placeholder="qty"
                style={{ width: 90 }}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={stockSaving}>
              {stockSaving ? "Adding…" : "Add"}
            </button>
          </form>
        </div>
        {stockError && (
          <div className="helper-text" style={{ color: "var(--rust)", marginTop: 12 }}>
            {stockError}
          </div>
        )}
      </div>
    </div>
  );
}
