# WHACK 2026: Capital One Accessibility Interface - Project Handover & Architecture Document

## 1. Project Overview & Context
- **Event**: WHACK 2026 Hackathon.
- **Challenge Sponsor**: Capital One.
- **Problem Statement**:
  > *"Best financial hack: 'Make Credit Accessible'. It's important for our customers to be able to independently manage their finances. We'd love to see some hacks that would help us to help customers with accessibility requirements to manage their account."*
- **Core Mission**: Build an accessible, multimodal financial dashboard that empowers individuals with visual, physical/motor, and cognitive disabilities to independently view, understand, and manage their finances.

---

## 2. Team Split & Responsibilities
- **Teammates A & B**: Original real-time **Eye-Tracking model/pipeline** and **Voice Command / Speech Integration** research. Their eye-tracking work landed as `eyetracker_v4.html` (see §3.1) and is now wired into the live dashboard.
- **Ammar (This Workspace, with Claude)**: Accessible Capital One Frontend Dashboard, state management, HCI interaction patterns, account actions, and the **live webcam eye-tracking integration** (§7).
- **Teammate Aydin (Backend + Voice Contributor)**: `/backend` Node.js services (`server.mjs`, `openrouter.mjs`, `accounts.mjs`, `intent-responses.json`), the dashboard-to-backend wiring (`frontend/linking.js`), demo auto sign-in, and Firefox speech transcription.

---

## 3. Architecture & Repository Structure

```
whack/
├── backend/
│   ├── server.mjs                # HTTP server (port 3001), CORS origin checks, voice transcription route
│   ├── openrouter.mjs            # OpenRouter API: transcript -> intent/script, Whisper transcription
│   ├── runner.mjs                # Docker execution sandbox (node:22-bookworm-slim)
│   ├── accounts.mjs              # SQLite account lookup service
│   ├── intent-responses.json     # Intent classification mapping
│   └── data/
│       ├── accounts.sqlite       # SQLite demo database
│       └── voice-clips/          # Optional debug recordings (gitignored; DEBUG_STORE_VOICE_CLIPS=true)
├── frontend/
│   ├── index.html                # Main single-page application, UI, and the eye-tracking bridge script
│   ├── actions.js                # Central state store & Action Registry (window.appStore / C1Store)
│   ├── linking.js                # Wires the dashboard to the backend: account sign-in, voice commands,
│   │                              #   Firefox speech transcription, high-contrast/magnification prefs
│   └── eyeTracking/
│       └── eyetracker_v4.html    # Standalone + embeddable webcam gaze tracker (MediaPipe FaceLandmarker)
├── .env.example                  # Environment configuration template
└── README.md                     # Base project technical documentation
```

**3.1 Where `eyetracker_v4.html` came from.** Three eye-tracking branches existed on `origin` (`eyetracking`, `eyeTrackingV2`, `realeyetracking`). `eyeTrackingV2` was pulled in because it was the only one built on top of current `main`, was a single self-contained file (the others accidentally committed `node_modules` or pulled in a submodule), and its commit message ("eye tracking improved and reskinned") indicated it superseded the rest. It is a from-scratch in-browser gaze tracker: webcam → MediaPipe `FaceLandmarker` → a 13-point calibration + 5-point validation pass → ridge regression + One-Euro filtering → smoothed `(x, y)` gaze with I-VT fixation/saccade detection. No external gaze SDK is used.

---

## 4. Backend Analysis & Specifications (Do Not Break)
1. **`POST /api/generate`**:
   - **Accepts**: JSON `{ "text": "<transcript>" }` (Max 8,000 bytes).
   - **OpenRouter System Prompt**: Classifies intent against `intent-responses.json` (`RESPONCE_SHOW_BALANCE`, `REPONCE_SHOW_TRANSACTIONS`, `RESPONSE_SHOW_NAME`, `RESPONSE_SHOW_ACCOUNT_SUMMARY`, `RESPONSE_GENERATE_CODE`, etc.).
   - **Returns**: `{ "language": "javascript", "code": string | null, "responseCode": string, "message": string }`.
2. **`POST /api/execute` (Docker Sandbox)**:
   - **Accepts**: JSON `{ "code": "<script>" }` (Max 16,384 bytes).
   - **Constraints**: Completely offline (`--network=none`), read-only filesystem (`--read-only`), 128MB RAM, 5-second timeout, 16 KiB output limit per stream.
   - **Architectural Note**: Code executed inside Docker cannot mutate the browser DOM or frontend store. Therefore, browser navigation and financial transactions are handled via structured action mapping.
