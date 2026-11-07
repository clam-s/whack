# WHACK 2026: Capital One Accessibility Interface - Project Handover & Architecture Document

## 1. Project Overview & Context
- **Event**: WHACK 2026 Hackathon.
- **Challenge Sponsor**: Capital One.
- **Problem Statement**:
  > *"Best financial hack: 'Make Credit Accessible'. It’s important for our customers to be able to independently manage their finances. We’d love to see some hacks that would help us to help customers with accessibility requirements to manage their account."*
- **Core Mission**: Build an accessible, multimodal financial dashboard that empowers individuals with visual, physical/motor, and cognitive disabilities to independently view, understand, and manage their finances.

---

## 2. Team Split & Responsibilities
- **Teammates A & B**: Building the real-time **Eye-Tracking model/pipeline** and the **Voice Command / Speech Integration layer**.
- **Ammar & Teammate C (This Workspace)**: Architecting and implementing the **Accessible Capital One Frontend Dashboard**, state management, HCI interaction patterns, and account actions.
- **Teammate Aydin (Backend Contributor)**: Managing `/backend` Node.js services (`server.mjs`, `openrouter.mjs`, `accounts.mjs`, `intent-responses.json`).

---

## 3. Architecture & Repository Structure

```
whack/
├── backend/
│   ├── server.mjs                # HTTP server (ports 3001), CORS origin checks
│   ├── openrouter.mjs            # OpenRouter API: Speech transcript to intent/script
│   ├── runner.mjs                # Docker execution sandbox (node:22-bookworm-slim)
│   ├── accounts.mjs              # SQLite account lookup service
│   ├── intent-responses.json     # Intent classification mapping
│   └── data/accounts.sqlite      # SQLite demo database
├── frontend/
│   ├── index.html                # Main single-page application & UI components
│   └── actions.js                # Central state store & Action Registry
├── .env.example                  # Environment configuration template
└── README.md                     # Base project technical documentation
```

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
3. **CORS / `FRONTEND_ORIGIN`**:
   - The backend validates `Origin` against `FRONTEND_ORIGIN` (default: `http://localhost:5173` or `http://127.0.0.1:3001`).
   - Opening `index.html` as `file://` causes the browser to send `Origin: null`, which the backend rejects with `403`. 
   - When communicating with the live backend, run `python3 -m http.server 5173 --directory frontend`.

---

## 5. Frontend Architecture & Features Implemented

### A. Central State Store & Action Registry ([`frontend/actions.js`](frontend/actions.js))
- Built as a **Universal Module (UMD)** compatible with browser scripts (`window.C1Store`), ES modules, and Node environments without CORS issues on `file://`.
- **All dates are dynamic**: Driven by `getToday()` and `getRelativeDate(offsetDays)` (no stale hardcoded 2024 dates).
- **Working Views Implemented**:
  1. `checking`: Full balance overview ($4,200.10), routing info, transaction history, upcoming payments, spending meters.
  2. `savings`: 360 Performance Savings ($18,450.75, 4.25% APY, YTD interest, deposit shortcuts).
  3. `credit-cards`: Venture X Rewards ($1,420.50 owed, $13,579.50 available credit, APR, due dates, live lock toggle).
  4. `loans`: Auto Loan ($12,350.00 principal, $345.20/mo, 5.19% APR).
  5. `rewards`: Capital One Venture Miles (64,250 miles, cash value $642.50, retail partner deals).
  6. `account-details`: Full account and routing numbers for direct deposits.
  7. `send-money`: Zelle-style peer-to-peer payment flow.
  8. `transfer`: Inter-account funds transfer.
  9. `lock-card`: Dedicated card security toggle with plain-language rules.
  10. `statements`: PDF statement history.
  11. `open-account`: Deposit account creation workflow.
  12. `upcoming-all`: Scheduled bill and autopay management with cancellation.
  13. `recent-all`: Full transaction ledger with live text filter and search.

