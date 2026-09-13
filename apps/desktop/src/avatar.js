/**
 * Sprite avatar: Ashley PNG frames, blink, lip-sync crossfade.
 */
const MANIFEST_URL = "/avatar/manifest.json";

const STATE_FRAME = {
  idle: "idle",
  listening: "listening",
  thinking: "thinking",
  speaking: "speak_medium",
  error: "error",
  booting: "booting",
  dormant: "dormant",
};

export class Avatar {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.state = "idle";
    this.frames = {};
    this.ready = false;
    this.mouthOpen = 0;
    this.targetMouth = 0;
    this.blink = 0;
    this.blinkPhase = 0;
    this.nextBlinkAt = performance.now() + 2200;
    this.breathe = 0;
    this.speakEnergy = 0;
    this._raf = 0;
    this._last = performance.now();
    this._resize();
    window.addEventListener("resize", () => this._resize());
    this._loadSprites().then(() => {
      this.ready = true;
      this._loop();
    });
  }

  async _loadSprites() {
    const res = await fetch(MANIFEST_URL);
    const manifest = await res.json();
    const entries = Object.entries(manifest.frames);
    await Promise.all(
      entries.map(([key, file]) => this._loadImage(key, `/avatar/${file}`)),
    );
    if (!this.frames.booting) this.frames.booting = this.frames.idle;
    if (!this.frames.dormant) this.frames.dormant = this.frames.blink ?? this.frames.idle;
  }

  _loadImage(key, url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.frames[key] = img;
        resolve();
      };
      img.onerror = () => {
        console.warn("[avatar] missing sprite:", url);
        resolve();
      };
      img.src = url;
    });
  }

  setState(state) {
    this.state = state;
  }

  setMouthEnergy(energy) {
    this.targetMouth = Math.min(1, energy * 2.2);
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
  }

  _loop(now = performance.now()) {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this._update(dt, now);
    this._draw();
    this._raf = requestAnimationFrame((t) => this._loop(t));
  }

  destroy() {
    cancelAnimationFrame(this._raf);
  }

  _update(dt, now) {
    this.breathe += dt * 1.4;
    const speaking = this.state === "speaking";
    if (!speaking) this.targetMouth *= 0.85;
    this.mouthOpen += (this.targetMouth - this.mouthOpen) * (speaking ? dt * 18 : dt * 8);
    this.speakEnergy += (this.targetMouth - this.speakEnergy) * dt * 10;

    const allowBlink = this.state === "idle" || this.state === "listening";
    if (allowBlink && now >= this.nextBlinkAt && this.blinkPhase === 0) {
      this.blinkPhase = 0.001;
    }
    if (this.blinkPhase > 0) {
      this.blinkPhase += dt * 14;
      if (this.blinkPhase >= 1) {
        this.blinkPhase = 0;
        this.nextBlinkAt = now + 1800 + Math.random() * 3200;
      }
    }
    this.blink =
      this.blinkPhase <= 0
        ? 0
        : this.blinkPhase < 0.5
          ? this.blinkPhase * 2
          : (1 - this.blinkPhase) * 2;
  }

  _currentBaseKey() {
    if (this.state === "booting") return "booting";
    if (this.state === "speaking") {
      return this.mouthOpen > 0.45 ? "speak_wide" : "speak_medium";
    }
    return STATE_FRAME[this.state] ?? "idle";
  }

  _draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    if (!this.ready) return;

    const cx = w / 2;
    const cy = h / 2;
    const breathe = Math.sin(this.breathe) * 0.01;
    const scale = 1 + breathe + this.speakEnergy * 0.015;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    const baseKey = this._currentBaseKey();
    const base = this.frames[baseKey] ?? this.frames.idle;
    if (base) this._drawSprite(ctx, base, 0, 0);

    if (this.blink > 0.05 && this.frames.blink && baseKey !== "blink") {
      ctx.globalAlpha = this.blink;
      this._drawSprite(ctx, this.frames.blink, 0, 0);
      ctx.globalAlpha = 1;
    }

    if (this.state === "booting") {
      ctx.globalAlpha = 0.75 + Math.sin(this.breathe * 2) * 0.15;
      ctx.restore();
      ctx.save();
      ctx.translate(cx, cy);
    }

    ctx.restore();
  }

  _drawSprite(ctx, img, x, y) {
    const size = Math.min(this.w, this.h) * 0.95;
    ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
  }
}
