const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load .env.local if it exists, otherwise fall back to default .env
const envPath = fs.existsSync(path.resolve(__dirname, '../.env.local'))
  ? path.resolve(__dirname, '../.env.local')
  : path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const express = require('express');
const cors = require('cors');
const voiceRouter = require('./routes/voice');
const chatRouter = require('./routes/chat');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'aurora-backend' }));

// Routes
app.use('/api/voice', voiceRouter);
app.use('/api/chat', chatRouter);

app.listen(PORT, () => {
    console.log(`Aurora backend running on http://localhost:${PORT}`);
});