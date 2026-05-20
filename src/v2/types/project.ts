// Branded types pour éviter la confusion ClipId vs TrackId
type Brand<T, B> = T & { readonly __brand: B };
export type ProjectId = Brand<string, 'ProjectId'>;
export type TrackId = Brand<string, 'TrackId'>;
export type ClipId = Brand<string, 'ClipId'>;
export type MarkerId = Brand<string, 'MarkerId'>;
export type EffectId = Brand<string, 'EffectId'>;

// Helpers pour créer les branded IDs
export const makeProjectId = (s: string) => s as ProjectId;
export const makeTrackId = (s: string) => s as TrackId;
export const makeClipId = (s: string) => s as ClipId;
export const makeMarkerId = (s: string) => s as MarkerId;
export const makeEffectId = (s: string) => s as EffectId;

export interface Project {
  id: ProjectId;
  name: string;
  createdAt: number;
  updatedAt: number;
  videoSource?: VideoSource;
  duration: number;
  fps?: number;
  sampleRate: number;
  tracks: Track[];
  markers: Marker[];
  playhead: number;
  loop: LoopRegion;
  zoom: number;
  snapEnabled: boolean;
  snapInterval: number;
  rippleEdit: boolean;
}

export interface VideoSource {
  filePath: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface LoopRegion {
  enabled: boolean;
  in: number;
  out: number;
}

export type TrackType = 'audio' | 'video' | 'bus';

export interface Track {
  id: TrackId;
  name: string;
  color: string;
  type: TrackType;
  height: number;
  gain: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  recArmed: boolean;
  clips: Clip[];
  effectChain: Effect[];
  receives?: TrackId[];
}

export interface Clip {
  id: ClipId;
  trackId: TrackId;
  name: string;
  source: ClipSource;
  timelinePosition: number;
  duration: number;
  gain: number;
  fadeIn: number;
  fadeOut: number;
  gainEnvelope?: EnvelopePoint[];
}

export interface ClipSource {
  filePath: string;
  inPoint: number;
  outPoint: number;
}

export interface EnvelopePoint {
  time: number;
  value: number;
}

export interface Marker {
  id: MarkerId;
  time: number;
  label: string;
  color: string;
}

export interface Effect {
  id: EffectId;
  type: EffectType;
  bypass: boolean;
  params: Record<string, number>;
}

export type EffectType =
  | 'eq_parametric'
  | 'compressor'
  | 'de_esser'
  | 'denoise'
  | 'reverb'
  | 'limiter';

export const DEFAULTS = {
  PROJECT: {
    sampleRate: 48000,
    zoom: 80,
    snapInterval: 1.0,
    snapEnabled: true,
    rippleEdit: false,
    duration: 60,
  },
  TRACK: {
    height: 78,
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    recArmed: false,
    color: '#2B6FE6',
  },
  CLIP: {
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
  },
  TRACK_COLORS: [
    '#2B6FE6',
    '#1D9E75',
    '#EF9F27',
    '#7F77DD',
    '#D85A30',
    '#D4537E',
    '#97C459',
    '#888780',
  ],
} as const;

export function isValidClip(clip: Partial<Clip>): clip is Clip {
  return (
    typeof clip.id === 'string' &&
    typeof clip.trackId === 'string' &&
    typeof clip.timelinePosition === 'number' &&
    clip.timelinePosition >= 0 &&
    typeof clip.duration === 'number' &&
    clip.duration > 0 &&
    !!clip.source &&
    clip.source.outPoint > clip.source.inPoint
  );
}

export function clipEndTime(clip: Clip): number {
  return clip.timelinePosition + clip.duration;
}

export interface ProjectStore {
  getProject(): Readonly<Project>;
  subscribe(listener: (p: Project) => void): () => void;
  createProject(name: string): void;
  loadProject(project: Project): void;
  updateProjectMeta(updates: Partial<Pick<Project, 'name'>>): void;
  addTrack(type: TrackType, name?: string): TrackId;
  removeTrack(id: TrackId): void;
  updateTrack(id: TrackId, updates: Partial<Track>): void;
  reorderTracks(orderedIds: TrackId[]): void;
  addClip(
    trackId: TrackId,
    source: ClipSource,
    timelinePosition: number,
    name?: string,
  ): ClipId;
  removeClip(id: ClipId): void;
  moveClip(id: ClipId, newPosition: number, newTrackId?: TrackId): void;
  trimClip(id: ClipId, edge: 'left' | 'right', delta: number): void;
  splitClip(id: ClipId, atTime: number): [ClipId, ClipId];
  updateClip(id: ClipId, updates: Partial<Clip>): void;
  setPlayhead(time: number): void;
  getPlayhead(): number;
  addMarker(time: number, label: string): MarkerId;
  removeMarker(id: MarkerId): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}
