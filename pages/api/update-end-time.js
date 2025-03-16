import db from '../../database';

export default function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { sessionId } = req.body;

    if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
    }

    try {
        const updateEndTime = db.prepare('UPDATE users SET end_time = CURRENT_TIMESTAMP WHERE session_id = ?');
        updateEndTime.run(sessionId);

        return res.status(200).json({ message: 'End time updated successfully' });
    } catch (error) {
        console.error('Error updating end time:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
