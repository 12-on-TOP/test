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
const TYPE_NICKNAME = 6;
const TYPE_LEADERBOARD = 7;

let gameX = 0;
let gameY = 0;
let frameCounter = 0;
let lastHeadPos = { x: 0, y: 0 };
let state = 0;
let lastLeaderboard = [];

// Map of DOM elements for nicknames
let nicknameElements = {};

async function connectSocket() {
  try {
    // Fetch the tunnel URL from GitHub Pages
    const response = await fetch("https://12-on-top.github.io/test/current_tunnel.txt");
    if (!response.ok) {
      throw new Error(`Failed to fetch tunnel: ${response.status}`);
    }

    // Read plain text file
    const url = (await response.text()).trim();
    const wsUrl = url.replace("http", "ws");

    // Connect to WebSocket server
    socket = new WebSocket(wsUrl);
    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      console.log("ðŸŸ¢ Connected to server", wsUrl);
      sendWindowSize();
    };

    socket.onmessage = (event) => {
      const view = new DataView(event.data);
      let offset = 0;
      if (view.byteLength < 1) return;

      const version = view.getUint8(offset++);
      if (version !== TYPE_VERSION) return;

      const type = view.getUint8(offset++);

      // World size packet
      if (type === TYPE_WORLDSIZE) {
        gameX = view.getFloat32(offset, false); offset += 4;
        gameY = view.getFloat32(offset, false); offset += 4;
        console.log("ðŸŒ World size received:", gameX, gameY);
        return;
      }

      // Leaderboard packet
      if (type === TYPE_LEADERBOARD) {
        const count = view.getUint32(offset, false); offset += 4;
        const leaderboard = [];

        for (let i = 0; i < count; i++) {
          const length = view.getUint32(offset, false); offset += 4;
          const isBot = view.getUint8(offset++);
          const nickLen = view.getUint16(offset, false); offset += 2;

          let nickname = "";
          if (nickLen > 0) {
            const nickBytes = new Uint8Array(event.data, offset, nickLen);
            nickname = new TextDecoder().decode(nickBytes);
            offset += nickLen;
          }

          leaderboard.push({ nickname, isBot: !!isBot, length });
        }

        if (state === 1) {
          if (leaderboard.length > 0) {
            lastLeaderboard = leaderboard;
          }
          if (lastLeaderboard.length > 0) {
            renderLeaderboard(lastLeaderboard);
          }
        }
        return;
      }

      // Snapshot packet
      if (type !== TYPE_SNAPSHOT) return;

      mySnakeId = view.getUint32(offset, false); offset += 4;

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

        const nickLen = view.getUint16(offset, false); offset += 2;
        let nickname = "";
        if (nickLen > 0) {
          const nickBytes = new Uint8Array(event.data, offset, nickLen);
          nickname = new TextDecoder().decode(nickBytes);
          offset += nickLen;
        }

        snakes.push({ id, angle, segments, nickname });

        if (nickname) {
          if (!nicknameElements[id]) {
            const p = createP(nickname);
            p.style("position", "absolute");
            p.style("color", "white");
            p.style("font", "16px Arial");
            p.style("margin", "0");
            p.style("padding", "0");
            p.style("pointer-events", "none");
            nicknameElements[id] = p;
          } else {
            nicknameElements[id].html(nickname);
          }
        }
      }

      // Cleanup ghost nicknames
      const activeIds = new Set(snakes.map(s => s.id));
      for (const id in nicknameElements) {
        if (id !== "hud" && !activeIds.has(Number(id))) {
          nicknameElements[id].remove();
          delete nicknameElements[id];
        }
      }

      // Foods
      const foodCount = view.getUint32(offset, false); offset += 4;
      foods = [];
      for (let i = 0; i < foodCount; i++) {
        const x = view.getFloat32(offset, false); offset += 4;
        const y = view.getFloat32(offset, false); offset += 4;
        const s = view.getFloat32(offset, false); offset += 4;
        const d = view.getUint8(offset); offset += 1;
        foods.push({ x, y, s, d });
      }
    };

    socket.onclose = () => console.log("ðŸ”´ Disconnected from server");
    socket.onerror = (err) => console.error("WebSocket error", err);

  } catch (err) {
    console.error("âŒ Error connecting:", err);
  }
}


function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  frameRate(60);

  connectSocket()
}

function play () {
  sendNickname(document.getElementById("myDiv").innerText);
}

function changeSkin() {
  let container = document.getElementById("change");
  container.innerHTML = `
    <div style="display:flex; flex-wrap:nowrap;">
      ${Array.from({length:30}, () => 
        '<div style="width:50px; height:50px; margin:2px; background-color:black;"></div>'
      ).join('')}
    </div>
    <br><br>
  `;
  container.addEventListener("scroll",() => {
    console.log("Div is scrolling!");
  });
}


// Call once to render



