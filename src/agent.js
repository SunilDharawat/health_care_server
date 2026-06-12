const axios = require('axios');
const supabase = require('./supabase');

// ============================================================
// TOOL DEFINITIONS — what Gemini can do
// ============================================================
const TOOLS = [
    {
        name: 'log_water',
        description: 'Log water intake for the user. Use when user mentions drinking water, a beverage amount in ml, glasses, or cups.',
        input_schema: {
            type: 'object',
            properties: {
                amount_ml: {
                    type: 'number',
                    description: 'Amount of water in millilitres. Convert: 1 glass = 250ml, 1 cup = 240ml, 1 bottle = 500ml',
                },
            },
            required: ['amount_ml'],
        },
    },
    {
        name: 'log_sleep',
        description: 'Log sleep duration for the user. Use when user mentions how many hours they slept.',
        input_schema: {
            type: 'object',
            properties: {
                hours: {
                    type: 'number',
                    description: 'Number of hours slept (e.g. 7.5)',
                },
                quality: {
                    type: 'number',
                    description: 'Sleep quality rating from 1 (poor) to 5 (excellent). Infer from context if not stated.',
                },
            },
            required: ['hours'],
        },
    },
    {
        name: 'create_habit',
        description: 'Create a new habit for the user. Use when user asks to add or create a habit.',
        input_schema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Name of the habit, e.g. Morning meditation' },
                icon: {
                    type: 'string',
                    description: 'Icon key: reading, meditation, stretching, walking, journaling, supplements, sleep, exercise, water, breathing, gratitude, cold_shower, custom',
                },
            },
            required: ['name'],
        },
    },
    {
        name: 'complete_habit',
        description: "Mark a habit as completed for today. Use when user says they did, completed, or finished a habit.",
        input_schema: {
            type: 'object',
            properties: {
                habit_name: {
                    type: 'string',
                    description: 'Name of the habit to mark as complete (partial match is fine)',
                },
            },
            required: ['habit_name'],
        },
    },
    {
        name: 'log_meal',
        description: 'Log a meal or food for the user. Use when user mentions eating something.',
        input_schema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Name of the food or meal' },
                meal_type: {
                    type: 'string',
                    enum: ['breakfast', 'lunch', 'dinner', 'snack'],
                    description: 'Type of meal. Infer from context or time of day.',
                },
                calories: { type: 'number', description: 'Estimated calories. Use your knowledge to estimate if not stated.' },
                protein_g: { type: 'number', description: 'Protein in grams (optional estimate)' },
                carbs_g: { type: 'number', description: 'Carbohydrates in grams (optional estimate)' },
                fat_g: { type: 'number', description: 'Fat in grams (optional estimate)' },
            },
            required: ['name', 'meal_type'],
        },
    },
    {
        name: 'get_health_summary',
        description: "Get a summary of user's health data for today or a specific period. Use when user asks how they're doing.",
        input_schema: {
            type: 'object',
            properties: {
                period: {
                    type: 'string',
                    enum: ['today', 'week'],
                    description: 'Time period for summary',
                },
            },
            required: ['period'],
        },
    },
];

// Map our tools schemas to Gemini functionDeclarations format
const GEMINI_TOOLS = [
    {
        functionDeclarations: TOOLS.map(t => ({
            name: t.name,
            description: t.description,
            parameters: {
                type: 'OBJECT', // Gemini REST API expects uppercase for schema types
                properties: Object.keys(t.input_schema.properties).reduce((acc, key) => {
                    const prop = t.input_schema.properties[key];
                    acc[key] = {
                        type: prop.type.toUpperCase(),
                        description: prop.description,
                        ...(prop.enum ? { enum: prop.enum } : {})
                    };
                    return acc;
                }, {}),
                required: t.input_schema.required
            }
        }))
    }
];

