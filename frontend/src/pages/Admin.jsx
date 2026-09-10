import { useEffect, useState } from "react";
import { getAdminDashboard } from "../api";
import { formatDateTime } from "../lib/dates";
import "./Admin.css";

export function AdminDashboardPage({ user, onLogout }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getAdminDashboard()
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((err) => {
        if (alive) {
          setError(err.message);
          const msg = err.message.toLowerCase();
          if (
            msg.includes("authentication") ||
            msg.includes("token") ||
            msg.includes("session")
          ) {
            onLogout?.();
          }
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [onLogout]);

  if (loading)
    return (
      <div className="admin-page embedded">
        <div className="admin-loading">Loading Admin Dashboard…</div>
      </div>
    );
  if (error)
    return (
      <div className="admin-page embedded">
        <div className="admin-error">{error}</div>
      </div>
    );
  if (!data) return null;

  return (
    <div className="admin-page embedded">
      <div className="admin-stats">
        <div className="admin-stat">
          <span>Total Users</span>
          <strong>{data.total_users}</strong>
        </div>
        <div className="admin-stat">
          <span>Administrators</span>
          <strong>{data.total_admins}</strong>
        </div>
        <div className="admin-stat">
          <span>Images</span>
          <strong>{data.total_images}</strong>
        </div>
        <div className="admin-stat">
          <span>Objects</span>
          <strong>{data.total_objects}</strong>
        </div>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>User Accounts</h2>
            <p>Role-based accounts currently registered in AnnotateAI.</p>
          </div>
          <span className="admin-user-pill">Signed in: {user?.name || user?.email}</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
  <tr>
    <th>Name</th>
    <th>Email</th>
    <th>Role</th>
    <th>Login Time</th>
    <th>Logout Time</th>
  </tr>
</thead>
            <tbody>
              {data.users.map((account) => (
                <tr key={account.id}>
                  <td>{account.name}</td>
                  <td>{account.email}</td>
                  <td>
                    <span className={`role-badge ${account.role}`}>{account.role}</span>
                  </td>
                  <td>
  {account.login_time
    ? formatDateTime(account.login_time)
    : "Not logged in"}
</td>

<td>
  {account.logout_time
    ? formatDateTime(account.logout_time)
    : "Currently logged in"}
</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
