import { WebSocketServer } from "ws";
const gameX = 10000;
const gameY = 10000;
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// Global registry: segment → gridId
const segmentBucket = new WeakMap();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const random = (x = 1) => Math.random() * x;
const sin = Math.sin;
const cos = Math.cos;
const atan2 = Math.atan2;
const sqrt = Math.sqrt;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const REQUIRED_FOODS = 10000;
const REQUIRED_SNAKES = 100;
let freeIds = [];
const server = http.createServer((req, res) => {
  if (req.url === "/tunnel.json") {
    const filePath = path.join(__dirname, "public", "tunnel.json");

    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(data);
    } else {
      res.writeHead(404);
      res.end("tunnel.json not found");
    }
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Game server running");
});

server.listen(8080, () => {

});

const wss = new WebSocketServer({ server });

let snakes = [];
const foods = [];
const clientMouseMap = new Map();
let nextId = 1;

const GESTURE     = { id: 1, flag: ["uint",8] };
const WINDOWSIZE  = { id: 2, width: ["float",32], height: ["float",32] };
const MOUSE       = { id: 3, x: ["float",32], y: ["float",32] };
const WORLDSIZE   = { id: 4, width: ["float",32], height: ["float",32] };
const NICKNAME    = { id: 5, length: ["uint",16], nickname: "utf8" };
const SKIN        = { id: 6, count: ["uint",32], colors: "float32[]", r: ["float",32], g: ["float",32], b: ["float",32] };
const LEADERBOARD = { id: 7, count: ["uint",32], entries: "object[]" };
const SNAPSHOT    = { id: 8, snakeCount: ["uint",32], snakes: "object[]", foodCount: ["uint",32], foods: "object[]" };
const SNAKE = {mid: ["uint",32], segCount: ["uint",32], angle: ["float",32], segments: "object[]", nicknameLen: ["uint",16], nickname: "utf8", isBot: ["uint",8]};
const SEGMENT = { x: ["float",32], y: ["float",32] };
const FOOD = { x: ["float",32], y: ["float",32], size: ["float",32], d: ["uint",8] };

const CELL_W = gameX / 20;
const CELL_H = gameY / 20;
const GRID_COLS = gameX / CELL_W;
const GRID_ROWS = gameY / CELL_H;
const gridSnakes = Array(GRID_COLS * GRID_ROWS).fill(null).map(() => []);
const gridFoods  = Array(GRID_COLS * GRID_ROWS).fill(null).map(() => []);

function gridIndex(x, y) {
    const cellX = Math.floor(x / CELL_W);
    const cellY = Math.floor(y / CELL_H);

    if (cellX < 0 || cellY < 0 || cellX >= GRID_COLS || cellY >= GRID_ROWS)
        return -1;

    return cellY * GRID_COLS + cellX;
}

function getBytesfromBits(x) {
    if (Array.isArray(x)) {
        return x[1]/8;
    }
}

function querySnakesIn(gridId) {
    const gx = gridId % GRID_COLS;
    const gy = (gridId / GRID_COLS) | 0;

    const results = [];
    let rIndex = 0;

    for (let oy = -1; oy <= 1; oy++) {
        const ny = gy + oy;
        if (ny < 0 || ny >= GRID_ROWS) continue;

        const rowOffset = ny * GRID_COLS;

        for (let ox = -1; ox <= 1; ox++) {
            const nx = gx + ox;
            if (nx < 0 || nx >= GRID_COLS) continue;

            const nid = rowOffset + nx;
            const bucket = gridSnakes[nid];

            // bucket is always an array; no need for safety checks
            for (let i = 0; i < bucket.length; i++) {
                results[rIndex++] = bucket[i];
            }
        }
    }

    return results;
}



function queryFoodsIn(gridId) {
    const gx = gridId % GRID_COLS;
    const gy = (gridId / GRID_COLS) | 0;

    const results = [];
    let rIndex = 0; // manual push avoids spread cost

    for (let oy = -1; oy <= 1; oy++) {
        const ny = gy + oy;
        if (ny < 0 || ny >= GRID_ROWS) continue;

        const rowOffset = ny * GRID_COLS;

        for (let ox = -1; ox <= 1; ox++) {
            const nx = gx + ox;
            if (nx < 0 || nx >= GRID_COLS) continue;

            const nid = rowOffset + nx;
            const bucket = gridFoods[nid];

            // manual copy is faster than spread
            for (let i = 0; i < bucket.length; i++) {
                results[rIndex++] = bucket[i];
            }
        }
    }

    return results;
}