// ============================================================
// TOOL EXECUTORS — what actually happens when the agent calls a tool
// ============================================================
async function executeTool(toolName, toolInput, userId) {
    const today = new Date().toISOString().split('T')[0];

    switch (toolName) {

        case 'log_water': {
            const { amount_ml } = toolInput;
            await supabase.from('hydration_logs').insert({
                user_id: userId, amount_ml: Math.round(amount_ml), source: 'voice',
            });
            return { success: true, message: `Logged ${amount_ml}ml of water`, action: `Added ${amount_ml}ml water` };
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
            return { success: true, message: `Logged ${hours} hours of sleep`, action: `Logged ${hours}h sleep` };
        }

        case 'create_habit': {
            const { name, icon = 'custom' } = toolInput;
            await supabase.from('habits').insert({
                user_id: userId, name, icon, color: '#4DB6AC', frequency: 'daily',
            });
            return { success: true, message: `Created habit: ${name}`, action: `Created "${name}" habit` };
        }

        case 'complete_habit': {
            const { habit_name } = toolInput;
            // Find matching habit (case-insensitive partial match)
            const { data: habits } = await supabase
                .from('habits')
                .select('id, name')
                .eq('user_id', userId)
                .eq('is_active', true)
                .ilike('name', `%${habit_name}%`)
                .limit(1);

            if (!habits?.length) {
                return { success: false, message: `No habit found matching "${habit_name}"` };
            }

            const habit = habits[0];
            await supabase.from('habit_logs').upsert({
                habit_id: habit.id,
                user_id: userId,
                status: 'completed',
                date_key: today,
                source: 'voice',
            }, { onConflict: 'habit_id,date_key' });

            return { success: true, message: `Marked "${habit.name}" as complete`, action: `Completed "${habit.name}"` };
        }

        case 'log_meal': {
            const { name, meal_type, calories = 0, protein_g = 0, carbs_g = 0, fat_g = 0 } = toolInput;
            await supabase.from('meals').insert({
                user_id: userId, name, meal_type, calories, protein_g, carbs_g, fat_g,
                date_key: today, source: 'voice',
            });
            return { success: true, message: `Logged ${name} as ${meal_type}`, action: `Logged ${name}` };
        }

        case 'get_health_summary': {
            return { success: true, message: 'Summary retrieved from context above' };
        }

        default:
            return { success: false, message: `Unknown tool: ${toolName}` };
    }
}

// ============================================================
// MAIN AGENT FUNCTION
// ============================================================
async function runAgent(userMessage, userId, healthContext) {
    const systemPrompt = `You are Aurora, a warm and intelligent personal health companion. You are not a chatbot — you are a supportive health coach who knows this user personally.

Your personality:
- Warm, encouraging, and concise
- Never clinical or overwhelming
- Use the user's name occasionally
- Celebrate small wins
- Give practical, specific advice based on their actual data

${healthContext}

Important rules:
- When the user logs something, use the appropriate tool FIRST, then confirm it warmly
- Keep responses short and conversational (2-3 sentences max unless they ask for detail)
- Always use real numbers from their health context when answering questions
- If they ask how they're doing, give a specific, data-driven answer
- Estimate nutritional values using your knowledge when logging meals`;

    const systemInstruction = {
        parts: [{ text: systemPrompt }]
    };

    let contents = [
        {
            role: 'user',
            parts: [{ text: userMessage }]
        }
    ];

    let finalReply = '';
    let actionTaken = null;
    let iterations = 0;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not defined in the environment variables');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    while (iterations < 5) {
        iterations++;

        const response = await axios.post(url, {
            contents,
            systemInstruction,
            tools: GEMINI_TOOLS
        });

        const candidate = response.data?.candidates?.[0];
        const content = candidate?.content;
        const parts = content?.parts || [];

        // Check for text content
        const textParts = parts.filter(p => p.text);
        if (textParts.length > 0) {
            finalReply = textParts.map(p => p.text).join(' ');
        }

        // Check for function calls
        const functionCalls = parts.filter(p => p.functionCall);
        if (functionCalls.length === 0) {
            break;
        }

        // Add assistant's response to conversation history
        contents.push(content);

        // Execute all tool calls and collect results
        const toolResultParts = [];
        for (const part of functionCalls) {
            const func = part.functionCall;
            const result = await executeTool(func.name, func.args, userId);
            if (result.action) actionTaken = result.action;
            
            toolResultParts.push({
                functionResponse: {
                    name: func.name,
                    response: result
                }
            });
        }

        // Add tool execution results to history
        contents.push({
            role: 'function',
            parts: toolResultParts
        });
    }

    return {
        reply: finalReply || "I'm here! How can I help you today?",
        action: actionTaken,
    };
}

module.exports = { runAgent };