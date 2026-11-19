"""Health Connect dashboard server.

Web UI (static/) talks to this JSON API with a login session cookie. Phones
forward Health Connect data with a per-account device token, which can only
call POST /api/ingest.

Accounts: the first visit creates the admin account; the admin adds other
people. Every record, token and session belongs to one account.
"""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

DB_PATH = os.environ.get("SLEEP_DB", "sleep.db")
_HERE = os.path.dirname(os.path.abspath(__file__))
# In the container the built web app is ./static; in development it's web/dist.
STATIC = os.environ.get("HC_STATIC") or next(
    (p for p in (os.path.join(_HERE, "web", "dist"), os.path.join(_HERE, "static")) if os.path.isfile(os.path.join(p, "index.html"))),
    os.path.join(_HERE, "static"),
)
SESSION_COOKIE = "hc_session"
SESSION_DAYS = 30

# type -> unit.  "sum" types add up over a day; the rest are averaged.
TYPES = {
    "sleep": ("min", "sum"),
    "steps": ("count", "sum"),
    "distance": ("m", "sum"),
    "active_calories": ("kcal", "sum"),
    "total_calories": ("kcal", "sum"),
    "hydration": ("L", "sum"),
    "nutrition": ("kcal", "sum"),
    "exercise": ("min", "sum"),
    "heart_rate": ("bpm", "avg"),
    "resting_heart_rate": ("bpm", "avg"),
    "hrv": ("ms", "avg"),
    "weight": ("kg", "avg"),
    "body_fat": ("%", "avg"),
    "height": ("m", "avg"),
    "blood_pressure": ("mmHg", "avg"),
    "blood_glucose": ("mmol/L", "avg"),
    "oxygen_saturation": ("%", "avg"),
    "body_temperature": ("°C", "avg"),
    "respiratory_rate": ("/min", "avg"),
}
# Sleep is attributed to the day you wake up; everything else to its start.
DAY_BY_END = {"sleep"}

app = FastAPI(title="healthconnector", docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "same-origin"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    )
    if request.url.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


