# Setup — accounts, private storage, and a public link

This turns Pantry Planner into a public web app where anyone signs in with Google
and gets their own private data. Three parts: **Firebase** (login + database),
your **App.jsx config**, and **GitHub Pages** (the public link).

Do the Firebase parts on a computer if you can — it's a lot of console tapping.

---

## A. Firebase — login + private database (~10 min, one time)

1. Go to <https://console.firebase.google.com> → **Add project** → name it → create.
2. In the project, click the **web icon `</>`** to add a Web app → give it a nickname → **Register app**.
3. It shows a `firebaseConfig = { ... }` object. **Keep this open** — you'll paste it in step B.
4. Left menu → **Build → Authentication → Get started → Sign-in method →** enable **Google** (pick a support email) → Save.
5. Left menu → **Build → Firestore Database → Create database** → Start in **production mode** → pick a location → Enable.
6. In Firestore → **Rules** tab → replace everything with the contents of `firestore.rules` (in this project) → **Publish**. This is what makes each person's data private.
7. Authentication → **Settings → Authorized domains → Add domain** → add your Pages domain: `YOUR-USERNAME.github.io` (add it now; the app lives there after part C).

---

## B. Paste your config into the app

Open `App.jsx`, find the `firebaseConfig` block near the top, and replace the
`PASTE_...` placeholders with the values from step A.3. It looks like:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234:web:abcd",
};
```

(These values are safe to be public — your data is protected by the rules in step A.6.)

---

## C. Publish the public link (GitHub Pages)

1. Push this project to your repo (or upload the changed files).
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The included **Deploy Web App** workflow runs on push. When it's green, your app is live at:
   `https://YOUR-USERNAME.github.io/YOUR-REPO/`
4. Open it, tap **Continue with Google**, and you're in. Share that URL with anyone —
   each person signs in and gets their own private pantry.

Tip: on a phone, open the link → browser menu → **Add to Home screen** to use it like an app.

---

## AI features (optional)

Photo scan and meal suggestions use the Anthropic API. Right now each user adds
their **own** key under the ⚙️ account menu (stored only on their device); the
**Paste a list** feature needs no key.

To give everyone keyless AI (like a real product), put one key behind a small
proxy — a **Cloudflare Worker** is a free fit — and point the app's AI calls at it.
Ask and I'll build that Worker + wire it in.
