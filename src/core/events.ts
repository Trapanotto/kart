import type { EventBus, Listener } from './types';

export function createEventBus<E>(): EventBus<E> {
  const map = new Map<keyof E, Set<Listener<any>>>();
  return {
    on(type, fn) {
      let set = map.get(type);
      if (!set) map.set(type, (set = new Set()));
      set.add(fn);
      return () => set!.delete(fn);
    },
    emit(type, payload) {
      const set = map.get(type);
      if (!set) return;
      for (const fn of [...set]) fn(payload);
    },
    clear() {
      map.clear();
    },
  };
}