# ---------------------------------------------------------------- database

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init():
    path = os.path.abspath(DB_PATH)
    folder = os.path.dirname(path)
    # The folder must be writable, and so must the file if an older version already made it (as root).
    if not os.access(folder, os.W_OK) or (os.path.exists(path) and not os.access(path, os.W_OK)):
        raise SystemExit(
            f"Can't write to the database at {path}. "
            "In Docker, run:  mkdir -p data && sudo chown -R 1000:1000 data  (the container runs as user 1000)."
        )
    with closing(db()) as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS user (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                pw_hash TEXT NOT NULL,
                is_admin INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS session (
                hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS api_token (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
                label TEXT NOT NULL,
                hash TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                last_used_at TEXT
            );
            CREATE TABLE IF NOT EXISTS record (
                user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                start TEXT NOT NULL,
                end TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT '',
                value REAL,
                extra TEXT,
                PRIMARY KEY (user_id, type, start, end, source)
            );
            CREATE INDEX IF NOT EXISTS record_by_time ON record (user_id, type, start);
            """
        )
        if "device_id" not in [r["name"] for r in c.execute("PRAGMA table_info(api_token)")]:
            c.execute("ALTER TABLE api_token ADD COLUMN device_id TEXT")
        c.execute("INSERT OR IGNORE INTO meta (key, value) VALUES ('instance_id', ?)", (secrets.token_hex(8),))
        c.commit()


init()


def instance_id() -> str:
    with closing(db()) as c:
        return c.execute("SELECT value FROM meta WHERE key='instance_id'").fetchone()[0]


# ---------------------------------------------------------------- passwords

def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${h.hex()}"


def check_password(pw: str, stored: str) -> bool:
    try:
        _, salt, h = stored.split("$")
        got = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1, dklen=32)
        return hmac.compare_digest(got.hex(), h)
    except Exception:
        return False


def sha(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- rate limit

_fails: dict = {}


def throttle(key: str, limit: int = 8, window: int = 900):
    now = time.time()
    hits = [t for t in _fails.get(key, []) if now - t < window]
    _fails[key] = hits
    if len(hits) >= limit:
        raise HTTPException(429, "Too many attempts. Try again in a few minutes.")


def fail(key: str):
    _fails.setdefault(key, []).append(time.time())


def client_ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (
        request.client.host if request.client else "?"
    )


# ---------------------------------------------------------------- auth

def user_from_session(request: Request):
    """Returns (user, via) where via is 'cookie' (the web app) or 'bearer' (the
    Android app, which keeps its session token itself)."""
    auth = request.headers.get("authorization", "")
    raw, via = (auth[7:], "bearer") if auth.startswith("Bearer ") else (request.cookies.get(SESSION_COOKIE), "cookie")
    if not raw:
        return None, None
    with closing(db()) as c:
        row = c.execute(
            "SELECT u.id, u.username, u.is_admin, s.expires_at FROM session s "
            "JOIN user u ON u.id = s.user_id WHERE s.hash=?",
            (sha(raw),),
        ).fetchone()
    if not row or row["expires_at"] < now_iso():
        return None, None
    return dict(id=row["id"], username=row["username"], is_admin=bool(row["is_admin"])), via


def web_user(request: Request):
    """A signed-in session. With a cookie, unsafe methods also need the X-HC
    header, which a cross-site form or fetch cannot send, so a cookie alone
    can't be abused. A bearer token isn't sent automatically, so needs no check."""
    u, via = user_from_session(request)
    if not u:
        raise HTTPException(401, "not signed in")
    if via == "cookie" and request.method not in ("GET", "HEAD") and request.headers.get("x-hc") != "1":
        raise HTTPException(403, "missing X-HC header")
    request.state.session_raw = request.headers.get("authorization", "")[7:] or request.cookies.get(SESSION_COOKIE)
    return u


def admin_user(u=Depends(web_user)):
    if not u["is_admin"]:
        raise HTTPException(403, "admin only")
    return u


def device_user(authorization: str = Header(default="")):
    """A phone's per-account token. Valid for ingest only."""
    t = authorization[7:] if authorization.startswith("Bearer ") else ""
    if t:
        with closing(db()) as c:
            row = c.execute(
                "SELECT t.id, t.user_id, u.username, u.is_admin FROM api_token t "
                "JOIN user u ON u.id = t.user_id WHERE t.hash=?",
                (sha(t),),
            ).fetchone()
            if row:
                c.execute("UPDATE api_token SET last_used_at=? WHERE id=?", (now_iso(), row["id"]))
                c.commit()
                return dict(id=row["user_id"], username=row["username"], is_admin=bool(row["is_admin"]))
    raise HTTPException(401, "bad token")


def start_session(request: Request, response: Response, user_id: int) -> str:
    raw = secrets.token_urlsafe(32)
    exp = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).isoformat()
    with closing(db()) as c:
        c.execute("DELETE FROM session WHERE expires_at < ?", (now_iso(),))
        c.execute("INSERT INTO session (hash, user_id, expires_at) VALUES (?,?,?)", (sha(raw), user_id, exp))
        c.commit()
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(
        SESSION_COOKIE, raw, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=secure, path="/"
    )
    return raw


# ---------------------------------------------------------------- accounts

class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=200)


def clean_username(name: str) -> str:
    name = name.strip().lower()
    if not name or len(name) > 40 or not all(ch.isalnum() or ch in "._-" for ch in name):
        raise HTTPException(400, "Username: letters, numbers, . _ - only")
    return name


DEFAULT_POLICY = {"min_length": 1, "require_upper": False, "require_lower": False, "require_digit": False, "require_symbol": False}


def get_policy() -> dict:
    with closing(db()) as c:
        row = c.execute("SELECT value FROM meta WHERE key='password_policy'").fetchone()
    return {**DEFAULT_POLICY, **(json.loads(row["value"]) if row else {})}


def policy_problems(pw: str, p: dict) -> list:
    """What a new password is missing, as phrases for a sentence."""
    out = []
    if len(pw) < p["min_length"]:
        out.append(f"at least {p['min_length']} character{'s' if p['min_length'] != 1 else ''}")
    if p["require_upper"] and not any(ch.isupper() for ch in pw):
        out.append("an uppercase letter")
    if p["require_lower"] and not any(ch.islower() for ch in pw):
        out.append("a lowercase letter")
    if p["require_digit"] and not any(ch.isdigit() for ch in pw):
        out.append("a number")
    if p["require_symbol"] and not any(not ch.isalnum() for ch in pw):
        out.append("a symbol")
    return out


def check_new_password(pw: str):
    """Applies to passwords being set from now on; existing ones aren't re-checked."""
    problems = policy_problems(pw, get_policy())
    if problems:
        raise HTTPException(400, "Password needs " + ", ".join(problems[:-1]) + (" and " if len(problems) > 1 else "") + problems[-1])


