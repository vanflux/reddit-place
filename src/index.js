const DB = require('./db');
const Session = require('./session');

async function main() {
  console.log('Init');
  //await tickPixels();
  await monitor();
  console.log('End');
}

async function tickPixels() {
  console.log('');
  console.log('[  TICK PIXELS  ]');
  console.log('');

  let curX = 995;
  let curY = 855;
  let curColor = 23;
  
  const sessionsData = DB.getSessions();
  for (const sessionData of sessionsData) {
    const {id} = sessionData;
    try {
      const session = await Session.create(sessionData);
      if (!session) continue;
      if (session.isOnCooldown()) {
        const leftSeconds = Math.floor(session.getLeftCooldown() / 1000);
        console.log('Skipping session', id, 'cooldown', leftSeconds, 'seconds');
        continue;
      }
      curX++;
      await session.place(curX, curY, curColor);
    } catch (exc) {
      console.log('Session', id, 'tick error', exc);
    }
  }
}

async function monitor() {
  const sessionsData = DB.getSessions();
  let session;
  for (let sessionData of sessionsData) {
    const newSession = await Session.create(sessionData);
    if (newSession) {
      session = newSession;
      break;
    }
  }
  if (!session) return console.log('There is no session available to monitor');

  session.startMonitoring((url) => {
    console.log('Full url received', url);
  }, (url) => {
    console.log('Diff url received', url);
  }, (config) => {
    console.log('Config', config);
  });
}

main();
