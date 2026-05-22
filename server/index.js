import express from 'express';
import { createServer } from 'http';
import Anthropic from '@anthropic-ai/sdk';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import dotenv from 'dotenv';
import multer from 'multer';
import { WebSocket, WebSocketServer } from 'ws';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const SYSTEM_PROMPT = 'You are AURIS, a hands-free voice assistant. You help drivers reply to messages, control phone volume, and read notifications. Be concise, max 2 sentences per response. Speak naturally.';
const TRANSCRIBE_SYSTEM_PROMPT = `You are AURIS, a hands-free voice assistant for drivers and busy people.
Help users reply to messages, read notifications, and control their phone.
Be concise, max 2 sentences. Speak naturally in the same language as the user.`;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.get('/', (req, res) => {
  res.json({ status: 'AURIS server running', port: PORT });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

function getTranscriptionText(transcription) {
  if (typeof transcription?.text === 'string') {
    return transcription.text.trim();
  }

  if (Array.isArray(transcription?.transcripts)) {
    return transcription.transcripts
      .map((item) => item.text)
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  return '';
}

function getClaudeText(message) {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

async function getClaudeResponse(transcript) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    system: TRANSCRIBE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcript }],
  });

  return getClaudeText(message);
}

app.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Audio file is required.' });
    return;
  }

  try {
    const transcription = await elevenlabs.speechToText.convert({
      file: {
        data: req.file.buffer,
        filename: req.file.originalname || 'auris-recording.m4a',
        contentType: req.file.mimetype || 'audio/m4a',
        contentLength: req.file.size,
      },
      modelId: 'scribe_v2',
    });
    const transcript = getTranscriptionText(transcription);

    if (!transcript) {
      res.status(422).json({ error: 'No transcript returned from audio.' });
      return;
    }

    const response = await getClaudeResponse(transcript);
    res.json({ transcript, response });
  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: 'Failed to transcribe audio.' });
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function extractTranscript(rawMessage) {
  const message = rawMessage.toString();

  try {
    const payload = JSON.parse(message);
    return payload.transcript || payload.text || payload.message || '';
  } catch {
    return message;
  }
}

async function streamClaudeResponse(ws, transcript) {
  sendJson(ws, { type: 'response.start' });

  const stream = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcript }],
    stream: true,
  });

  for await (const event of stream) {
    if (ws.readyState !== WebSocket.OPEN) {
      break;
    }

    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      sendJson(ws, { type: 'response.delta', text: event.delta.text });
    }
  }

  sendJson(ws, { type: 'response.complete' });
}

wss.on('connection', (ws) => {
  sendJson(ws, { type: 'connection.ready' });

  ws.on('message', async (message) => {
    const transcript = extractTranscript(message).trim();

    if (!transcript) {
      sendJson(ws, { type: 'error', message: 'Transcript is required.' });
      return;
    }

    try {
      await streamClaudeResponse(ws, transcript);
    } catch (error) {
      console.error('Claude streaming error:', error);
      sendJson(ws, { type: 'error', message: 'Failed to stream Claude response.' });
    }
  });
});

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AURIS server running on port ${PORT}`);
});
