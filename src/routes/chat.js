const express = require('express');
const router = express.Router();
const { runAgent } = require('../agent');  // Now uses Groq
const { textToSpeech } = require('../tts');
const { buildHealthContext } = require('../healthContext');

/**
 * POST /api/chat
 * Text-only agent (for suggested prompts)
 */
router.post('/', async (req, res) => {
    try {
        const { message, userId } = req.body;

        if (!message || !userId) {
            return res.status(400).json({ error: 'Missing message or userId' });
        }

        console.log(`[chat] Message from ${userId}: "${message}"`);

        const healthContext = await buildHealthContext(userId);
        const { reply, action } = await runAgent(message, userId, healthContext);

        const audioBase64 = await textToSpeech(reply).catch(err => {
            console.warn('TTS unavailable:', err.message);
            return null;
        });

        console.log(`[chat] Reply: "${reply}" | Action: ${action}`);

        return res.json({ reply, action, audioBase64 });

    } catch (err) {
        console.error('[chat] Error:', err.message);
        return res.status(500).json({
            error: 'Chat failed',
            details: err.message,
            reply: 'Sorry, something went wrong. Please try again.',
            action: null,
            audioBase64: null,
        });
    }
});

/**
 * Test endpoint
 */
router.get('/test', async (req, res) => {
    return res.json({
        status: 'Chat service ready',
        groq_configured: !!process.env.GROQ_API_KEY,
    });
});

module.exports = router;