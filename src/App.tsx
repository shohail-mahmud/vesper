import { useEffect, useRef } from "react";
import { Desktop } from "./components/Desktop";
import { WidgetWindow } from "./components/Widget";
import {
  cycleRepeat,
  init,
  next,
  previous,
  seek,
  setDrawer,
  setShuffle,
  setWidget,
  toggleMute,
  togglePlay,
  useApp,
} from "./state/store";

const WIDGET_URL_PARAM = "window";
const WIDGET_URL_VALUE = "widget";

export function isWidgetWindow(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get(WIDGET_URL_PARAM) === WIDGET_URL_VALUE;
}

/** Global application keyboard shortcuts. Never captured while typing in inputs. */
function useKeyboardShortcuts(
  enabled: boolean,
  searchInputRef: React.RefObject<HTMLInputElement | null>,
) {
  const state = useApp();

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      switch (event.key) {
        case " ":
          event.preventDefault();
          void togglePlay();
          break;
        case "ArrowLeft":
          event.preventDefault();
          if (event.shiftKey) void previous();
          else void seek(Math.max(0, state.playback.position - 5));
          break;
        case "ArrowRight":
          event.preventDefault();
          if (event.shiftKey) void next();
          else void seek(state.playback.position + 5);
          break;
        case "s":
        case "S":
          setShuffle(!state.playback.shuffle);
          break;
        case "r":
        case "R":
          cycleRepeat();
          break;
        case "m":
        case "M":
          toggleMute();
          break;
        case "w":
        case "W":
          setWidget({ visible: !state.widget.visible });
          break;
        case "q":
        case "Q":
          setDrawer("queue");
          break;
        case "l":
        case "L":
          setDrawer("lyrics");
          break;
        case "e":
        case "E":
          setDrawer("eq");
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, searchInputRef, state.playback.position, state.playback.shuffle, state.widget.visible]);
}

export default function App() {
  const widgetWindow = isWidgetWindow();
  const state = useApp();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  useKeyboardShortcuts(!widgetWindow, searchInputRef);

  useEffect(() => {
    void init(widgetWindow);
  }, [widgetWindow]);

  if (widgetWindow) return <WidgetWindow />;
  if (!state.ready) {
    return <div className="h-full w-full bg-paper" />;
  }
  return <Desktop searchInputRef={searchInputRef} />;
}
