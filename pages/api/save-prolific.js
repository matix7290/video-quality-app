export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { sessionId, PROLIFIC_PID, STUDY_ID, SESSION_ID } = req.body || {};

  // console.log("Data from Prolific saved:", {
  //   sessionId,
  //   PROLIFIC_PID,
  //   STUDY_ID,
  //   SESSION_ID,
  // });

  return res.status(200).json({ success: true });
}
