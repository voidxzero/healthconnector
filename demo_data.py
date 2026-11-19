"""Fill a test server with made-up data: python demo_data.py http://localhost:8099 demo demo-password

Creates the account if the server has none, then sends 90 days of records.
Safe to run twice (records are replaced, not duplicated). Never point it at a
real account: the data is invented.
"""
import json
import math
import random
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

base, user, pw = (sys.argv + ["http://localhost:8099", "demo", "demo-password"][len(sys.argv) - 1:])[1:4]


def call(path, body=None, token=None, method=None):
    req = urllib.request.Request(
        base + path, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})},
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


try:
    session = call("/api/setup", {"username": user, "password": pw})["token"]
except urllib.error.HTTPError:
    session = call("/api/login", {"username": user, "password": pw})["token"]
device = call("/api/tokens", {"label": "Demo phone"}, token=session)["token"]

rnd = random.Random(7)
now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
recs = []
for n in range(90, -1, -1):
    day = (now - timedelta(days=n)).replace(hour=0)
    wk = day.weekday() >= 5
    # sleep: bed ~23:00, wake ~7:00 (UTC, fine for a demo), as ~90-minute cycles: deep early, REM late, a few brief wakings
    span = rnd.gauss(470 if not wk else 530, 35)
    segs, t, cycle = [], 0, 0
    while t < span:
        plan = [("l", rnd.randint(14, 28)), ("d", round(max(4, (0.30 - 0.07 * cycle) * 90 * rnd.uniform(0.7, 1.2)))),
                ("l", rnd.randint(8, 22)), ("r", round((0.08 + 0.07 * cycle) * 90 * rnd.uniform(0.7, 1.2)))]
        if rnd.random() < 0.55:
            plan.append(("a", rnd.randint(2, 9)))
        for code, dur in plan:
            if t >= span:
                break
            dur = min(dur, round(span - t)) or 1
            segs.append([t, dur, code])
            t += dur
        cycle += 1
    tot = {c: sum(d for _, d, k in segs if k == c) for c in "dlra"}
    start = day - timedelta(hours=1)
    recs.append(dict(type="sleep", start=iso(start), end=iso(start + timedelta(minutes=t)), value=tot["d"] + tot["l"] + tot["r"],
                     source="demo.watch", extra=dict(stages=dict(deep=tot["d"], light=tot["l"], rem=tot["r"], awake=tot["a"]), segments=segs)))
    steps = max(1500, rnd.gauss(8200, 2600))
    for h in range(8, 21):
        w = math.exp(-((h - 13) ** 2) / 40)
        recs.append(dict(type="steps", start=iso(day + timedelta(hours=h)), end=iso(day + timedelta(hours=h + 1)),
                         value=round(steps * w / 5.3), source="demo.watch"))
    recs.append(dict(type="distance", start=iso(day + timedelta(hours=8)), end=iso(day + timedelta(hours=20)), value=round(steps * 0.74), source="demo.watch"))
    recs.append(dict(type="active_calories", start=iso(day + timedelta(hours=8)), end=iso(day + timedelta(hours=20)), value=round(steps * 0.045 + 120), source="demo.watch"))
    recs.append(dict(type="total_calories", start=iso(day), end=iso(day + timedelta(hours=23, minutes=59)), value=round(1750 + steps * 0.045), source="demo.watch"))
    for k in range(48):
        h = k * 0.5 + 0.25
        bpm = 58 + 8 * math.sin(h / 24 * 6.28) + (35 if 17 <= h <= 17.5 and n % 2 == 0 else 0) + rnd.gauss(0, 3)
        recs.append(dict(type="heart_rate", start=iso(day + timedelta(hours=h)), value=round(bpm), source="demo.watch"))
    recs.append(dict(type="resting_heart_rate", start=iso(day + timedelta(hours=6)), value=round(rnd.gauss(57, 2)), source="demo.watch"))
    recs.append(dict(type="hrv", start=iso(day + timedelta(hours=6)), value=round(rnd.gauss(52, 8)), source="demo.watch"))
    recs.append(dict(type="oxygen_saturation", start=iso(day + timedelta(hours=3)), value=round(rnd.gauss(96.5, 0.8), 1), source="demo.watch"))
    if n % 3 == 0:
        recs.append(dict(type="weight", start=iso(day + timedelta(hours=7)), value=round(78.5 - n * 0.02 + rnd.gauss(0, 0.3), 1), source="demo.scale"))
        recs.append(dict(type="body_fat", start=iso(day + timedelta(hours=7)), value=round(19.5 - n * 0.01 + rnd.gauss(0, 0.2), 1), source="demo.scale"))
    if n % 4 == 0:
        recs.append(dict(type="blood_pressure", start=iso(day + timedelta(hours=9)), value=round(rnd.gauss(118, 5)), extra=dict(diastolic=round(rnd.gauss(76, 4))), source="demo.cuff"))
    if n % 2 == 0:
        recs.append(dict(type="body_temperature", start=iso(day + timedelta(hours=8)), value=round(rnd.gauss(36.6, 0.2), 1), source="demo.watch"))
    recs.append(dict(type="respiratory_rate", start=iso(day + timedelta(hours=3)), value=round(rnd.gauss(14.5, 1)), source="demo.watch"))
    recs.append(dict(type="hydration", start=iso(day + timedelta(hours=12)), end=iso(day + timedelta(hours=13)), value=round(rnd.uniform(1.2, 2.6), 1), source="demo.app"))
    if n % 2 == 0:
        kind = rnd.choice(["running", "biking", "strength_training", "walking", "yoga"])
        recs.append(dict(type="exercise", start=iso(day + timedelta(hours=17)), end=iso(day + timedelta(hours=17, minutes=45)), value=45,
                         extra=dict(type=kind), source="demo.watch"))

for i in range(0, len(recs), 1000):
    out = call("/api/ingest", {"records": recs[i:i + 1000]}, token=device)
print(f"sent {len(recs)} records for '{user}'")
