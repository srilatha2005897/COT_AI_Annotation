import { useState } from "react";
import { login, register, resetPassword } from "../api";
import "./Auth.css";

function AuthShell({
  children,
  title,
  subtitle,
  switchText,
  switchPath,
  switchLabel,
  mode,
}) {
  return (
    <main className="auth-page">
      {/* Left branding panel */}
      <section className="auth-left">
        <div className="auth-left-content">
          <a className="brand" href="#/">
            Annotate<span>AI</span>
          </a>

          <div className="brand-tagline">AI labels first, and humans do the rest.</div>

          <div className="hero-content">
            <h2>
              Label smarter.
              <br />
              <span>Work faster.</span>
            </h2>

            <p>
              YOLOv8 draws the first pass of bounding boxes. You review, fix and export a
              training-ready dataset.
            </p>

            <div className="workflow">
              <div className="workflow-item">
                <div className="workflow-icon">↑</div>
                <div>
                  <strong>Upload</strong>
                  <small>Add your images</small>
                </div>
              </div>

              <div className="workflow-line" />

              <div className="workflow-item">
                <div className="workflow-icon">✦</div>
                <div>
                  <strong>Detect</strong>
                  <small>AI finds objects</small>
                </div>
              </div>

              <div className="workflow-line" />

              <div className="workflow-item">
                <div className="workflow-icon">✓</div>
                <div>
                  <strong>Review</strong>
                  <small>Fix the boxes</small>
                </div>
              </div>

              <div className="workflow-line" />

              <div className="workflow-item">
                <div className="workflow-icon">↓</div>
                <div>
                  <strong>Export</strong>
                  <small>YOLO dataset</small>
                </div>
              </div>
            </div>
          </div>

          <div className="auth-footer">© 2026 AnnotateAI</div>
        </div>
      </section>

      {/* Right authentication panel */}
      <section className={`auth-right ${mode}`}>
        <div className="auth-card">
          <a className="mobile-brand" href="#/">
            Annotate<span>AI</span>
          </a>

          <div className="auth-header">
            <h1>{title}</h1>

            <p>{subtitle}</p>
          </div>

          {children}

          <div className="auth-switch">
            <span>{switchText}</span>
            <a href={`#${switchPath}`}>{switchLabel}</a>
          </div>

          <a className="auth-home-link" href="#/">
            ← Back to home
          </a>
        </div>
      </section>

      <div className="auth-decoration decoration-one" />
      <div className="auth-decoration decoration-two" />
    </main>
  );
}

