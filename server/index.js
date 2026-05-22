import express from 'express';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.get('/health', (req, res) => {
  res.json({ status: 'AURIS server running' });
});

app.listen(PORT, () => {
  console.log(`AURIS server running on port ${PORT}`);
});
