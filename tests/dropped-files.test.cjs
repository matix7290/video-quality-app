const { test } = require('node:test');
const assert = require('node:assert/strict');
const { droppedFiles } = require('../utils/dropped-files.cjs');

const fileEntry = file => ({ isFile: true, file: resolve => resolve(file) });
function directory(batches) {
  return { isDirectory: true, createReader: () => {
    let index = 0;
    return { readEntries: resolve => resolve(batches[index++] || []) };
  } };
}

test('drop reads all directory batches and nested folders alongside loose files', async () => {
  const files = [{ name: 'first.png' }, { name: 'nested.jpg' }, { name: 'last.webp' }, { name: 'loose.png' }];
  const folder = directory([[fileEntry(files[0]), directory([[fileEntry(files[1])]])], [fileEntry(files[2])]]);
  const items = [folder, fileEntry(files[3])].map(entry => ({ kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => null }));
  assert.deepEqual(await droppedFiles({ items, files: [] }), files);
});

test('drop falls back to files when entry APIs or items are unavailable', async () => {
  const file = { name: 'photo.png' };
  assert.deepEqual(await droppedFiles({ items: [{ kind: 'string' }, { kind: 'file', getAsFile: () => file }], files: [file] }), [file]);
  assert.deepEqual(await droppedFiles({ files: [file] }), [file]);
  assert.deepEqual(await droppedFiles({ items: [], files: [] }), []);
});

test('drop captures drag data synchronously and reports directory read failures', async () => {
  const file = { name: 'photo.png' };
  const data = { items: [{ kind: 'file', getAsFile: () => file }], files: [file] };
  const pending = droppedFiles(data);
  data.items = []; data.files = [];
  assert.deepEqual(await pending, [file]);
  const entry = { isDirectory: true, createReader: () => ({ readEntries: (resolve, reject) => reject(new Error('Unreadable folder')) }) };
  await assert.rejects(droppedFiles({ items: [{ kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => null }] }), /Unreadable folder/);
});
