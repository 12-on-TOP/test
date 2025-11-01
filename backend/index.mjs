import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/api/ping', (req, res) => {
  res.json({ status: 'MMO backend is alive!' });
});

const server = app.listen(PORT, () => {
  console.log(`HTTP server running on port ${PORT}`);
});

const wss = new WebSocketServer({ server });

let players = {};

wss.on('connection', (ws) => {
  const id = Date.now();
  players[id] = { x: 0, y: 0 };

  ws.send(JSON.stringify({ type: 'welcome', id }));

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    if (data.type === 'move') {
      players[id] = data.position;
      broadcast({ type: 'update', players });
    }
  });

  ws.on('close', () => {
    delete players[id];
    broadcast({ type: 'update', players });
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}
