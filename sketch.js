let s;
let grids = [];
let id = null;
let players = [];
let leaderboard = [];
let size;

function setup() {
  createCanvas(400,400);
(async () => {
  try {
    const r = await fetch("https://12-on-top.github.io/test/current_tunnel.txt");
    if (!r.ok) {
      throw new Error(`Failed to fetch ${r} with status ${r.status}`);
    }
    let testing = false;
    const e = (await r.text()).trim().replace("https", "wss");
  s = new WebSocket(testing===true?"ws://localhost:8080":e);


  s.onopen = () => {
    console.log("Connected to server");
  };

  s.onmessage = (event) => {
    const json = JSON.parse(event.data);
    if (json.type === "id") {
      id = json.id;
    } else if (json.type === "update") {
      players = json.data[0];
      grids = json.data[1];
      leaderboard = json.data[2] ?? [];
    } else if (json.type === "size") {
      size = json.siz;
    }
  };

  s.onclose = () => {
    console.log("Disconnected");
  };
  } catch(e) {
    console.error(e)
  }
})()
}

let ghost;

function draw() {
  if (s && s.readyState === WebSocket.OPEN) {
    background(255);

    const me = players.find(p => p.id === id);

    if (me) ghost = me;

    if (!ghost) {
      fill(0);
      textAlign(CENTER, CENTER);
      text("Loading player...", width / 2, height / 2);
      return;
    }

    push();
    translate(
      width / 2 - ghost.x * 50 - 25,
      height / 2 - ghost.y * 50 - 25
    );

    for (const i of grids) {
      push();
      translate(i.x * 50, i.y * 50);
      fill(color(...(i.colour ?? [255, 255, 255])));
      rect(0,0, 50, 50);
      if (i.shield) {
        textAlign(CENTER);
        fill(255);
        textSize(20);
        text("X",25,25)
      }
      pop();
    }

    stroke(255);

    for (const i of players) {
      fill(color(...(i.c ?? [255, 0, 0])));
      rect(i.x * 50, i.y * 50, 50, 50);

      if (i.id === id) {
        fill(255);
        circle(i.x * 50 + 25, i.y * 50 + 25, 10);
      }
    }

    pop();

    push();
    fill(0);


    if (!me) {
      fill(255, 0, 0);
      text("YOU DIED", 10, 35);
    }

    pop();
    push();
    translate(210,25)
    fill(255,0,0);
    square(0,0,size);
    for (let i of grids) {
      if (i.c === ghost.id) {
        point(i.x,i.y)
      }
    }
    pop();
    push();
    textAlign(LEFT, TOP);
    textSize(20);
    text(`Score: ${ghost.score}`, 10, 10);
    text(`Kills: ${ghost.kills}`, 10, 30);
    text(`Territory: ${ghost.territoryCount}`, 10, 50);
    pop()
    push();
    noStroke();
    fill(0,0,0, 190);
    rect(270, 8, 122, 166);
    fill(255);
    textAlign(LEFT, TOP);
    textSize(11);
    text("Leaderboard:", 276, 14);
    textSize(10);
    for (let i = 0; i < leaderboard.length; i++) {
      const entry = leaderboard[i];
      const y = 34 + i * 13;
      fill(color(...(entry.c ?? [255, 255, 255])));
      textAlign(LEFT, TOP);
      text(`${i + 1}. P${entry.id}${entry.id === id ? " (you)" : ""}`, 286, y);
      textAlign(RIGHT, TOP);
      text(entry.score, 387, y);
    }
    pop();
  } else {
    background(255, 0, 0);
    fill(255);
    textAlign(CENTER, CENTER);
    text("Disconnected", width / 2, height / 2);
  }
}

function send(m) {
  if (s && s.readyState === WebSocket.OPEN) {
    s.send(m);
  }
}

function placeShield(q) {
  send(new Uint8Array([
  0b00000000,
  q ? 0b11111111 : 0b00000000
]));

}

function removeShield(q) {
  send(new Uint8Array([
  0b11111111,
  q ? 0b11111111 : 0b00000000
]));

}


function sendMove(x, y) {
  const b = {
    "-1":0,
    "0":1,
    "1":2
  }
  const bin = (b[x] << 2) | b[y];
  send(new Uint8Array([bin]));
}
function keyPressed() {
  if (key === LEFT_ARROW) {
    sendMove(-1, 0);
  } else if (key === RIGHT_ARROW) {
    sendMove(1, 0);
  } else if (key === UP_ARROW) {
    sendMove(0, -1);
  } else if (key === DOWN_ARROW) {
    sendMove(0, 1);
  }
  else if (key === "s") {
    placeShield(0);
  }
  else if (key === "r") {
    removeShield(1);
  }
}

