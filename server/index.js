import express from 'express';
import { createServer } from 'http';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import multer from 'multer';
import { WebSocket, WebSocketServer } from 'ws';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const OPENAI_TTS_VOICE = 'nova';
const AUREL_SYSTEM_PROMPT = `Kamu adalah Aurel, asisten suara hands-free untuk pengemudi, orang sibuk, dan penyandang disabilitas.
Deteksi bahasa user dan balas dalam bahasa yang sama.

Untuk SEMUA perintah, selalu return JSON valid dengan field speak untuk response suara natural.

Contoh JSON responses:

Kirim WA tanpa pesan:
{"action":"send_wa","contact":"nama","message":null,"speak":"Mau kirim apa ke nama?"}

Kirim WA dengan pesan:
{"action":"send_wa","contact":"nama","message":"isi pesan","speak":"Oke, membuka WhatsApp untuk kirim pesan ke nama"}

Telepon WA normal:
{"action":"call_wa","contact":"nama","option":"normal","speak":"Oke, menelepon nama via WhatsApp"}

Telepon WA loudspeaker:
{"action":"call_wa","contact":"nama","option":"loudspeaker","speak":"Oke, menelepon nama dengan loudspeaker"}

Balas WA:
{"action":"reply_wa","message":"pesan","speak":"Oke, membalas pesan"}

Angkat telepon normal:
{"action":"answer_call","option":"normal","speak":"Mengangkat telepon"}

Angkat telepon loudspeaker:
{"action":"answer_call","option":"loudspeaker","speak":"Mengangkat telepon dengan loudspeaker"}

Tolak telepon:
{"action":"reject_call","speak":"Menolak telepon"}

Volume naik:
{"action":"volume","direction":"up","speak":"Volume dinaikkan"}

Volume turun:
{"action":"volume","direction":"down","speak":"Volume diturunkan"}

Mute:
{"action":"mute","enabled":true,"speak":"Mikrofon di-mute"}

Unmute:
{"action":"mute","enabled":false,"speak":"Mikrofon diaktifkan"}

Baca jadwal hari ini:
{"action":"calendar_today","speak":"Mengambil jadwal hari ini"}

Jadwal besok:
{"action":"calendar_tomorrow","speak":"Mengambil jadwal besok"}

Tambah jadwal:
{"action":"calendar_add","title":"judul event","datetime":"ISO datetime string","speak":"Menambahkan jadwal"}

Hapus jadwal:
{"action":"calendar_delete","query":"keyword pencarian","speak":"Mencari dan menghapus jadwal"}

Baca email:
{"action":"gmail_read","speak":"Membacakan email terbaru"}

Pertanyaan umum:
{"action":"speak","speak":"jawaban natural maksimal 2 kalimat"}

PENTING:
- Selalu return JSON valid, tidak ada teks di luar JSON
- Field speak selalu dalam bahasa yang sama dengan user
- Untuk send_wa tanpa pesan, tanya dulu dengan speak
- Nama kontak gunakan persis seperti yang disebutkan user`;
const TRANSCRIBE_SYSTEM_PROMPT = AUREL_SYSTEM_PROMPT;
const SPEECH_ENGINE_SYSTEM_PROMPT = AUREL_SYSTEM_PROMPT;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({ status: 'Aurel server running', port: PORT });
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
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: TRANSCRIBE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcript }],
  });

  return getClaudeText(message);
}

async function streamToBuffer(stream) {
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function getTextToSpeechAudio(responseText) {
  const audioResponse = await openai.audio.speech.create({
    model: 'tts-1',
    voice: OPENAI_TTS_VOICE,
    input: responseText,
    response_format: 'mp3',
  });
  const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

  return audioBuffer.toString('base64');
}

function getSpeakTextFromClaudeResponse(responseText) {
  try {
    const intent = JSON.parse(responseText);
    if (typeof intent?.speak === 'string' && intent.speak.trim()) {
      return intent.speak.trim();
    }
  } catch {
    // Non-JSON fallback keeps older/free-form responses speakable.
  }

  return responseText;
}

function pcmToWav(pcmBuffer, sampleRate = 16000, channels = 1, bitDepth = 16) {
  const dataLength = pcmBuffer.length;
  const buffer = Buffer.alloc(44 + dataLength);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);

  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bitDepth / 8, 28);
  buffer.writeUInt16LE(channels * bitDepth / 8, 32);
  buffer.writeUInt16LE(bitDepth, 34);

  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  pcmBuffer.copy(buffer, 44);

  return buffer;
}

function base64PcmToWav(base64Audio) {
  const pcmBuffer = Buffer.from(String(base64Audio || ''), 'base64');
  return pcmToWav(pcmBuffer, 16000, 1, 16);
}

