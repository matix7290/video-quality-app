import fs from 'node:fs';
import path from 'node:path';
import { stimulusInfo } from '../../../utils/stimuli.cjs';
export default function handler(req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
  const name = req.query.name;
  const info = stimulusInfo(name);
  if (!info || name !== path.basename(name)) return res.status(404).end();
  const filename = path.join(process.cwd(), 'public', info.directory, name);
  let stat;
  try { stat = fs.lstatSync(filename); } catch { return res.status(404).end(); }
  if (!stat.isFile() || !stat.size) return res.status(404).end();
  res.setHeader('Content-Type', info.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');
  let start = 0, end = stat.size - 1;
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    } else start = stat.size;
    if (start > end || start >= stat.size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      res.setHeader('Content-Range', `bytes */${stat.size}`); return res.status(416).end();
    }
    res.status(206); res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  }
  res.setHeader('Content-Length', end - start + 1);
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(filename, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
export const config = { api: { responseLimit: false } };