function draw() {
  if (state === 0) {
    noLoop();
    document.getElementById("nick").innerHTML =
      `Enter Nickname:<div id="myDiv" contenteditable="true" style="border:1px solid #ccc; padding:5px; font:16px Arial; white-space:nowrap; overflow:hidden; width:200px"></div> <button onclick="play()">PLAY</button><br><br>
      <button onclick="changeSkin()" type="button">Change Skin</button>`;
  } else {
    document.getElementById("nick").innerHTML = ``;

    background(20);
    ambientLight(80);
    directionalLight(255, 255, 255, 0.5, -1, -0.5);

    push();
    translate(-width / 2, -height / 2);

    const me = snakes.find((s) => s.id === mySnakeId);
    const myHead = me && me.segments.length ? me.segments[0] : null;

    push();
    if (myHead) {
      lastHeadPos = { x: myHead.x, y: myHead.y };
      translate(width / 2 - myHead.x, height / 2 - myHead.y);
    } else {
      translate(width / 2 - lastHeadPos.x, height / 2 - lastHeadPos.y);
    }

    // World bounds
    noFill();
    stroke(100);
    rect(0, 0, gameX, gameY);

    // Snakes
    for (let s of snakes) {
      for (let i = s.segments.length - 1; i >= 0; i--) {
        const seg = s.segments[i];
        push();
        translate(seg.x, seg.y, 0);
        noStroke();
        ambientMaterial(255, 255, 0);
        sphere(10);
        pop();
      }

      if (s.segments.length > 0) {
        const head = s.segments[0];
        push();
        translate(head.x, head.y, 0);
        rotateZ(s.angle);
        ambientMaterial(255, 0, 0);
        sphere(6);
        translate(5, 5, 2);
        sphere(2);
        translate(0, -10, 0);
        sphere(2);
        pop();

        // Update nickname DOM element position
// Update nickname DOM element position
if (s.nickname && nicknameElements[s.id]) {
  let label = s.nickname;
  if (s.isBot) {
    label = `${s.nickname}<br>(Bot)`; // two lines
  }
  nicknameElements[s.id].html(label);

  const screenX = width / 2 - (lastHeadPos.x - head.x);
  const screenY = height / 2 - (lastHeadPos.y - head.y);
  nicknameElements[s.id].position(screenX, screenY - 20);
}

      }
    }

    // Foods
    for (let f of foods) {
      push();
      translate(f.x, f.y, 5);
      const diam = Math.max(5, 5 + f.s * 0.25);
      const isBlue = f.d === 1;
      noStroke();
      fill(isBlue ? color(0, 150, 255, 80) : color(0, 255, 100, 80));
      sphere(diam * 1.5);
      fill(isBlue ? color(0, 150, 255) : color(0, 255, 100));
      sphere(diam);
      pop();
    }

    pop(); // camera

    // HUD length as DOM overlay
    if (mySnakeId && me) {
      if (!nicknameElements["hud"]) {
        const hud = createP(`Length: ${me.segments.length}`);
        hud.style("position", "absolute");
        hud.style("color", "white");
        hud.style("font", "16px Arial");
        hud.style("margin", "0");
        hud.style("padding", "0");
        hud.style("pointer-events", "none");
        nicknameElements["hud"] = hud;
      } else {
        nicknameElements["hud"].html(`Length: ${me.segments.length}`);
        nicknameElements["hud"].position(20, 20); // top-left corner
      }
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

function sendNickname(nick) {
  state=1;loop();
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  // Encode nickname as UTFâ€‘8
  const encoder = new TextEncoder();
  const nickBytes = encoder.encode(nick);

  // Packet layout:
  // version (1 byte)
  // type (1 byte)
  // length (2 bytes, unsigned)
  // nickname (UTFâ€‘8 bytes)
  const buffer = new ArrayBuffer(1 + 1 + 2 + nickBytes.length);
  const view = new DataView(buffer);
  let offset = 0;

  // Protocol version
  view.setUint8(offset++, TYPE_VERSION);

  // Message type
  view.setUint8(offset++, TYPE_NICKNAME);

  // Nickname length
  view.setUint16(offset, nickBytes.length, false);
  offset += 2;

  // Nickname bytes
  for (let i = 0; i < nickBytes.length; i++) {
    view.setUint8(offset++, nickBytes[i]);
  }

  // Send to server
  socket.send(buffer);
}

function renderLeaderboard(entries) {
  if (state !== 1) return;

  let html = "<h3 style='color:white;margin:0'>Leaderboard</h3><ul style='color:white;padding-left:20px'>";
  entries.forEach((entry, index) => {
    const rank = `#${index + 1}`;
    if (entry.isBot) {
      html += `<li>${rank}(Bot) ${entry.nickname} - Length: ${entry.length}</li>`;
    } else {
      html += `<li>${rank} ${entry.nickname} - Length: ${entry.length}</li>`;
    }
  });
  html += "</ul>";

  if (!nicknameElements["leaderboard"]) {
    const lb = createDiv(html);
    lb.style("position", "absolute");
    lb.style("top", "50px");
    lb.style("right", "20px");
    lb.style("background", "rgba(0,0,0,0.5)");
    lb.style("padding", "10px");
    lb.style("font", "14px Arial");
    lb.style("pointer-events", "none");
    nicknameElements["leaderboard"] = lb;
  } else {
    nicknameElements["leaderboard"].html(html);
  }
}




function keyPressed() {
  if (key === "ArrowUp" || key === " " || key === "w") sendGesture(1);
}
function keyReleased() {
  if (key === "ArrowUp" || key === " " || key === "w") sendGesture(0);
}
function mousePressed() { sendGesture(1); }
function mouseReleased() { sendGesture(0); }
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  sendWindowSize();
}