3. **Voice transcription (new)**: a speech-to-text route backed by `OPENROUTER_TRANSCRIPTION_MODEL` (default `openai/whisper-large-v3`), added for the Firefox fallback path where the Web Speech API isn't available. Set `DEBUG_STORE_VOICE_CLIPS=true` to persist uploaded recordings to `backend/data/voice-clips/` for debugging (gitignored).
4. **`POST /api/account`**: unchanged — returns `userId`, `name`, `balanceMinor`, `currency`, `transactions`. The dashboard now calls this automatically on load (auto sign-in to the demo account) via `frontend/linking.js`.
5. **CORS / `FRONTEND_ORIGIN`**:
   - The backend validates `Origin` against `FRONTEND_ORIGIN` (default: `http://localhost:5173` or `http://127.0.0.1:3001`).
   - Opening `index.html` as `file://` causes the browser to send `Origin: null`, which the backend rejects with `403`.
   - For normal development, open the dashboard and API on the same origin using the Node server in §6. Set `FRONTEND_ORIGIN` only if you serve the frontend separately.

**⚠️ Known issue, not fixed in this session:** `.env` (containing a live `OPENROUTER_API_KEY`) is tracked in git, not ignored. Harmless while the repo stays private, but the key should be rotated and `.env` removed from history before this repo is ever made public.

---

## 5. Frontend Architecture & Features Implemented

### A. Central State Store & Action Registry ([`frontend/actions.js`](frontend/actions.js))
- Built as a **Universal Module (UMD)** compatible with browser scripts (`window.C1Store`/`window.appStore`), ES modules, and Node environments without CORS issues on `file://`.
- **All dates are dynamic**: Driven by `getToday()` and `getRelativeDate(offsetDays)` (no stale hardcoded 2024 dates).
- **Working Views Implemented**: `checking`, `savings`, `credit-cards`, `loans`, `rewards`, `account-details`, `send-money`, `transfer`, `lock-card`, `statements`, `open-account`, `upcoming-all`, `recent-all` (unchanged this session — see prior handover revisions for the full per-view breakdown).

### B. Dashboard ↔ Backend Wiring ([`frontend/linking.js`](frontend/linking.js)) — new this session, by Aydin
- Auto signs in to the demo account (`demo-user` / `whack-demo-only`) against `POST /api/account` on load; renders live balance/transaction data into the existing views instead of the static fictional numbers.
- Wires the voice command drawer to the backend: text or microphone input → `/api/generate` → intent routed to `C1Store` actions; Firefox (no Web Speech API) falls back to recording a clip and sending it to the new transcription route.
- Persists High Contrast and Magnification preferences to `localStorage` (`whack.highContrast`, `whack.magnification`) so they survive reloads.

### C. Human-Computer Interaction (HCI) & Accessibility Innovations
1. **Fitts' Law & Target Expansion (`.hci-lens-active`)**:
   - Toggled via the **"Gaze Lens"** button in the header, and auto-enabled the moment live eye tracking starts (§7).
   - Grounded in Fitts' Law: expanding target width compensates for eye-tracker calibration drift, microsaccadic gaze jitter, and motor tremors.
   - Scale bumped this session from `scale(1.05) translateY(-3px)` to **`scale(1.16) translateY(-7px)`** with a stronger ambient shadow, per direct feedback that the original was too subtle.
   - Originally only fired on real mouse `:hover`/`:focus` — meaning gaze input (synthetic, not a real browser hover state) silently did nothing. Fixed via a `.gaze-active-target` class applied directly by the eye-tracking bridge, scoped to `button, [data-nav], a` only (not `.card`/`h1`/`h2`, which would look broken scaling up).
2. **Apple-style Floating Hover Magnifier HUD**: unchanged — frosted glass panel enlarging hovered/gazed text, with a 🔊 Speak button via `window.speechSynthesis`.
3. **"Listen Aloud" Full Account Audio Summary**: unchanged.
4. **WCAG AA Compliance**: unchanged (4.5:1 / 7:1 contrast, 44px+ touch targets, reduced-motion support, live-region announcements, confirmation steps on money-moving actions).

---

## 6. How to Run Locally

### Start the Dashboard and Backend

From the repository root, use this command to run the full app:

```bash
node --env-file=.env backend/server.mjs
```

