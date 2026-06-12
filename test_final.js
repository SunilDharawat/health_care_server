const fetch = require('node-fetch');
(async () => {
    try {
        console.log("Calling deployed endpoint: https://health-care-server-ci1l.onrender.com/api/chat");
        const response = await fetch('https://health-care-server-ci1l.onrender.com/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: "hello, what is your name?",
                userId: "d3b07384-d113-43cf-a5a4-56b000000000"
            })
        });
        const data = await response.json();
        console.log("Response status:", response.status);
        console.log("Response body:", JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Test failed:", err);
    }
})();