class SnakeSegment {
  constructor(x, y, snake, index) {
    this.x = x;
    this.y = y;
    this.c = snake.skin[index % snake.skin.length] || [255, 255, 0];
    this.parent = snake;

    this.gridId = gridIndex(x, y);

    if (this.gridId >= 0) {
      const bucket = gridSnakes[this.gridId];

      if (!segmentBucket.has(this)) {
        bucket.push(this);
        segmentBucket.set(this, this.gridId);
      }
    }
  }


update() {
    const newId = gridIndex(this.x, this.y);
    const oldId = this.gridId;   // faster than WeakMap.get()

    if (newId === oldId) return;

    // ---------------------------------------------------------
    // 1. REMOVE FROM OLD BUCKET (O(1) instead of O(n))
    // ---------------------------------------------------------
    if (oldId >= 0) {
        const bucket = gridSnakes[oldId];
        const idx = bucket.indexOf(this);
        if (idx !== -1) {
            bucket[idx] = bucket[bucket.length - 1];
            bucket.pop();
        }
    }

    // ---------------------------------------------------------
    // 2. ADD TO NEW BUCKET (no indexOf check)
    // ---------------------------------------------------------
    if (newId >= 0) {
        gridSnakes[newId].push(this);
    }

    // ---------------------------------------------------------
    // 3. UPDATE LOCAL + WEAKMAP
    // ---------------------------------------------------------
    this.gridId = newId;
    segmentBucket.set(this, newId);
}



}
function removeSegmentFromGrid(seg) {
    const gid = seg.gridId;   // faster than segmentBucket.get(seg)
    if (gid >= 0) {
        const bucket = gridSnakes[gid];
        const idx = bucket.indexOf(seg);

        if (idx !== -1) {
            // O(1) removal: swap with last element, then pop
            bucket[idx] = bucket[bucket.length - 1];
            bucket.pop();
        }
    }

    segmentBucket.delete(seg);
}


