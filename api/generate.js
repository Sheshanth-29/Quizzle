// Vercel Serverless Function — Gemini AI Quiz Question Generator
module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const topic = (body.topic || '').trim();
    const count = parseInt(body.count) || 5;

    if (!topic) {
      return res.status(400).json({ error: 'Please provide a topic.' });
    }

    // Support any casing the user might have used in Vercel project settings
    const apiKey = (
      process.env.GEMINI_API_KEY ||
      process.env.Gemini_API_key ||
      process.env.gemini_api_key ||
      process.env.GEMINI_KEY ||
      ''
    ).trim();

    if (!apiKey) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY is not set in Vercel. In your Vercel Dashboard, go to Settings → Environment Variables and add GEMINI_API_KEY.'
      });
    }

    const prompt = `You are a quiz creator. Generate exactly ${count} multiple-choice quiz questions about the topic: "${topic}".

Rules:
- Each question must have exactly 4 answer options (A, B, C, D).
- Exactly one option must be correct.
- Questions should be clear, factual, and educational.
- Vary difficulty: mix easy, medium, and hard questions.
- Do NOT number the questions.

Respond ONLY with a valid JSON array, no extra text, no markdown fences. Format:
[
  {
    "question": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": 0
  }
]

Where correctAnswer is the 0-based index of the correct option.`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `HTTP ${response.status}`;
      return res.status(response.status).json({ error: `Gemini API error: ${errMsg}` });
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    let questions;
    try {
      questions = JSON.parse(cleaned);
    } catch (e) {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        questions = JSON.parse(match[0]);
      } else {
        return res.status(502).json({ error: 'AI returned an unparseable response. Please try again.' });
      }
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(502).json({ error: 'No questions generated. Please try a different topic.' });
    }

    return res.status(200).json({ questions });
  } catch (err) {
    console.error('Serverless function error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
