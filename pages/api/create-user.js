import db from '../../database';

export default function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { sessionId, videoOrder, clientInfo, autoFullscreen } = req.body;

    if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
    }

    if (!videoOrder) {
        return res.status(400).json({ error: 'Missing videoOrder' });
    }

    if (!clientInfo) {
        return res.status(400).json({ error: 'Missing clientInfo' });
    }

    if (autoFullscreen === undefined) {
        return res.status(400).json({ error: 'Missing autoFullscreen' });
    }

    try {
        const insertUser = db.prepare('INSERT INTO users (session_id, playlist, client_info, auto_fullscreen) VALUES (?, ?, ?, ?)');
        insertUser.run(sessionId, JSON.stringify(videoOrder), JSON.stringify(clientInfo), autoFullscreen);

        return res.status(201).json({ message: 'User created successfully', sessionId });
    } catch (error) {
        console.error('Error creating user:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
