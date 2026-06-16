const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const axios = require('axios');

/**
 * POST /api/insights/generate
 * Generates a smart daily insight based on 14-day user log patterns.
 * Caches in `daily_insights` table.
 */
router.post('/generate', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'Missing userId' });
        }

        const today = new Date().toISOString().split('T')[0];

        // 1. Check if an insight is already generated for today
        const { data: existingInsight, error: fetchError } = await supabase
            .from('daily_insights')
            .select('*')
            .eq('user_id', userId)
            .eq('date_key', today)
            .single();

        if (existingInsight) {
            console.log(`[insights] Loaded cached insight for user ${userId} today.`);
            return res.json(existingInsight);
        }

        console.log(`[insights] No cached insight found. Generating fresh insight for ${userId}...`);

        // 2. Fetch last 14 days of data to analyze patterns
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
        const fourteenDaysAgoKey = fourteenDaysAgo.toISOString().split('T')[0];
        const fourteenDaysAgoISO = fourteenDaysAgo.toISOString();

        const [
            { data: profile },
            { data: hydrationLogs },
            { data: sleepLogs },
            { data: habits },
            { data: habitLogs },
            { data: meals },
        ] = await Promise.all([
            supabase.from('profiles').select('*').eq('id', userId).single(),
            supabase.from('hydration_logs').select('*').eq('user_id', userId).gte('logged_at', `${fourteenDaysAgoKey}T00:00:00`),
            supabase.from('sleep_logs').select('*').eq('user_id', userId).gte('sleep_end', fourteenDaysAgoISO),
            supabase.from('habits').select('*').eq('user_id', userId).eq('is_active', true),
            supabase.from('habit_logs').select('*').eq('user_id', userId).gte('logged_at', fourteenDaysAgoISO),
            supabase.from('meals').select('*').eq('user_id', userId).gte('logged_at', fourteenDaysAgoISO),
        ]);

        // 3. Compile timeline data per day
        const dailyData = {};
        for (let i = 0; i <= 14; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = d.toISOString().split('T')[0];
            dailyData[key] = {
                date: key,
                hydration: 0,
                sleep: null,
                completedHabits: [],
                totalCalories: 0,
            };
        }

        // Hydration logs
        (hydrationLogs || []).forEach(log => {
            const key = log.logged_at.split('T')[0];
            if (dailyData[key]) {
                dailyData[key].hydration += log.amount_ml;
            }
        });

        // Sleep logs
        (sleepLogs || []).forEach(log => {
            const key = log.sleep_end.split('T')[0];
            if (dailyData[key]) {
                dailyData[key].sleep = { duration: log.duration_hrs, quality: log.quality };
            }
        });

        // Habits map
        const habitMap = {};
        (habits || []).forEach(h => {
            habitMap[h.id] = h.name;
        });

        // Habit completed logs
        (habitLogs || []).forEach(log => {
            const key = log.date_key;
            if (dailyData[key] && log.status === 'completed') {
                const name = habitMap[log.habit_id] || 'Unknown Habit';
                dailyData[key].completedHabits.push(name);
            }
        });

        // Meals
        (meals || []).forEach(m => {
            const key = m.date_key;
            if (dailyData[key]) {
                dailyData[key].totalCalories += m.calories || 0;
            }
        });

        // Generate clean textual timeline
        let timelineText = '';
        Object.keys(dailyData).sort().forEach(key => {
            const day = dailyData[key];
            // Format only if there's any logged data for that day
            if (day.hydration > 0 || day.sleep || day.completedHabits.length > 0 || day.totalCalories > 0) {
                timelineText += `Date: ${key}\n`;
                timelineText += `- Hydration: ${day.hydration} ml (Goal: ${profile?.water_goal_ml || 2500} ml)\n`;
                timelineText += `- Sleep: ${day.sleep ? `${day.sleep.duration}h (quality: ${day.sleep.quality || 3}/5)` : 'no sleep log'}\n`;
                timelineText += `- Completed Habits: ${day.completedHabits.join(', ') || 'none'}\n`;
                timelineText += `- Nutrition: ${day.totalCalories} kcal\n\n`;
            }
        });

        // If timeline is empty, generate a fallback welcoming insight
        if (!timelineText.trim()) {
            const fallbackInsight = "Hi! I'm ready to track your patterns. Log your sleep, water, and habits for a few days, and I'll start sharing custom wellness insights!";
            const { data: newInsight } = await supabase
                .from('daily_insights')
                .insert({
                    user_id: userId,
                    date_key: today,
                    insight: fallbackInsight,
                    category: 'general',
                })
                .select()
                .single();
            return res.json(newInsight);
        }

        // 4. Send to Groq for custom health pattern insight
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            throw new Error('GROQ_API_KEY is not configured on backend.');
        }

        const systemPrompt = `You are Aurora, a warm health companion. Your job is to analyze the user's 14-day health history and extract exactly ONE smart, highly personalized, and actionable health insight.

Rules:
- Identify a clear, logical pattern, trend, or correlation from the data (e.g. sleep duration/quality correlates with water logged, morning vs evening habit completion, sleep quality on days when certain habits are completed, etc.).
- Always refer to actual metrics or specific habits from their timeline.
- Keep the tone encouraging, warm, conversational, and personal (use "I" when talking as Aurora).
- Keep it short: exactly 1-2 sentences.
- Avoid generic health advice (like "remember to sleep 8 hours"). Focus on the actual data correlations.
- Return ONLY the raw insight text. No preamble, no headers, no quotation marks.`;

        const userPrompt = `Here is my profile and 14-day health history. Please analyze it and give me my smart daily insight.

Profile:
- Name: ${profile?.name || 'User'}
- Goal: ${profile?.goals?.join(', ') || 'General Wellness'}

History:
${timelineText}`;

        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.1-8b-instant',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0.4,
            max_tokens: 256,
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
        });

        let insightText = response.data.choices[0].message.content.trim();
        // Strip surrounding quotes if the model output them
        insightText = insightText.replace(/^["']|["']$/g, '');

        if (!insightText) {
            throw new Error('LLM generated empty insight');
        }

        // 5. Store generated insight to daily_insights table in Supabase
        const { data: newInsight, error: insertError } = await supabase
            .from('daily_insights')
            .insert({
                user_id: userId,
                date_key: today,
                insight: insightText,
                category: 'general',
            })
            .select()
            .single();

        if (insertError) throw insertError;

        console.log(`[insights] Successfully generated and cached new insight for user ${userId}.`);
        return res.json(newInsight);

    } catch (err) {
        console.error('[insights] Generation error:', err.message);
        return res.status(500).json({
            error: 'Insights generation failed',
            details: err.message,
            insight: 'I am tracking your habits and sleep. Keep logging data and I will reveal your custom wellness patterns soon!',
        });
    }
});

module.exports = router;
