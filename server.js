// server.js
import express from 'express';
import fetch from 'node-fetch';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public')); // serve index.html from /public if you put it there

// simple rate limit
const limiter = rateLimit({ windowMs: 60*1000, max: 30 });
app.use(limiter);

// In-memory shares (demo). Use DB in real app.
const shares = {};

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.warn('Please set OPENAI_API_KEY in environment variables.');
}

// defensive JSON extractor
function extractJsonFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const jsonFence = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (jsonFence) { try { return JSON.parse(jsonFence[1]); } catch(e){} }
  const fence = text.match(/```([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch(e){} }
  try { return JSON.parse(text); } catch(e){}
  return null;
}

// Build a single instruction that asks model to return JSON with required fields.
// Keep it strict and request only JSON in triple backticks.
function buildPromptForFullAnalysis(fullText) {
  return `
You are an expert English linguist and exam writer for Korean high school students. 
Analyze the following passage and return only a JSON object (no extra commentary). Wrap the JSON in triple backticks if necessary.
The JSON must include:
- fullText: original text
- sentenceAnalyses: [ { sentenceText, chunk_translation:[{chunk,translation}], full_translation, paraphrasing, tokens:[{text,pos,role,explanation_ko,phrase_starts,phrase_ends}], exam_analysis:{grammar_points:[{point,explanation}], question_predictions:[{type,reason}]}, five_format_analysis:{format_type,subject,verb,object,complement,modifiers,explanation}, modern_grammar_analysis:{summary,clauses:[{clause_text,clause_type,analysis}]}, vocabulary:[{word,meaning,synonyms,antonyms}] } ]
- overallAnalysis: { topic, main_idea, argument, rhetoric:[{device,explanation}], structure:[{part,summary,role}] }
- finalAnalysis: { grammar_points:[{point,example}], vocabulary_points:[{word,reason}], reference_points:[{pronoun,refers_to}], summary_point, implication_points:[{sentence,meaning}], sequencing_hints:[{hint,explanation}] }
- highlights: [{text,type,explanation}] where type ∈ [grammar,vocabulary,blank,insertion,reference,sequence]
Make outputs concise and in Korean for explanations. Use modern grammar analysis and 5-form analysis for each sentence.
Passage:
"""${fullText}"""
Return the JSON now.
`;
}

app.post('/api/analyze', async (req,res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  if (!OPENAI_KEY) return res.status(500).json({ error: 'server not configured (OPENAI_API_KEY missing)' });

  try {
    // call OpenAI chat completions
    const prompt = buildPromptForFullAnalysis(text);
    const apiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // change if needed
        messages: [{role:'system', content:'You are a JSON-output-only assistant.'},{role:'user', content: prompt}],
        temperature: 0
      })
    });
    if (!apiResp.ok) {
      const t = await apiResp.text();
      return res.status(apiResp.status).json({ error:'upstream_error', detail: t });
    }
    const j = await apiResp.json();
    const candidate = j.choices?.[0]?.message?.content || '';
    const parsed = extractJsonFromText(candidate);
    if (!parsed) {
      // as fallback try to parse candidate directly
      try {
        const guessed = JSON.parse(candidate);
        return res.json(guessed);
      } catch (err) {
        // return text for debugging
        return res.status(500).json({ error:'could_not_parse', raw: candidate });
      }
    }
    return res.json(parsed);
  } catch (err) {
    console.error('Analyze error', err);
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
});

// Minimal share endpoints (demo)
function makeId(len=6){ const chars='abcdefghijklmnopqrstuvwxyz0123456789'; let s=''; for(let i=0;i<len;i++) s+=chars[Math.floor(Math.random()*chars.length)]; return s;}
app.post('/api/share', (req,res)=>{
  const body = req.body;
  const id = makeId(6);
  shares[id] = body;
  res.json({ id });
});
app.get('/api/share/:id', (req,res)=>{
  const id = req.params.id;
  if (!shares[id]) return res.status(404).json({ error:'not found' });
  res.json(shares[id]);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Server running on', PORT));
