// Keep recent decoded download URLs, rather than retaining the entire study in RAM.
class BlobCache {
  constructor(revoke, maxBytes = 128 * 1024 * 1024, maxEntries = 3) {
    this.entries = new Map();
    this.bytes = 0;
    this.revoke = revoke;
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
  }
  get(key) {
    const value = this.entries.get(key);
    if (value) { this.entries.delete(key); this.entries.set(key, value); }
    return value;
  }
  set(key, value) {
    this.delete(key);
    this.entries.set(key, value);
    this.bytes += value.size;
    // The current stimulus must remain alive, even if it alone exceeds the budget.
    while (this.entries.size > 1 && (this.bytes > this.maxBytes || this.entries.size > this.maxEntries)) {
      this.delete(this.entries.keys().next().value);
    }
  }
  delete(key) {
    const value = this.entries.get(key);
    if (!value) return;
    this.revoke(value.blobUrl);
    this.bytes -= value.size;
    this.entries.delete(key);
  }
  clear() { for (const key of this.entries.keys()) this.delete(key); }
}
module.exports = { BlobCache };
