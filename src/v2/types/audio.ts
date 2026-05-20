export interface DecodedAudio {
  filePath: string;
  buffer: AudioBuffer;
  duration: number;
  sampleRate: number;
  channels: number;
}

export interface BufferCache {
  get(filePath: string): AudioBuffer | undefined;
  set(filePath: string, buffer: AudioBuffer): void;
  has(filePath: string): boolean;
  clear(): void;
}

export interface ScheduledClipNode {
  source: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  stopAt: number;
}

export interface PlaybackSnapshot {
  playing: boolean;
  playhead: number;
  startedAtContextTime: number;
}

export class MemoryBufferCache implements BufferCache {
  private readonly buffers = new Map<string, AudioBuffer>();

  get(filePath: string): AudioBuffer | undefined {
    return this.buffers.get(filePath);
  }

  set(filePath: string, buffer: AudioBuffer): void {
    this.buffers.set(filePath, buffer);
  }

  has(filePath: string): boolean {
    return this.buffers.has(filePath);
  }

  clear(): void {
    this.buffers.clear();
  }
}
