const express = require('express');
const router = express.Router();
const { transcribeAudio } = require('../stt');
const { runAgent } = require('../agent');
const { textToSpeech } = require('../tts');
const { buildHealthContext } = require('../healthContext');

/**
 * POST /api/voice
 * Body: { audio: base64String, userId: string }
 * Returns: { transcript, reply, action, audioBase64 }
 */
router.post('/', async (req, res) => {
    try {
        const { audio, userId } = req.body;

        if (!audio || !userId) {
            return res.status(400).json({ error: 'Missing audio or userId' });
        }

        // 1. Transcribe audio → text
        console.log(`[voice] Transcribing for user ${userId}`);
        const transcript = await transcribeAudio(audio);

        if (!transcript?.trim()) {
            return res.json({
                transcript: '',
                reply: "I didn't catch that. Please try speaking again.",
                action: null,
                audioBase64: null,
            });
        }

        console.log(`[voice] Transcript: "${transcript}"`);

        // 2. Build health context
        const healthContext = await buildHealthContext(userId);

        // 3. Run AI agent (may call tools)
        const { reply, action } = await runAgent(transcript, userId, healthContext);
        console.log(`[voice] Reply: "${reply}" | Action: ${action}`);

        // 4. Convert reply to speech
        const audioBase64 = await textToSpeech(reply);

        return res.json({ transcript, reply, action, audioBase64 });

    } catch (err) {
        console.error('[voice] Error:', err);
        return res.status(500).json({
            error: 'Voice processing failed',
            transcript: '',
            reply: 'Sorry, something went wrong. Please try again.',
            action: null,
            audioBase64: null,
        });
    }
});

module.exports = router;