const fs = require('node:fs');
const path = require('node:path');

// Checking metadata is cheap; directory scans, CSV parsing and hashing are cached.
// Include cwd so isolated studies/tests never share a cached configuration.
function revision(paths) {
  return JSON.stringify([process.cwd(), ...paths.map(relative => {
    try {
      const stat = fs.statSync(path.join(process.cwd(), relative), { bigint: true });
      return [stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  })]);
}
function cachedSnapshot() {
  let key, value;
  return (nextKey, build) => {
    if (key !== nextKey) {
      const nextValue = build(); // Never cache a failed read.
      value = nextValue;
      key = nextKey;
    }
    return structuredClone(value);
  };
}
module.exports = { revision, cachedSnapshot };
