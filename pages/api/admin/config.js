import { requireAdmin } from '../../../utils/admin-auth.cjs';
import { passwordConfigured } from '../../../utils/admin-password.cjs';
import { catalog, readConfiguration, validateConfig, writeConfiguration } from '../../../utils/study-config.cjs';
import { parseQuestions, readStudy } from '../../../utils/study.cjs';
export default function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!['GET', 'PUT'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  try {
    const files = catalog();
    if (req.method === 'PUT') {
      const settings = validateConfig(req.body?.settings, files.map(file => file.name));
      const csv = req.body?.questionsCsv;
      if (typeof csv !== 'string' || csv.length > 500000) throw new Error('CSV jest za duży lub nieprawidłowy.');
      parseQuestions(csv, files.map(file => file.name));
      writeConfiguration(settings, csv);
    }
    const configuration = readConfiguration();
    let version = null, warning = '';
    try { version = readStudy().settings.version; } catch (error) { warning = error.message; }
    return res.json({ ...configuration, catalog: files, version, warning, passwordProtected: passwordConfigured() });
  } catch (error) { return res.status(400).json({ error: error.message }); }
}
export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
