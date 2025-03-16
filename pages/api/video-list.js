import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
    const videoDir = path.join(process.cwd(), 'public/videos');

    try {
        const files = fs.readdirSync(videoDir).filter(file => file.endsWith('.mp4'));

        if (files.length === 0) {
            return res.status(404).json({ error: 'Brak plików wideo w katalogu' });
        }

        res.status(200).json({ videos: files.map(file => `/videos/${file}`) });
    } catch (error) {
        console.error("Błąd odczytu katalogu:", error);
        res.status(500).json({ error: 'Błąd serwera' });
    }
}