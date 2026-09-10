def test_register_and_login(client):
    resp = client.post(
        "/api/auth/register",
        json={"name": "Ada", "email": "ADA@Example.com", "password": "password123"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "ada@example.com"  # normalised
    assert body["role"] == "user"
    assert body["access_token"]
    # a session cookie is set
    assert client.cookies.get("annotateai_token")

    resp = client.post(
        "/api/auth/login",
        json={"email": "ada@example.com", "password": "password123", "role": "user"},
    )
    assert resp.status_code == 200


def test_register_rejects_bad_email(client):
    resp = client.post(
        "/api/auth/register",
        json={"name": "Ada", "email": "not-an-email", "password": "password123"},
    )
    assert resp.status_code == 422


def test_register_rejects_short_password(client):
    resp = client.post(
        "/api/auth/register",
        json={"name": "Ada", "email": "ada@example.com", "password": "short"},
    )
    assert resp.status_code == 422


def test_register_duplicate_email(client):
    payload = {"name": "Ada", "email": "ada@example.com", "password": "password123"}
    assert client.post("/api/auth/register", json=payload).status_code == 200
    assert client.post("/api/auth/register", json=payload).status_code == 409


def test_login_wrong_password_is_generic(client):
    client.post(
        "/api/auth/register",
        json={"name": "Ada", "email": "ada@example.com", "password": "password123"},
    )
    resp = client.post(
        "/api/auth/login",
        json={"email": "ada@example.com", "password": "wrongpass", "role": "user"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid email, password or account type"


def test_login_role_mismatch_does_not_leak_role(client):
    client.post(
        "/api/auth/register",
        json={"name": "Ada", "email": "ada@example.com", "password": "password123"},
    )
    resp = client.post(
        "/api/auth/login",
        json={"email": "ada@example.com", "password": "password123", "role": "admin"},
    )
    assert resp.status_code == 401
    assert "admin" not in resp.json()["detail"].lower()


def test_login_rate_limited_after_repeated_failures(client):
    client.post(
        "/api/auth/register",
        json={"name": "Ada", "email": "ada@example.com", "password": "password123"},
    )
    body = {"email": "ada@example.com", "password": "nope", "role": "user"}
    codes = [client.post("/api/auth/login", json=body).status_code for _ in range(7)]
    assert codes.count(429) >= 1
    assert codes[-1] == 429


def test_first_admin_requires_setup_key(client):
    resp = client.post(
        "/api/admin/create",
        json={
            "name": "Admin",
            "email": "admin@example.com",
            "password": "password123",
            "setup_key": "wrong-key",
        },
    )
    assert resp.status_code == 403


def test_logout_clears_cookie(user_client):
    resp = user_client.post("/api/auth/logout")
    assert resp.status_code == 200
