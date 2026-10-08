import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import multer from 'multer';
import { requireAdmin } from '../../../utils/admin-auth.cjs';
import { stimulusInfo, validStimulusHeader } from '../../../utils/stimuli.cjs';
export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const type = req.query?.type ?? 'video';
    if (!['video', 'image'].includes(type)) throw new Error('Nieprawidłowy rodzaj stymulów.');
    const upload = multer({ dest: os.tmpdir(), limits: { fileSize: type === 'image' ? 50 * 1024 ** 2 : 2 * 1024 ** 3, files: 1, fields: 0 },
      fileFilter: (req, file, done) => {
        const info = stimulusInfo(file.originalname);
        done(info?.type === type && file.originalname === path.basename(file.originalname) ? null :
          new Error(type === 'image' ? 'Wybierz zdjęcie JPG, PNG lub WebP o poprawnej nazwie.' : 'Wybierz plik MP4 o poprawnej nazwie.'), true);
      } }).single('video');
    await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
    if (!req.file) throw new Error('Nie wybrano pliku.');
    const fd = fs.openSync(req.file.path, 'r');
    const header = Buffer.alloc(12);
    try { fs.readSync(fd, header, 0, 12, 0); } finally { fs.closeSync(fd); }
    const info = stimulusInfo(req.file.originalname);
    if (!validStimulusHeader(info, header)) throw new Error('Zawartość pliku nie odpowiada jego formatowi.');
    const directory = path.join(process.cwd(), 'public', info.directory);
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, req.file.originalname);
    // COPYFILE_EXCL protects existing stimuli and sessions from overwritten content.
    try { await fs.promises.copyFile(req.file.path, target, fs.constants.COPYFILE_EXCL); }
    catch (error) { if (error.code === 'EEXIST') return res.status(409).json({ error: `Plik ${req.file.originalname} już istnieje. Zmień nazwę przed importem.` }); throw error; }
    return res.status(201).json({ name: req.file.originalname });
  } catch (error) { return res.status(400).json({ error: error.message }); }
  finally { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); }
}
export const config = { api: { bodyParser: false, responseLimit: false } };
