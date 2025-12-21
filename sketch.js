let socket;
let snakes = [];
let foods = [];
let mySnakeId = 0;

const TYPE_VERSION = 1;
const TYPE_SNAPSHOT = 1;
const TYPE_GESTURE = 2;
const TYPE_WINDOWSIZE = 3;
const TYPE_MOUSE = 4;
const TYPE_WORLDSIZE = 5;

let gameX = 0;
let gameY = 0;

let frameCounter = 0;
let lastHeadPos = { x: 0, y: 0 };

function setup() {
  frameRate(60);
  createCanvas(windowWidth, windowHeight);

  socket = new WebSocket("wss://gorsy-blanca-cistaceous.ngrok-free.dev/");
  socket.binaryType = "arraybuffer";

  socket.onopen = () => {
    console.log("🟢 Connected to server");
    sendWindowSize();
  };

  socket.onmessage = handleMessage;
  socket.onclose = () => console.log("🔴 Disconnected from server");
  socket.onerror = (err) => console.error("WebSocket error", err);
}

function handleMessage(event) {
  const view = new DataView(event.data);
  let offset = 0;
  if (view.byteLength < 1) return;

  // VERSION
  const version = view.getUint8(offset++);
  if (version !== TYPE_VERSION) return;

  // TYPE
  const type = view.getUint8(offset++);

  // WORLD SIZE PACKET
  if (type === TYPE_WORLDSIZE) {
    gameX = view.getFloat32(offset, false); offset += 4;
    gameY = view.getFloat32(offset, false); offset += 4;
    console.log("🌍 World size received:", gameX, gameY);
    return;
  }

  // SNAPSHOT PACKET
  if (type !== TYPE_SNAPSHOT) return;

  mySnakeId = view.getUint32(offset, false); offset += 4;

  // Snakes
  const snakeCount = view.getUint32(offset, false); offset += 4;
  snakes = [];

  for (let i = 0; i < snakeCount; i++) {
    const id = view.getUint32(offset, false); offset += 4;
    const segCount = view.getUint32(offset, false); offset += 4;
    const angle = view.getFloat32(offset, false); offset += 4;

    const segments = [];
    for (let s = 0; s < segCount; s++) {
      const x = view.getFloat32(offset, false); offset += 4;
      const y = view.getFloat32(offset, false); offset += 4;
      segments.push({ x, y });
    }

    snakes.push({ id, angle, segments });
  }

  // Foods
  const foodCount = view.getUint32(offset, false); offset += 4;
  foods = [];

  for (let i = 0; i < foodCount; i++) {
    const x = view.getFloat32(offset, false); offset += 4;
    const y = view.getFloat32(offset, false); offset += 4;
    const s = view.getFloat32(offset, false); offset += 4;
    const d = view.getUint8(offset++);

    foods.push({ x, y, s, d });
  }
}

function draw() {
  background(240);

  const me = snakes.find(s => s.id === mySnakeId);
  const myHead = me && me.segments.length ? me.segments[0] : null;

  push();
  if (myHead) {
    lastHeadPos = { x: myHead.x, y: myHead.y };
    translate(width / 2 - myHead.x, height / 2 - myHead.y);
  } else {
    translate(width / 2 - lastHeadPos.x, height / 2 - lastHeadPos.y);
  }

  // World bounds
  stroke(0);
  noFill();
  rect(0, 0, gameX, gameY);

  // Foods
  for (let f of foods) {
    fill(f.d ? "blue" : "green");
    const diam = 10 + f.s * 0.5;
    ellipse(f.x, f.y, diam, diam);
  }

  // Snakes
  for (let s of snakes) {
    for (let i = s.segments.length - 1; i >= 0; i--) {
      const seg = s.segments[i];
      fill(255, 255, 0);
      circle(seg.x, seg.y, 20);
    }

    if (s.segments.length > 0) {
      const head = s.segments[0];
      push();
      translate(head.x, head.y);
      rotate(s.angle);
      fill(255, 0, 0);
      circle(5, 5, 5);
      circle(5, -5, 5);
      pop();
    }
  }

  pop();

  // HUD
  fill(0);
  textSize(16);
  if (mySnakeId && me) {
    text(`Length: ${me.segments.length}`, 20, 24);
  }

  // Send mouse (throttled)
  if (socket.readyState === WebSocket.OPEN && (++frameCounter % 3) === 0) {
    const buffer = new ArrayBuffer(1 + 1 + 8);
    const view = new DataView(buffer);
    let o = 0;
    view.setUint8(o++, TYPE_VERSION);
    view.setUint8(o++, TYPE_MOUSE);
    view.setFloat32(o, mouseX, false); o += 4;
    view.setFloat32(o, mouseY, false); o += 4;
    socket.send(buffer);
  }
}

function sendGesture(flag) {
  if (socket.readyState !== WebSocket.OPEN) return;
  const buffer = new ArrayBuffer(1 + 1 + 1);
  const view = new DataView(buffer);
  let o = 0;
  view.setUint8(o++, TYPE_VERSION);
  view.setUint8(o++, TYPE_GESTURE);
  view.setUint8(o++, flag);
  socket.send(buffer);
}

function sendWindowSize() {
  if (socket.readyState !== WebSocket.OPEN) return;
  const buffer = new ArrayBuffer(1 + 1 + 8);
  const view = new DataView(buffer);
  let o = 0;
  view.setUint8(o++, TYPE_VERSION);
  view.setUint8(o++, TYPE_WINDOWSIZE);
  view.setFloat32(o, width, false); o += 4;
  view.setFloat32(o, height, false); o += 4;
  socket.send(buffer);
}

function keyPressed() {
  if (key === "ArrowUp" || key === " " || key === "w") sendGesture(1);
}

function keyReleased() {
  if (key === "ArrowUp" || key === " " || key === "w") sendGesture(0);
}

function mousePressed() {
  sendGesture(1);
}

function mouseReleased() {
  sendGesture(0);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  sendWindowSize();
}