class Snake {
  constructor(x, y, id, isBot) {
    this.id = id;
    this.skin = [[255, 255, 0]]; // Default yellow body pattern (set first!)
    this.s = [new SnakeSegment(x, y, this, 0)]; // Now safe
    this.trail = [];
    this.speed = 2;
    this.boosting = false;
    this.def = 0;
    this.scrambled = false;
    this.isBot = isBot;
    this.mouseX = 0;
    this.mouseY = 0;
    this.width = 800;
    this.lastBounds = {
  x1: x - 500,
  y1: y - 500,
  x2: x + 500,
  y2: y + 500
};

    this.height = 600;
    this.active = 1;
    this.direction = { x: 0, y: 0 };
    this.length = this.s.length;
    this.killRadius = 10;
    this.eatRadius = 12;
  }


update() {
    if (this.scrambled || this.s.length === 0) return;
    const head = this.s[0];

    // Bounds check
    if (head.x <= 0 || head.x >= gameX || head.y <= 0 || head.y >= gameY) {
        this.disappear();
        return;
    }

//     if (this.boosting) this.speed = 5;
// else this.speed = 2;


    // ---------------------------------------------------------
    // 1. MOVE HEAD
    // ---------------------------------------------------------
if (this.isBot) {
    const head = this.s[0];

    // ---------------------------------------------------------
    // 1. FAST NEAREST-FOOD SEARCH (no reduce, no repeated math)
    // ---------------------------------------------------------
    const foods = queryFoodsIn(head.gridId);
    let target = null;
    let bestDist = Infinity;

    for (let i = 0; i < foods.length; i++) {
        const f = foods[i];
        const dx = f.x - head.x;
        const dy = f.y - head.y;

        // squared distance (no sqrt)
        const d2 = dx*dx + dy*dy;
        if (d2 < bestDist) {
            bestDist = d2;
            target = f;
        }
    }

    // ---------------------------------------------------------
    // 2. COMPUTE ANGLE ONLY ONCE
    // ---------------------------------------------------------
    let dirX, dirY;

    if (target) {
        const dx = target.x - head.x;
        const dy = target.y - head.y;
        const inv = 1 / Math.sqrt(dx*dx + dy*dy);
        dirX = dx * inv;
        dirY = dy * inv;
    } else {
        // random direction without trig
        const a = Math.random() * 6.28318530718; // 2π
        dirX = Math.cos(a);
        dirY = Math.sin(a);
    }

    // ---------------------------------------------------------
    // 3. APPLY MOVEMENT
    // ---------------------------------------------------------
    if (this.active) {
        this.direction.x = dirX;
        this.direction.y = dirY;
    }

    head.x += this.direction.x * this.speed;
    head.y += this.direction.y * this.speed;

    // ---------------------------------------------------------
    // 4. BOOST LOGIC (branch-free)
    // ---------------------------------------------------------
    const boosting = (this.s.length >= 100);
    this.boosting = boosting;
    this.active   = boosting ? 0 : 1;
    this.speed    = boosting ? 5 : 2;
}

else {
    const head = this.s[0];

    // Precompute half‑sizes once
    const halfW = this.width * 0.5;
    const halfH = this.height * 0.5;

    // Mouse in world space
    const worldMouseX = this.mouseX - (halfW - head.x);
    const worldMouseY = this.mouseY - (halfH - head.y);

    const dx = worldMouseX - head.x;
    const dy = worldMouseY - head.y;

    const d2 = dx*dx + dy*dy;
    if (d2 > 0.0001) {           // avoid sqrt for zero / near‑zero
        const inv = 1 / Math.sqrt(d2);

        if (this.active) {
            this.direction.x = dx * inv;
            this.direction.y = dy * inv;
        }

        head.x += this.direction.x * this.speed;
        head.y += this.direction.y * this.speed;
    }
}


    // ---------------------------------------------------------
    // 2. UPDATE HEAD BUCKET
    // ---------------------------------------------------------
    head.update();

    // ---------------------------------------------------------
    // 3. SEGMENT COLLISION
    // ---------------------------------------------------------
    const nearbySegs = querySnakesIn(head.gridId);

    for (let i = 0; i < nearbySegs.length; i++) {
        const seg = nearbySegs[i];

        if (seg === head) continue;
        if (seg.parent === this) continue;

        const dx = seg.x - head.x;
        if (dx > this.killRadius || dx < -this.killRadius) continue;

        const dy = seg.y - head.y;
        if (dy > this.killRadius || dy < -this.killRadius) continue;

        if (dx * dx + dy * dy <= this.killRadius * this.killRadius) {
            this.scramble();
            return;
        }
    }

    // ---------------------------------------------------------
    // 4. FOOD COLLISION
    // ---------------------------------------------------------
    const nearbyFoods = queryFoodsIn(head.gridId);
    const ER = this.eatRadius;
    const ERR = ER * ER;

    for (let i = 0; i < nearbyFoods.length; i++) {
        const f = nearbyFoods[i];

        const dx = f.x - head.x;
        if (dx > ER || dx < -ER) continue;

        const dy = f.y - head.y;
        if (dy > ER || dy < -ER) continue;

        if (dx * dx + dy * dy <= ERR) {
            f.grow(this, f.d ? 1 : f.s)
        }
    }

    // ---------------------------------------------------------
    // 5. BOOST LOGIC
    // ---------------------------------------------------------
    const MIN_LENGTH_FOR_BOOST = 1;

if (this.boosting && this.s.length > MIN_LENGTH_FOR_BOOST) {
    this.def++;

    if (this.def % 5 === 0) {

        // Lose 1 segment per 500 body length (minimum 1)
        const loss = Math.max(1, Math.floor(this.s.length / 50));

        for (let i = 0; i < loss && this.s.length > MIN_LENGTH_FOR_BOOST; i++) {
            const tail = this.s.pop();
            if (tail) {
                removeSegmentFromGrid(tail);
            }
        }
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

    // ---------------------------------------------------------
    // 6. TRAIL
    // ---------------------------------------------------------
    this.trail.unshift({ x: head.x, y: head.y });
    if (this.trail.length > this.s.length * 6) this.trail.pop();

    // ---------------------------------------------------------
    // 7. SEGMENT SPACING / CONSTRAINT
    // ---------------------------------------------------------
    const targetSpacing = 10;
    const maxSpacing = 14;
    const stiffness = 0.35;

    for (let i = 1; i < this.s.length; i++) {
        const curr = this.s[i];
        const prev = this.s[i - 1];

        let dx = curr.x - prev.x;
        let dy = curr.y - prev.y;
        let d = sqrt(dx * dx + dy * dy);
        if (d === 0) continue;

        let error = d - targetSpacing;
        let nx = dx / d;
        let ny = dy / d;

        curr.x -= nx * error * stiffness;
        curr.y -= ny * error * stiffness;

        if (d > maxSpacing) {
            let extra = (d - maxSpacing) * 0.5;
            curr.x -= nx * extra;
            curr.y -= ny * extra;
        }
    }

    // ---------------------------------------------------------
    // 8. UPDATE ALL SEGMENT BUCKETS
    // ---------------------------------------------------------
    for (let i = 0; i < this.s.length; i++) {
        this.s[i].update();
    }
}


  scramble() {
    const deadSegments = [...this.s];
    this.s = [];
    for (let k of deadSegments) {
      const f = new Food(k.x, k.y, 20, 1, allocateId());
      foods.push(f);
    }
for (let k of deadSegments) {
  removeSegmentFromGrid(k);
}


    snakes = snakes.filter((snake) => snake !== this);
    releaseId(this.id);
    if (!this.isBot) {
      this.scrambled = 1;
    } else {
      freeBotName(this.nickname);
      this.nickname = null; 
      this.respawn(); 
    }
  }

disappear() {
    this.scrambled = true;

    // remove segments from buckets BEFORE clearing
    for (let k of this.s) {
        removeSegmentFromGrid(k);
    }

    this.s = [];

    snakes = snakes.filter(s => s !== this);
    releaseId(this.id);
    if (this.isBot) {
      freeBotName(this.nickname);
      this.nickname = null;
      this.respawn();
    }
}



  respawn() {
  if (this.isBot) {
    const { x, y } = findSafeSpawn(60); // 60px safety radius
const mySnake = new Snake(x, y, allocateId(), true);
    mySnake.nickname = allocateBotName();
    mySnake.skin = [[255, 255, 0]];  // Explicit default for bots
    mySnake.applySkin();
    snakes.push(mySnake);
  }
}



  applySkin() {
    if (!this.skin || this.skin.length === 0) return;
    for (let i = 0; i < this.s.length; i++) {
      this.s[i].c = this.skin[i % this.skin.length];
    }
  }
}



class Food {
  constructor(x, y, size, d, id) {
    this.x = x;
    this.y = y;
    this.s = size;     // size (mass)
    this.d = d;        // 1 = large food, 0 = small food
    this.id = id;
    this.consumed = false;

    this.gridId = gridIndex(x, y);
    if (this.gridId >= 0) {
      gridFoods[this.gridId].push(this);
    }
  }

  // Move food to a new location and update grid buckets
  _moveTo(x, y) {
    // remove from old bucket
    if (this.gridId >= 0) {
      const arr = gridFoods[this.gridId];
      const idx = arr.indexOf(this);
      if (idx !== -1) arr.splice(idx, 1);
    }

    this.x = x;
    this.y = y;
    this.gridId = gridIndex(x, y);

    // add to new bucket
    if (this.gridId >= 0) {
      gridFoods[this.gridId].push(this);
    }
  }

  // Remove food completely
  _delete() {
    const idx = foods.indexOf(this);
    if (idx !== -1) foods.splice(idx, 1);

    if (this.gridId >= 0) {
      const arr = gridFoods[this.gridId];
      const j = arr.indexOf(this);
      if (j !== -1) arr.splice(j, 1);
    }

    releaseId(this.id);
  }

  // Snake eats food
  grow(snake, amount) {
    // Add segments to snake tail
    const tail = snake.s[snake.s.length - 1];
    for (let i = 0; i < amount; i++) {
      const newIndex = snake.s.length;
      snake.s.push(new SnakeSegment(tail.x, tail.y, snake, newIndex));
    }

    // -------------------------------
    // LARGE FOOD RULE (d == 1)
    // -------------------------------
    if (this.d === 1) {
      // Large foods NEVER respawn
      this._delete();
      return;
    }

    // -------------------------------
    // SMALL FOOD RULE (d == 0)
    // -------------------------------
    if (foods.length < REQUIRED_FOODS) {
      // Respawn small food somewhere else
      this._moveTo(random(gameX), random(gameY));
      this.consumed = false;
    } else {
      // Delete small food completely
      this._delete();
    }
  }
}


let nextBotNameIndex = 0;
let freeBotNames = [];

function allocateBotName() {
  if (freeBotNames.length > 0) {
    return freeBotNames.pop(); // reuse released names first
  }
  if (nextBotNameIndex >= botNames.length) {
    nextBotNameIndex = 0; // wrap if you ever exceed
  }
  return botNames[nextBotNameIndex++];
}

function freeBotName(name) {
  if (name) {
    freeBotNames.push(name); // recycle into free‑list
  }
}

function allocateId() {
      if (freeIds.length > 0) {
    return freeIds.pop();
  } else {
    return nextId++;
  }
}

function releaseId(id) {
  freeIds.push(id);
}

wss.on("connection", (socket) => {

  const {x, y} = findSafeSpawn(60);
  const mySnake = new Snake(x,y, allocateId(), false);
  mySnake.skin = [[255, 255, 0]];  // Default for players until skin message received
  mySnake.applySkin();
  socket.snake = mySnake;
  snakes.push(mySnake);
    // Send world size immediately
  const buf = new ArrayBuffer(1 + getBytesfromBits(WORLDSIZE.width) + getBytesfromBits(WORLDSIZE.height));
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint8(o++, WORLDSIZE.id);
  dv.setFloat32(o, gameX, false); o += getBytesfromBits(WORLDSIZE.width);
  dv.setFloat32(o, gameY, false); o += getBytesfromBits(WORLDSIZE.height);
  socket.send(buf);
  socket.on("message", (data) => {
    
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const view = new DataView(arrayBuffer);
    let offset = 0;
    if (view.byteLength < 2) return;

    const type = view.getUint8(offset);
    offset += 1;

    if (type === WINDOWSIZE.id) {
      if (offset + (getBytesfromBits(WINDOWSIZE.width) + getBytesfromBits(WINDOWSIZE.height)) > view.byteLength) return;
      const width = view.getFloat32(offset); offset += getBytesfromBits(WINDOWSIZE.width);
      const height = view.getFloat32(offset); offset += getBytesfromBits(WINDOWSIZE.height);
      socket.snake.width = width;
      socket.snake.height = height;
      return;
    }

    if (type === GESTURE.id) {
      if (offset + getBytesfromBits(GESTURE.flag) > view.byteLength) return;
      const gesture = view.getUint8(offset);
      socket.snake.boosting = gesture === 1;
      socket.snake.speed = gesture === 1 ? 5 : 2;
      const buf = new ArrayBuffer(1 + getBytesfromBits(GESTURE.flag));
      const dv = new DataView(buf);
      dv.setUint8(0, GESTURE.id);
      dv.setUint8(1, gesture);
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(buf);
      }
      return;
    }

    if (type === MOUSE.id) {
      if (offset + (getBytesfromBits(MOUSE.x) + getBytesfromBits(MOUSE.y)) > view.byteLength) return;
      const mouseX = view.getFloat32(offset); offset += getBytesfromBits(MOUSE.x);
      const mouseY = view.getFloat32(offset); offset += getBytesfromBits(MOUSE.y);
      socket.snake.mouseX = mouseX;
      socket.snake.mouseY = mouseY;
      clientMouseMap.set(socket, { x: mouseX, y: mouseY });
      return;
    }
if (type === NICKNAME.id) {
  const length = view.getUint16(offset, false); 
  offset += 2;

  const bytes = new Uint8Array(arrayBuffer, offset, length);
  let nickname = new TextDecoder().decode(bytes).trim();

  // enforce max width or length
  const safeNickname = trimNickname(nickname, 200, "16px Arial");

  // attach safely
  socket.nickname = safeNickname;
  if (socket.snake) {
    socket.snake.nickname = safeNickname;
  }

}

if (type === SKIN.id) {
  const patternLength = view.getUint32(offset, false); offset += getBytesfromBits(SKIN.count);
  const pattern = [];
  for (let i = 0; i < patternLength; i++) {
    const r = view.getFloat32(offset, false); offset += getBytesfromBits(SKIN.r);
    const g = view.getFloat32(offset, false); offset += getBytesfromBits(SKIN.g);
    const b = view.getFloat32(offset, false); offset += getBytesfromBits(SKIN.b);
    pattern.push([r, g, b]);
  }
  socket.snake.skin = pattern;
  socket.snake.applySkin();   // 🔑 repaint all segments
  return;
}

  });
  socket.on("close", () => {
    clientMouseMap.delete(socket);
    const snake = socket.snake;
    if (snake) {
      snake.active = 0;
    }
  });
});

import { createCanvas } from "canvas";

// Measure nickname width in pixels
function measureNicknameWidth(nick, font = "16px Arial") {
  const canvas = createCanvas(1, 1);
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  return ctx.measureText(nick).width;
}

// Trim nickname until it fits maxWidth
function trimNickname(nick, maxWidth = 200, font = "16px Arial") {
  let trimmed = nick.trim();
  while (measureNicknameWidth(trimmed, font) > maxWidth && trimmed.length > 0) {
    trimmed = trimmed.slice(0, -1); // remove last character
  }
  return trimmed;
}

function findSafeSpawn(minDist = 50) {
    for (let attempts = 0; attempts < 200; attempts++) {
        const x = random(gameX * 0.9);
        const y = random(gameY * 0.9);

        const gridId = gridIndex(x, y);
        if (gridId < 0) continue;

        // Query nearby segments using your existing function
        const nearby = querySnakesIn(gridId);

        let safe = true;
        for (const seg of nearby) {
            const dx = seg.x - x;
            const dy = seg.y - y;
            if (dx*dx + dy*dy < minDist * minDist) {
                safe = false;
                break;
            }
        }

        if (safe) return { x, y };
    }

    // Fallback: return center if no safe spot found
    return { x: gameX / 2, y: gameY / 2 };
}

for (let i = 0; i < REQUIRED_FOODS; i++) {
  const {x, y} = findSafeSpawn(20);
  foods.push(new Food(x, y, 1, 0, allocateId()));
}

// Example: your array of 100 names
const botNames = [
  "Alpha","Happy","Clever", "Brave", "Spark", "Sunny", "Lucky", "Swift", "Calm", "Bright", "Star", "Dreamer", "Explorer", "Builder", "Helper", "Thinker", "Runner", "Jumper", "Singer", "Dancer", "Painter", "Writer", "Reader", "Coder", "Player", "Winner",
  "Beta","Cool","River","Mountain","Sky","Ocean","Forest","Leaf","Stone","Cloud", "Rain","Storm","Thunder","Lightning","Sun","Moon","Star","Galaxy",  "Space" ,"Science", "Comet","Asteroid","Meteor","Nebula","Orbit","Rocket","Planet","Cosmos", "Eclipse","Aurora","Polaris","Andromeda","Quasar","Photon","Gravity","Nova", "Creativity" ,"Fun", "Harmony","Melody","Rhythm","Echo","Color","Canvas","Brush","Sculptor", "Poet","Story","Vision","Dream","Sparkle","Glow","Shine","Wonder",
  "Gamma","Great",
  "Delta","Positive",
  "Epsilon","Fun",
  "Zeta","Lightened",
  "Eta","Joyful",
  "Theta","Nice",
  "Iota","Friendly",
  "Kappa","Well",
  "Lambda","Intuition",
  "Mu","I am hungry",
  "Nu","Hunter",
  "Xi","Eater",
  "Omicron","I like cake",
  "Pi","I like turtles",
  "Rho","I like pizza",
  "Sigma","How are you?",
  "Tau","Trustworthy",
  "Upsilon","Draw",
  "Phi","Pencil",
  "Chi","Pen",
  "Psi","Working",
  "Omega","Loading..."
];

// Spawn bots with nicknames
for (let i = 0; i < REQUIRED_SNAKES; i++) {
  const {x ,y} = findSafeSpawn(60);
  const bot = new Snake(x, y, allocateId(), true);
  bot.nickname = allocateBotName();   // ✅ just like allocateId()
  snakes.push(bot);
}

function getViewBounds(snake) {
    if (!snake) return null;

    if (snake.s.length === 0) {
        return snake.lastBounds;
    }

    const head = snake.s[0];

    // Hard cap
    const MAX_W = 2000;
    const MAX_H = 2000;

    const halfW = Math.min(snake.width / 2, MAX_W / 2);
    const halfH = Math.min(snake.height / 2, MAX_H / 2);

    const padding = 100;

    const bounds = {
        x1: head.x - halfW - padding,
        y1: head.y - halfH - padding,
        x2: head.x + halfW + padding,
        y2: head.y + halfH + padding,
    };

    snake.lastBounds = bounds;
    return bounds;
}



function getSnakesInView(bounds) {
  const { x1, y1, x2, y2 } = bounds;

  const minCol = Math.max(0, Math.floor(x1 / CELL_W));
  const maxCol = Math.min(GRID_COLS - 1, Math.floor(x2 / CELL_W));
  const minRow = Math.max(0, Math.floor(y1 / CELL_H));
  const maxRow = Math.min(GRID_ROWS - 1, Math.floor(y2 / CELL_H));

  const results = [];
  const seen = new Set();

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const cellId = row * GRID_COLS + col;
      const bucket = gridSnakes[cellId];

      for (const seg of bucket) {
        const snake = seg.parent;
        if (!snake || seen.has(snake.id)) continue;

const PAD = 100;

for (const seg of snake.s) {
    if (
        seg.x >= x1 - PAD &&
        seg.x <= x2 + PAD &&
        seg.y >= y1 - PAD &&
        seg.y <= y2 + PAD
    ) {
        results.push(snake);
        seen.add(snake.id);
        break;
    }
}


      }
    }
  }

  return results;
}



