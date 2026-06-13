const express = require('express');
const router = express.Router();
const { transcribeAudio } = require('../stt');
const { runAgent } = require('../agent');  // Now uses Groq
const { textToSpeech } = require('../tts');
const { buildHealthContext } = require('../healthContext');

/**
 * POST /api/voice
 * Handles: Audio upload → STT → Agent → TTS
 */
router.post('/', async (req, res) => {
    try {
        const { audio, userId } = req.body;

        if (!audio || !userId) {
            return res.status(400).json({ error: 'Missing audio or userId' });
        }

        console.log(`[voice] Processing for user ${userId}`);

        // 1. Transcribe
        const transcript = await transcribeAudio(audio);
        console.log(`[voice] Transcript: "${transcript}"`);

        if (!transcript?.trim()) {
            return res.json({
                transcript: '',
                reply: "I didn't catch that. Please try speaking again.",
                action: null,
                audioBase64: null,
            });
        }

        // 2. Build context
        const healthContext = await buildHealthContext(userId);

        // 3. Run agent (now uses Groq)
        const { reply, action } = await runAgent(transcript, userId, healthContext);
        console.log(`[voice] Reply: "${reply}" | Action: ${action}`);

        // 4. Convert to speech (optional — still works)
        const audioBase64 = await textToSpeech(reply).catch(err => {
            console.warn('TTS unavailable, returning text only:', err.message);
            return null;
        });

        return res.json({ transcript, reply, action, audioBase64 });

    } catch (err) {
        console.error('[voice] Error:', err.message);
        return res.status(500).json({
            error: 'Voice processing failed',
            details: err.message,
            transcript: '',
            reply: 'Sorry, something went wrong. Please try again.',
            action: null,
            audioBase64: null,
        });
    }
});

/**
 * Test endpoint to verify Groq connection
 */
router.get('/test', async (req, res) => {
    try {
        const axios = require('axios');
        const apiKey = process.env.GROQ_API_KEY;

        if (!apiKey) {
            return res.status(400).json({ error: 'GROQ_API_KEY not set in .env' });
        }

        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'mixtral-8x7b-32768',
                messages: [{ role: 'user', content: 'Say hello' }],
                max_tokens: 10,
            },
            {
                headers: { 'Authorization': `Bearer ${apiKey}` },
            }
        );

        return res.json({ status: 'ok', groq_connection: 'working' });
    } catch (err) {
        return res.status(500).json({
            error: 'Groq connection failed',
            details: err.message
        });
    }
});

module.exports = router;