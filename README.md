# whack 2026 submission

Accessibility interface for Capital One.

The dashboard uses voice and typed commands to navigate account tabs and show account details. The backend uses OpenRouter to interpret commands the dashboard doesn't recognize locally.

## Tech stack

- **Node.js 22 and JavaScript ES modules** for the backend and generated scripts.
- **Built-in Node.js APIs** for the HTTP server (`node:http`), and OpenRouter requests (`fetch`). No npm packages are required.
- **OpenRouter Chat Completions API** for turning transcripts into JavaScript. Choose the model with `OPENROUTER_MODEL`.
- **SQLite** via Node.js `node:sqlite` for local demo accounts and transaction history.

## Start the backend

1. Install Node.js 22.13 or newer.
2. Run `cp .env.example .env` and fill in `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` with your key and model ID. If the browser frontend runs on a different origin, set `FRONTEND_ORIGIN` to match it exactly.
3. Run `node --env-file=.env backend/server.mjs`. The backend listens at `http://127.0.0.1:3001` by default.
4. Open `http://127.0.0.1:3001` in your browser to use the dashboard.

Select the profile button and sign in with the demo credentials below. The balance and recent transactions load from SQLite. Type or say “show balance”, “show recent transactions”, “go home”, or “focus command” to navigate. Use **Send command** for other ways of phrasing those requests. The microphone depends on browser support, and the command field also accepts keyboard input.

Common phrases such as “what’s my balance?”, “list my recent transactions”, and “take me to savings” are matched locally without an OpenRouter call. Select a quick command, speak the phrase, or type it and select **Send command**.

Use the sidebar, the Up and Down arrow keys on a focused tab, or commands like “open savings”, “open credit cards”, “open loans”, and “open rewards” to switch tabs. OpenRouter can also return a tab intent such as `RESPONSE_OPEN_SAVINGS`. Checking uses the demo account from SQLite. The other tabs display sample data.

Turn on **Read aloud** in the voice console to hear tab summaries, account status, and balance or transaction-count commands. Select **Read this tab** or say “read this tab” to repeat the summary. Spoken feedback stops while the microphone is active.

Select **High contrast** in the voice console to switch to white text on black with yellow highlights. The dashboard remembers your selection on this browser.

Select **Magnify on hover** in the voice console to enlarge key controls and account figures when you point to them or focus them with the keyboard. The dashboard remembers this setting separately from high contrast.

## API

Send JSON with `Content-Type: application/json`. Keep the OpenRouter key in the backend's `.env` file.

| Route | Request | Successful response |
| --- | --- | --- |
| `POST /api/generate` | `{"text":"Print the first five square numbers"}` | `{"language":"javascript","code":"for (let n = 1; n <= 5; n++) console.log(n ** 2)","responseCode":"RESPONSE_GENERATE_CODE","message":"Prints the first five square numbers."}` |
| `POST /api/intent` | `{"text":"Take me to my savings"}` | `{"responseCode":"RESPONSE_OPEN_SAVINGS","message":"Open the Savings tab."}` |

The dashboard uses `/api/intent` to open the matching tab or display details from `/api/account`. Its response contains `responseCode` and a short `message`. Unknown or missing intent codes fall back to `RESPONSE_UNKNOWN_INTENT`. HTTP errors include an `error` string. The action list is in [intent-responses.json](backend/intent-responses.json).

## Fetch a demo account

The repository includes a prepared SQLite file at `backend/data/accounts.sqlite`. The backend opens it read-only on startup. Set `ACCOUNT_DB_PATH` to use another prepared file with the same schema. The demo password hash uses scrypt with the fixed salt `whack-local-demo-v1`.

The frontend can send a JSON `POST` to `/api/account` with the user ID and password entered in its sign-in form. For local testing, use `demo-user` and `whack-demo-only`.

```js
const response = await fetch('http://127.0.0.1:3001/api/account', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId, password }),
});
const account = await response.json();
if (!response.ok) throw new Error(account.error);
```

The response contains `userId`, `name`, `balanceMinor`, `currency`, and `transactions`. Each transaction has an `id`, `date`, `description`, and `amountMinor`. Amounts are integers in the smallest currency unit. For the demo account, `109350` means £1,093.50, and a negative transaction amount is money out. Incorrect credentials return `401`. The account response excludes password hashes and salts.
