# whack 2026 submission

Accessibility interface for Capital One.

The local backend turns a speech transcript into JavaScript for Node.js 22 using OpenRouter. The app can display the code and send it back in a separate request to run it and display the output.

## Tech stack

- **Node.js 22 and JavaScript ES modules** for the backend and generated scripts.
- **Built-in Node.js APIs** for the HTTP server (`node:http`), OpenRouter requests (`fetch`), and launching the runner (`node:child_process`). No npm packages are required.
- **OpenRouter Chat Completions API** for turning transcripts into JavaScript. Choose the model with `OPENROUTER_MODEL`.
- **Docker** for optional code execution using the `node:22-bookworm-slim` image.
- **SQLite** via Node.js `node:sqlite` for local demo accounts and transaction history.

## Start the backend

1. Install Node.js 22.13 or newer.
2. Run `cp .env.example .env` and fill in `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` with your key and model ID. If the browser frontend runs on a different origin, set `FRONTEND_ORIGIN` to match it exactly.
3. Run `node --env-file=.env backend/server.mjs`. The backend listens at `http://127.0.0.1:3001` by default.

## API

Send JSON with `Content-Type: application/json`. Keep the OpenRouter key in the backend's `.env` file.

| Route | Request | Successful response |
| --- | --- | --- |
| `POST /api/generate` | `{"text":"Print the first five square numbers"}` | `{"language":"javascript","code":"for (let n = 1; n <= 5; n++) console.log(n ** 2)","responseCode":"RESPONSE_GENERATE_CODE","message":"Prints the first five square numbers."}` |
| `POST /api/generate` | `{"text":"Show my balance"}` | `{"language":"javascript","code":null,"responseCode":"RESPONCE_SHOW_BALANCE","message":"Show the account balance."}` |
| `POST /api/execute` | `{"code":"for (let n = 1; n <= 5; n++) console.log(n ** 2)"}` | `{"stdout":"1\n4\n9\n16\n25\n","stderr":"","exitCode":0,"status":"ok","truncated":false}` |

Recognized account requests return `200` with `code: null` and an intent `responseCode`. The frontend can use that code to choose what to display from `/api/account`. Unknown or missing intent codes fall back to `RESPONSE_UNKNOWN_INTENT`. HTTP errors include an `error` string, and generation failures also include a plain-language `message` for the app to display. The full list is in [intent-responses.json](backend/intent-responses.json).

A script that exits with an error still returns an execution result with `status: "error"` and its stderr. A script killed by the time or memory limit can return `status: "killed"`. Each output stream is capped at 16 KiB.

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

## Enable local execution

Start Docker, run `docker pull node:22-bookworm-slim`, set `ENABLE_CODE_EXECUTION=true` in `.env`, and restart the backend. The runner uses the default local Docker socket and runs one script at a time. Each script runs as an unprivileged user in a fresh container with networking disabled, a read-only filesystem, and a five-second runtime limit. Keep the runner on a trusted local development machine.
