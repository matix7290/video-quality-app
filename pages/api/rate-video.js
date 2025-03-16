import db from '../../database';

export default function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { sessionId, videoName, rating, duration } = req.body;
    if (!sessionId || !videoName || !rating || duration === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    let user = db.prepare('SELECT id FROM users WHERE session_id = ?').get(sessionId);
    if (!user) {
        const insertUser = db.prepare('INSERT INTO users (session_id) VALUES (?)');
        const info = insertUser.run(sessionId);
        user = { id: info.lastInsertRowid };
    }

    // Wyciągnięcie nazwy klipu (do pierwszego "_") i wartości VMAF (po "_vmaf_")
    const clipNameMatch = videoName.match(/^([^_]+)/);
    const vmafMatch = videoName.match(/_vmaf_(\d+)/);

    const clipName = clipNameMatch ? clipNameMatch[1] : 'Unknown';
    const vmafValue = vmafMatch ? parseInt(vmafMatch[1], 10) : null;

    // Zapis do bazy danych
    const insertRating = db.prepare('INSERT INTO ratings (user_id, video_name, clip_name, vmaf, rating, duration) VALUES (?, ?, ?, ?, ?, ?)');
    insertRating.run(user.id, videoName, clipName, vmafValue, rating, duration);

    res.json({ message: 'Rating saved successfully' });
}