Open `http://127.0.0.1:3001` in your browser. The Node server serves the dashboard, eye-tracking overlay, and API together. Set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` in `.env` for natural-language commands and fallback transcription. If `.env` is missing, copy `.env.example` first.

### Trying Live Eye Tracking:
1. In the dashboard header, click **"Eye Tracking"** (next to "Gaze Lens").
2. An overlay appears on top of the dashboard (dimmed, so the calibration dots are easy to focus on). Click **"Start camera and calibrate"** inside it and approve the webcam prompt.
3. Follow the calibration dots, then the 10s smooth-pursuit pass.
4. Once calibration finishes, the badge flips to **LIVE**, the dashboard clears back to full visibility, and your gaze (shown as a small dot) drives the Gaze Lens: hovering a button/nav item expands it, and holding your gaze on it for **2 seconds fills a ring and clicks it**.
5. If drift creeps in, click **"Recalibrate"** in the header — no reload needed.

---

## 7. Live Eye Tracking Integration (built this session)

`frontend/eyeTracking/eyetracker_v4.html` is embedded into `index.html` as a **same-origin `<iframe>`**, not run as a separate page/tab — gaze tracking needs the webcam watching the user while the thing they're looking at (the dashboard) is on screen, which only works if both live in the same document.

- **Bridge, not postMessage**: because the iframe is same-origin, the tracker calls `window.parent.__onTrackerState(state)` and `window.parent.__onExternalGaze(x, y, fixating)` directly — no serialization, no listener boilerplate.
- **Click-through handoff**: while calibrating, the iframe stays `pointer-events: auto` so its own UI (Start/Recalibrate/Drift-fix) is reachable. The instant it reaches the `"tracking"` state, the parent sets the iframe to `pointer-events: none`, handing the page back to the dashboard. A header "Recalibrate" button temporarily re-enables it and calls `iframe.contentWindow.recalibrateGaze()`.
- **Coordinate space**: the iframe covers the full viewport, so gaze coordinates from the tracker are already in this document's viewport pixels — no cross-window scaling/guessing needed.
- **Calibration-phase dimming**: `body.embed-dim` (toggled from the tracker's own `setState()`) darkens the dashboard showing through behind the overlay for every pre-tracking state, clearing to fully transparent the moment tracking starts. Fixing this required also resetting `color-scheme` to `normal` inside the iframe — Chrome paints an opaque dark UA canvas color behind `background: transparent` on a page that declares `color-scheme: dark`, which is why the overlay first appeared to "stay solid black" even with a transparent background set.
- **Gaze hit-testing**: tries an exact `elementFromPoint` hit first, then falls back to the nearest clickable element within a **28px padded bounding box** (`GAZE_HITBOX_MARGIN_PX`). This only ever applies post-calibration, since the tracker doesn't emit gaze samples before reaching `"tracking"`.
- **Settle window**: raw gaze is jittery even while "settled" (head/webcam noise, not real intent). A target must hold under gaze for `GAZE_SETTLE_MS` (110ms) before it "wins" — tracked separately for the magnifier HUD (broad selector: buttons, nav, cards, headers, list items) and the expand/dwell target (clickable-only: `button, [data-nav], a`), so the HUD and the expansion/click logic never fight over different elements.
- **2-second gaze dwell-to-click**: holding gaze on a clickable control fills an SVG progress ring around the gaze cursor (`#gazeDwellRing`, `GAZE_DWELL_CLICK_MS = 2000`); completing it fires a real `.click()` and an `aria-live` announcement. Looking away before 2s cancels it.
- **Overlay restyling**: the standalone tracker's dark dev-tool look (teal accents, glass panel) is overridden in embedded mode (`?embed=1`) to the Capital One palette (navy `#004879`, white pill buttons), and the control bar was moved from top-left (where it sat directly on top of the Capital One logo) to bottom-left.
- **Tunable constants** (all in the eye-tracking bridge script inside `frontend/index.html`, plus one in `eyetracker_v4.html`): `GAZE_SETTLE_MS`, `GAZE_DWELL_CLICK_MS`, `GAZE_HITBOX_MARGIN_PX`, the `.gaze-active-target` scale/shadow values in the `<style>` block, and the `rgba(4, 10, 20, 0.38)` dim amount in `eyetracker_v4.html`.

---

## 8. Next Steps for Next Session / Teammates
1. **Tune live gaze reliability further**: the settle window and hitbox margin are first-pass values from one session of testing — expect to retune `GAZE_SETTLE_MS`/`GAZE_HITBOX_MARGIN_PX` against more users and lighting conditions before the demo.
2. **Voice Layer**: `linking.js` already wires text/voice input to `/api/generate` → `C1Store` actions, plus a Firefox transcription fallback. Still untested end-to-end with `requestTransfer`/`requestSendMoney` confirmation flows.
3. **CreditWise Simulator**: not started — an interactive score simulator to demonstrate what actions improve credit rating.
4. **Security hygiene before going public**: rotate the OpenRouter key and remove `.env` from git history (see §4 warning).
5. **Mobile/tablet testing**: the live eye-tracking overlay and dwell-click logic have only been exercised on desktop Chrome so far.
