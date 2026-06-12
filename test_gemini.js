const fetch = require('node-fetch');
(async () => {
    try {
        console.log("Calling Google Gemini ListModels API...");
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.log("Error: GEMINI_API_KEY is not defined in env");
            return;
        }
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();
        console.log("Status:", response.status);
        if (data.models) {
            console.log("Available models:");
            data.models.forEach(m => console.log(`- ${m.name}`));
        } else {
            console.log("No models returned. Full response:", JSON.stringify(data, null, 2));
        }
    } catch (err) {
        console.error("Test failed:", err);
    }
})();
