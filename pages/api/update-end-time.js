import { sessionSettings, phases } from '../../utils/study-config.cjs';
import db from '../../database';

export default function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { sessionId } = req.body || {};

    if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 200) {
        return res.status(400).json({ error: 'Missing sessionId' });
    }

    try {
        const user = db.prepare('SELECT id, playlist, settings_snapshot FROM users WHERE session_id = ?').get(sessionId);
        if (!user) return res.status(404).json({ error: 'Session not found' });
        const playlist = JSON.parse(user.playlist);
        const ratings = db.prepare('SELECT video_name, phase FROM ratings WHERE user_id = ?').all(user.id);
        if (phases(sessionSettings(user)).some(phase => playlist.some(url =>
            !ratings.some(r => r.phase === phase && r.video_name === decodeURIComponent(url.split('/').pop()))))) {
            return res.status(409).json({ error: 'Both phases must be completed' });
        }
        const updateEndTime = db.prepare('UPDATE users SET end_time = COALESCE(end_time, CURRENT_TIMESTAMP) WHERE session_id = ?');
        updateEndTime.run(sessionId);

        return res.status(200).json({ message: 'End time updated successfully' });
    } catch (error) {
        console.error('Error updating end time:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
