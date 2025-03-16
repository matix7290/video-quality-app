import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
    const videoDir = path.join(process.cwd(), 'public/videos');
    const files = fs.readdirSync(videoDir).filter(file => file.endsWith('.mp4'));

    if (files.length === 0) {
        return res.status(404).json({ error: 'No videos available' });
    }

    const randomFile = files[Math.floor(Math.random() * files.length)];
    res.json({ video: `/videos/${randomFile}` });
}