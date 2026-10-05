require("dotenv").config();

const express = require("express");
const axios = require("axios");
//const open = require("open").default;

const { Client, CustomStatus } = require("discord.js-selfbot-v13");

const app = express();
const client = new Client();

//━━━━━━━━━━━━━━━━━━━
// CONFIG
//━━━━━━━━━━━━━━━━━━━

const PORT = 8888;

const LYRICS_OFFSET_MS = 100;

// Spotify API lent = pas de rate limit
const SPOTIFY_SYNC_MS = 8000;

// Lyrics rapide en local
const LYRICS_RENDER_MS = 300;

const MAX_STATUS_LENGTH = 128;

//━━━━━━━━━━━━━━━━━━━
// GLOBAL STATE
//━━━━━━━━━━━━━━━━━━━

let refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
let accessTokenCache = null;
let accessTokenExpiresAt = 0;

let spotifyBackoffUntil = 0;
let lyricsSystemStarted = false;

let spotifySnapshot = null;
let spotifySnapshotAt = 0;

let currentTrackKey = "";
let syncedLines = [];
let plainLyrics = "";
let lastLineIndex = -1;

let lastStatusText = "";
let lastConsoleState = "";

let isSpotifySyncRunning = false;

//━━━━━━━━━━━━━━━━━━━
// DISCORD
//━━━━━━━━━━━━━━━━━━━

client.on("ready", () => {
  console.log(`✅ Discord connecté : ${client.user.username}`);

  if (!lyricsSystemStarted) {
    lyricsSystemStarted = true;
    startLyricsSystem();
  }
});

function setDiscordStatus(text) {
  if (!client.user) return;

  const clean = String(text || "♪")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_STATUS_LENGTH);

  if (!clean || clean === lastStatusText) return;

  lastStatusText = clean;

  try {
    const custom = new CustomStatus(client).setState(clean);
    client.user.setPresence({ activities: [custom] });
  } catch (err) {
    console.log("Erreur statut Discord :", err.message);
  }
}

//━━━━━━━━━━━━━━━━━━━
// SPOTIFY AUTH
//━━━━━━━━━━━━━━━━━━━

const scopes = [
  "user-read-currently-playing",
  "user-read-playback-state"
].join(" ");

const authUrl =
  "https://accounts.spotify.com/authorize?" +
  new URLSearchParams({
    response_type: "code",
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: scopes,
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI
  });

app.get("/", (req, res) => {
  res.send("Connecte-toi à Spotify : <a href='/login'>Login Spotify</a>");
});

/*app.get("/login", (req, res) => {
  res.redirect(authUrl);
});

app.get("/callback", async (req, res) => {
  try {
    const code = req.query.code;

    if (!code) {
      res.send("❌ Code Spotify manquant.");
      return;
    }

    const tokenRes = await axios.post(
      "https://accounts.spotify.com/api/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI
      }),
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
            ).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    refreshToken = tokenRes.data.refresh_token;

    if (!refreshToken) {
      res.send("❌ Aucun refresh_token reçu. Relance l'auth Spotify.");
      return;
    }

    res.send("✅ Connecté à Spotify ! Tu peux retourner dans la console.");
    console.log("✅ Spotify connecté !");

    if (!lyricsSystemStarted) {
      lyricsSystemStarted = true;
      startLyricsSystem();
    }
  } catch (err) {
    console.error("Erreur callback :", err.response?.data || err.message);
    res.send("❌ Erreur pendant la connexion Spotify.");
  }
});
*/
async function getAccessToken() {
  if (accessTokenCache && Date.now() < accessTokenExpiresAt) {
    return accessTokenCache;
  }

  if (!refreshToken) {
    console.log('pas de refresh')
    throw new Error("Refresh token Spotify absent.");
  }

  const res = await axios.post(
    "https://accounts.spotify.com/api/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }),
    {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      validateStatus: () => true
    }
  );

  if (res.status !== 200) {
    throw new Error(
      `Erreur token Spotify ${res.status}: ${JSON.stringify(res.data)}`
    );
  }

  accessTokenCache = res.data.access_token;
  accessTokenExpiresAt = Date.now() + (res.data.expires_in - 60) * 1000;

  return accessTokenCache;
}

//━━━━━━━━━━━━━━━━━━━
// SPOTIFY CURRENT TRACK
//━━━━━━━━━━━━━━━━━━━

