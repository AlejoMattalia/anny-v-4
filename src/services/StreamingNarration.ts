type Scene = { text: string; generation: number; capturedAt: number; analysisMs: number };
type Options = {
  read: (text: string, onStart: () => void) => Promise<void>;
  current: (generation: number) => boolean;
  speaking: (value: boolean) => void;
  now?: () => number;
};

// One spoken scene and at most one prepared scene. Capture near the end of the
// current phrase so the next result is ready without reading an old backlog.
export class StreamingNarration {
  private active: Scene | null = null;
  private pending: Scene | null = null;
  private readyAt = 0;
  private wordMs = 250;
  private now: () => number;
  constructor(private options: Options) { this.now = options.now || Date.now; }
  get isSpeaking() { return this.active !== null; }
  canCapture() { return !this.pending && (!this.active || this.now() >= this.readyAt); }
  reset() { this.active = this.pending = null; this.readyAt = 0; this.options.speaking(false); }
  enqueue(scene: Scene) { this.pending = scene; void this.drain(); }
  private async drain() {
    if (this.active || !this.pending) return;
    const scene = this.pending; this.pending = null;
    if (!this.options.current(scene.generation) || this.now() - scene.capturedAt > Math.max(3500, scene.analysisMs * 2)) return;
    this.active = scene; this.readyAt = Infinity; this.options.speaking(true);
    const words = Math.max(1, scene.text.trim().split(/\s+/).length);
    let startedAt: number | undefined;
    try {
      await this.options.read(scene.text, () => {
        if (this.active !== scene) return;
        startedAt = this.now();
        this.readyAt = startedAt + Math.max(0, words * this.wordMs - scene.analysisMs - 100);
      });
    } catch { /* A lost voice connection is recovered by its owning service. */ }
    finally {
      if (this.active !== scene) return;
      if (startedAt !== undefined) this.wordMs = this.wordMs * 0.5 + Math.min(500, Math.max(120, (this.now() - startedAt) / words)) * 0.5;
      this.active = null; this.readyAt = 0; this.options.speaking(false);
      void this.drain();
    }
  }
}

export function streamingPictureSize(sizes: string[], detail: boolean) {
  const target = detail ? 1280 : 960;
  return sizes.map(value => {
    const [width, height] = value.split('x').map(Number);
    return { value, width, height, distance: Math.abs(Math.max(width, height) - target) };
  }).filter(item => item.width > 0 && item.height > 0)
    .sort((a, b) => a.distance - b.distance || a.width * a.height - b.width * b.height)[0]?.value;
}
