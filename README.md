# whack 2026 submission

An accessible banking dashboard demo for WHACK 2026. Explore fictional accounts using voice or typed commands, high contrast, read-aloud controls, and webcam gaze tracking.

Common dashboard commands run in the browser. OpenRouter interprets more loosely phrased requests. A separate API can generate JavaScript for Node.js 22 and run it in a local Docker container when enabled.

## Tech stack

- **Node.js 22 and JavaScript ES modules** for the backend and generated scripts.
- **Built-in Node.js APIs** for the HTTP server (`node:http`), OpenRouter requests (`fetch`), and launching the runner (`node:child_process`). No npm packages are required.
- **OpenRouter** for natural-language commands and optional JavaScript generation. Choose the chat model with `OPENROUTER_MODEL`.
- **Fish Audio** for push-to-talk transcription and short spoken agent status replies when `FISH_API_KEY` is configured.
- **Docker** for optional code execution using the `node:22-bookworm-slim` image.
- **SQLite** via Node.js `node:sqlite` for local demo accounts and transaction history.

## Start the backend

1. Install Node.js 22.13 or newer.
2. If you don't have a `.env` file, copy `.env.example` to `.env`. Set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` to enable natural-language commands. Set `FISH_API_KEY` to enable Fish Audio push-to-talk transcription and agent speech. If the browser frontend runs on a different origin, set `FRONTEND_ORIGIN` to match it exactly.
3. Run `node --env-file=.env backend/server.mjs`. The backend listens at `http://127.0.0.1:3001` by default.
4. Open `http://127.0.0.1:3001` to use the dashboard and API on the same address.

The dashboard automatically signs in to the demo account and shows the SQLite balance and transactions separately from the example data. Use **Demo account** to sign out. Reloading signs in to the demo again.

## Voice and typed commands

Open **Voice Assistant** and either type a command or use the microphone. Commands such as “show balance,” “open savings,” and “click Contrast” run locally. Other phrasing goes to OpenRouter when configured. For on-screen controls, use the button label or describe the action. Where buttons share a label, include the section or item name.

| Try saying or typing | What happens |
| --- | --- |
| “Click View All Recent Transactions” | Opens the merchant filter page. You can also get there from **Recent Transactions → View All** on the dashboard. |
| “Which charges were for Spotify?” | Filters purchases by merchant. Say “clear merchant filter” to show all merchant purchases. |
| “Turn on high contrast” | Asks the assistant to select the dashboard's Contrast control. |
| “Put fifty dollars into savings from checking” | Opens a review dialog with the source account, destination account, and amount. |
| “Send Jane $100 and say ‘That’s for your birthday’” | Opens a review dialog with Jane, $100, and the birthday memo. |

Voice payment requests never execute on the first utterance. Review the dialog, then say “confirm payment” or “cancel payment” using push-to-talk, or use the on-screen buttons. Confirmation completes a simulated demo transaction in the browser; it does not move real money. The agent speaks a generic acknowledgement and completion status. Exact payment details stay in the accessible dialog and are not sent to Fish Audio for TTS.

Hold **Control + Space** and speak; release either key to submit the recording. The shortcut works while the dashboard is focused, but not while typing in a text field. The Voice Assistant's recent activity panel shows recording, transcription, OpenRouter, and action results. You can also select **Start microphone** for browser speech recognition, or type a command and select **Send command**. [Browser speech recognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)

Push-to-talk recordings stop when the keybind is released and are capped at 15 seconds. With `FISH_API_KEY`, the backend transcribes using Fish Audio's `transcribe-1-pro`; without it, the existing OpenRouter transcription fallback is used. The backend keeps the Fish key out of the browser. Fish's ASR is billed by audio duration; check the current rate before use.

Fish Audio handles speech-to-text and speech output; OpenRouter still interprets the transcript as a dashboard action. Fish currently lists `transcribe-1-pro` at $0.36 per audio hour and `drama-3` at a promotional $10 per million UTF-8 bytes through November 30, 2026. A 15-second recording is about $0.0015 for transcription, and $1 covers about 100,000 TTS bytes at the promotional rate, before any OpenRouter usage. Fish receives the push-to-talk recording for transcription. Fish TTS receives only generic status phrases, not recipient names, amounts, or memo text.

The default agent voice is Sarah with the `drama-3` model. To change it, choose a voice in Fish Audio's **Voice Library** or **My Voices**, copy its model ID, and set `FISH_TTS_VOICE_ID` in your local `.env`. That ID is sent as Fish's `reference_id`. `FISH_TTS_SPEED` adjusts delivery from 0.5 to 2.0 (default `1`), `FISH_TTS_VOLUME` ranges from -20 to 20 (default `0`), and `FISH_TTS_DIRECTION` can add a Fish direction tag such as `[warm]`. Restart the backend after changing `.env`. Keep the actual API key in `.env`, never `.env.example` or screenshots.

Set `DEBUG_STORE_VOICE_CLIPS=true` in `.env` and restart the backend to save uploaded WebM or Ogg clips in `backend/data/voice-clips/`. The terminal prints each saved filename. Clips are saved before transcription, so they are available even when the transcription request fails. The directory is ignored by Git, and clips remain on disk until deleted. Browser-native speech recognition does not upload a clip to this backend.

## Webcam gaze tracking

Open the dashboard on localhost or HTTPS, select **Eye Tracking**, then select **Start camera and calibrate** and allow camera access. Look at each target and follow the moving dot. After calibration, holding your gaze on a dashboard control selects it. Use **Recalibrate** to run calibration again or **Retry** if the camera or tracker stops.

## API

Send JSON with `Content-Type: application/json`. Keep the OpenRouter key in the backend's `.env` file.

| Route | Request | Successful response |
| --- | --- | --- |
| `POST /api/generate` | `{"text":"Print the first five square numbers"}` | `{"language":"javascript","code":"for (let n = 1; n <= 5; n++) console.log(n ** 2)","responseCode":"RESPONSE_GENERATE_CODE","message":"Prints the first five square numbers."}` |
| `POST /api/generate` | `{"text":"Show my balance"}` | `{"language":"javascript","code":null,"responseCode":"RESPONCE_SHOW_BALANCE","message":"Show the account balance."}` |
| `POST /api/intent` | `{"text":"Take me to my savings"}` | `{"responseCode":"RESPONSE_OPEN_SAVINGS","message":"Open the Savings tab."}` |
| `POST /api/execute` | `{"code":"for (let n = 1; n <= 5; n++) console.log(n ** 2)"}` | `{"stdout":"1\n4\n9\n16\n25\n","stderr":"","exitCode":0,"status":"ok","truncated":false}` |

`POST /api/intent` may return a `merchant` filter or a transaction `draft` with `amount` and either `from` and `to`, or `recipient` and an optional `note`. For natural-language button selection, the client can send a `controls` array of visible button labels. A `RESPONSE_CLICK_CONTROL` result includes the zero-based `controlIndex` into that array.

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
