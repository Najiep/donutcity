"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  GripVertical,
  LogOut,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2
} from "lucide-react";

function blankUpdate() {
  return {
    id: `update-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    version: "v1.0.0",
    title: "New Donut City Update",
    date: new Date().toISOString().slice(0, 10),
    type: "Patch",
    featured: false,
    notes: ["New update"]
  };
}

export default function AdminPage() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [updates, setUpdates] = useState([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const checkSession = async () => {
    try {
      const response = await fetch("/api/admin/session", { cache: "no-store" });
      const data = await response.json();
      setAuthenticated(Boolean(data.authenticated));

      if (data.authenticated) {
        await loadUpdates();
      }
    } finally {
      setChecking(false);
    }
  };

  const loadUpdates = async () => {
    const response = await fetch("/api/admin/updates", { cache: "no-store" });

    if (response.status === 401) {
      setAuthenticated(false);
      return;
    }

    const data = await response.json();
    setUpdates(Array.isArray(data.updates) ? data.updates : []);
  };

  useEffect(() => {
    checkSession();
  }, []);

  const login = async (event) => {
    event.preventDefault();
    setMessage("");

    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });

    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error || "Login failed.");
      return;
    }

    setAuthenticated(true);
    setPassword("");
    setMessage("");
    await loadUpdates();
  };

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthenticated(false);
    setUpdates([]);
    setMessage("");
  };

  const changeUpdate = (index, field, value) => {
    setUpdates((current) =>
      current.map((update, i) =>
        i === index ? { ...update, [field]: value } : update
      )
    );
  };

  const removeUpdate = (index) => {
    if (!window.confirm("Delete this update?")) return;
    setUpdates((current) => current.filter((_, i) => i !== index));
  };

  const addUpdate = () => {
    setUpdates((current) => [blankUpdate(), ...current]);
  };

  const save = async () => {
    setSaving(true);
    setMessage("");

    const response = await fetch("/api/admin/updates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates })
    });

    const data = await response.json();

    if (response.status === 401) {
      setAuthenticated(false);
      setMessage("Session expired. Please log in again.");
      setSaving(false);
      return;
    }

    if (!response.ok) {
      setMessage(data.error || "Unable to save.");
      setSaving(false);
      return;
    }

    setUpdates(data.updates || updates);
    setMessage("Saved! Public patch notes are updated.");
    setSaving(false);
  };

  if (checking) {
    return (
      <main className="admin-shell admin-center">
        <div className="admin-loading">Loading admin...</div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="admin-shell admin-center">
        <section className="admin-login-card">
          <img src="/logo.svg" alt="Donut City" className="admin-logo" />
          <div className="admin-login-title">
            <ShieldCheck size={21} />
            <span>DONUT CITY ADMIN</span>
          </div>
          <h1>Patch Notes Dashboard</h1>
          <p>Login to manage the updates shown on your public website.</p>

          <form onSubmit={login} className="admin-login-form">
            <label>
              Admin Password
              <div className="password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter admin password"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label="Show or hide password"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            {message && <div className="admin-error">{message}</div>}

            <button className="admin-primary-button" type="submit">
              Login to Admin
            </button>
          </form>

          <a href="/" className="admin-back-link">
            <ArrowLeft size={16} />
            Back to website
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <a href="/" className="admin-brand">
          <img src="/logo.svg" alt="Donut City" />
          <div>
            <strong>DONUT CITY</strong>
            <span>Admin Dashboard</span>
          </div>
        </a>

        <div className="admin-top-actions">
          <a href="/#updates" className="admin-secondary-button" target="_blank">
            View Website
          </a>
          <button className="admin-secondary-button" onClick={logout}>
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </header>

      <section className="admin-container">
        <div className="admin-heading-row">
          <div>
            <div className="admin-eyebrow">
              <Sparkles size={15} />
              SERVER DEVELOPMENT
            </div>
            <h1>Updates & Patch Notes</h1>
            <p>
              Add, edit, feature, or remove updates. Click save when you're done.
            </p>
          </div>

          <div className="admin-heading-actions">
            <button className="admin-secondary-button" onClick={addUpdate}>
              <Plus size={17} />
              New Update
            </button>

            <button
              className="admin-primary-button"
              onClick={save}
              disabled={saving}
            >
              <Save size={17} />
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        {message && (
          <div className={message.startsWith("Saved") ? "admin-success" : "admin-error"}>
            {message}
          </div>
        )}

        <div className="admin-update-list">
          {updates.length === 0 && (
            <div className="admin-empty">
              No updates yet. Click <strong>New Update</strong> to create one.
            </div>
          )}

          {updates.map((update, index) => (
            <article className="admin-update-card" key={update.id || index}>
              <div className="admin-card-head">
                <div className="admin-card-label">
                  <GripVertical size={18} />
                  Update #{index + 1}
                </div>

                <div className="admin-card-tools">
                  <label className="featured-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(update.featured)}
                      onChange={(e) =>
                        changeUpdate(index, "featured", e.target.checked)
                      }
                    />
                    <Star size={16} />
                    Featured
                  </label>

                  <button
                    className="admin-delete-button"
                    onClick={() => removeUpdate(index)}
                    title="Delete update"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>

              <div className="admin-form-grid">
                <label>
                  Version
                  <input
                    value={update.version || ""}
                    onChange={(e) =>
                      changeUpdate(index, "version", e.target.value)
                    }
                    placeholder="v1.0.1"
                  />
                </label>

                <label>
                  Type
                  <input
                    value={update.type || ""}
                    onChange={(e) =>
                      changeUpdate(index, "type", e.target.value)
                    }
                    placeholder="Patch"
                  />
                </label>

                <label>
                  Date / Status
                  <input
                    value={update.date || ""}
                    onChange={(e) =>
                      changeUpdate(index, "date", e.target.value)
                    }
                    placeholder="August 14, 2026"
                  />
                </label>

                <label className="admin-wide-field">
                  Title
                  <input
                    value={update.title || ""}
                    onChange={(e) =>
                      changeUpdate(index, "title", e.target.value)
                    }
                    placeholder="Donut City Update"
                  />
                </label>

                <label className="admin-wide-field">
                  Patch Notes
                  <span className="admin-field-hint">One item per line</span>
                  <textarea
                    rows={7}
                    value={(update.notes || []).join("\n")}
                    onChange={(e) =>
                      changeUpdate(
                        index,
                        "notes",
                        e.target.value.split("\n")
                      )
                    }
                    placeholder={"Optimized scripts\nAdded new MLO\nFixed vehicle bugs"}
                  />
                </label>
              </div>
            </article>
          ))}
        </div>

        <div className="admin-bottom-save">
          <button
            className="admin-primary-button"
            onClick={save}
            disabled={saving}
          >
            <Save size={17} />
            {saving ? "Saving..." : "Save All Changes"}
          </button>
        </div>
      </section>
    </main>
  );
}
