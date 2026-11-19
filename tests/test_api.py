"""API tests: run with `python -m pytest` (needs requirements-dev.txt). Each test gets its own empty database."""
import importlib
import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def app_module(tmp_path, monkeypatch):
    monkeypatch.setenv("SLEEP_DB", str(tmp_path / "test.db"))
    import app

    return importlib.reload(app)


@pytest.fixture
def client(app_module):
    return TestClient(app_module.app)


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(client):
    r = client.post("/api/setup", json={"username": "admin", "password": "password1"})
    assert r.status_code == 200
    return bearer(r.json()["token"])


def fresh(app_module):
    """A client with no cookies, so it really is anonymous."""
    return TestClient(app_module.app)


def sync_token(client, admin, device_id=None):
    body = {"label": "Phone", **({"device_id": device_id} if device_id else {})}
    return bearer(client.post("/api/tokens", headers=admin, json=body).json()["token"])


def rec(type_, start, value, end=None, source="a", extra=None):
    return {"type": type_, "start": start, "end": end, "value": value, "source": source, "extra": extra}


def test_status_reports_a_version_and_that_setup_is_needed(client):
    s = client.get("/api/status").json()
    assert s["needs_setup"] is True
    assert s["app"] == "healthconnector"
    assert s["version"] != "unknown"


def test_first_account_is_the_admin_and_setup_works_once(client):
    assert client.post("/api/setup", json={"username": "a", "password": "password1"}).json()["is_admin"] is True
    assert client.post("/api/setup", json={"username": "b", "password": "password1"}).status_code == 403


def test_everything_needs_a_login(app_module, admin):
    anon = fresh(app_module)
    for path in ["/api/daily?types=steps", "/api/latest", "/api/records?type=steps", "/api/tokens", "/api/users", "/api/me"]:
        assert anon.get(path).status_code == 401, path
    assert anon.post("/api/ingest", json={"records": []}).status_code == 401


def test_a_cookie_session_must_send_the_csrf_header_but_a_bearer_token_need_not(app_module, admin):
    c = fresh(app_module)
    assert c.post("/api/login", json={"username": "admin", "password": "password1"}).status_code == 200
    assert c.post("/api/tokens", json={"label": "x"}).status_code == 403
    assert c.post("/api/tokens", json={"label": "x"}, headers={"X-HC": "1"}).status_code == 200
    assert fresh(app_module).post("/api/tokens", json={"label": "x"}, headers=admin).status_code == 200


def test_wrong_password_is_refused(app_module, admin):
    assert fresh(app_module).post("/api/login", json={"username": "admin", "password": "nope"}).status_code == 401


def test_sync_tokens_can_only_ingest(client, admin):
    t = sync_token(client, admin)
    assert client.post("/api/ingest", headers=t, json={"records": []}).status_code == 200
    for path in ["/api/daily?types=steps", "/api/tokens", "/api/users"]:
        assert client.get(path, headers=t).status_code == 401
    assert client.post("/api/ingest", headers=admin, json={"records": []}).status_code == 401  # a session can't ingest


def test_a_phone_signing_in_again_replaces_its_token_instead_of_adding_one(client, admin):
    first = sync_token(client, admin, "phone-1")
    sync_token(client, admin, "phone-2")
    second = sync_token(client, admin, "phone-1")
    assert len(client.get("/api/tokens", headers=admin).json()) == 2
    assert client.post("/api/ingest", headers=first, json={"records": []}).status_code == 401
    assert client.post("/api/ingest", headers=second, json={"records": []}).status_code == 200


def test_a_phone_can_be_renamed_and_removed(client, admin):
    t = sync_token(client, admin, "phone-1")
    tid = client.get("/api/tokens", headers=admin).json()[0]["id"]
    assert client.patch(f"/api/tokens/{tid}", headers=admin, json={"label": "Pixel 8"}).status_code == 200
    assert client.get("/api/tokens", headers=admin).json()[0]["label"] == "Pixel 8"
    assert client.delete(f"/api/tokens/{tid}", headers=admin).status_code == 200
    assert client.post("/api/ingest", headers=t, json={"records": []}).status_code == 401


