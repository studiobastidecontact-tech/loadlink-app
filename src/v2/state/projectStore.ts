import {
  clipEndTime,
  Clip,
  ClipId,
  ClipSource,
  DEFAULTS,
  makeClipId,
  makeMarkerId,
  makeProjectId,
  makeTrackId,
  MarkerId,
  Project,
  ProjectStore,
  Track,
  TrackId,
  TrackType,
} from '../types/project';

type Listener = (project: Project) => void;

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function cloneProject(project: Project): Project {
  return structuredClone(project) as Project;
}

function now(): number {
  return Date.now();
}

function makeDefaultProject(name: string): Project {
  const stamp = now();
  return {
    id: makeProjectId(uid('project')),
    name,
    createdAt: stamp,
    updatedAt: stamp,
    duration: DEFAULTS.PROJECT.duration,
    sampleRate: DEFAULTS.PROJECT.sampleRate,
    tracks: [],
    markers: [],
    playhead: 0,
    loop: { enabled: false, in: 0, out: 0 },
    zoom: DEFAULTS.PROJECT.zoom,
    snapEnabled: DEFAULTS.PROJECT.snapEnabled,
    snapInterval: DEFAULTS.PROJECT.snapInterval,
    rippleEdit: DEFAULTS.PROJECT.rippleEdit,
  };
}

function makeTrack(type: TrackType, name: string, index: number): Track {
  return {
    id: makeTrackId(uid('track')),
    name,
    color: DEFAULTS.TRACK_COLORS[index % DEFAULTS.TRACK_COLORS.length],
    type,
    height: DEFAULTS.TRACK.height,
    gain: DEFAULTS.TRACK.gain,
    pan: DEFAULTS.TRACK.pan,
    muted: DEFAULTS.TRACK.muted,
    solo: DEFAULTS.TRACK.solo,
    recArmed: DEFAULTS.TRACK.recArmed,
    clips: [],
    effectChain: [],
  };
}

function sortClips(track: Track): void {
  track.clips.sort((a, b) => a.timelinePosition - b.timelinePosition);
}

function recalcDuration(project: Project): void {
  const latestClip = project.tracks.flatMap((track) => track.clips).reduce(
    (latest, clip) => Math.max(latest, clipEndTime(clip)),
    0,
  );
  const videoDuration = project.videoSource?.duration ?? 0;
  project.duration = Math.max(DEFAULTS.PROJECT.duration, latestClip, videoDuration);
}

function snapPosition(project: Project, position: number): number {
  const safe = Math.max(0, position);
  if (!project.snapEnabled || project.snapInterval <= 0) return safe;
  return Math.round(safe / project.snapInterval) * project.snapInterval;
}