export function LoginPage({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const user = await login({ email: email.trim(), password, role });
      localStorage.setItem("annotateai_user", JSON.stringify(user));
      onSuccess(user);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      mode="login"
      title="Login"
      subtitle="Welcome back. Sign in to continue to your annotation workspace."
      switchText="Don't have an account?"
      switchPath="/register"
      switchLabel="Create an account"
    >
      <form className="auth-form" onSubmit={submit}>
        {/* Account type */}
        <div className="form-group">
          <label htmlFor="login-role">Account type</label>
          <div className="input-wrapper select-wrapper">
            <span className="input-icon">♟</span>
            <select
              id="login-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              required
            >
              <option value="user">User</option>
              <option value="annotator">Annotator</option>
              <option value="team_lead">Team Lead</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>

        {/* Email */}
        <div className="form-group">
          <label htmlFor="login-email">Email address</label>
          <div className="input-wrapper">
            <span className="input-icon">✉</span>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
        </div>

        {/* Password */}
        <div className="form-group password-group">
          <div className="password-label-row">
            <label htmlFor="login-password">Password</label>
            <a href="#forgot" className="forgot-link">
              Forgot password?
            </a>
          </div>
          <div className="input-wrapper">
            <span className="input-icon">●</span>
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {error && (
          <div className="error-message">
            <span>!</span>
            {error}
          </div>
        )}

        <button type="submit" className="auth-button" disabled={loading}>
          {loading ? (
            <>
              <span className="spinner" />
              Signing in...
            </>
          ) : (
            <>
              Sign in
              <span className="button-arrow">→</span>
            </>
          )}
        </button>

        <div className="secure-note">
          <span>🔒</span>
          Your data is securely protected
        </div>
      </form>
    </AuthShell>
  );
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function RegisterPage({ onSuccess }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");

    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("Please enter a valid email address");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    if (role === "admin" && !setupKey.trim()) {
      setError("Admin Setup Key is required for admin registration");
      return;
    }

    setLoading(true);

    try {
      const user = await register({
        name: name.trim(),
        email: email.trim(),
        role,
        password,
        setup_key: role === "admin" ? setupKey : undefined,
      });

      localStorage.setItem("annotateai_user", JSON.stringify(user));
      onSuccess(user);
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      mode="register"
      title="Create your account"
      subtitle="Join AnnotateAI and start building accurate annotations faster."
      switchText="Already have an account?"
      switchPath="/login"
      switchLabel="Login"
    >
      <form className="auth-form" onSubmit={submit}>
        {/* 1. Full name */}
        <div className="form-group">
          <label htmlFor="register-name">Full name</label>
          <div className="input-wrapper">
            <span className="input-icon">♙</span>
            <input
              id="register-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              minLength="2"
              required
            />
          </div>
        </div>

        {/* 2. Email address */}
        <div className="form-group">
          <label htmlFor="register-email">Email address</label>
          <div className="input-wrapper">
            <span className="input-icon">✉</span>
            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
        </div>

        {/* 3. Role type */}
        <div className="form-group">
          <label htmlFor="register-role">Role type</label>
          <div className="input-wrapper select-wrapper">
            <span className="input-icon">♟</span>
            <select
              id="register-role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setSetupKey("");
                setError("");
              }}
              required
            >
              <option value="user">User</option>
              <option value="annotator">Annotator</option>
              <option value="team_lead">Team Lead</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>

        {/* 4. Password */}
        <div className="form-group">
          <label htmlFor="register-password">Password</label>
          <div className="input-wrapper">
            <span className="input-icon">●</span>
            <input
              id="register-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              minLength="8"
              required
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {/* 5. Confirm password */}
        <div className="form-group">
          <label htmlFor="register-confirm">Confirm password</label>
          <div className="input-wrapper">
            <span className="input-icon">●</span>
            <input
              id="register-confirm"
              type={showPassword ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              autoComplete="new-password"
              minLength="8"
              required
            />
          </div>
        </div>

        {/* 6. Admin setup key — only for admins */}
        {role === "admin" && (
          <div className="form-group">
            <label htmlFor="register-admin-key">Admin Setup Key</label>
            <div className="input-wrapper">
              <span className="input-icon">🔑</span>
              <input
                id="register-admin-key"
                type="password"
                value={setupKey}
                onChange={(e) => setSetupKey(e.target.value)}
                placeholder="Enter admin setup key"
                autoComplete="off"
                required
              />
            </div>
            <small className="field-help">
              Required only when creating an administrator account.
            </small>
          </div>
        )}

        {error && (
          <div className="error-message">
            <span>!</span>
            {error}
          </div>
        )}

        <button type="submit" className="auth-button" disabled={loading}>
          {loading ? (
            <>
              <span className="spinner" />
              {role === "admin" ? "Creating admin account..." : "Creating account..."}
            </>
          ) : (
            <>
              {role === "admin" ? "Create admin account" : "Create account"}
              <span className="button-arrow">→</span>
            </>
          )}
        </button>

        <div className="secure-note">
          <span>🔒</span>
          Your information is securely protected
        </div>
      </form>
    </AuthShell>
  );
}


export function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const submit = async (e) => {
    e.preventDefault();

    setError("");
    setSuccess("");

    const trimmedEmail = email.trim().toLowerCase();

    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setError("Please enter a valid email address");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      await resetPassword({
        email: trimmedEmail,
        password,
      });

      setSuccess(
        "Password reset successfully. Redirecting to login..."
      );

      setEmail("");
      setPassword("");
      setConfirmPassword("");

      setTimeout(() => {
        window.location.hash = "#/login";
      }, 1500);
    } catch (err) {
      setError(err.message || "Unable to reset password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      mode="reset-password"
      title="Reset Password"
      subtitle="Create a new password for your AnnotateAI account."
      switchText="Remember your password?"
      switchPath="/login"
      switchLabel="Back to login"
    >
      <form className="auth-form" onSubmit={submit}>

        {/* Email */}
        <div className="form-group">
          <label htmlFor="reset-email">Email address</label>

          <div className="input-wrapper">
            <span className="input-icon">✉</span>

            <input
              id="reset-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
        </div>

        {/* Reset Password */}
        <div className="form-group">
          <label htmlFor="reset-password">
            Reset password
          </label>

          <div className="input-wrapper">
            <span className="input-icon">●</span>

            <input
              id="reset-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter new password"
              autoComplete="new-password"
              minLength="8"
              required
            />

            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={
                showPassword
                  ? "Hide password"
                  : "Show password"
              }
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {/* Confirm Reset Password */}
        <div className="form-group">
          <label htmlFor="reset-confirm-password">
            Confirm reset password
          </label>

          <div className="input-wrapper">
            <span className="input-icon">●</span>

            <input
              id="reset-confirm-password"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              minLength="8"
              required
            />
          </div>
        </div>

        {error && (
          <div className="error-message">
            <span>!</span>
            {error}
          </div>
        )}

        {success && (
          <div className="success-message">
            <span>✓</span>
            {success}
          </div>
        )}

        <button
          type="submit"
          className="auth-button"
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="spinner" />
              Resetting password...
            </>
          ) : (
            <>
              Reset Password
              <span className="button-arrow">→</span>
            </>
          )}
        </button>

        <div className="secure-note">
          <span>🔒</span>
          Your new password is securely protected
        </div>
      </form>
    </AuthShell>
  );
}