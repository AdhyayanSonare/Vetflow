import { useEffect, useState, useSyncExternalStore } from "react";

/** True while the media query matches, and updates when it changes (rotate a tablet, resize a window). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    cb => {
      const m = matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

export const useIsDesktop = () => useMediaQuery("(min-width: 768px)");

/** Returns `value` after it has stopped changing for `ms`. For search boxes. */
export function useDebounce<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Whether the browser has a network connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    cb => {
      addEventListener("online", cb);
      addEventListener("offline", cb);
      return () => { removeEventListener("online", cb); removeEventListener("offline", cb); };
    },
    () => navigator.onLine,
    () => true,
  );
}