function getFoodsInView(bounds) {
  const { x1, y1, x2, y2 } = bounds;

  const minCol = Math.max(0, Math.floor(x1 / CELL_W));
  const maxCol = Math.min(GRID_COLS - 1, Math.floor(x2 / CELL_W));
  const minRow = Math.max(0, Math.floor(y1 / CELL_H));
  const maxRow = Math.min(GRID_ROWS - 1, Math.floor(y2 / CELL_H));

  const results = [];

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const cellId = row * GRID_COLS + col;
      const bucket = gridFoods[cellId];

      for (const f of bucket) {
        if (f.x >= x1 && f.x <= x2 && f.y >= y1 && f.y <= y2) {
          results.push(f);
        }
      }
    }
  }

  return results;
}




function broadcastSnapshot() {
  const encoder = new TextEncoder();
  const FOOD_STRIDE = 13;

  // 1. Build global raw data once
  const globalSnakes = [];
  for (const s of snakes) {
    if (!s.s.length) continue;

    const angle = Math.atan2(s.direction.y, s.direction.x);
    const nickBytes = (!s.scrambled && s.nickname)
      ? encoder.encode(s.nickname)
      : new Uint8Array(0);

    globalSnakes.push({
      id: s.id,
      angle,
      segments: s.s,
      fullLength: s.s.length,
      nickBytes,
      isBot: s.isBot ? 1 : 0
    });
  }

  const globalFoods = foods.map(f => ({
    x: f.x,
    y: f.y,
    s: f.s,
    d: f.d ? 1 : 0,
    ref: f
  }));

  // 2. Pre‑encode snakes once (id → blob)
  const snakeBlobMap = new Map();
  for (const s of globalSnakes) {
    const segCount = s.segments.length;
    const nickLen = s.nickBytes.length;

    const size =
      4 +      // id
      1 +      // isBot
      4 +      // visibleSegCount (reuse full seg count)
      4 +      // fullLength
      4 +      // angle
      segCount * (4 + 4 + 3) + // segments
      2 + nickLen;             // nickname

    const buf = new ArrayBuffer(size);
    const dv = new DataView(buf);
    let o = 0;

    dv.setUint32(o, s.id, false); o += 4;
    dv.setUint8(o++, s.isBot);
    dv.setUint32(o, segCount, false); o += 4;
    dv.setUint32(o, s.fullLength, false); o += 4;
    dv.setFloat32(o, s.angle, false); o += 4;

    for (const seg of s.segments) {
      dv.setFloat32(o, seg.x, false); o += 4;
      dv.setFloat32(o, seg.y, false); o += 4;
      dv.setUint8(o++, seg.c[0]);
      dv.setUint8(o++, seg.c[1]);
      dv.setUint8(o++, seg.c[2]);
    }

    dv.setUint16(o, nickLen, false); o += 2;
    new Uint8Array(buf, o).set(s.nickBytes);

    snakeBlobMap.set(s.id, buf);
  }

  // 3. Pre‑encode foods once (by reference)
  const foodBlobMap = new Map();
  for (const gf of globalFoods) {
    const buf = new ArrayBuffer(FOOD_STRIDE);
    const dv = new DataView(buf);
    let o = 0;

    dv.setFloat32(o, gf.x, false); o += 4;
    dv.setFloat32(o, gf.y, false); o += 4;
    dv.setFloat32(o, gf.s, false); o += 4;
    dv.setUint8(o++, gf.d);

    foodBlobMap.set(gf.ref, buf);
  }

  // 4. Per‑client: use grid‑based view queries
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;

    const mySnake = client.snake;
    const myId = mySnake?.id ?? 0;
    const bounds = mySnake ? getViewBounds(mySnake) : null;

    const visibleSnakeBlobs = [];
    const visibleFoodBlobs = [];

    if (bounds) {
      const snakesInView = getSnakesInView(bounds);
      const foodsInView  = getFoodsInView(bounds);

      // SNAKES: map to pre‑encoded blobs
      for (const s of snakesInView) {
        const blob = snakeBlobMap.get(s.id);
        if (blob) visibleSnakeBlobs.push(blob);
      }

      // FOODS: map to pre‑encoded blobs
      for (const f of foodsInView) {
        const blob = foodBlobMap.get(f);
        if (blob) visibleFoodBlobs.push(blob);
      }
    } else {
      // no bounds → send everything
      for (const [id, blob] of snakeBlobMap) visibleSnakeBlobs.push(blob);
      for (const [f, blob] of foodBlobMap) visibleFoodBlobs.push(blob);
    }

    // 5. Build final buffer
    let total =
      1 + 4 + 4 + // header
      visibleSnakeBlobs.reduce((a, b) => a + b.byteLength, 0) +
      4 +
      visibleFoodBlobs.reduce((a, b) => a + b.byteLength, 0);

    const out = new ArrayBuffer(total);
    const dv = new DataView(out);
    let o = 0;

    dv.setUint8(o++, SNAPSHOT.id);
    dv.setUint32(o, myId, false); o += 4;

    dv.setUint32(o, visibleSnakeBlobs.length, false); o += 4;
    for (const blob of visibleSnakeBlobs) {
      new Uint8Array(out, o).set(new Uint8Array(blob));
      o += blob.byteLength;
    }

    dv.setUint32(o, visibleFoodBlobs.length, false); o += 4;
    for (const blob of visibleFoodBlobs) {
      new Uint8Array(out, o).set(new Uint8Array(blob));
      o += blob.byteLength;
    }

    client.send(out);
  }
}




