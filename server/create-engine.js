const ElevenLabs = require('elevenlabs');
const dotenv = require('dotenv');
dotenv.config();

const client = new ElevenLabs.ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

async function main() {
  const engine = await client.speechEngine.create({
    name: "AURIS Voice Agent",
    speechEngine: {
      wsUrl: "wss://PLACEHOLDER.ngrok.io/ws",
    },
  });
  console.log("Speech Engine ID:", engine.engineId);
}

main().catch(console.error);
