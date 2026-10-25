import { useEffect, useRef, useState } from "react";
import { slowRequestsSince } from "./api";
import { tg } from "./telegram";

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** true, если какой-то запрос висит дольше порога — показываем «медленное соединение». */
export function useSlowNetwork(thresholdMs = 4000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => setSlow(slowRequestsSince(thresholdMs)), 700);
    return () => window.clearInterval(t);
  }, [thresholdMs]);
  return slow;
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Подтверждение закрытия Mini App, пока в форме есть несохранённые данные. */
export function useClosingConfirmation(dirty: boolean): void {
  useEffect(() => {
    tg.closingConfirmation(dirty);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      tg.closingConfirmation(false);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty]);
}

/** Актуальная ссылка на колбэк без пересоздания подписок. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Сохранение черновика формы между безопасными переходами (sessionStorage). */
export function useStoredState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void, () => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* недоступно — работаем без сохранения */
    }
  }, [key, state]);
  const clear = () => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };
  return [state, setState, clear];
}