async function transcribeAudioBuffer(audioBuffer, filename = 'aurel-recording.wav') {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const tempPath = join(tmpdir(), `${randomUUID()}-${safeFilename}`);

  try {
    await fs.writeFile(tempPath, audioBuffer);
    const transcription = await openai.audio.transcriptions.create({
      file: createReadStream(tempPath),
      model: 'whisper-1',
    });

    return String(transcription.text || '').trim();
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

async function transcribeBase64PcmAudio(base64Audio, filename = 'aurel-recording.wav') {
  const wavAudio = base64PcmToWav(base64Audio);
  return transcribeAudioBuffer(wavAudio, filename);
}

async function transcribePcmBuffer(audioBuffer, filename = 'aurel-ws.wav') {
  const wavAudio = pcmToWav(audioBuffer, 16000, 1, 16);
  return transcribeAudioBuffer(wavAudio, filename);
}

async function getTextToSpeechBuffer(responseText) {
  const audioResponse = await openai.audio.speech.create({
    model: 'tts-1',
    voice: OPENAI_TTS_VOICE,
    input: responseText,
    response_format: 'mp3',
  });

  return Buffer.from(await audioResponse.arrayBuffer());
}

async function buildTranscribeResponse(transcript) {
  const response = await getClaudeResponse(transcript);
  const speak = getSpeakTextFromClaudeResponse(response);
  const audio = await getTextToSpeechAudio(speak);

  return {
    transcript,
    response,
    speak,
    audio,
    audioFormat: 'mp3',
  };
}

app.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (req.body?.text) {
      const transcript = String(req.body.text).trim();
      const payload = await buildTranscribeResponse(transcript);
      res.json(payload);
      return;
    }

    if (req.body?.audio) {
      const transcript = await transcribeBase64PcmAudio(req.body.audio);

      if (!transcript) {
        res.status(422).json({ error: 'No transcript returned from audio.' });
        return;
      }

      const payload = await buildTranscribeResponse(transcript);
      res.json(payload);
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Audio file or text is required.' });
      return;
    }

    const transcript = await transcribeAudioBuffer(
      req.file.buffer,
      req.file.originalname || 'aurel-recording.m4a'
    );

    if (!transcript) {
      res.status(422).json({ error: 'No transcript returned from audio.' });
      return;
    }

    const payload = await buildTranscribeResponse(transcript);
    res.json(payload);
  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: 'Failed to transcribe audio.' });
  }
});

app.post('/transcribe-wake', async (req, res) => {
  try {
    if (!req.body?.audio) {
      res.status(400).json({ error: 'Audio is required.' });
      return;
    }

    const transcript = await transcribeBase64PcmAudio(req.body.audio, 'aurel-wake.wav');

    res.json({ transcript });
  } catch (error) {
    console.error('Wake transcription error:', error);
    res.status(500).json({ error: 'Failed to transcribe wake audio.' });
  }
});

app.post('/speak', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();

    if (!text) {
      res.status(400).json({ error: 'Text is required.' });
      return;
    }

    const audio = await getTextToSpeechAudio(text);
    res.json({
      audio,
      audioFormat: 'mp3',
    });
  } catch (error) {
    console.error('Speak error:', error);
    res.status(500).json({ error: 'Failed to generate speech.' });
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function getClaudeSpeechEngineResponse(transcript) {
  const stream = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: SPEECH_ENGINE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcript }],
    stream: true,
  });
  let response = '';

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      response += event.delta.text;
    }
  }

  return response.trim();
}

async function streamTextToSpeechToMobile(mobileWs, responseText) {
  const audioBuffer = await getTextToSpeechBuffer(responseText);

  sendJson(mobileWs, { type: 'audio.start', audioFormat: 'mp3' });

  if (mobileWs.readyState === WebSocket.OPEN) {
    mobileWs.send(audioBuffer, { binary: true });
  }

  sendJson(mobileWs, { type: 'audio.complete', audioFormat: 'mp3' });
}

async function handleSpeechEngineTranscript(mobileWs, transcript) {
  if (!transcript) {
    return;
  }

  sendJson(mobileWs, { type: 'transcript', transcript });

  try {
    const response = await getClaudeSpeechEngineResponse(transcript);
    sendJson(mobileWs, { type: 'response', response });
    await streamTextToSpeechToMobile(mobileWs, response);
  } catch (error) {
    console.error('Speech Engine Claude/TTS error:', error);
    sendJson(mobileWs, { type: 'error', message: 'Failed to generate voice response.' });
  }
}

wss.on('connection', async (ws) => {
  sendJson(ws, { type: 'connection.ready' });
  sendJson(ws, { type: 'speech_engine.connected' });

  ws.on('message', async (message, isBinary) => {
    try {
      let transcript = '';

      if (isBinary) {
        transcript = await transcribePcmBuffer(Buffer.from(message));
      } else {
        const payload = JSON.parse(message.toString());

        if (payload.type === 'audio' && payload.audio) {
          transcript = await transcribeBase64PcmAudio(payload.audio, 'aurel-ws.wav');
        } else if (payload.type === 'text' && payload.text) {
          transcript = String(payload.text).trim();
        } else {
          sendJson(ws, { type: 'error', message: 'Expected audio or text payload.' });
          return;
        }
      }

      await handleSpeechEngineTranscript(ws, transcript);
    } catch (error) {
      console.error('OpenAI WebSocket transcription error:', error);
      sendJson(ws, { type: 'error', message: 'Failed to process audio.' });
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
  console.log(`Aurel server running on port ${PORT}`);
});
