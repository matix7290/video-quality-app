const formats = {
  mp4: { type: 'video', mime: 'video/mp4', directory: 'videos' },
  jpg: { type: 'image', mime: 'image/jpeg', directory: 'images' },
  jpeg: { type: 'image', mime: 'image/jpeg', directory: 'images' },
  png: { type: 'image', mime: 'image/png', directory: 'images' },
  webp: { type: 'image', mime: 'image/webp', directory: 'images' },
};
function stimulusInfo(name) {
  if (typeof name !== 'string' || /[\\/\x00-\x1f]/.test(name) || name.length > 200) return null;
  const extension = name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  return formats[extension] || null;
}
function validStimulusHeader(info, header) {
  if (info.mime === 'video/mp4') return header.toString('ascii', 4, 8) === 'ftyp';
  if (info.mime === 'image/jpeg') return header.subarray(0, 3).toString('hex') === 'ffd8ff';
  if (info.mime === 'image/png') return header.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  return header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP';
}
module.exports = { stimulusInfo, validStimulusHeader };