async function fetchCurrentTrackFromSpotify() {
  if (Date.now() < spotifyBackoffUntil) {
    return null;
  }

  const accessToken = await getAccessToken();

  const res = await axios.get(
    "https://api.spotify.com/v1/me/player/currently-playing",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      validateStatus: () => true
    }
  );

  if (res.status === 429) {
    const retryAfter = Number(res.headers["retry-after"] || 10);
    spotifyBackoffUntil = Date.now() + retryAfter * 1000;

    logState(`⛔ Spotify rate limit. Retry dans ${retryAfter}s`);
    return null;
  }

  if (res.status === 204 || !res.data?.item) {
    return null;
  }

  if (res.status !== 200) {
    logState(`❌ Erreur Spotify ${res.status}: ${JSON.stringify(res.data)}`);
    return null;
  }

  const item = res.data.item;

  return {
    title: item.name,
    artist: item.artists.map(a => a.name).join(", "),
    album: item.album?.name || "",
    durationMs: item.duration_ms,
    progressMs: res.data.progress_ms || 0,
    isPlaying: Boolean(res.data.is_playing),
    fetchedAt: Date.now()
  };
}

function getEstimatedTrack() {
  if (!spotifySnapshot) return null;

  if (!spotifySnapshot.isPlaying) {
    return spotifySnapshot;
  }

  const elapsed = Date.now() - spotifySnapshotAt;
  const estimatedProgress = spotifySnapshot.progressMs + elapsed;

  return {
    ...spotifySnapshot,
    progressMs: Math.min(estimatedProgress, spotifySnapshot.durationMs)
  };
}

async function syncSpotifySnapshot() {
  if (isSpotifySyncRunning) return;
  isSpotifySyncRunning = true;

  try {
    const track = await fetchCurrentTrackFromSpotify();

    if (!track) {
      spotifySnapshot = null;
      spotifySnapshotAt = 0;
      return;
    }

    spotifySnapshot = track;
    spotifySnapshotAt = Date.now();

    await handleTrackChangeIfNeeded(track);
  } catch (err) {
    console.log("Erreur sync Spotify :", err.response?.data || err.message);
  } finally {
    isSpotifySyncRunning = false;
  }
}

//━━━━━━━━━━━━━━━━━━━
// LYRICS
//━━━━━━━━━━━━━━━━━━━

const https = require("https");

const lrclibAgent = new https.Agent({
  keepAlive: true,
  family: 4
});

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getLyrics(track) {
  const params = {
    track_name: track.title,
    artist_name: track.artist,
    album_name: track.album,
    duration: Math.round(track.durationMs / 1000)
  };

  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(
        `🔎 Requête LRCLIB (${attempt}/${maxAttempts}) :`,
        params
      );

      const res = await axios.get("https://lrclib.net/api/get", {
        params,
        headers: {
          Accept: "application/json",
          "User-Agent": "SpotifyDiscordLyrics/1.0"
        },
        timeout: 30_000,
        validateStatus: () => true
      });

      console.log(`📡 LRCLIB statut : ${res.status}`);

      if (res.status === 200) {
        return {
          success: true,
          syncedLyrics: res.data?.syncedLyrics || null,
          plainLyrics: res.data?.plainLyrics || null
        };
      }

      if (res.status === 404) {
        return {
          success: false,
          reason: "not_found"
        };
      }

      if ([429, 500, 502, 503, 504].includes(res.status)) {
        console.log(
          `⚠️ LRCLIB temporairement indisponible (${res.status}).`
        );

        if (attempt < maxAttempts) {
          const delay = attempt * 3000;

          console.log(`🔄 Nouvelle tentative dans ${delay / 1000}s...`);
          await sleep(delay);
          continue;
        }

        return {
          success: false,
          reason: "service_unavailable",
          status: res.status
        };
      }

      console.log("📦 Réponse LRCLIB :", res.data);

      return {
        success: false,
        reason: "http_error",
        status: res.status
      };
    } catch (err) {
      console.error("❌ Erreur réseau LRCLIB :", {
        message: err.message,
        code: err.code
      });

      if (attempt < maxAttempts) {
        const delay = attempt * 3000;

        console.log(`🔄 Nouvelle tentative dans ${delay / 1000}s...`);
        await sleep(delay);
        continue;
      }

      return {
        success: false,
        reason: "network_error",
        error: err.message
      };
    }
  }

  return {
    success: false,
    reason: "unknown"
  };
}

function parseSyncedLyrics(syncedLyrics) {
  return syncedLyrics
    .split("\n")
    .map(line => {
      const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
      if (!match) return null;

      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const ms = Number(match[3].padEnd(3, "0"));
      const text = match[4].trim();

      return {
        timeMs: minutes * 60_000 + seconds * 1000 + ms,
        text
      };
    })
    .filter(Boolean);
}

function findCurrentLineIndex(lines, progressMs) {
  let found = -1;

  for (let i = 0; i < lines.length; i++) {
    if (progressMs >= lines[i].timeMs) {
      found = i;
    } else {
      break;
    }
  }

  return found;
}

