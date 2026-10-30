import { useCallback, useEffect, useState } from "react";

/** A per-device UI preference (rail collapsed, dashboard view…). Falls back to the default if storage is blocked. */
export function usePref<T extends string | boolean>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`lms.pref.${key}`);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(`lms.pref.${key}`, JSON.stringify(v));
      } catch {
        // ignore
      }
    },
    [key],
  );
  return [value, set];
}

/** True while the media query matches (e.g. "(min-width: 1024px)"). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

// Course colors: each has at least 4.5:1 contrast with white text.
const COURSE_COLORS = ["#1a5c94", "#6d3a8f", "#0e6655", "#9c3a1c", "#4d5b1c", "#8a2f5c", "#2d4f8a", "#6b4a12"];

export function courseColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COURSE_COLORS[h % COURSE_COLORS.length]!;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
