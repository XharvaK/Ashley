/** PCM playback with AnalyserNode for lip-sync energy. */
export class PcmPlayer {
  constructor(onEnergy) {
    this.onEnergy = onEnergy;
    this.ctx = null;
    this.analyser = null;
    this.data = null;
    this.nextPlayTime = 0;
    this.activeSources = 0;
    this._raf = 0;
    this.defaultSampleRate = 24000;
  }

  _ensureCtx(sampleRate) {
    const rate = sampleRate || this.defaultSampleRate;
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: rate });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.35;
      this.analyser.connect(this.ctx.destination);
      this.data = new Uint8Array(this.analyser.frequencyBinCount);
      this._meter();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return rate;
  }

  _meter() {
    if (!this.analyser) return;
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.data.length);
    this.onEnergy(this.activeSources > 0 ? rms : 0);
    this._raf = requestAnimationFrame(() => this._meter());
  }

  playBase64(b64, sampleRate) {
    const rate = this._ensureCtx(sampleRate || this.defaultSampleRate);
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const sampleBytes = bytes.byteLength - (bytes.byteLength % 2);
    const sampleCount = sampleBytes / 2;
    if (sampleCount === 0) return 0;

    const samples = new Float32Array(sampleCount);
    const view = new DataView(bytes.buffer, bytes.byteOffset, sampleBytes);
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = view.getInt16(i * 2, true) / 32768;
    }

    const buffer = this.ctx.createBuffer(1, sampleCount, rate);
    buffer.copyToChannel(samples, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    const start = Math.max(this.ctx.currentTime, this.nextPlayTime);
    source.start(start);
    this.nextPlayTime = start + buffer.duration;
    this.activeSources += 1;
    source.onended = () => {
      this.activeSources = Math.max(0, this.activeSources - 1);
    };
    return buffer.duration;
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this.ctx?.close();
  }
}