export function createProjectStore(initialName = 'Projet audio sans titre'): ProjectStore {
  let project = makeDefaultProject(initialName);
  const listeners = new Set<Listener>();
  const undoStack: Project[] = [];
  const redoStack: Project[] = [];

  const notify = (): void => {
    recalcDuration(project);
    project.updatedAt = now();
    listeners.forEach((listener) => listener(cloneProject(project)));
  };

  const mutate = (fn: (draft: Project) => void, recordHistory = true): void => {
    if (recordHistory) {
      undoStack.push(cloneProject(project));
      redoStack.length = 0;
    }
    fn(project);
    notify();
  };

  const findTrack = (id: TrackId): Track => {
    const track = project.tracks.find((candidate) => candidate.id === id);
    if (!track) throw new Error(`Track introuvable: ${id}`);
    return track;
  };

  const findClip = (id: ClipId): { track: Track; clip: Clip; index: number } => {
    for (const track of project.tracks) {
      const index = track.clips.findIndex((clip) => clip.id === id);
      if (index >= 0) return { track, clip: track.clips[index], index };
    }
    throw new Error(`Clip introuvable: ${id}`);
  };

  return {
    getProject: () => cloneProject(project),
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      listener(cloneProject(project));
      return () => listeners.delete(listener);
    },
    createProject(name: string): void {
      undoStack.length = 0;
      redoStack.length = 0;
      project = makeDefaultProject(name);
      notify();
    },
    loadProject(nextProject: Project): void {
      undoStack.length = 0;
      redoStack.length = 0;
      project = cloneProject(nextProject);
      notify();
    },
    updateProjectMeta(updates: Partial<Pick<Project, 'name'>>): void {
      mutate((draft) => Object.assign(draft, updates));
    },
    addTrack(type: TrackType, name?: string): TrackId {
      const track = makeTrack(type, name ?? `${type === 'video' ? 'Video' : 'Piste'} ${project.tracks.length + 1}`, project.tracks.length);
      mutate((draft) => draft.tracks.push(track));
      return track.id;
    },
    removeTrack(id: TrackId): void {
      mutate((draft) => {
        draft.tracks = draft.tracks.filter((track) => track.id !== id);
      });
    },
    updateTrack(id: TrackId, updates: Partial<Track>): void {
      mutate(() => Object.assign(findTrack(id), updates));
    },
    reorderTracks(orderedIds: TrackId[]): void {
      mutate((draft) => {
        const byId = new Map(draft.tracks.map((track) => [track.id, track]));
        draft.tracks = orderedIds.map((id) => byId.get(id)).filter((track): track is Track => Boolean(track));
      });
    },
    addClip(trackId: TrackId, source: ClipSource, timelinePosition: number, name?: string): ClipId {
      const track = findTrack(trackId);
      const id = makeClipId(uid('clip'));
      const duration = Math.max(0.01, source.outPoint - source.inPoint);
      const clip: Clip = {
        id,
        trackId,
        name: name ?? source.filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'Clip',
        source,
        timelinePosition: snapPosition(project, timelinePosition),
        duration,
        gain: DEFAULTS.CLIP.gain,
        fadeIn: DEFAULTS.CLIP.fadeIn,
        fadeOut: DEFAULTS.CLIP.fadeOut,
      };
      mutate(() => {
        track.clips.push(clip);
        sortClips(track);
      });
      return id;
    },
    removeClip(id: ClipId): void {
      mutate(() => {
        const { track, index } = findClip(id);
        track.clips.splice(index, 1);
      });
    },
    moveClip(id: ClipId, newPosition: number, newTrackId?: TrackId): void {
      mutate(() => {
        const { track, clip, index } = findClip(id);
        const nextPosition = snapPosition(project, newPosition);
        if (newTrackId && newTrackId !== track.id) {
          track.clips.splice(index, 1);
          const nextTrack = findTrack(newTrackId);
          clip.trackId = newTrackId;
          clip.timelinePosition = nextPosition;
          nextTrack.clips.push(clip);
          sortClips(nextTrack);
          return;
        }
        clip.timelinePosition = nextPosition;
        sortClips(track);
      });
    },
    trimClip(id: ClipId, edge: 'left' | 'right', delta: number): void {
      mutate(() => {
        const { clip, track } = findClip(id);
        if (edge === 'left') {
          const nextIn = Math.max(0, Math.min(clip.source.inPoint + delta, clip.source.outPoint - 0.05));
          const diff = nextIn - clip.source.inPoint;
          clip.source.inPoint = nextIn;
          clip.timelinePosition = snapPosition(project, clip.timelinePosition + diff);
        } else {
          clip.source.outPoint = Math.max(clip.source.inPoint + 0.05, clip.source.outPoint + delta);
        }
        clip.duration = Math.max(0.05, clip.source.outPoint - clip.source.inPoint);
        clip.fadeIn = Math.min(clip.fadeIn, clip.duration);
        clip.fadeOut = Math.min(clip.fadeOut, clip.duration);
        sortClips(track);
      });
    },
    splitClip(id: ClipId, atTime: number): [ClipId, ClipId] {
      const leftId = makeClipId(uid('clip'));
      const rightId = makeClipId(uid('clip'));
      mutate(() => {
        const { track, clip, index } = findClip(id);
        const relative = atTime - clip.timelinePosition;
        if (relative <= 0.05 || relative >= clip.duration - 0.05) {
          throw new Error('Le playhead doit etre a l interieur du clip');
        }
        const sourceSplit = clip.source.inPoint + relative;
        const left: Clip = {
          ...clip,
          id: leftId,
          duration: relative,
          source: { ...clip.source, outPoint: sourceSplit },
          fadeOut: Math.min(clip.fadeOut, relative),
        };
        const rightDuration = clip.duration - relative;
        const right: Clip = {
          ...clip,
          id: rightId,
          timelinePosition: atTime,
          duration: rightDuration,
          source: { ...clip.source, inPoint: sourceSplit },
          fadeIn: Math.min(clip.fadeIn, rightDuration),
        };
        track.clips.splice(index, 1, left, right);
        sortClips(track);
      });
      return [leftId, rightId];
    },
    updateClip(id: ClipId, updates: Partial<Clip>): void {
      mutate(() => {
        const { clip, track } = findClip(id);
        Object.assign(clip, updates);
        sortClips(track);
      });
    },
    setPlayhead(time: number): void {
      mutate((draft) => {
        draft.playhead = Math.max(0, Math.min(time, draft.duration));
      }, false);
    },
    getPlayhead: () => project.playhead,
    addMarker(time: number, label: string): MarkerId {
      const id = makeMarkerId(uid('marker'));
      mutate((draft) => {
        draft.markers.push({ id, time: Math.max(0, time), label, color: '#f5c842' });
      });
      return id;
    },
    removeMarker(id: MarkerId): void {
      mutate((draft) => {
        draft.markers = draft.markers.filter((marker) => marker.id !== id);
      });
    },
    undo(): void {
      const previous = undoStack.pop();
      if (!previous) return;
      redoStack.push(cloneProject(project));
      project = previous;
      notify();
    },
    redo(): void {
      const next = redoStack.pop();
      if (!next) return;
      undoStack.push(cloneProject(project));
      project = next;
      notify();
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
  };
}