function broadcastLeaderboard() {
  const encoder = new TextEncoder();

  // Collect top 10 snakes by length
  const topSnakes = snakes
    .filter(s => s.s.length > 0) // skip dead/no-name
    .sort((a, b) => b.s.length - a.s.length)
    .slice(0, 10);

  // Calculate size
  let totalSize = 1 + getBytesfromBits(LEADERBOARD.count); // version + type + count
  const entries = [];
  for (const s of topSnakes) {
    const nickBytes = encoder.encode(s.nickname);
    entries.push({ nickBytes, isBot: s.isBot ? 1 : 0, length: s.s.length });
    totalSize += getBytesfromBits(SNAKE.segCount) + getBytesfromBits(SNAKE.isBot) + getBytesfromBits(SNAKE.nicknameLen) + nickBytes.length;
  }

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let offset = 0;

  view.setUint8(offset++, LEADERBOARD.id);
  view.setUint32(offset, entries.length, false); offset += getBytesfromBits(LEADERBOARD.count);

  for (const e of entries) {
    view.setUint32(offset, e.length, false); offset += getBytesfromBits(SNAKE.segCount);
    view.setUint8(offset++, e.isBot);
    view.setUint16(offset, e.nickBytes.length, false); offset += getBytesfromBits(SNAKE.nicknameLen)
    for (let i = 0; i < e.nickBytes.length; i++) {
      view.setUint8(offset++, e.nickBytes[i]);
    }
  }

  // Send to all clients
for (const client of wss.clients) {
  if (client.readyState !== 1) continue;

  const bytes = buffer.byteLength;
  const sendStart = Date.now();

  client.send(buffer, () => {
    const sendEnd = Date.now();
  });
}

}