class PasswordPolicy(BaseModel):
    min_length: int = Field(ge=1, le=128)
    require_upper: bool
    require_lower: bool
    require_digit: bool
    require_symbol: bool


@app.put("/api/password-policy")
def set_password_policy(body: PasswordPolicy, _=Depends(admin_user)):
    with closing(db()) as c:
        c.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('password_policy', ?)", (json.dumps(body.model_dump()),))
        c.commit()
    return get_policy()


FEATURES = ["accounts", "records", "daily", "password-policy"]


@app.get("/api/status")
def status(request: Request):
    """Public: lets an app check an address is really this server."""
    with closing(db()) as c:
        n = c.execute("SELECT COUNT(*) FROM user").fetchone()[0]
    return {"app": "healthconnector", "instance_id": instance_id(), "needs_setup": n == 0,
            "features": FEATURES, "user": user_from_session(request)[0], "password_policy": get_policy()}


@app.post("/api/setup")
def setup(body: Credentials, request: Request, response: Response):
    """Create the first (admin) account. Works once."""
    name = clean_username(body.username)
    check_new_password(body.password)
    with closing(db()) as c:
        c.execute("BEGIN IMMEDIATE")  # two browsers can't both claim it
        if c.execute("SELECT COUNT(*) FROM user").fetchone()[0]:
            c.rollback()
            raise HTTPException(403, "already set up")
        cur = c.execute(
            "INSERT INTO user (username, pw_hash, is_admin, created_at) VALUES (?,?,1,?)",
            (name, hash_password(body.password), now_iso()),
        )
        c.commit()
        uid = cur.lastrowid
    token = start_session(request, response, uid)
    return {"id": uid, "username": name, "is_admin": True, "token": token}


@app.post("/api/login")
def login(body: Credentials, request: Request, response: Response):
    name = body.username.strip().lower()
    keys = [f"ip:{client_ip(request)}", f"user:{name}"]
    for k in keys:
        throttle(k)
    with closing(db()) as c:
        row = c.execute("SELECT * FROM user WHERE username=?", (name,)).fetchone()
    # Always run a hash so response time doesn't reveal whether the user exists.
    ok = check_password(body.password, row["pw_hash"] if row else "scrypt$00$00")
    if not (row and ok):
        for k in keys:
            fail(k)
        raise HTTPException(401, "Wrong username or password")
    token = start_session(request, response, row["id"])
    return {"id": row["id"], "username": row["username"], "is_admin": bool(row["is_admin"]), "token": token}


@app.post("/api/logout")
def logout(request: Request, response: Response):
    u, via = user_from_session(request)
    if u and (via == "bearer" or request.headers.get("x-hc") == "1"):
        raw = request.headers.get("authorization", "")[7:] or request.cookies.get(SESSION_COOKIE)
        with closing(db()) as c:
            c.execute("DELETE FROM session WHERE hash=?", (sha(raw),))
            c.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


class PasswordChange(BaseModel):
    current: str
    new: str = Field(max_length=200)


@app.post("/api/password")
def change_password(body: PasswordChange, request: Request, u=Depends(web_user)):
    check_new_password(body.new)
    throttle(f"pw:{u['id']}")
    with closing(db()) as c:
        row = c.execute("SELECT pw_hash FROM user WHERE id=?", (u["id"],)).fetchone()
        if not check_password(body.current, row["pw_hash"]):
            fail(f"pw:{u['id']}")
            raise HTTPException(400, "Current password is wrong")
        c.execute("UPDATE user SET pw_hash=? WHERE id=?", (hash_password(body.new), u["id"]))
        # Sign out every other browser.
        c.execute("DELETE FROM session WHERE user_id=? AND hash<>?", (u["id"], sha(request.state.session_raw)))
        c.commit()
    return {"ok": True}


class NewUser(Credentials):
    is_admin: bool = False


@app.get("/api/users")
def list_users(_=Depends(admin_user)):
    with closing(db()) as c:
        rows = c.execute("SELECT id, username, is_admin, created_at FROM user ORDER BY id").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/users")
