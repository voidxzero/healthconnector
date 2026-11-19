# Health Connector

Your Android Health Connect data on your own server, with a dashboard you can open on anything. Sleep, steps, heart rate, workouts, weight, blood pressure and more, with charts per day.

There are three parts: a server (Docker), a web app the server serves, and an Android app. The web app and the Android app are the same code. Everything is behind a login.

## Run the server

```sh
mkdir -p data && sudo chown -R 1000:1000 data   # the container runs as user 1000
docker compose up -d --build
```

Open `http://<your-server>:8000`. The first visit asks you to create the admin account. After that, only the admin can add people (Settings → People); each person has their own data. Settings → Password rules lets the admin set a minimum length and require uppercase, lowercase, a number or a symbol (off by default).

The database is one SQLite file, `data/sleep.db`. **Back that folder up.**

If the server is reachable from outside your home network, put it behind HTTPS (a reverse proxy such as Caddy does this in two lines). Over plain `http://` your password and data travel unencrypted.

## Install the Android app

```sh
./build-apk.sh                    # needs the Android SDK and JDK 21; makes healthconnector.apk
adb install -r healthconnector.apk   # or copy the file to the phone and open it
```

1. Enter your server's address (for example `192.168.1.20:8000` or `health.example.com`) and sign in. If the server has a second address, such as its IP on your home Wi-Fi, add it as the local address; the app switches to it when the main one can't be reached.
2. Open **Settings → Health Connect sync**, tap **Allow access**, switch on everything (including past data and background access), then tap **Sync now**.
3. After that it syncs by itself, by default about every 6 hours (you can change that in Settings).

The app makes its own sync token when you sign in, so there is nothing to copy; signing in again from the same phone replaces it rather than adding another. Signing out revokes it. Phones are listed under Settings → Phones sending data, where any one can be removed.

**No server?** Choose "Use on this phone only" on the sign-in screen. The app then reads Health Connect itself and shows the same dashboard from a copy kept on the phone; nothing leaves it. You can connect to a server later from Settings.

The first sync reads up to 90 days back (30 if you decline "past data"); later ones re-read the last week to catch late data, so nothing is double counted.

## Using the dashboard

- **Swipe down** on any screen to sync (in the Android app) or reload (in a browser).
- Each chart has buttons to switch between **bars and a line**, to see the numbers as a **table**, and (sleep, steps, exercise, hydration, resting heart rate, blood oxygen) to **colour by value**: red is low, green is the healthy range, blue is unusually much. The legend and tooltip say what each colour means, and the ranges are typical adult ones, not medical advice.

## Home screen widgets

Press and hold the home screen, choose **Widgets → HealthConnector**, and pick what it shows: any metric (last night's sleep, today's steps, resting heart rate, weight…), as a number, a chart, or both; bars or a line; 7, 14 or 30 days; and whether to colour by value. Add as many as you like, each different, and press and hold one to change it. Widgets read Health Connect on the phone, so they work with or without a server, and tapping one opens that screen of the app.

In the app, **Settings → Health Connect sync** lets you choose how often it syncs by itself (every 15 minutes up to once a day, or only when you ask).

## What is synced

Sleep (with stages), steps, distance, active and total calories, hydration, nutrition, exercise sessions, heart rate, resting heart rate, heart rate variability, weight, body fat, height, blood pressure, blood glucose, blood oxygen, body temperature and breathing rate. Not yet: speed, power, cadence, and the other data types Health Connect has.

When a phone and a watch both count steps (or other running totals), each day uses whichever source counted more instead of adding them.

## Development

```sh
pip install -r requirements.txt && uvicorn app:app --port 8000   # API; serves web/dist if built
cd web && npm install && npm run dev      # web app with live reload, proxies /api to :8000
cd web && npm run build                   # type-check + bundle
python demo_data.py http://localhost:8000 demo demo-password   # made-up data for trying things out
```

- `app.py`: the server (FastAPI, SQLite). Accounts, sessions, sync tokens, `/api/ingest`, and the read endpoints the dashboard uses.
- `web/`: React + TypeScript + Vite + Material Web. It is both the web app and, wrapped by Capacitor (`web/android/`), the Android app.
- `web/android/app/src/main/java/app/healthconnector/`: the native part. `HcSync` reads Health Connect and posts it, `SyncWorker` runs it every 6 hours, `HealthConnectPlugin` is how the web side reaches both.
- `android/`, `static/`: left over from the first version (a separate forwarder app and a one-page viewer). Nothing uses them any more.
