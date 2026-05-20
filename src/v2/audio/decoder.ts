import { BufferCache, DecodedAudio, MemoryBufferCache } from '../types/audio';

export class AudioDecoder {
  private readonly cache: BufferCache = new MemoryBufferCache();

  constructor(private readonly context: AudioContext) {}

  async decodeFile(filePath: string): Promise<DecodedAudio> {
    const cached = this.cache.get(filePath);
    if (cached) return this.toDecoded(filePath, cached);

    const url = this.toAssetUrl(filePath);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Lecture audio impossible: ${response.status}`);
    const bytes = await response.arrayBuffer();
    const buffer = await this.context.decodeAudioData(bytes.slice(0));
    this.cache.set(filePath, buffer);
    return this.toDecoded(filePath, buffer);
  }

  getCachedBuffer(filePath: string): AudioBuffer | undefined {
    return this.cache.get(filePath);
  }

  clear(): void {
    this.cache.clear();
  }

  private toDecoded(filePath: string, buffer: AudioBuffer): DecodedAudio {
    return {
      filePath,
      buffer,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
    };
  }

  private toAssetUrl(filePath: string): string {
    const tauri = window.__TAURI__;
    const convert = tauri?.core?.convertFileSrc;
    if (convert) return convert(filePath);
    return filePath;
  }
}
