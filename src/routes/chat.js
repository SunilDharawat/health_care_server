const express = require('express');
const router = express.Router();
const { runAgent } = require('../agent');
const { textToSpeech } = require('../tts');
const { buildHealthContext } = require('../healthContext');

/**
 * POST /api/chat
 * Body: { message: string, userId: string }
 * Returns: { reply, action, audioBase64 }
 */
router.post('/', async (req, res) => {
    try {
        const { message, userId } = req.body;

        if (!message || !userId) {
            return res.status(400).json({ error: 'Missing message or userId' });
        }

        const healthContext = await buildHealthContext(userId);
        const { reply, action } = await runAgent(message, userId, healthContext);
        const audioBase64 = await textToSpeech(reply);

        return res.json({ reply, action, audioBase64 });

    } catch (err) {
        console.error('[chat] Error:', err);
        return res.status(500).json({
            error: 'Chat failed',
            reply: 'Sorry, something went wrong. Please try again.',
            action: null,
            audioBase64: null,
        });
    }
});

module.exports = router;