async function handleTrackChangeIfNeeded(track) {
  const trackKey = `${track.title}-${track.artist}-${track.durationMs}`;

  if (trackKey === currentTrackKey) return;

  currentTrackKey = trackKey;
  syncedLines = [];
  plainLyrics = "";
  lastLineIndex = -1;

  console.clear();
  console.log(`🎵 ${track.title}`);
  console.log(`👤 ${track.artist}`);
  console.log("🔎 Recherche des paroles...");

  const lyrics = await getLyrics(track);
  console.log(lyrics);

  if (!lyrics.success) {
    syncedLines = [];
    plainLyrics = "";

    console.clear();
    console.log(`🎵 ${track.title}`);
    console.log(`👤 ${track.artist}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━\n");

    if (lyrics.reason === "service_unavailable") {
      console.log(
        `⚠️ LRCLIB est temporairement indisponible (${lyrics.status}).`
      );
    } else if (lyrics.reason === "network_error") {
      console.log("⚠️ Impossible de contacter LRCLIB.");
    } else {
      console.log("❌ Paroles introuvables.");
    }

    //setDiscordStatus(`<a:vscodeparty:1324792379739209841>`);
    return;

    syncedLines = [];
    plainLyrics = "";

    console.clear();
    console.log(`🎵 ${track.title}`);
    console.log(`👤 ${track.artist}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log("❌ Paroles introuvables.");

    setDiscordStatus(`🎵 ${track.title} - ${track.artist}`);
    return;
  }

  if (lyrics.syncedLyrics) {
    syncedLines = parseSyncedLyrics(lyrics.syncedLyrics);
    plainLyrics = "";

    console.clear();
    console.log(`🎵 ${track.title}`);
    console.log(`👤 ${track.artist}`);
    console.log(`✅ Paroles synchronisées chargées.`);
    return;
  }

  if (lyrics.plainLyrics) {
    syncedLines = [];
    plainLyrics = lyrics.plainLyrics;

    renderPlainLyrics(track, plainLyrics);
    return;
  }

  syncedLines = [];
  plainLyrics = "";

  console.clear();
  console.log(`🎵 ${track.title}`);
  console.log(`👤 ${track.artist}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("❌ Aucune parole exploitable.");

  setDiscordStatus(`🎵 ${track.title} - ${track.artist}`);
}

//━━━━━━━━━━━━━━━━━━━
// RENDER
//━━━━━━━━━━━━━━━━━━━

function logState(message) {
  if (message === lastConsoleState) return;

  lastConsoleState = message;
  console.clear();
  console.log(message);
}

function renderPlainLyrics(track, lyrics) {
  console.clear();

  console.log(`🎵 ${track.title}`);
  console.log(`👤 ${track.artist}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("⚠️ Paroles trouvées, mais pas synchronisées.\n");
  console.log(lyrics);

  setDiscordStatus(`🎵 ${track.title} - ${track.artist}`);
}

function renderSyncedLyrics(track, currentIndex) {
  console.clear();

  const previous = syncedLines[currentIndex - 1]?.text || "";
  const current = syncedLines[currentIndex]?.text || "♪";
  const next = syncedLines[currentIndex + 1]?.text || "";

  console.log(`🎵 ${track.title}`);
  console.log(`👤 ${track.artist}`);
  console.log(`⏱️ ${Math.floor(track.progressMs / 1000)}s`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━\n");

  if (previous) console.log(`   ${previous}`);
  console.log(`👉 ${current}`);
  if (next) console.log(`   ${next}`);

  setDiscordStatus(current);
}

function renderLoop() {
  const track = getEstimatedTrack();

  if (!track) {
    logState("⏸️ Aucune musique détectée sur Spotify.");
    currentTrackKey = "";
    syncedLines = [];
    plainLyrics = "";
    lastLineIndex = -1;
    return;
  }

  if (!track.isPlaying) {
    logState(
      `⏸️ Musique en pause.\n🎵 ${track.title}\n👤 ${track.artist}`
    );
    return;
  }

  if (plainLyrics && !syncedLines.length) {
    return;
  }

  if (!syncedLines.length) {
    return;
  }

  const adjustedProgress = track.progressMs + LYRICS_OFFSET_MS;
  const currentIndex = findCurrentLineIndex(syncedLines, adjustedProgress);

  if (currentIndex === -1) return;

  if (currentIndex !== lastLineIndex) {
    lastLineIndex = currentIndex;
    renderSyncedLyrics(track, currentIndex);
  }
}

//━━━━━━━━━━━━━━━━━━━
// START SYSTEM
//━━━━━━━━━━━━━━━━━━━

function startLyricsSystem() {
  console.log("🚀 Système lyrics lancé.");

  syncSpotifySnapshot();

  setInterval(syncSpotifySnapshot, SPOTIFY_SYNC_MS);
  setInterval(renderLoop, LYRICS_RENDER_MS);
}

//━━━━━━━━━━━━━━━━━━━
// SERVER START
//━━━━━━━━━━━━━━━━━━━

app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé : http://127.0.0.1:${PORT}`);
  console.log("✅ Mode VPS : refresh token utilisé depuis .env");
});

client.login(process.env.TOKEN);
