const fetch = require('node-fetch'); // or native fetch
(async () => {
    try {
        console.log("Calling deployed endpoint: https://health-care-server-ci1l.onrender.com/api/chat");
        const response = await fetch('https://health-care-server-ci1l.onrender.com/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: "hello",
                userId: "d3b07384-d113-43cf-a5a4-56b000000000"
            })
        });
        const text = await response.text();
        console.log("Response status:", response.status);
        console.log("Response headers:", response.headers.get('content-type'));
        console.log("Response body:", text);
    } catch (err) {
        console.error("Test failed:", err);
    }
})();
