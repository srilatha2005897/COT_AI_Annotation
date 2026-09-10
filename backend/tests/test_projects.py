def test_requires_authentication(client):
    assert client.get("/api/projects").status_code == 401
    assert client.get("/api/dashboard").status_code == 401
    assert client.post("/api/projects", json={"name": "x"}).status_code == 401


def test_create_list_update_delete(user_client):
    resp = user_client.post("/api/projects", json={"name": "Roads", "description": "cars"})
    assert resp.status_code == 201
    project_id = resp.json()["id"]

    resp = user_client.get("/api/projects")
    assert resp.status_code == 200
    assert any(p["id"] == project_id for p in resp.json())

    resp = user_client.put(
        f"/api/projects/{project_id}", json={"name": "Highways", "description": "trucks"}
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Highways"

    resp = user_client.delete(f"/api/projects/{project_id}")
    assert resp.status_code == 200
    assert user_client.get(f"/api/projects/{project_id}").status_code == 404


def test_duplicate_project_name_rejected(user_client):
    user_client.post("/api/projects", json={"name": "Roads"})
    resp = user_client.post("/api/projects", json={"name": "Roads"})
    assert resp.status_code == 409


def test_project_list_pagination(user_client):
    for i in range(5):
        user_client.post("/api/projects", json={"name": f"P{i}"})
    resp = user_client.get("/api/projects", params={"limit": 2, "offset": 0})
    assert len(resp.json()) == 2
    resp = user_client.get("/api/projects", params={"limit": 2, "offset": 4})
    assert len(resp.json()) == 1


def test_admin_dashboard_is_admin_only(user_client):
    assert user_client.get("/api/admin/dashboard").status_code == 403


def test_admin_dashboard_ok_for_admin(admin_client):
    resp = admin_client.get("/api/admin/dashboard")
    assert resp.status_code == 200
    assert resp.json()["total_admins"] == 1
