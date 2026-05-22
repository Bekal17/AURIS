import express from 'express';
import { createServer } from 'http';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { WebSocket, WebSocketServer } from 'ws';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const SYSTEM_PROMPT = 'You are AURIS, a hands-free voice assistant. You help drivers reply to messages, control phone volume, and read notifications. Be concise, max 2 sentences per response. Speak naturally.';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.get('/', (req, res) => {
  res.json({ status: 'AURIS server running', port: PORT });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
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
