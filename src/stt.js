const axios = require('axios');

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

/**
 * Transcribes base64-encoded audio using Deepgram Nova-2.
 * Falls back to OpenAI Whisper if OPENAI_API_KEY is set instead.
 */
async function transcribeAudio(base64Audio) {
    const audioBuffer = Buffer.from(base64Audio, 'base64');

    // ── Option A: Deepgram (recommended — fastest, cheapest)
    if (DEEPGRAM_API_KEY) {
        try {
            const response = await axios.post(
                'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=en',
                audioBuffer,
                {
                    headers: {
                        Authorization: `Token ${DEEPGRAM_API_KEY}`,
                        'Content-Type': 'audio/m4a',
                    },
                }
            );
            const transcript = response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
            return transcript || '';
        } catch (err) {
            console.error('Deepgram STT error:', err?.response?.data || err.message);
            throw err;
        }
    }

    // ── Option B: OpenAI Whisper fallback
    if (process.env.OPENAI_API_KEY) {
        const FormData = require('form-data');
        const form = new FormData();
        form.append('file', audioBuffer, { filename: 'audio.m4a', contentType: 'audio/m4a' });
        form.append('model', 'whisper-1');

        const response = await axios.post(
            'https://api.openai.com/v1/audio/transcriptions',
            form,
            {
                headers: {
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                    ...form.getHeaders(),
                },
            }
        );
        return response.data?.text || '';
    }

    throw new Error('No STT provider configured. Set DEEPGRAM_API_KEY or OPENAI_API_KEY.');
}

module.exports = { transcribeAudio };