def test_uploads_are_limited_to_5000_records_a_request(client, admin):
    t = sync_token(client, admin)
    ok = [rec("steps", f"2026-11-17T10:{i % 60:02d}:00Z", i, source=str(i // 60)) for i in range(1000)]
    assert client.post("/api/ingest", headers=t, json={"records": ok}).json()["stored"] == 1000
    assert client.post("/api/ingest", headers=t, json={"records": ok * 6}).status_code == 422


def test_resending_a_record_replaces_it(client, admin):
    t = sync_token(client, admin)
    r = rec("weight", "2026-11-17T07:00:00Z", 80)
    client.post("/api/ingest", headers=t, json={"records": [r]})
    client.post("/api/ingest", headers=t, json={"records": [{**r, "value": 79}]})
    rows = client.get("/api/records?type=weight", headers=admin).json()
    assert [x["value"] for x in rows] == [79]


def test_unknown_types_are_skipped(client, admin):
    t = sync_token(client, admin)
    out = client.post("/api/ingest", headers=t, json={"records": [rec("bogus", "2026-11-17T10:00:00Z", 1), rec("steps", "2026-11-17T10:00:00Z", 1)]}).json()
    assert (out["stored"], out["skipped"]) == (1, 1)


def test_daily_takes_the_larger_source_for_totals_and_averages_the_rest(client, admin):
    t = sync_token(client, admin)
    client.post("/api/ingest", headers=t, json={"records": [
        rec("steps", "2026-11-17T10:00:00Z", 1000, source="watch"), rec("steps", "2026-11-17T12:00:00Z", 500, source="watch"),
        rec("steps", "2026-11-17T10:00:00Z", 900, source="phone"),
        rec("heart_rate", "2026-11-17T10:00:00Z", 60), rec("heart_rate", "2026-11-17T10:05:00Z", 80),
    ]})
    d = client.get("/api/daily?types=steps,heart_rate&days=400&tz=0", headers=admin).json()
    assert d["steps"][0]["value"] == 1500 and d["steps"][0]["count"] == 3
    hr = d["heart_rate"][0]
    assert (hr["value"], hr["min"], hr["max"]) == (70, 60, 80)


def test_sleep_counts_on_the_day_it_ends_in_the_viewers_time_zone(client, admin):
    t = sync_token(client, admin)
    client.post("/api/ingest", headers=t, json={"records": [rec("sleep", "2026-11-17T22:30:00Z", 450, end="2026-11-18T06:30:00Z")]})
    assert client.get("/api/daily?types=sleep&days=400&tz=0", headers=admin).json()["sleep"][0]["date"] == "2026-11-18"
    assert client.get("/api/daily?types=sleep&days=400&tz=-480", headers=admin).json()["sleep"][0]["date"] == "2026-11-17"


def test_each_person_sees_only_their_own_data(client, admin):
    t = sync_token(client, admin)
    client.post("/api/ingest", headers=t, json={"records": [rec("steps", "2026-11-17T10:00:00Z", 5)]})
    assert client.post("/api/users", headers=admin, json={"username": "sam", "password": "password2"}).status_code == 200
    sam = bearer(client.post("/api/login", json={"username": "sam", "password": "password2"}).json()["token"])
    assert client.get("/api/daily?types=steps&days=400", headers=sam).json()["steps"] == []
    assert client.get("/api/users", headers=sam).status_code == 403


def test_password_rules_apply_to_new_passwords_and_only_an_admin_sets_them(client, admin):
    assert client.post("/api/users", headers=admin, json={"username": "x", "password": "p"}).status_code == 200  # open by default
    rules = {"min_length": 6, "require_upper": True, "require_lower": False, "require_digit": True, "require_symbol": False}
    assert client.put("/api/password-policy", headers=admin, json=rules).status_code == 200
    bad = client.post("/api/users", headers=admin, json={"username": "y", "password": "abcdef"})
    assert bad.status_code == 400 and "uppercase letter and a number" in bad.json()["detail"]
    assert client.post("/api/users", headers=admin, json={"username": "z", "password": "Abcde1"}).status_code == 200
    z = bearer(client.post("/api/login", json={"username": "z", "password": "Abcde1"}).json()["token"])
    assert client.put("/api/password-policy", headers=z, json=rules).status_code == 403
    assert client.put("/api/password-policy", headers=admin, json={**rules, "min_length": 0}).status_code == 422


def test_a_database_the_server_cannot_write_gives_a_clear_message(tmp_path, monkeypatch):
    db = tmp_path / "ro.db"
    db.write_text("")
    db.chmod(0o444)
    if os.access(db, os.W_OK):  # running as root: permissions don't apply
        pytest.skip("can't make a file unwritable as root")
    monkeypatch.setenv("SLEEP_DB", str(db))
    import app

    with pytest.raises(SystemExit) as e:
        importlib.reload(app)
    assert "chown" in str(e.value)
