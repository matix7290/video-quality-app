import { readStudy, publicQuestions } from '../../utils/study.cjs';
export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    const study = readStudy();
    if (!study.videos.length) return res.status(404).json({ error: 'Brak stymulów wybranego rodzaju. Dodaj pliki w panelu administratora.' });
    return res.json({ videos: study.videos, questions: publicQuestions(study.questions), settings: study.settings });
  } catch (error) { return res.status(500).json({ error: error.message }); }
}
