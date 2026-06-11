const supabase = require('./supabase');

/**
 * Builds a full health context string for a user.
 * This is injected into every Claude prompt so it can give personalised answers.
 */
async function buildHealthContext(userId) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

        const [
            { data: profile },
            { data: hydrationToday },
            { data: sleepLast },
            { data: habitsToday },
            { data: mealsToday },
            { data: memories },
        ] = await Promise.all([
            supabase.from('profiles').select('*').eq('id', userId).single(),
            supabase.from('hydration_logs').select('amount_ml').eq('user_id', userId).gte('logged_at', `${today}T00:00:00`),
            supabase.from('sleep_logs').select('*').eq('user_id', userId).order('sleep_end', { ascending: false }).limit(1).single(),
            supabase.from('habits').select('id, name, streak, is_active').eq('user_id', userId).eq('is_active', true),
            supabase.from('meals').select('name, meal_type, calories, protein_g, carbs_g, fat_g').eq('user_id', userId).eq('date_key', today),
            supabase.from('health_memory').select('observation').eq('user_id', userId).order('updated_at', { ascending: false }).limit(10),
        ]);

        // Hydration
        const totalWater = (hydrationToday || []).reduce((s, l) => s + l.amount_ml, 0);
        const waterGoal = profile?.water_goal_ml || 2500;

        // Sleep
        const lastSleepHrs = sleepLast?.duration_hrs?.toFixed(1) || 'not logged';

        // Habits
        const habitNames = (habitsToday || []).map(h => `${h.name} (streak: ${h.streak})`).join(', ') || 'none';

        // Habits completed today
        let completedHabits = [];
        if (habitsToday?.length > 0) {
            const { data: habitLogs } = await supabase
                .from('habit_logs')
                .select('habit_id, status')
                .eq('user_id', userId)
                .eq('date_key', today);
            completedHabits = habitLogs || [];
        }
        const completedIds = completedHabits.filter(l => l.status === 'completed').map(l => l.habit_id);
        const habitsStatus = (habitsToday || []).map(h =>
            `${h.name}: ${completedIds.includes(h.id) ? 'done ✓' : 'pending'}`
        ).join(', ') || 'no habits';

        // Nutrition
        const totalCals = (mealsToday || []).reduce((s, m) => s + (m.calories || 0), 0);
        const mealNames = (mealsToday || []).map(m => m.name).join(', ') || 'nothing logged';

        // Memory
        const memoryStr = (memories || []).map(m => `- ${m.observation}`).join('\n') || 'No observations yet.';

        return `
== USER HEALTH CONTEXT ==
Name: ${profile?.name || 'User'}
Date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
Time: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}

HYDRATION TODAY:
- Consumed: ${(totalWater / 1000).toFixed(2)}L of ${(waterGoal / 1000).toFixed(1)}L goal (${Math.round((totalWater / waterGoal) * 100)}%)

SLEEP (last night):
- Duration: ${lastSleepHrs} hours
- Goal: ${profile?.sleep_goal_hrs || 8} hours

HABITS TODAY:
- ${habitsStatus}

NUTRITION TODAY:
- Total calories: ${totalCals} kcal
- Meals logged: ${mealNames}

AURORA'S MEMORY (patterns observed):
${memoryStr}

== END CONTEXT ==
`.trim();
    } catch (err) {
        console.error('buildHealthContext error:', err);
        return 'User health context unavailable.';
    }
}

module.exports = { buildHealthContext };