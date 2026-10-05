# 🎵 Discord Status Spotify Lyrics

Display the **currently playing Spotify lyrics in real time as your Discord custom status**.

The application tracks your current Spotify song, fetches synchronized lyrics from **LRCLIB**, and automatically updates your Discord custom status with the current lyric line.

---

## ✨ Features

- 🎧 Detects the currently playing Spotify track
- 📝 Fetches lyrics from LRCLIB
- ⏱️ Supports synchronized lyrics
- 🔄 Automatically follows song progress
- 💬 Updates your Discord custom status with the current lyric
- 🚦 Handles Spotify rate limits
- 🔁 Automatically retries LRCLIB requests on temporary errors
- ⚡ Uses local timing between Spotify API refreshes for smoother lyric synchronization
- 🖥️ Can run continuously on a VPS

---

## 🛠️ Requirements

- Node.js 18+
- npm
- A Spotify account
- A Spotify Developer application
- A Spotify refresh token
- A Discord account token

---

## 📦 Installation

Clone the repository:

```bash
git clone https://github.com/cupsyyyy/discord-status-spotify-lyrics.git
cd discord-status-spotify-lyrics
```

Install dependencies:

```bash
npm install
```

---

## ⚙️ Environment variables

Create a `.env` file in the root directory:

```env
TOKEN=YOUR_DISCORD_TOKEN

SPOTIFY_CLIENT_ID=YOUR_SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET=YOUR_SPOTIFY_CLIENT_SECRET
SPOTIFY_REFRESH_TOKEN=YOUR_SPOTIFY_REFRESH_TOKEN
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
```

### Spotify application

Create an application from the Spotify Developer Dashboard and configure your redirect URI.

Example:

```text
http://127.0.0.1:8888/callback
```

The application uses the following Spotify permissions:

```text
user-read-currently-playing
user-read-playback-state
```

---

## 🚀 Start

Run:

```bash
node index.js
```

The application will start its local server on:

```text
http://127.0.0.1:8888
```

Once Discord is connected, the lyrics system starts automatically.

---

## 🎶 How it works

The application periodically requests the currently playing track from Spotify.

Instead of calling Spotify continuously, it stores a playback snapshot and estimates the current song position locally between API requests.

By default:

```js
SPOTIFY_SYNC_MS = 8000
```

Spotify is therefore refreshed every **8 seconds**.

The local lyrics renderer runs every:

```js
LYRICS_RENDER_MS = 300
```

which allows the displayed lyric to update quickly without constantly querying Spotify.

---

## 📝 Lyrics

Lyrics are retrieved from:

**LRCLIB**

The application searches using:

- Track name
- Artist
- Album
- Track duration

If synchronized lyrics are available, they are parsed and matched against the current Spotify playback position.

Example:

```text
🎵 Song Title
👤 Artist
⏱️ 82s
━━━━━━━━━━━━━━━━━━━━━━

   Previous lyric
👉 Current lyric
   Next lyric
```

The current line becomes your Discord custom status.

---

## ⏱️ Lyrics offset

You can manually adjust lyric synchronization with:

```js
const LYRICS_OFFSET_MS = 100;
```

For example:

```js
const LYRICS_OFFSET_MS = 500;
```

will display lyrics approximately **500 ms earlier relative to the tracked playback position**.

Adjust this value depending on your connection and playback latency.

---

## 🚦 Rate limits

Spotify HTTP `429` responses are automatically detected.

The application reads Spotify's:

```text
Retry-After
```

header and temporarily stops requesting the API until the rate limit expires.

LRCLIB temporary errors such as:

```text
429
500
502
503
504
```

are also retried automatically.

---

## 🎵 Unsynchronized lyrics

If LRCLIB finds lyrics but no synchronized version is available, the full lyrics are displayed in the console.

The Discord status falls back to:

```text
🎵 Song Title - Artist
```

---

## 🔐 Security

Never commit your `.env` file.

Your `.gitignore` should contain:

```gitignore
.env
node_modules/
```

Never publish:

- Discord tokens
- Spotify client secrets
- Spotify refresh tokens
- Access tokens

If a token is accidentally committed, revoke or regenerate it immediately.

---

## 📁 Example project structure

```text
discord-status-spotify-lyrics/
│
├── index.js
├── package.json
├── package-lock.json
├── .gitignore
├── .env
└── README.md
```

---

## ⚠️ Discord account warning

This project uses:

```text
discord.js-selfbot-v13
```

which operates through a Discord user account rather than a regular Discord bot account.

Self-bots are not officially supported by Discord and their use may violate Discord's Terms of Service.

Use this project at your own risk.

---

## 🧰 Main technologies

- Node.js
- Express
- Axios
- Spotify Web API
- LRCLIB
- discord.js-selfbot-v13

---

## 📄 License

This project is provided for educational and personal use.

---

## 👤 Author

**cupsyyyy**

GitHub: `@cupsyyyy`