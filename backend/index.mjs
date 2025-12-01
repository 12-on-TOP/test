// server.js
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { gameX, gameY } from "../shared/setup.mjs"

// ===== Helpers =====
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const random = (x = 1) => Math.random() * x;
const sin = Math.sin;
const cos = Math.cos;
const atan2 = Math.atan2;
const sqrt = Math.sqrt;
const lerp = (a, b, t) => a + (b - a) * t;

const VERSION = 1;
const TYPE_SNAPSHOT = 1;
const TYPE_GESTURE = 2;
const TYPE_WINDOWSIZE = 3;
const TYPE_MOUSE = 4;

const REQUIRED_FOODS = 1000;
const REQUIRED_SNAKES = 10;

// ===== HTTP server (Render-ready) =====
const app = express();
app.get("/", (req, res) => res.send("Snake server is running"));
const server = createServer(app);
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Listening on ${PORT}`));

// ===== WebSocket server attached to HTTP =====
const wss = new WebSocketServer({ server });

// ===== Server state =====
let snakes = [];
const foods = [];
const clientMouseMap = new Map();
let nextSnakeId = 1;

// ===== Classes =====
class SnakeSegment {
  constructor(x, y, s, c = [255, 255, 0]) {
    this.x = x;
    this.y = y;
    this.s = s;
    this.c = c;
  }
}

class Snake {
  constructor(x, y) {
    this.id = 0;
    this.s = [new SnakeSegment(x, y, 20)];
    this.trail = [];
    this.speed = 2;
    this.boosting = false;
    this.def = 0;
    this.scrambled = false;
    this.isBot = false;
    this.mouseX = 0;
    this.mouseY = 0;
    this.width = 800;
    this.height = 600;
    this.active = 1;
    this.direction = { x: 0, y: 0 };
    this.length = 1;
  }

  update() {
    if (this.scrambled || this.s.length === 0) return;
    const head = this.s[0];
    this.length = this.s.length;

    // Bounds check
    if (head.x <= 0 || head.x >= gameX || head.y <= 0 || head.y >= gameY) {
      this.disappear();
      return;
    }

    const MIN_LENGTH_FOR_BOOST = 1;

    if (this.boosting && this.s.length > MIN_LENGTH_FOR_BOOST) {
      this.def++;

      // Drop tail segment every 5 ticks
      if (this.def % 5 === 0) {
        const tail = this.s.pop();
        if (tail) foods.push(new Food(tail.x, tail.y, 1, 0));
      }

      // Auto-disable boost if snake shrinks too far
      if (this.s.length <= MIN_LENGTH_FOR_BOOST) {
        this.boosting = false;
        this.speed = 2;
        this.def = 0;
      }
    } else {
      // Reset boost state if not boosting or too short
      this.boosting = false;
      this.speed = 2;
      this.def = 0;
    }

    // Movement
    if (this.isBot) {
      const visibleFoods = getFoodsInView(this);
      const target = visibleFoods.length
        ? visibleFoods.reduce((a, b) =>
            dist(head.x, head.y, a.x, a.y) < dist(head.x, head.y, b.x, b.y)
              ? a
              : b
          )
        : null;
      const angle = target
        ? atan2(target.y - head.y, target.x - head.x)
        : Math.random() * Math.PI * 2;
      if (this.active) {
        this.direction.x = cos(angle);
        this.direction.y = sin(angle);
      }
      head.x += this.direction.x * this.speed;
      head.y += this.direction.y * this.speed;
      if (this.s.length >= 100) this.active = 0;
    } else {
      const worldMouseX = this.mouseX - (this.width / 2 - head.x);
      const worldMouseY = this.mouseY - (this.height / 2 - head.y);
      const dx = worldMouseX - head.x;
      const dy = worldMouseY - head.y;
      const d = sqrt(dx * dx + dy * dy);
      if (d) {
        if (this.active) {
          this.direction.x = dx / d;
          this.direction.y = dy / d;
        }
        head.x += this.direction.x * this.speed;
        head.y += this.direction.y * this.speed;
      }
    }

    // Trail
    this.trail.unshift({ x: head.x, y: head.y });
    if (this.trail.length > this.s.length * 5) this.trail.pop();

    // Segment spacing
    const gap = 8;
    for (let i = 1; i < this.s.length; i++) {
      let distSoFar = 0;
      for (let t = 1; t < this.trail.length; t++) {
        const step = dist(
          this.trail[t - 1].x,
          this.trail[t - 1].y,
          this.trail[t].x,
          this.trail[t].y
        );
        distSoFar += step;
        if (distSoFar >= gap * i) {
          const overshoot = distSoFar - gap * i;
          const ratio = 1 - overshoot / step;
          this.s[i].x = lerp(this.trail[t - 1].x, this.trail[t].x, ratio);
          this.s[i].y = lerp(this.trail[t - 1].y, this.trail[t].y, ratio);
          break;
        }
      }
    }

    // Food collisions (view-filtered)
    const bounds = getViewBounds(this);
    for (const f of foods) {
      if (f.consumed) continue;
      if (
        f.x < bounds.minX ||
        f.x > bounds.maxX ||
        f.y < bounds.minY ||
        f.y > bounds.maxY
      )
        continue;
      if (dist(head.x, head.y, f.x, f.y) < 20) {
        f.consumed = true;
        f.grow(this, f.d ? 1 : f.s);
      }
    }

    // Snake collisions (view-filtered)
    const nearbySnakes = getSnakesInView(bounds, this);
    for (const other of nearbySnakes) {
      for (const seg of other.s) {
        if (dist(head.x, head.y, seg.x, seg.y) < 20) {
          this.scramble();
          return;
        }
      }
    }
  }

  scramble() {
    const deadSegments = [...this.s];
    this.s = [];
    for (let k of deadSegments) {
      foods.push(new Food(k.x, k.y, 20, 1));
    }
    snakes = snakes.filter((snake) => snake !== this);
    if (!this.isBot) {
      this.scrambled = 1;
    } else this.respawn();
  }

  disappear() {
    this.scrambled = true;
    this.s = [];
    snakes = snakes.filter((snake) => snake !== this);
    if (this.isBot) {
      this.respawn();
    }
  }

  respawn() {
    if (snakes.length < REQUIRED_SNAKES && this.isBot) {
      const bot = new Snake(random(gameX), random(gameY));
      bot.id = nextSnakeId++;
      bot.isBot = true;
      snakes.push(bot);
    }
  }
}

class Food {
  constructor(x, y, s, d) {
    this.x = x;
    this.y = y;
    this.s = s;
    this.d = d;
    this.timer = 0;
    this.consumed = false;
  }

  grow(snake, amount) {
    const tail = snake.s[snake.s.length - 1];
    for (let i = 0; i < amount; i++) {
      snake.s.push(new SnakeSegment(tail.x, tail.y, 20, tail.c));
    }

    if (this.d) {
      const idx = foods.indexOf(this);
      if (idx !== -1) foods.splice(idx, 1);
    } else {
      this.x = random(gameX);
      this.y = random(gameY);
      this.consumed = false;
    }
  }
}

// ===== Prepopulate foods and bots =====
for (let i = 1; i <= REQUIRED_FOODS; i++) {
  foods.push(new Food(random(gameX), random(gameY), 2, 0));
}

for (let i = 0; i < REQUIRED_SNAKES; i++) {
  const bot = new Snake(random(gameX), random(gameY));
  bot.id = nextSnakeId++;
  bot.isBot = true;
  snakes.push(bot);
}

// ===== WebSocket handling =====
wss.on("connection", (socket) => {
  console.log("🟢 Client connected");

  const mySnake = new Snake(random(gameX), random(gameY));
  mySnake.id = nextSnakeId++;
  snakes.push(mySnake);
  socket.snake = mySnake;

  socket.on("message", (data) => {
    // Normalize Node Buffer to ArrayBuffer
    const arrayBuffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    );
    const view = new DataView(arrayBuffer);
    let offset = 0;
    if (view.byteLength < 2) return;

    const version = view.getUint8(offset);
    offset += 1;
    if (version !== VERSION) return;

    const type = view.getUint8(offset);
    offset += 1;

    if (type === TYPE_WINDOWSIZE) {
      if (offset + 8 > view.byteLength) return;
      const width = view.getFloat32(offset);
      offset += 4;
      const height = view.getFloat32(offset);
      offset += 4;
      socket.snake.width = width;
      socket.snake.height = height;
      return;
    }

    if (type === TYPE_GESTURE) {
      if (offset + 1 > view.byteLength) return;
      const gesture = view.getUint8(offset);
      socket.snake.boosting = gesture === 1;
      socket.snake.speed = gesture === 1 ? 5 : 2;

      const buf = new ArrayBuffer(1 + 1 + 1);
      const dv = new DataView(buf);
      dv.setUint8(0, VERSION);
      dv.setUint8(1, TYPE_GESTURE);
      dv.setUint8(2, gesture);
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(buf);
      }
      return;
    }

    if (type === TYPE_MOUSE) {
      if (offset + 8 > view.byteLength) return;
      const mouseX = view.getFloat32(offset);
      offset += 4;
      const mouseY = view.getFloat32(offset);
      offset += 4;
      socket.snake.mouseX = mouseX;
      socket.snake.mouseY = mouseY;
      clientMouseMap.set(socket, { x: mouseX, y: mouseY });
      return;
    }
  });

  socket.on("close", () => {
    console.log("🔴 Client disconnected");
    clientMouseMap.delete(socket);
    const snake = socket.snake;
    if (snake) {
      snake.active = 0;
    }
  });
});

// ===== Simulation tick + broadcast =====
const TICK_MS = 1000 / 60;

function getViewBounds(snake) {
  if (!snake || snake.s.length === 0) return null;
  const head = snake.s[0];
  const halfW = snake.width / 2;
  const halfH = snake.height / 2;
  const padding = 100;
  return {
    minX: head.x - halfW - padding,
    maxX: head.x + halfW + padding,
    minY: head.y - halfH - padding,
    maxY: head.y + halfH + padding,
  };
}

function getEntitiesInView(bounds, entities) {
  if (!bounds) return [];
  return entities.filter(
    (e) =>
      e.x >= bounds.minX &&
      e.x <= bounds.maxX &&
      e.y >= bounds.minY &&
      e.y <= bounds.maxY
  );
}

function getFoodsInView(snake) {
  const bounds = getViewBounds(snake);
  return getEntitiesInView(bounds, foods).filter((f) => !f.consumed);
}

function getSnakesInView(bounds, excludeSnake = null) {
  if (!bounds) return [];
  return snakes.filter(
    (s) =>
      s !== excludeSnake &&
      s.s.some(
        (seg) =>
          seg.x >= bounds.minX &&
          seg.x <= bounds.maxX &&
          seg.y >= bounds.minY &&
          seg.y <= bounds.maxY
      )
  );
}

function broadcastSnapshot() {
  const FOOD_STRIDE = 13;
  const playersSnapshot = [...clientMouseMap.values()].map((p) => ({
    x: +p.x,
    y: +p.y,
  }));

  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;

    const mySnake = client.snake;
    const mySnakeId = mySnake?.id ?? 0;
    const bounds = mySnake ? getViewBounds(mySnake) : null;

    const visibleSnakes = bounds
      ? snakes.filter((s) =>
          s.s.some(
            (seg) =>
              seg.x >= bounds.minX &&
              seg.x <= bounds.maxX &&
              seg.y >= bounds.minY &&
              seg.y <= bounds.maxY
          )
        )
      : snakes;

    const visibleFoods = bounds
      ? foods.filter(
          (f) =>
            f.x >= bounds.minX &&
            f.x <= bounds.maxX &&
            f.y >= bounds.minY &&
            f.y <= bounds.maxY
        )
      : foods;

    const snakesSnapshot = visibleSnakes.map((s) => ({
      id: s.id,
      x: s.s[0].x,
      y: s.s[0].y,
      length: s.s.length,
    }));

    const foodsSnapshot = visibleFoods.map((f) => ({
      x: f.x,
      y: f.y,
      s: f.s,
      d: f.d ? 1 : 0,
    }));

    // === Size calculation ===
    let totalSize = 0;
    totalSize += 1 + 1; // version + type
    totalSize += 4; // mySnakeId
    totalSize += 4 + playersSnapshot.length * 8; // players
    totalSize += 4 + snakesSnapshot.length * 16; // snakes: id + x + y + length
    totalSize += 4 + foodsSnapshot.length * 13; // foods: x + y + s + d

    // === Allocate and write ===
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    view.setUint8(offset, VERSION);
    offset += 1;
    view.setUint8(offset, TYPE_SNAPSHOT);
    offset += 1;
    view.setUint32(offset, mySnakeId);
    offset += 4;

    view.setUint32(offset, playersSnapshot.length);
    offset += 4;
    for (const { x, y } of playersSnapshot) {
      view.setFloat32(offset, x);
      offset += 4;
      view.setFloat32(offset, y);
      offset += 4;
    }

    view.setUint32(offset, snakesSnapshot.length);
    offset += 4;
    for (const s of snakesSnapshot) {
      view.setUint32(offset, s.id);
      offset += 4;
      view.setFloat32(offset, s.x);
      offset += 4;
      view.setFloat32(offset, s.y);
      offset += 4;
      view.setUint32(offset, s.length);
      offset += 4;
    }

    view.setUint32(offset, foodsSnapshot.length);
    offset += 4;
    for (const f of foodsSnapshot) {
      view.setFloat32(offset, f.x);
      view.setFloat32(offset + 4, f.y);
      view.setFloat32(offset + 8, f.s);
      view.setUint8(offset + 12, f.d);
      offset += FOOD_STRIDE;
    }

    if (offset !== totalSize) {
      console.warn(`Packet size mismatch: wrote ${offset} of ${totalSize} bytes`);
    }

    client.send(buffer);
  }
}

// Fixed-rate simulation
setInterval(() => {
  for (const s of snakes) s.update();
  broadcastSnapshot();
}, TICK_MS);
