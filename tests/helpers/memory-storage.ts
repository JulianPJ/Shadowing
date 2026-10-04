/** Browser storage fake shared by persistence tests; backing data stays inspectable. */
export function memoryStorage(values = new Map<string, string>()): Storage {
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, String(value));
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

export function installMemoryStorage(values = new Map<string, string>()) {
  const storage = memoryStorage(values);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  return storage;
}
