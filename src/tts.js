const axios = require('axios');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Default: Bella (calm female)

/**
 * Converts text to speech using ElevenLabs.
 * Returns base64-encoded MP3 audio.
 */
async function textToSpeech(text) {
    if (!ELEVENLABS_API_KEY) {
        console.warn('ElevenLabs API key not set — skipping TTS');
        return null;
    }

    try {
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
            {
                text,
                model_id: 'eleven_turbo_v2',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                    style: 0.3,
                    use_speaker_boost: true,
                },
            },
            {
                headers: {
                    'xi-api-key': ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json',
                    Accept: 'audio/mpeg',
                },
                responseType: 'arraybuffer',
            }
        );

        return Buffer.from(response.data).toString('base64');
    } catch (err) {
        console.error('TTS error:', err?.response?.data || err.message);
        return null;
    }
}

module.exports = { textToSpeech };