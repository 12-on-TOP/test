// server.js
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { gameX, gameY } from "../shared/setup.mjs"

// ===== Adaptive spatial index =====
const spatial = {
  MIN_CELL: 32,
  MAX_CELL: 512,
  cellSize: 256,
  snakesGrid: new Map(),
  foodsGrid: new Map(),

  computeCellSize(totalSnakes, totalFoods) {
    const worldW = gameX;
    const worldH = gameY;
    const A = worldW * worldH;
    const load = totalSnakes * 1.0 + totalFoods * 0.25;
    const base = Math.sqrt(A / Math.max(load, 1));
    const size = Math.max(this.MIN_CELL, Math.min(this.MAX_CELL, base));
    this.cellSize = Math.round((this.cellSize * 0.5) + (size * 0.5));
  },

  cellOf(x, y) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return { cx, cy };
  },

  insert(grid, x, y, entity) {
    const { cx, cy } = this.cellOf(x, y);
    const key = `${cx},${cy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(entity);
  },

  rebuild(snakes, foods) {
    this.computeCellSize(snakes.length, foods.length);
    this.snakesGrid.clear();
    this.foodsGrid.clear();
    for (const s of snakes) {
      if (!s.s.length) continue;
      const h = s.s[0];
      this.insert(this.snakesGrid, h.x, h.y, s);
    }
    for (const f of foods) {
      if (f.consumed) continue;
      this.insert(this.foodsGrid, f.x, f.y, f);
    }
  },

  queryGrid(grid, bounds) {
    if (!bounds) return [];
    const minCell = this.cellOf(bounds.minX, bounds.minY);
    const maxCell = this.cellOf(bounds.maxX, bounds.maxY);
    const results = [];
    for (let cy = minCell.cy; cy <= maxCell.cy; cy++) {
      for (let cx = minCell.cx; cx <= maxCell.cx; cx++) {
        const key = `${cx},${cy}`;
        const bucket = grid.get(key);
        if (!bucket) continue;
        for (const e of bucket) {
          const ex = e.x ?? e.s?.[0]?.x ?? 0;
          const ey = e.y ?? e.s?.[0]?.y ?? 0;
          if (ex >= bounds.minX && ex <= bounds.maxX &&
              ey >= bounds.minY && ey <= bounds.maxY) {
            results.push(e);
          }
        }
      }
    }
    return results;
  }
};


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
      if (this.def % 5 === 0) {
        const tail = this.s.pop();
        if (tail) foods.push(new Food(tail.x, tail.y, 1, 0));
      }
      if (this.s.length < MIN_LENGTH_FOR_BOOST) {
        this.boosting = false;
        this.speed = 2;
        this.def = 0;
      }
    } else {
      this.boosting = false;
      this.speed = 2;
      this.def = 0;
    }

    if (this.isBot) {
      const visibleFoods = getFoodsInView(this);
      const target = visibleFoods.length
        ? visibleFoods.reduce((a, b) =>
            dist(head.x, head.y, a.x, a.y) < dist(head.x, head.y, b.x, b.y) ? a : b
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
  this.trail.unshift({ x: head.x, y: head.y });

  // Limit trail history
  if (this.trail.length > this.s.length * 6)
    this.trail.pop();

  const targetSpacing = 10;       // behaves like baseSpacing
  const maxSpacing = 14;          // behaves like maxSpacing
  const stiffness = 0.35;         // same as first class

  for (let i = 1; i < this.s.length; i++) {
    const curr = this.s[i];
    const prev = this.s[i - 1];

    let dx = curr.x - prev.x;
    let dy = curr.y - prev.y;
    let d = sqrt(dx * dx + dy * dy);

    if (d === 0) continue;

    // distance error
    let error = d - targetSpacing;

    // Soft correction
    let nx = dx / d;
    let ny = dy / d;
    curr.x -= nx * error * stiffness;
    curr.y -= ny * error * stiffness;

    // Slack limiter (accordion prevention)
    if (d > maxSpacing) {
      let extra = (d - maxSpacing) * 0.5;
      curr.x -= nx * extra;
      curr.y -= ny * extra;
    }
  }

    // Food collisions (view-filtered)
    const bounds = getViewBounds(this);
    const nearbyFoods = spatial.queryGrid(spatial.foodsGrid, bounds);
    for (const f of nearbyFoods) {
      if (f.consumed) continue;
      if (dist(head.x, head.y, f.x, f.y) < 20) {
        f.consumed = true;
        f.grow(this, f.d ? 1 : f.s);
      }
    }

    // Snake collisions (view-filtered)
    const nearbySnakes = getSnakesInView(bounds, this);
    for (const other of nearbySnakes) {
      for (const seg of other.s) {
        if (Math.abs(seg.x - head.x) > 50 || Math.abs(seg.y - head.y) > 50) continue;
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
    if (this.isBot) {
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
    // Remove this food from the array immediately
    const idx = foods.indexOf(this);
    if (idx !== -1) foods.splice(idx, 1);
  } else {
    // Only recycle if we haven't hit the cap
    if (foods.length <= REQUIRED_FOODS) {
      this.x = random(gameX);
      this.y = random(gameY);
      this.consumed = false;
    } else {
      while (foods.length < REQUIRED_FOODS) {
  foods.push(new Food(random(gameX), random(gameY), 0));
}
      const idx = foods.indexOf(this);
      if (idx !== -1) foods.splice(idx, 1);
    }
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
const TICK_MS = 1000 / 30;

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
  return spatial.queryGrid(spatial.foodsGrid, bounds).filter(f => !f.consumed);
}

function getSnakesInView(bounds, excludeSnake = null) {
  const coarse = spatial.queryGrid(spatial.snakesGrid, bounds);
  return coarse.filter(s => s !== excludeSnake);
}

function broadcastSnapshot() {
  const FOOD_STRIDE = 13;
  const playersSnapshot = [...clientMouseMap.values()].map((p) => ({ x: +p.x, y: +p.y }));

  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;

    const mySnake = client.snake;
    const mySnakeId = mySnake?.id ?? 0;
    const bounds = mySnake ? getViewBounds(mySnake) : null;

    // Filter via spatial index
    const visibleSnakes = bounds ? getSnakesInView(bounds, null) : snakes;
    const visibleFoods = bounds ? spatial.queryGrid(spatial.foodsGrid, bounds) : foods;

    // Build full snake snapshots (id + angle + all segment positions)
    const snakesSnapshot = [];
    for (const s of visibleSnakes) {
      if (!s.s.length) continue;
      const segments = s.s.map(seg => ({ x: seg.x, y: seg.y }));
      const angle = Math.atan2(s.direction.y, s.direction.x);
      snakesSnapshot.push({
        id: s.id,
        angle,
        segments
      });
    }

    const foodsSnapshot = visibleFoods.map((f) => ({
      x: f.x,
      y: f.y,
      s: f.s,
      d: f.d ? 1 : 0,
    }));

    // === Size calculation (big-endian) ===
    // Header: version(1) + type(1) + mySnakeId(4)
    let totalSize = 1 + 1 + 4;
    // Players: count(4) + each (x,y) float32 -> 8 bytes
    totalSize += 4 + playersSnapshot.length * 8;
    // Snakes: count(4) + each snake: id(4) + segCount(4) + angle(4) + each segment (x,y float32 -> 8 bytes)
    totalSize += 4;
    for (const s of snakesSnapshot) {
      totalSize += 4; // id
      totalSize += 4; // segCount
      totalSize += 4; // angle
      totalSize += s.segments.length * 8;
    }
    // Foods: count(4) + each stride 13
    totalSize += 4 + foodsSnapshot.length * FOOD_STRIDE;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Header
    view.setUint8(offset, VERSION); offset += 1;
    view.setUint8(offset, TYPE_SNAPSHOT); offset += 1;
    view.setUint32(offset, mySnakeId, false); offset += 4;

    // Players
    view.setUint32(offset, playersSnapshot.length, false); offset += 4;
    for (const { x, y } of playersSnapshot) {
    function broadcastSnapshot() {
  const FOOD_STRIDE = 13;
  const playersSnapshot = [...clientMouseMap.values()].map((p) => ({ x: +p.x, y: +p.y }));

  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;

    const mySnake = client.snake;
    const mySnakeId = mySnake?.id ?? 0;
    const bounds = mySnake ? getViewBounds(mySnake) : null;

    // Filter visible entities
    const visibleSnakes = bounds ? getSnakesInView(bounds, null) : snakes;
    const visibleFoods = bounds ? spatial.queryGrid(spatial.foodsGrid, bounds) : foods;

    // Build full snake snapshots (id + angle + all segment positions)
    const snakesSnapshot = [];
    for (const s of visibleSnakes) {
      if (!s.s.length) continue;
      const segments = s.s.map(seg => ({ x: seg.x, y: seg.y }));
      const angle = Math.atan2(s.direction.y, s.direction.x);
      snakesSnapshot.push({
        id: s.id,
        angle,
        segments
      });
    }

    const foodsSnapshot = visibleFoods.map((f) => ({
      x: f.x,
      y: f.y,
      s: f.s,
      d: f.d ? 1 : 0,
    }));

    // === Size calculation ===
    let totalSize = 1 + 1 + 4; // version + type + mySnakeId
    totalSize += 4 + playersSnapshot.length * 8;
    totalSize += 4; // snake count
    for (const s of snakesSnapshot) {
      totalSize += 4; // id
      totalSize += 4; // segCount
      totalSize += 4; // angle
      totalSize += s.segments.length * 8;
    }
    totalSize += 4 + foodsSnapshot.length * FOOD_STRIDE;

    // === Allocate and write ===
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Header
    view.setUint8(offset, VERSION); offset += 1;
    view.setUint8(offset, TYPE_SNAPSHOT); offset += 1;
    view.setUint32(offset, mySnakeId, false); offset += 4;

    // Players
    view.setUint32(offset, playersSnapshot.length, false); offset += 4;
    for (const { x, y } of playersSnapshot) {
      view.setFloat32(offset, x, false); offset += 4;
      view.setFloat32(offset, y, false); offset += 4;
    }

    // Snakes
    view.setUint32(offset, snakesSnapshot.length, false); offset += 4;
    for (const s of snakesSnapshot) {
      view.setUint32(offset, s.id, false); offset += 4;
      view.setUint32(offset, s.segments.length, false); offset += 4;
      view.setFloat32(offset, s.angle, false); offset += 4;
      for (const seg of s.segments) {
        view.setFloat32(offset, seg.x, false); offset += 4;
        view.setFloat32(offset, seg.y, false); offset += 4;
      }
    }

    // Foods
    view.setUint32(offset, foodsSnapshot.length, false); offset += 4;
    for (const f of foodsSnapshot) {
      view.setFloat32(offset, f.x, false);
      view.setFloat32(offset + 4, f.y, false);
      view.setFloat32(offset + 8, f.s, false);
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
  spatial.rebuild(snakes, foods);   // <<< rebuild grid each tick
  broadcastSnapshot();
}, TICK_MS);
