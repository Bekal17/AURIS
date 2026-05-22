import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import dotenv from 'dotenv';
dotenv.config();

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

async function main() {
  const engine = await client.speechEngine.create({
    name: "AURIS Voice Agent",
    speechEngine: {
      wsUrl: "wss://auris-production-a715.up.railway.app/ws",
    },
  });
  console.log("Speech Engine ID:", engine.engineId);
  console.log("Save this ID to your .env as SPEECH_ENGINE_ID");
}

main().catch(console.error);
