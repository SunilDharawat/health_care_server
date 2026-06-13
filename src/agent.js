const axios = require('axios');
const supabase = require('./supabase');

// ============================================================
// TOOL DEFINITIONS
// ============================================================
const TOOLS = [
    {
        name: 'log_water',
        description: 'Log water intake for the user.',
        input_schema: {
            type: 'object',
            properties: {
                amount_ml: { type: 'number', description: 'Amount in ml' },
            },
            required: ['amount_ml'],
        },
    },
    {
        name: 'log_sleep',
        description: 'Log sleep duration.',
        input_schema: {
            type: 'object',
            properties: {
                hours: { type: 'number', description: 'Hours slept' },
                quality: { type: 'number', description: 'Quality 1-5' },
            },
            required: ['hours'],
        },
    },
    {
        name: 'create_habit',
        description: 'Create a new habit.',
        input_schema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Habit name' },
                icon: { type: 'string', description: 'Icon key' },
            },
            required: ['name'],
        },
    },
    {
        name: 'complete_habit',
        description: 'Mark habit as completed.',
        input_schema: {
            type: 'object',
            properties: {
                habit_name: { type: 'string', description: 'Habit name' },
            },
            required: ['habit_name'],
        },
    },
    {
        name: 'log_meal',
        description: 'Log a meal.',
        input_schema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Food name' },
                meal_type: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
                calories: { type: 'number', description: 'Calories' },
            },
            required: ['name', 'meal_type'],
        },
    },
    {
        name: 'get_health_summary',
        description: 'Get health summary.',
        input_schema: {
            type: 'object',
            properties: {
                period: { type: 'string', enum: ['today', 'week'] },
            },
            required: ['period'],
        },
    },
];

// ============================================================
// TOOL EXECUTORS
// ============================================================
async function executeTool(toolName, toolInput, userId) {
    const today = new Date().toISOString().split('T')[0];

    switch (toolName) {
        case 'log_water': {
            const { amount_ml } = toolInput;
            await supabase.from('hydration_logs').insert({
                user_id: userId, amount_ml: Math.round(amount_ml), source: 'voice',
            });
            return { success: true, message: `Logged ${amount_ml}ml`, action: `Added ${amount_ml}ml water` };
        }

        case 'log_sleep': {
            const { hours, quality = 3 } = toolInput;
            const wakeTime = new Date();
            const sleepTime = new Date(wakeTime.getTime() - hours * 3600000);
            await supabase.from('sleep_logs').insert({
                user_id: userId,
                sleep_start: sleepTime.toISOString(),
                sleep_end: wakeTime.toISOString(),
                quality,
                source: 'voice',
            });
            return { success: true, message: `Logged ${hours}h sleep`, action: `Logged ${hours}h sleep` };
        }

        case 'create_habit': {
            const { name, icon = 'custom' } = toolInput;
            await supabase.from('habits').insert({
                user_id: userId, name, icon, color: '#4DB6AC', frequency: 'daily',
            });
            return { success: true, message: `Created ${name}`, action: `Created "${name}"` };
        }

        case 'complete_habit': {
            const { habit_name } = toolInput;
            const { data: habits } = await supabase
                .from('habits')
                .select('id, name')
                .eq('user_id', userId)
                .eq('is_active', true)
                .ilike('name', `%${habit_name}%`)
                .limit(1);

            if (!habits?.length) {
                return { success: false, message: `No habit found` };
            }

            const habit = habits[0];
            await supabase.from('habit_logs').upsert({
                habit_id: habit.id,
                user_id: userId,
                status: 'completed',
                date_key: today,
                source: 'voice',
            }, { onConflict: 'habit_id,date_key' });

            return { success: true, message: `Completed ${habit.name}`, action: `Completed "${habit.name}"` };
        }

        case 'log_meal': {
            const { name, meal_type, calories = 0 } = toolInput;
            await supabase.from('meals').insert({
                user_id: userId, name, meal_type, calories, date_key: today, source: 'voice',
            });
            return { success: true, message: `Logged ${name}`, action: `Logged ${name}` };
        }

        default:
            return { success: false, message: `Unknown tool` };
    }
}

// ============================================================
// MAIN AGENT - USES GROQ API (Free, no payment needed)
// ============================================================
async function runAgent(userMessage, userId, healthContext) {
    const systemPrompt = `You are Aurora, a warm health companion.

${healthContext}

Rules:
- Use tools to log health data
- Keep responses short (2-3 sentences)
- Be encouraging and warm
- Use real numbers from context`;

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error('GROQ_API_KEY not set. Get free key from console.groq.com');
    }

    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
    ];

    let finalReply = '';
    let actionTaken = null;
    let iterations = 0;

    while (iterations < 5) {
        iterations++;

        const response = await axios.post(url, {
            model: 'mixtral-8x7b-32768', // Free model, very fast
            messages,
            tools: TOOLS,
            tool_choice: 'auto',
            temperature: 0.7,
            max_tokens: 1024,
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
        });

        const choice = response.data.choices[0];
        const toolCalls = choice.message.tool_calls || [];

        // Add assistant message
        messages.push({ role: 'assistant', content: choice.message.content || '', tool_calls: toolCalls });

        if (choice.message.content) {
            finalReply = choice.message.content;
        }

        // No tool calls — we're done
        if (toolCalls.length === 0) {
            break;
        }

        // Execute tools
        const toolResults = [];
        for (const toolCall of toolCalls) {
            const result = await executeTool(toolCall.function.name, JSON.parse(toolCall.function.arguments), userId);
            if (result.action) actionTaken = result.action;

            toolResults.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
            });
        }

        messages.push(...toolResults);
    }

    return {
        reply: finalReply || "I'm here! How can I help?",
        action: actionTaken,
    };
}

module.exports = { runAgent };