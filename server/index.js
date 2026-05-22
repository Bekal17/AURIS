import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/', (req, res) => {
  res.json({ status: 'AURIS server running', port: PORT });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AURIS server running on port ${PORT}`);
});