setInterval(() => {
  const start = performance.now();

  let updateTime = 0;

  for (const snake of snakes) {
    const t0 = performance.now();
    snake.update();
    updateTime += performance.now() - t0;
  }
  
  const end = performance.now();
  const total = end - start;

  console.log(
    `[UPDATE] total: ${total.toFixed(2)}ms | snake.update only: ${updateTime.toFixed(2)}ms | snakeSegments: ${
     snakes.reduce((a, s) => a + s.s.length, 0)
    }`
  );
}, 1000 / 60);

// add catmull-rom smoothing to snake segments
// add extra bytes to snapshot for bytes needed to decode and make functions for the constant ids (gesture) so that do not need to redo functions every time i update the constants
// reuse all objects and arrays instead of creating new ones every time
// need to compromise ideas so become efficient

// =====================
// SNAPSHOT LOOP (20 FPS)
// =====================
setInterval(() => {
  const start = performance.now();

  broadcastSnapshot();

  const end = performance.now();
  const total = end - start;

  console.log(
   `[SNAPSHOT] ${total.toFixed(2)}ms | bytes: ${globalThis.lastSnapshotBytes ?? "?"}`
  );
}, 1000 / 20);



// =====================
// LEADERBOARD (1 FPS)
// =====================
setInterval(() => {
  const start = performance.now();

  broadcastLeaderboard();

  const end = performance.now();
  const total = end - start;

//   console.log(
//     `[LEADERBOARD] ${total.toFixed(2)}ms | foods: ${foods.length} | snakes: ${snakes.length}`
//   );
}, 1000);