def create_user(body: NewUser, _=Depends(admin_user)):
    name = clean_username(body.username)
    check_new_password(body.password)
    with closing(db()) as c:
        try:
            cur = c.execute(
                "INSERT INTO user (username, pw_hash, is_admin, created_at) VALUES (?,?,?,?)",
                (name, hash_password(body.password), int(body.is_admin), now_iso()),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "That username is taken")
        c.commit()
    return {"id": cur.lastrowid, "username": name}


class PasswordSet(BaseModel):
    password: str = Field(max_length=200)


@app.post("/api/users/{uid}/password")
def reset_password(uid: int, body: PasswordSet, _=Depends(admin_user)):
    check_new_password(body.password)
    with closing(db()) as c:
        cur = c.execute("UPDATE user SET pw_hash=? WHERE id=?", (hash_password(body.password), uid))
        c.execute("DELETE FROM session WHERE user_id=?", (uid,))
        c.commit()
    if not cur.rowcount:
        raise HTTPException(404, "no such user")
    return {"ok": True}


@app.delete("/api/users/{uid}")
def delete_user(uid: int, u=Depends(admin_user)):
    if uid == u["id"]:
        raise HTTPException(400, "You can't delete your own account")
    with closing(db()) as c:
        cur = c.execute("DELETE FROM user WHERE id=?", (uid,))  # cascades to data, tokens, sessions
        c.commit()
    if not cur.rowcount:
        raise HTTPException(404, "no such user")
    return {"ok": True}


# ---------------------------------------------------------------- phone sync tokens
# The Android app creates one for itself after sign-in; it can only send data.

class NewToken(BaseModel):
    label: str = "Phone"
    # A random id the app keeps for the life of its install. Signing in again from the same phone
    # replaces its earlier token instead of adding another row.
    device_id: Optional[str] = Field(default=None, max_length=64)


@app.post("/api/tokens")
def create_token(body: NewToken, u=Depends(web_user)):
    token = secrets.token_urlsafe(32)
    label = body.label.strip()[:60] or "Phone"
    with closing(db()) as c:
        if body.device_id:
            c.execute("DELETE FROM api_token WHERE user_id=? AND device_id=?", (u["id"], body.device_id))
        cur = c.execute(
            "INSERT INTO api_token (user_id, label, hash, created_at, device_id) VALUES (?,?,?,?,?)",
            (u["id"], label, sha(token), now_iso(), body.device_id or None),
        )
        c.commit()
    return {"id": cur.lastrowid, "label": label, "token": token}


@app.get("/api/tokens")
def list_tokens(u=Depends(web_user)):
    with closing(db()) as c:
        rows = c.execute(
            "SELECT id, label, created_at, last_used_at FROM api_token WHERE user_id=? ORDER BY id",
            (u["id"],),
        ).fetchall()
    return [dict(r) for r in rows]


class TokenLabel(BaseModel):
    label: str = Field(min_length=1, max_length=60)


@app.patch("/api/tokens/{tid}")
def rename_token(tid: int, body: TokenLabel, u=Depends(web_user)):
    with closing(db()) as c:
        cur = c.execute("UPDATE api_token SET label=? WHERE id=? AND user_id=?", (body.label.strip(), tid, u["id"]))
        c.commit()
    if not cur.rowcount:
        raise HTTPException(404, "no such token")
    return {"ok": True}


@app.delete("/api/tokens/{tid}")
def revoke_token(tid: int, u=Depends(web_user)):
    with closing(db()) as c:
        cur = c.execute("DELETE FROM api_token WHERE id=? AND user_id=?", (tid, u["id"]))
        c.commit()
    if not cur.rowcount:
        raise HTTPException(404, "no such token")
    return {"ok": True}


# ---------------------------------------------------------------- ingest

class Rec(BaseModel):
    type: str
    start: str
    end: Optional[str] = None
    value: Optional[float] = None
    extra: Optional[dict] = None
    source: str = ""


class Batch(BaseModel):
    records: list[Rec] = Field(max_length=5000)


def utc(s: str) -> str:
    d = datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@app.post("/api/ingest")
def ingest(body: Batch, u=Depends(device_user)):
    rows, skipped = [], 0
    for r in body.records:
        if r.type not in TYPES:
            skipped += 1
            continue
        try:
            start = utc(r.start)
            end = utc(r.end) if r.end else start
        except ValueError:
            skipped += 1
            continue
        rows.append(
            (u["id"], r.type, start, end, r.source[:120], r.value, json.dumps(r.extra) if r.extra else None)
        )
    with closing(db()) as c:
        c.executemany(
            "INSERT OR REPLACE INTO record (user_id, type, start, end, source, value, extra) VALUES (?,?,?,?,?,?,?)",
            rows,
        )
        c.commit()
    return {"ok": True, "stored": len(rows), "skipped": skipped}


