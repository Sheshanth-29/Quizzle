// Vercel Serverless Function — AI Quiz Question Generator (Groq + Gemini fallback)
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const topic = String((body && body.topic) || '').trim().slice(0, 120);
  const count = Math.min(Math.max(parseInt(body && body.count, 10) || 5, 1), 10);

  if (!topic) {
    return res.status(400).json({ error: 'Please enter a topic.' });
  }

  const groqKey = (
    process.env.GROQ_API_KEY ||
    process.env.Groq_API_key ||
    process.env.groq_api_key ||
    ''
  ).trim();

  const geminiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.Gemini_API_key ||
    process.env.gemini_api_key ||
    ''
  ).trim();

  if (!groqKey && !geminiKey) {
    return res.status(500).json({
      error: 'Missing API key. Please add GROQ_API_KEY in Vercel > Settings > Environment Variables.'
    });
  }

  const systemPrompt = `You are a professional quiz creator. Generate exactly ${count} high-quality multiple-choice quiz questions about the given topic.

Rules:
- Each question must have exactly 4 answer options (A, B, C, D).
- Exactly one option must be correct.
- Questions should be clear, factual, and educational.
- Vary difficulty across easy, medium, and hard.
- Do NOT number the questions in the question text.

Output format must be valid JSON matching this exact structure:
{
  "questions": [
    {
      "question": "Question text here?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0
    }
  ]
}
Where correctAnswer is the 0-based index (0, 1, 2, or 3) of the correct option.`;

  // 1. Try Groq first (ultra-fast, generous rate limits, no overload)
  if (groqKey) {
    const groqModels = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];

    for (const model of groqModels) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Topic: "${topic}". Generate exactly ${count} multiple-choice questions.` }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.7
          })
        });

        if (response.ok) {
          const data = await response.json();
          const content = data?.choices?.[0]?.message?.content || '{}';
          const parsed = JSON.parse(content);
          const rawList = Array.isArray(parsed) ? parsed : (parsed.questions || []);

          if (Array.isArray(rawList) && rawList.length > 0) {
            return res.status(200).json({ questions: rawList });
          }
        }
      } catch (e) {
        console.warn(`Groq model ${model} failed, trying next fallback:`, e.message);
      }
    }
  }

  // 2. Fallback to Gemini if Groq is unavailable or failed
  if (geminiKey) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\nTopic: "${topic}"` }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json'
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        const rawList = Array.isArray(parsed) ? parsed : (parsed.questions || []);

        if (Array.isArray(rawList) && rawList.length > 0) {
          return res.status(200).json({ questions: rawList });
        }
      }
    } catch (e) {
      console.warn('Gemini fallback failed:', e.message);
    }
  }

  return res.status(502).json({
    error: 'AI service is temporarily busy. Please try again in a few moments.'
  });
};
