import fs from "fs";
import path from "path";

// Prosta pamięć sesyjna na serwerze (w RAM)
const sessions = new Map();

export default function handler(req, res) {
  const videoDir = path.join(process.cwd(), "public/videos");
  const files = fs.readdirSync(videoDir).filter((f) => f.endsWith(".mp4"));
  if (!files.length) {
    return res.status(404).json({ error: "Brak dostępnych filmów" });
  }

  const { sessionId, exclude } = req.query;

  const shuffle = (arr) =>
    arr
      .map((a) => [Math.random(), a])
      .sort((a, b) => a[0] - b[0])
      .map(([, a]) => a);

  let order, index;
  if (sessionId) {
    let session = sessions.get(sessionId);
    if (!session) {
      session = { order: shuffle(files), index: 0 };
      sessions.set(sessionId, session);
    }
    order = session.order;
    index = session.index;

    let tries = 0;
    while (order[index % order.length] === exclude && tries < order.length) {
      index++;
      tries++;
    }

    const pick = order[index % order.length];
    session.index = (index + 1) % order.length;
    res.setHeader("Cache-Control", "no-store");
    return res.json({ id: pick, video: `/videos/${pick}` });
  }

  let pick = files[Math.floor(Math.random() * files.length)];
  if (files.length > 1 && pick === exclude) {
    pick = files[(files.indexOf(pick) + 1) % files.length];
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({ id: pick, video: `/videos/${pick}` });
}
