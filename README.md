# whack 2026 submission

Accessibility interface for Capital One.

The local backend turns a speech transcript into JavaScript for Node.js 22 using OpenRouter. The app can display the code and send it back in a separate request to run it and display the output.

## Tech stack

- **Node.js 22 and JavaScript ES modules** for the backend and generated scripts.
- **Built-in Node.js APIs** for the HTTP server (`node:http`), OpenRouter requests (`fetch`), and launching the runner (`node:child_process`). No npm packages are required.
- **OpenRouter Chat Completions API** for turning transcripts into JavaScript. Choose the model with `OPENROUTER_MODEL`.
- **Docker** for optional code execution using the `node:22-bookworm-slim` image.

## Start the backend

1. Install Node.js 22 or newer.
2. Run `cp .env.example .env` and fill in `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` with your key and model ID. If the browser frontend runs on a different origin, set `FRONTEND_ORIGIN` to match it exactly.
3. Run `node --env-file=.env backend/server.mjs`. The backend listens at `http://127.0.0.1:3001` by default.

## API

Send JSON with `Content-Type: application/json`. Keep the OpenRouter key in the backend's `.env` file.

| Route | Request | Successful response |
| --- | --- | --- |
| `POST /api/generate` | `{"text":"Print the first five square numbers"}` | `{"language":"javascript","code":"for (let n = 1; n <= 5; n++) console.log(n ** 2)"}` |
| `POST /api/execute` | `{"code":"for (let n = 1; n <= 5; n++) console.log(n ** 2)"}` | `{"stdout":"1\n4\n9\n16\n25\n","stderr":"","exitCode":0,"status":"ok","truncated":false}` |

HTTP errors return `{"error":"..."}`. A script that exits with an error still returns an execution result with `status: "error"` and its stderr. A script killed by the time or memory limit can return `status: "killed"`. Each output stream is capped at 16 KiB.

## Enable local execution

Start Docker, run `docker pull node:22-bookworm-slim`, set `ENABLE_CODE_EXECUTION=true` in `.env`, and restart the backend. The runner uses the default local Docker socket and runs one script at a time. Each script runs as an unprivileged user in a fresh container with networking disabled, a read-only filesystem, and a five-second runtime limit. Keep the runner on a trusted local development machine.
