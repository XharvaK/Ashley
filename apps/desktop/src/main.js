import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Avatar } from "./avatar.js";
import { PcmPlayer } from "./audio.js";

const avatarRoot = document.getElementById("avatar");
const avatarCanvas = document.getElementById("avatar-canvas");
const statusLabel = document.getElementById("status-label");
const contextMenu = document.getElementById("context-menu");
const lockPositionBtn = document.getElementById("lock-position");

const avatar = new Avatar(avatarCanvas);
const player = new PcmPlayer((energy) => avatar.setMouthEnergy(energy));

let speakingTimer = null;
let positionLocked = false;
let pttListening = false;

function setState(state, label) {
  avatarRoot.className = `state-${state}`;
  avatar.setState(state);
  if (label) statusLabel.textContent = label;

  if (state === "speaking") {
    if (speakingTimer) clearTimeout(speakingTimer);
    speakingTimer = setTimeout(() => {
      if (avatarRoot.classList.contains("state-speaking")) {
        setState("idle", "Ready");
      }
    }, 400);
  }
}

function playPcmBase64(b64, sampleRate) {
  const duration = player.playBase64(b64, sampleRate);
  setState("speaking", "Speaking...");
  if (speakingTimer) clearTimeout(speakingTimer);
  speakingTimer = setTimeout(
    () => setState("idle", "Ready"),
    Math.max(300, duration * 1000 + 200),
  );
}

function updateLockLabel() {
  lockPositionBtn.textContent = positionLocked
    ? "Konum kilidini aç"
    : "Konumu kilitle";
  avatarRoot.classList.toggle("position-locked", positionLocked);
}

async function refreshLockState() {
  positionLocked = await invoke("get_position_locked");
  updateLockLabel();
}

avatarRoot.addEventListener("mousedown", async (e) => {
  if (e.button !== 0 || positionLocked) return;
  e.preventDefault();
  try {
    await getCurrentWindow().startDragging();
  } catch (err) {
    console.warn("[drag]", err);
  }
});

avatarRoot.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  contextMenu.style.left = `${e.clientX}px`;
  contextMenu.style.top = `${e.clientY}px`;
  contextMenu.removeAttribute("hidden");
});

lockPositionBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  positionLocked = await invoke("toggle_position_lock");
  updateLockLabel();
  contextMenu.setAttribute("hidden", "");
});

document.addEventListener("click", () => {
  contextMenu.setAttribute("hidden", "");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") contextMenu.setAttribute("hidden", "");
});

listen("assistant-state", (e) => {
  const { state, label } = e.payload;
  if (state === "listening") pttListening = true;
  if (state === "idle" || state === "ready") pttListening = false;
  setState(state, label);
});

listen("play-audio", (e) => {
  const { pcm, sampleRate } = e.payload;
  if (pcm) playPcmBase64(pcm, sampleRate);
});

listen("sse-event", (e) => {
  const ev = e.payload;
  if (ev.type === "assistant-state") {
    if (ev.state === "listening") pttListening = true;
    if (ev.state === "idle" || ev.state === "ready") pttListening = false;
    setState(ev.state, ev.label);
  }
  if (ev.type === "status") {
    if (ev.status === "thinking") setState("thinking", "Thinking...");
    if (ev.status === "ready") setState("idle", "Ready");
  }
  if (ev.type === "audio" && ev.pcm) {
    playPcmBase64(ev.pcm, ev.sampleRate);
  }
  if (ev.type === "offline") {
    setState("error", "Offline — voice only");
  }
  if (ev.type === "vram_guard") {
    if (ev.status === "paused") setState("dormant", "Paused — game running");
    if (ev.status === "resumed") setState("booting", "Resuming...");
  }
});

setState("booting", "Booting...");
refreshLockState().catch(() => {});
invoke("start_services").catch((err) => {
  console.error(err);
  setState("error", "Boot failed");
});

async function togglePtt() {
  try {
    const { listening } = await invoke("toggle_ptt");
    pttListening = listening;
    setState(
      listening ? "listening" : "idle",
      listening ? "Dinliyorum… (Ctrl+Shift+Space)" : "Ready",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setState("error", msg || "Voice service unavailable");
  }
}

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.code === "Space") {
    e.preventDefault();
    togglePtt();
  }
});
