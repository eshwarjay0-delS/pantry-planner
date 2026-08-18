# Pantry Planner — Android app

Your kitchen inventory, receipt scanning, meal planning, and shopping tracker,
packaged as an installable Android app (Capacitor + React + Vite).

Everything works **offline** — inventory, swipe-to-adjust, meal planning, shopping
trips and predictions. Only the two AI features (receipt/grocery **scan** and
**meal suggestions**) call the Anthropic API, using an API key you add in
**Settings**. The key is stored only on the device.

---

## Get an APK — Option A: GitHub Actions (no local Android setup) ✅ recommended

1. Create a new GitHub repo and push this folder to it:
   ```bash
   git init && git add . && git commit -m "Pantry Planner"
   git branch -M main
   git remote add origin https://github.com/<you>/pantry-planner.git
   git push -u origin main
   ```
2. The included workflow (`.github/workflows/build-apk.yml`) runs automatically.
   Open the repo's **Actions** tab → the latest run → wait ~3–5 min.
3. Under **Artifacts**, download **pantry-planner-apk** → unzip → `app-debug.apk`.
4. Copy it to your phone and install (see **Installing** below).

You can also re-run it any time from **Actions → Build Android APK → Run workflow**.

---

## Get an APK — Option B: build locally

Requires **Node 18+**, **JDK 17**, and the **Android SDK** (easiest via
[Android Studio](https://developer.android.com/studio); open it once so it
installs the SDK, and set `ANDROID_HOME`).

```bash
npm install
npm run build
npx cap add android          # first time only
npx cap sync android
cd android
./gradlew assembleDebug
```

APK lands at: `android/app/build/outputs/apk/debug/app-debug.apk`

Shortcut once set up: `npm run apk`.

To open the project in Android Studio instead (Run ▶ to a device/emulator):
`npx cap open android`.

---

## Preview in a browser first (fastest sanity check)

```bash
npm install
npm run dev
```
Open the printed URL. Camera buttons use your webcam/file picker.

---

## Installing the APK on your phone

1. Transfer `app-debug.apk` to the phone (USB, Drive, email to yourself, etc.).
2. Tap it. Android will ask to allow installs from this source — enable
   **Install unknown apps** for the app you're opening it from.
3. Install and launch **Pantry Planner**.

This is an unsigned **debug** build — perfect for personal testing. For the Play
Store you'd switch to `assembleRelease` with a signing key.

---

## Turning on the AI features

1. Get a key at <https://console.anthropic.com/settings/keys> (`sk-ant-…`).
2. In the app, tap the ⚙️ **gear** (top right) → paste the key → **Save**.
3. The model defaults to `claude-sonnet-5`. If your account uses a different
   model id, change it in the same screen.

**Security note:** a client-side app stores your key on the device and sends it
straight to Anthropic. That's fine for personal testing. Don't ship this build
publicly with a key embedded. For a public app, put the key behind a small
server/proxy instead of on the device.

---

## Project layout

```
src/App.jsx                     the whole app (one file)
src/main.jsx / index.css        entry + Tailwind
index.html, vite.config.js      web build
tailwind/postcss config
capacitor.config.json           appId, appName, webDir=dist
.github/workflows/build-apk.yml cloud APK build
```

App id: `com.pantryplanner.app` · name: **Pantry Planner** (change in
`capacitor.config.json`).
