// Capture entries immediately: browsers only expose the drag data during drop.
function droppedFiles(dataTransfer) {
  const items = Array.from(dataTransfer.items || []).filter(item => item.kind === 'file');
  const sources = items.map(item => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }));
  const fallback = Array.from(dataTransfer.files || []);
  async function readEntry(entry) {
    if (entry.isFile) return [await new Promise((resolve, reject) => entry.file(resolve, reject))];
    if (!entry.isDirectory) return [];
    const reader = entry.createReader();
    const files = [];
    // Directory readers may return only one batch (often 100 entries) at a time.
    for (;;) {
      const entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!entries.length) return files;
      for (const child of entries) files.push(...await readEntry(child));
    }
  }
  return sources.length
    ? Promise.all(sources.map(({ entry, file }) => entry ? readEntry(entry) : [file].filter(Boolean))).then(groups => groups.flat())
    : Promise.resolve(fallback);
}

module.exports = { droppedFiles };
