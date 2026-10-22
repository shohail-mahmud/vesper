import {
  addTrackToPlaylist,
  chooseTrackCover,
  clearTrackCover,
  createPlaylist,
  enqueueTrack,
  revealInExplorer,
  toggleFavorite,
  useApp,
} from "../state/store";
import { runtime } from "../state/bridge";

export {
  addTrackToPlaylist,
  chooseTrackCover,
  clearTrackCover,
  createPlaylist,
  enqueueTrack,
  revealInExplorer,
  toggleFavorite,
  useApp,
};

export function runtimeIsNative(): boolean {
  return runtime.isTauri;
}
