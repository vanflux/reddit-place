const fs = require('fs');
const DB = require('./db');
const Session = require('./session');
const { applyPaletteSync, buildPaletteSync, utils } = require('image-q');
const { PNG } = require('pngjs');
const GameCanvas = require('./game-canvas');
const { sleep } = require('./utils');
const AccountCreator = require('./acc-creator');
const request = require('request');
const SocksProxyAgent = require('socks-proxy-agent');

let loadedData;
let loadedWidth;
let loadedHeight;

let targetX = 955;
let targetY = 368;

const agent = new SocksProxyAgent('socks://127.0.0.1:9050');
const httpClient = request.defaults({agent});

async function main() {
  console.log('Init');

  /*let accCreator = new AccountCreator(httpClient);
  const newAccount = await accCreator.create('');

  if (newAccount?.error) {
    console.log(newAccount.error);
  } else {
    console.log('New account created!', newAccount.email);
    const id = DB.genSessionId();
    const sessionData = {
      id,
      redditSession: newAccount.redditSession,
      session: newAccount.session,
      account: {
        email: newAccount.email,
        password: newAccount.password,
        username: newAccount.username,
      },
    };
    DB.setSession(id, sessionData);
  }*/

  await monitor();
  while(true) {
    await tickPixels();
    await sleep(10000);
  }
}

async function wrongPixels() {
  if (!loadedData) return;

  const wrong = [];
  const start = Date.now();
  /*for (let y = 0; y < loadedHeight; y++) {
    for (let x = 0; x < loadedWidth; x++) {
      const expected = loadedData[y * loadedWidth + x];
      const current = GameCanvas.getPixel(targetX + x, targetY + y);
      if (expected != current) wrong.push({x: targetX + x, y: targetY + y, c: expected});
    }
  }*/
  for (let y = 362; y <= 363; y++) {
    for (let x = 972; x < 989; x++) {
      const current = GameCanvas.getPixel(x, y);
      if (current != 27) wrong.push({x, y, c: 27});
    }
  }
  const end = Date.now();
  console.log('Wrong pixels took', end-start, 'ms', 'wrongs:', wrong.length);
  return wrong;
}

async function tickPixels() {
  console.log('[  TICK PIXELS  ]');
  const wrong = await wrongPixels();
  if (!wrong) return console.log('Image not loaded yet');
  if (wrong.length == 0) return console.log('Image completed! Finally! Glory!'); 

  const sessionsData = DB.getSessions();
  for (const sessionData of sessionsData) {
    const {id} = sessionData;
    try {
      const session = await Session.create(sessionData, agent);
      if (!session) continue;
      if (session.isOnCooldown()) {
        const leftSeconds = Math.floor(session.getLeftCooldown() / 1000);
        console.log('Skipping session', id, 'cooldown', leftSeconds, 'seconds');
        continue;
      }
      const index = Math.floor(Math.random() * wrong.length);
      const [pixel] = wrong.splice(index, 1);
      await session.place(pixel.x, pixel.y, pixel.c);
    } catch (exc) {
      console.log('Session', id, 'tick error', exc);
    }
  }
}

async function monitor() {
  const sessionsData = DB.getSessions();
  let session;
  for (let sessionData of sessionsData) {
    const newSession = await Session.create(sessionData, agent);
    if (newSession) {
      session = newSession;
      break;
    }
  }
  if (!session) return console.log('There is no session available to monitor');

  session.startMonitoring(async (url) => {
    await GameCanvas.handleFull(url);
  }, async (url) => {
    await GameCanvas.handleDiff(url);
  }, async (config) => {
    await GameCanvas.handleConfig(config);
    const {palette} = config;
    await loadImage(palette);
  });
}

async function loadImage(inPalette) {
  const rgbToInt = ({r,g,b}) => (255 << 24) + (b << 16) + (g << 8) + (r);

  const { data, width, height } = PNG.sync.read(fs.readFileSync('image1.png'));

  const imageContainer = utils.PointContainer.fromUint8Array(data, width, height);
  const paletteContainer = utils.PointContainer.fromUint32Array(Uint32Array.from(inPalette.map(({rgb})=>rgbToInt(rgb))), inPalette.length, 1);

  const palette = buildPaletteSync([paletteContainer]);
  const outContainer = applyPaletteSync(imageContainer, palette);
  const outData = outContainer.toUint8Array();

  const png = new PNG();
  png.width = width;
  png.height = height;
  png.data = outData;
  fs.writeFileSync('filename.png', PNG.sync.write(png));

  const mappedData = [];
  const paletteMap = inPalette.reduce((a,b) => Object.assign(a, {[rgbToInt(b.rgb)]: b.index}), {});
  for (let i = 0; i < outData.length; i+=4) {
    const r = outData[i];
    const g = outData[i+1];
    const b = outData[i+2];
    const int = rgbToInt({r,g,b});
    const index = paletteMap[int];
    mappedData.push(index);
  }

  loadedData = mappedData;
  loadedWidth = width;
  loadedHeight = height;
  console.log('Image loaded, width:', width, 'height:', height);
}

main();
