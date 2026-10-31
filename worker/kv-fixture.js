// In-memory KV for offline tests. Values round-trip through JSON like real bindings.
export class MemoryKV {
  constructor(entries = []) { this.values = new Map(entries); this.writes = []; this.reads = []; }
  async get(key, type) {
    this.reads.push(key);
    const value = this.values.get(key) ?? null;
    return value === null || type !== "json" ? value : JSON.parse(value);
  }
  async put(key, value, options) {
    this.writes.push({ key, value, options });
    this.values.set(key, value);
  }
}
