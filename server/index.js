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
const TTS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
const AUREL_SYSTEM_PROMPT = `Kamu adalah Aurel, asisten suara hands-free untuk pengemudi,
orang sibuk, dan penyandang disabilitas.
Kamu berjalan di background HP Android pengguna.

Kemampuanmu:
- Membacakan dan membalas pesan WhatsApp
- Menerima dan menolak panggilan telepon WhatsApp
- Mengangkat telepon dengan loudspeaker
- Mute/unmute panggilan
- Membacakan notifikasi masuk
- Menjawab pertanyaan umum
- Membantu navigasi HP dengan perintah suara

Aturan:
- SELALU deteksi bahasa yang digunakan user dan balas dalam bahasa yang SAMA
- Jika user bicara Bahasa Indonesia, balas Indonesia
- Jika user bicara English, reply in English
- Jika user bicara bahasa lain, ikuti bahasa tersebut
- Maksimal 2 kalimat per respons
- Gunakan bahasa natural dan ramah seperti asisten pribadi
- Untuk penyandang disabilitas, gunakan bahasa yang jelas dan sabar
- Jika user tanya apa saja yang bisa kamu lakukan, jelaskan kemampuanmu dengan singkat dan friendly
- Jika ada perintah balas WA, konfirmasi dulu sebelum kirim
- Jika user bilang ya atau oke atau lanjut, eksekusi
- Jika tidak mengerti perintah, minta clarifikasi singkat
- Selalu konfirmasi sebelum melakukan aksi penting`;
const TRANSCRIBE_SYSTEM_PROMPT = AUREL_SYSTEM_PROMPT;
const SPEECH_ENGINE_SYSTEM_PROMPT = AUREL_SYSTEM_PROMPT;
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
    model: 'claude-sonnet-4-20250514',
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
  const audioStream = await elevenlabs.textToSpeech.convert(TTS_VOICE_ID, {
    text: responseText,
    modelId: 'eleven_multilingual_v2',
    outputFormat: 'mp3_44100_128',
  });
  const audioBuffer = await streamToBuffer(audioStream);

  return audioBuffer.toString('base64');
}

function pcm16MonoToWav(pcmBuffer, sampleRate = 16000) {
  const header = Buffer.alloc(44);
  const dataSize = pcmBuffer.length;
  const byteRate = sampleRate * 2;
  const blockAlign = 2;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

function base64PcmToWav(base64Audio) {
  const pcmBuffer = Buffer.from(String(base64Audio || ''), 'base64');
  return pcm16MonoToWav(pcmBuffer);
}

async function transcribeAudioBuffer(audioBuffer, filename = 'aurel-recording.wav', contentType = 'audio/wav') {
  const transcription = await elevenlabs.speechToText.convert({
    file: {
      data: audioBuffer,
      filename,
      contentType,
      contentLength: audioBuffer.length,
    },
    modelId: 'scribe_v2',
  });

  return getTranscriptionText(transcription);
}

async function buildTranscribeResponse(transcript) {
  const response = await getClaudeResponse(transcript);
  const audio = await getTextToSpeechAudio(response);

  return {
    transcript,
    response,
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
      const wavAudio = base64PcmToWav(req.body.audio);
      const transcript = await transcribeAudioBuffer(wavAudio);

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
      req.file.originalname || 'aurel-recording.m4a',
      req.file.mimetype || 'audio/m4a'
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

    const wavAudio = base64PcmToWav(req.body.audio);
    const transcript = await transcribeAudioBuffer(wavAudio, 'aurel-wake.wav', 'audio/wav');

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
    model: 'claude-sonnet-4-20250514',
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
  const audioStream = await elevenlabs.textToSpeech.stream(TTS_VOICE_ID, {
    text: responseText,
    modelId: 'eleven_multilingual_v2',
    outputFormat: 'mp3_44100_128',
  });

  sendJson(mobileWs, { type: 'audio.start', audioFormat: 'mp3' });

  for await (const chunk of audioStream) {
    if (mobileWs.readyState !== WebSocket.OPEN) {
      break;
    }

    mobileWs.send(Buffer.from(chunk), { binary: true });
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

async function createSpeechEngineSocket(mobileWs) {
  const speechEngineId = process.env.SPEECH_ENGINE_ID;

  if (!speechEngineId) {
    throw new Error('SPEECH_ENGINE_ID is required.');
  }

  await elevenlabs.speechEngine.get(speechEngineId);

  const speechEngineWs = new WebSocket(
    `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(speechEngineId)}`,
    {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
      },
    }
  );

  speechEngineWs.on('open', () => {
    sendJson(mobileWs, { type: 'speech_engine.connected' });
    speechEngineWs.send(JSON.stringify({
      type: 'conversation_initiation_client_data',
      conversation_config_override: {
        agent: {
          prompt: {
            prompt: SPEECH_ENGINE_SYSTEM_PROMPT,
            llm: 'claude-sonnet-4-20250514',
          },
        },
        tts: {
          voice_id: TTS_VOICE_ID,
        },
      },
    }));
  });

  speechEngineWs.on('message', async (rawMessage) => {
    try {
      const event = JSON.parse(rawMessage.toString());

      if (event.type === 'ping') {
        speechEngineWs.send(JSON.stringify({
          type: 'pong',
          event_id: event.ping_event?.event_id,
        }));
        return;
      }

      if (event.type === 'user_transcript') {
        await handleSpeechEngineTranscript(
          mobileWs,
          event.user_transcription_event?.user_transcript?.trim()
        );
        return;
      }

      if (event.type === 'audio' && event.audio_event?.audio_base_64) {
        mobileWs.send(Buffer.from(event.audio_event.audio_base_64, 'base64'), { binary: true });
        return;
      }

      if (event.type === 'agent_response') {
        sendJson(mobileWs, {
          type: 'speech_engine.agent_response',
          response: event.agent_response_event?.agent_response,
        });
      }
    } catch (error) {
      console.error('Speech Engine message error:', error);
      sendJson(mobileWs, { type: 'error', message: 'Failed to process Speech Engine event.' });
    }
  });

  speechEngineWs.on('close', () => {
    sendJson(mobileWs, { type: 'speech_engine.disconnected' });
  });

  speechEngineWs.on('error', (error) => {
    console.error('Speech Engine WebSocket error:', error);
    sendJson(mobileWs, { type: 'error', message: 'Speech Engine WebSocket error.' });
  });

  return speechEngineWs;
}

wss.on('connection', async (ws) => {
  sendJson(ws, { type: 'connection.ready' });

  let speechEngineWs;

  try {
    speechEngineWs = await createSpeechEngineSocket(ws);
  } catch (error) {
    console.error('Speech Engine connection error:', error);
    sendJson(ws, { type: 'error', message: error.message });
  }

  ws.on('message', (message, isBinary) => {
    if (!speechEngineWs || speechEngineWs.readyState !== WebSocket.OPEN) {
      sendJson(ws, { type: 'error', message: 'Speech Engine is not connected.' });
      return;
    }

    if (isBinary) {
      speechEngineWs.send(JSON.stringify({
        user_audio_chunk: Buffer.from(message).toString('base64'),
      }));
      return;
    }

    try {
      const payload = JSON.parse(message.toString());

      if (payload.type === 'audio' && payload.audio) {
        speechEngineWs.send(JSON.stringify({ user_audio_chunk: payload.audio }));
      }
    } catch {
      sendJson(ws, { type: 'error', message: 'Expected binary audio data.' });
    }
  });

  ws.on('close', () => {
    if (speechEngineWs?.readyState === WebSocket.OPEN) {
      speechEngineWs.close();
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
