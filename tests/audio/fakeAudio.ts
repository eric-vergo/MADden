// A recording stand-in for the slice of WebAudio the audio layer touches, so
// synth recipes and the engine graph can be exercised in the node test env.
// It also enforces the two rules the real API throws on: exponential ramps must
// target a strictly positive value, and stop() must not precede start().

export interface ParamCall {
  method: 'setValueAtTime' | 'exponentialRampToValueAtTime' | 'linearRampToValueAtTime' | 'setTargetAtTime';
  value: number;
  time: number;
  /** Time-constant, setTargetAtTime only. */
  tau?: number;
}

export class FakeParam {
  value = 0;
  readonly calls: ParamCall[] = [];

  constructor(private readonly label: string, initial = 0) {
    this.value = initial;
  }

  setValueAtTime(value: number, time: number): FakeParam {
    this.record('setValueAtTime', value, time);
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): FakeParam {
    this.record('linearRampToValueAtTime', value, time);
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): FakeParam {
    if (!(value > 0)) {
      throw new Error(`exponentialRampToValueAtTime(${value}) on ${this.label} must be > 0`);
    }
    this.record('exponentialRampToValueAtTime', value, time);
    return this;
  }

  setTargetAtTime(value: number, time: number, tau: number): FakeParam {
    if (!(tau > 0)) throw new Error(`setTargetAtTime tau ${tau} on ${this.label} must be > 0`);
    this.record('setTargetAtTime', value, time, tau);
    return this;
  }

  cancelScheduledValues(): FakeParam {
    return this;
  }

  private record(method: ParamCall['method'], value: number, time: number, tau?: number): void {
    if (!Number.isFinite(value) || !Number.isFinite(time)) {
      throw new Error(`non-finite ${method}(${value}, ${time}) on ${this.label}`);
    }
    this.value = value;
    this.calls.push({ method, value, time, tau });
  }
}

export class FakeNode {
  readonly outputs: unknown[] = [];

  constructor(readonly kind: string) {}

  connect(target: unknown): unknown {
    this.outputs.push(target);
    return target;
  }

  disconnect(): void {
    this.outputs.length = 0;
  }
}

export class FakeSourceNode extends FakeNode {
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  loop = false;
  buffer: unknown = null;

  start(when = 0, offset?: number): void {
    if (this.startedAt !== null) throw new Error(`${this.kind} started twice`);
    if (offset !== undefined && (offset < 0 || !Number.isFinite(offset))) {
      throw new Error(`${this.kind} bad start offset ${offset}`);
    }
    this.startedAt = when;
  }

  stop(when = 0): void {
    if (this.startedAt !== null && when < this.startedAt) {
      throw new Error(`${this.kind} stop(${when}) precedes start(${this.startedAt})`);
    }
    this.stoppedAt = when;
  }
}

export class FakeOscillator extends FakeSourceNode {
  type = 'sine';
  readonly frequency = new FakeParam('osc.frequency', 440);
  readonly detune = new FakeParam('osc.detune', 0);

  constructor() {
    super('oscillator');
  }
}

export class FakeBufferSource extends FakeSourceNode {
  constructor() {
    super('bufferSource');
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam('gain.gain', 1);

  constructor() {
    super('gain');
  }
}

export class FakeBiquad extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam('biquad.frequency', 350);
  readonly Q = new FakeParam('biquad.Q', 1);

  constructor() {
    super('biquad');
  }
}

export class FakeAudioBuffer {
  private readonly data: Float32Array;

  constructor(readonly length: number, readonly sampleRate: number) {
    this.data = new Float32Array(length);
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(): Float32Array {
    return this.data;
  }
}

export class FakeAudioContext {
  /** Low rate keeps the 2s noise buffers cheap in tests. */
  readonly sampleRate = 8000;
  readonly destination = new FakeNode('destination');
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  resumeCount = 0;

  readonly created: FakeNode[] = [];

  createOscillator(): FakeOscillator {
    return this.track(new FakeOscillator());
  }

  createGain(): FakeGain {
    return this.track(new FakeGain());
  }

  createBiquadFilter(): FakeBiquad {
    return this.track(new FakeBiquad());
  }

  createBufferSource(): FakeBufferSource {
    return this.track(new FakeBufferSource());
  }

  createBuffer(_channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(length, sampleRate);
  }

  resume(): Promise<void> {
    this.resumeCount++;
    this.state = 'running';
    return Promise.resolve();
  }

  advance(seconds: number): void {
    this.currentTime += seconds;
  }

  nodesOfKind(kind: string): FakeNode[] {
    return this.created.filter((n) => n.kind === kind);
  }

  private track<T extends FakeNode>(node: T): T {
    this.created.push(node);
    return node;
  }
}

/** The engine and synth are typed against the real DOM API; tests cast in. */
export function asAudioContext(ctx: FakeAudioContext): AudioContext {
  return ctx as unknown as AudioContext;
}