# ---------------------------------------------------------------- reading data

def parse_types(types: str):
    out = [t for t in types.split(",") if t]
    bad = [t for t in out if t not in TYPES]
    if bad or not out:
        raise HTTPException(400, f"unknown type: {','.join(bad) or '(none)'}")
    return out


@app.get("/api/daily")
def daily(types: str, days: int = 30, tz: int = 0, u=Depends(web_user)):
    """Per-day values for each type, in the viewer's timezone (tz = minutes
    ahead of UTC). Sum types add up; others average. When two sources report the
    same cumulative thing (phone and watch both count steps), the day takes the
    larger source rather than double counting."""
    days = max(1, min(days, 400))
    tz = max(-840, min(tz, 840))
    now_local = datetime.now(timezone.utc) + timedelta(minutes=tz)
    first = (now_local - timedelta(days=days - 1)).date()
    since = (datetime.combine(first, datetime.min.time(), timezone.utc) - timedelta(minutes=tz)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    out = {}
    with closing(db()) as c:
        for t in parse_types(types):
            col = "end" if t in DAY_BY_END else "start"
            day = f"date(datetime({col}, '{tz:+d} minutes'))"
            kind = TYPES[t][1]
            if kind == "sum":
                rows = c.execute(
                    f"SELECT d, MAX(v) AS value, SUM(n) AS count FROM ("
                    f"SELECT {day} AS d, source, SUM(value) AS v, COUNT(*) AS n FROM record "
                    f"WHERE user_id=? AND type=? AND {col} >= ? GROUP BY d, source) GROUP BY d ORDER BY d",
                    (u["id"], t, since),
                ).fetchall()
                out[t] = [{"date": r["d"], "value": r["value"], "count": r["count"]} for r in rows]
            else:
                rows = c.execute(
                    f"SELECT {day} AS d, AVG(value) AS value, MIN(value) AS min, MAX(value) AS max, COUNT(*) AS count "
                    f"FROM record WHERE user_id=? AND type=? AND {col} >= ? GROUP BY d ORDER BY d",
                    (u["id"], t, since),
                ).fetchall()
                out[t] = [dict(date=r["d"], value=r["value"], min=r["min"], max=r["max"], count=r["count"]) for r in rows]
    return out


@app.get("/api/records")
def records(type: str, since: str = "", limit: int = 200, u=Depends(web_user)):
    parse_types(type)
    limit = max(1, min(limit, 2000))
    with closing(db()) as c:
        rows = c.execute(
            "SELECT type, start, end, source, value, extra FROM record "
            "WHERE user_id=? AND type=? AND start >= ? ORDER BY start DESC LIMIT ?",
            (u["id"], type, utc(since) if since else "", limit),
        ).fetchall()
    return [
        {**dict(r), "extra": json.loads(r["extra"]) if r["extra"] else None, "unit": TYPES[type][0]}
        for r in rows
    ]


@app.get("/api/latest")
def latest(u=Depends(web_user)):
    out = {}
    with closing(db()) as c:
        for t, (unit, _) in TYPES.items():
            r = c.execute(
                "SELECT start, end, value, extra FROM record WHERE user_id=? AND type=? ORDER BY start DESC LIMIT 1",
                (u["id"], t),
            ).fetchone()
            if r:
                out[t] = {"start": r["start"], "end": r["end"], "value": r["value"], "unit": unit,
                          "extra": json.loads(r["extra"]) if r["extra"] else None}
    return out


@app.get("/api/me")
def me(u=Depends(web_user)):
    return u


# ---------------------------------------------------------------- pages

@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC, "index.html"), headers={"Cache-Control": "no-cache"})


for _d in ("assets",):
    if os.path.isdir(os.path.join(STATIC, _d)):
        app.mount(f"/{_d}", StaticFiles(directory=os.path.join(STATIC, _d)), name=_d)


@app.get("/{name:path}")
def root_files(name: str):
    """Icons, manifest and the like at the web root."""
    path = os.path.realpath(os.path.join(STATIC, name))
    if name and path.startswith(os.path.realpath(STATIC) + os.sep) and os.path.isfile(path):
        return FileResponse(path)
    raise HTTPException(404, "not found")
