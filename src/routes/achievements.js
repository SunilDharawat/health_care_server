const express = require('express');
const router = express.Router();
const supabase = require('../supabase');

/**
 * GET /api/achievements/:userId
 * Calculates user achievements and milestones progress.
 */
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({ error: 'Missing userId parameter' });
        }

        const today = new Date().toISOString().split('T')[0];

        // 14 days ago for sleep analysis
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
        const fourteenDaysAgoISO = fourteenDaysAgo.toISOString();

        // 7 days ago for hydration streak analysis
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const sevenDaysAgoKey = sevenDaysAgo.toISOString().split('T')[0];

        // Fetch user data
        const [
            { data: profile },
            { data: totalHydrationData },
            { data: hydrationLogs7Days },
            { data: sleepLogs14Days },
            { data: habits },
            // Today's logs for Wellness Score calculation
            { data: hydrationToday },
            { data: sleepToday },
            { data: habitLogsToday },
            { data: mealsToday },
        ] = await Promise.all([
            supabase.from('profiles').select('*').eq('id', userId).single(),
            supabase.from('hydration_logs').select('id').eq('user_id', userId).limit(1),
            supabase.from('hydration_logs').select('*').eq('user_id', userId).gte('logged_at', `${sevenDaysAgoKey}T00:00:00`),
            supabase.from('sleep_logs').select('*').eq('user_id', userId).gte('sleep_end', fourteenDaysAgoISO),
            supabase.from('habits').select('*').eq('user_id', userId).eq('is_active', true),
            supabase.from('hydration_logs').select('amount_ml').eq('user_id', userId).gte('logged_at', `${today}T00:00:00`),
            supabase.from('sleep_logs').select('*').eq('user_id', userId).gte('sleep_end', `${today}T00:00:00`),
            supabase.from('habit_logs').select('*').eq('user_id', userId).eq('date_key', today).eq('status', 'completed'),
            supabase.from('meals').select('calories').eq('user_id', userId).eq('date_key', today),
        ]);

        const waterGoal = profile?.water_goal_ml || 2500;
        const sleepGoal = profile?.sleep_goal_hrs || 8;

        // -- ACHIEVEMENT 1: First Steps (Log first water intake)
        const totalHydrationCount = totalHydrationData ? totalHydrationData.length : 0;
        const firstStepsUnlocked = totalHydrationCount > 0;

        // --------------------------------------------------------
        // -- ACHIEVEMENT 2: Hydration Legend (7-day perfect water goal streak)
        // --------------------------------------------------------
        const dailyHydration = {};
        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = d.toISOString().split('T')[0];
            dailyHydration[key] = 0;
        }
        (hydrationLogs7Days || []).forEach(log => {
            const key = log.logged_at.split('T')[0];
            if (dailyHydration[key] !== undefined) {
                dailyHydration[key] += log.amount_ml;
            }
        });

        const hydrationDaysMet = Object.keys(dailyHydration).filter(key => dailyHydration[key] >= waterGoal).length;
        const hydrationLegendUnlocked = hydrationDaysMet >= 7;
        const hydrationProgress = hydrationDaysMet / 7;

        // --------------------------------------------------------
        // -- ACHIEVEMENT 3: Sleep Master (Average 8h sleep for 14 days)
        // --------------------------------------------------------
        const sleepDurations = (sleepLogs14Days || []).map(log => log.duration_hrs);
        const sleepAvg = sleepDurations.length > 0
            ? sleepDurations.reduce((sum, val) => sum + val, 0) / sleepDurations.length
            : 0;
        const sleepMasterUnlocked = sleepAvg >= 8.0;
        const sleepProgress = Math.min(1.0, sleepAvg / 8.0);

        // --------------------------------------------------------
        // -- ACHIEVEMENT 4: On Fire (Complete all habits for 5 days straight)
        // --------------------------------------------------------
        const maxHabitStreak = (habits || []).reduce((max, h) => Math.max(max, h.streak || 0), 0);
        const onFireUnlocked = maxHabitStreak >= 5;
        const onFireProgress = Math.min(1.0, maxHabitStreak / 5);

        // --------------------------------------------------------
        // -- ACHIEVEMENT 5: Wellness Master (Wellness score above 85)
        // --------------------------------------------------------
        let targetCalories = 2000;
        if (profile && profile.weight_kg && profile.height_cm && profile.age) {
            const weight = profile.weight_kg;
            const height = profile.height_cm;
            const age = profile.age;
            const isFemale = profile.gender === 'female';
            const bmr = isFemale
                ? 447.593 + (9.247 * weight) + (3.098 * height) - (4.330 * age)
                : 88.362 + (13.397 * weight) + (4.799 * height) - (5.677 * age);
            const multiplier = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 }[profile.activity_level] || 1.2;
            targetCalories = Math.round(bmr * multiplier);
        }

        const todayHydrationTotal = (hydrationToday || []).reduce((sum, l) => sum + l.amount_ml, 0);
        const todaySleepLog = sleepToday && sleepToday.length > 0 ? sleepToday[0] : null;
        const completedHabitsCount = habitLogsToday ? habitLogsToday.length : 0;
        const totalHabitsCount = habits ? habits.length : 0;
        const todayCalories = (mealsToday || []).reduce((sum, m) => sum + m.calories, 0);

        const hydrationPct = waterGoal > 0 ? Math.min(100, Math.round((todayHydrationTotal / waterGoal) * 100)) : 0;
        let sleepScore = 70;
        if (todaySleepLog) {
            const durationPct = sleepGoal > 0 ? (todaySleepLog.duration_hrs / sleepGoal) * 100 : 0;
            const qualityPct = ((todaySleepLog.quality || 3) / 5) * 100;
            sleepScore = Math.min(100, Math.round(durationPct * 0.6 + qualityPct * 0.4));
        }
        const habitsPct = totalHabitsCount > 0 ? Math.round((completedHabitsCount / totalHabitsCount) * 100) : 100;
        const nutritionPct = todayCalories > 0 ? Math.max(0, 100 - Math.round(Math.abs(todayCalories - targetCalories) / targetCalories * 100)) : 0;

        const todayWellnessScore = Math.round(hydrationPct * 0.25 + sleepScore * 0.25 + habitsPct * 0.25 + nutritionPct * 0.25);
        const wellnessMasterUnlocked = todayWellnessScore >= 85;
        const wellnessProgress = Math.min(1.0, todayWellnessScore / 85);

        // 4. Compile Achievements Array
        const achievementsList = [
            {
                id: 'first_steps',
                title: 'First Steps',
                description: 'Log your first water intake',
                icon: 'Target',
                color: '#FFB74D', // Amber
                unlocked: firstStepsUnlocked,
                progress: firstStepsUnlocked ? 1.0 : 0.0,
                progressText: firstStepsUnlocked ? 'Completed' : '0/1 logged',
            },
            {
                id: 'hydration_legend',
                title: 'Hydration Legend',
                description: 'Hit water goal 7 days in a row',
                icon: 'Award',
                color: '#4FC3F7', // Water blue
                unlocked: hydrationLegendUnlocked,
                progress: hydrationProgress,
                progressText: `${hydrationDaysMet}/7 days`,
            },
            {
                id: 'sleep_master',
                title: 'Sleep Master',
                description: 'Average 8h sleep for 2 weeks',
                icon: 'Crown',
                color: '#9C7CF4', // Purple
                unlocked: sleepMasterUnlocked,
                progress: sleepProgress,
                progressText: `${sleepAvg.toFixed(1)}h avg`,
            },
            {
                id: 'on_fire',
                title: 'On Fire',
                description: 'Maintain habit streak of 5+ days',
                icon: 'Flame',
                color: '#F44336', // Red
                unlocked: onFireUnlocked,
                progress: onFireProgress,
                progressText: `${maxHabitStreak}/5 days`,
            },
            {
                id: 'wellness_master',
                title: 'Wellness Master',
                description: 'Wellness score above 85',
                icon: 'Trophy',
                color: '#7C6FF7', // Violet
                unlocked: wellnessMasterUnlocked,
                progress: wellnessProgress,
                progressText: `${todayWellnessScore}/85 score`,
            },
        ];

        return res.json(achievementsList);

    } catch (err) {
        console.error('[achievements] Fetch error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch achievements', details: err.message });
    }
});

module.exports = router;