### B. Action Registry (The Single Way State Mutates)
| Action Function | Parameters | Description | Confirmation Required? |
| :--- | :--- | :--- | :---: |
| `navigateTo(page, params)` | `page`, `params` | Switches view and manages header focus. | No |
| `requestTransfer(from, to, amount)` | `fromId`, `toId`, `amt` | Validates balances and stages confirmation. | **Yes** |
| `requestSendMoney(recipient, amount, note, source)` | `recip`, `amt`, `note`, `src` | Validates funds and stages Zelle payment. | **Yes** |
| `confirmPendingAction()` | *none* | Commits pending transfer/send/open action. | **Yes** |
| `cancelPendingAction()` | *none* | Discards pending staged action. | No |
| `toggleCardLock(cardId)` | `cardId` | Locks or unlocks credit card instantly. | No |
| `requestOpenAccount(type, deposit, name)` | `type`, `dep`, `name` | Stages new account creation with funding. | **Yes** |
| `cancelUpcomingPayment(id)` | `paymentId` | Cancels scheduled future bill. | No |
| `toggleHighContrast()` | *none* | Toggles high-contrast accessibility mode. | No |
| `getBalance(id)` | `accountId` | Read-only balance query helper. | No |
| `getSpending(category, days)` | `category`, `days` | Aggregates spend by category over time. | No |

### C. Human-Computer Interaction (HCI) & Accessibility Innovations
1. **Fitts' Law & Target Expansion (`.hci-lens-active`)**:
   - Toggled via the **"Gaze Lens"** button in the header.
   - Grounded in Fitts' Law: $MT = a + b \log_2(2D/W)$. Expanding target width ($W$) compensates for eye-tracker calibration drift, microsaccadic gaze jitter, and motor tremors.
   - **visionOS-inspired styling**: Avoids harsh colored borders; instead uses weighted physical lift (`translateY(-3px)` + `scale(1.05)`), soft diffused ambient drop shadow (`rgba(0, 30, 60, 0.18)`), and subtle depth illumination.
2. **Apple-style Floating Hover Magnifier HUD**:
   - Frosted glass panel (`backdrop-blur-xl`) floating on screen during Gaze Lens mode.
   - Enlarges any hovered/gazed number or text into clean 20px+ bold typography.
   - Features a **"🔊 Speak"** button powered by native Web Speech API (`window.speechSynthesis`).
3. **"Listen Aloud" Full Account Audio Summary**:
   - Header button speaking a natural language account overview: checking balance, loan due dates, card lock state.
4. **WCAG AA Compliance**:
   - Color contrast meets or exceeds 4.5:1 on light backgrounds and 7:1 on deep navy backgrounds.
   - Touch/click targets minimum 44px height (`min-h-[44px]`).
   - High Contrast toggle (`class="high-contrast"`).
   - `@media (prefers-reduced-motion: reduce)` supported.
   - Full keyboard navigation with screen reader announcements (`aria-live="polite"`).
   - Safe financial confirmation step with large 48px Yes/No buttons for all money-moving actions.

---

## 6. How to Run Locally

### Immediate Static Inspection:
```bash
open frontend/index.html
```
*(Runs completely self-contained with fictional data on `file://` or HTTP).*

### Running With Local HTTP Server (Recommended for API integration):
```bash
python3 -m http.server 5173 --directory frontend
```
Visit: `http://localhost:5173`

### Running the Backend:
```bash
cp .env.example .env
# Set OPENROUTER_API_KEY, OPENROUTER_MODEL, FRONTEND_ORIGIN=http://localhost:5173
node --env-file=.env backend/server.mjs
```

---

## 7. Next Steps for Next Session / Teammates
1. **Eye-Tracking Integration**: Hook up the gaze coordinates from the eye-tracking model to target DOM elements and trigger the Gaze Lens hover/dwell states.
2. **Voice Layer Integration**: Connect the Web Speech API / OpenRouter backend to map spoken intents directly to `window.C1Store.navigateTo`, `window.C1Store.requestSendMoney`, or `window.C1Store.requestTransfer`.
3. **CreditWise Simulator**: Add an interactive score simulator to demonstrate what actions improve credit rating.
