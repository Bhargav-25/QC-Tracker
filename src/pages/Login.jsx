import { useState } from "react";
import { loginWithEmail } from "../utils/authApi";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMsg("");
    setLoading(true);
    try {
      await loginWithEmail(email.trim(), password);
    } catch (err) {
      setErrorMsg("Login failed — check your email and password.");
    }
    setLoading(false);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div className="panel" style={{ width: "100%", maxWidth: 380 }}>
        <div className="eyebrow">QC Track</div>
        <h1 style={{ fontSize: 22, marginBottom: 20 }}>Sign in</h1>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {errorMsg && (
            <div className="helper-text" style={{ color: "var(--rust)", marginBottom: 12 }}>
              {errorMsg}
            </div>
          )}
          <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="helper-text" style={{ marginTop: 16 }}>
          Don't have an account? Ask an admin to create one and assign your role.
        </div>
      </div>
    </div>
  );
}
