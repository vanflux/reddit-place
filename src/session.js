const GraphQLClient = require('graphql-client');
const request = require('request');
const WebSocket = require('ws');
const DB = require('./db');

module.exports = class Session {
  constructor(sessionData) {
    this.data = sessionData;
  }

  static async requestSessionAuth(sessionData) {
    return new Promise(resolve => {
      const j = request.jar();
      const url = 'https://www.reddit.com';
      j.setCookie(request.cookie('reddit_session=' + sessionData.redditSession), url);
      j.setCookie(request.cookie('session=' + sessionData.session), url);
      request.get({
        jar: j,
        url: 'https://www.reddit.com/r/place/',
      }, (error, request, body) => {
        if (error) resolve({ hasError: true, error });
        try {
          const strStart = '"session":';
          const start = body.indexOf(strStart) + strStart.length;
          const end = body.indexOf(',"sessionRefreshFailed"', start);
          const str = body.substring(start, end);
          const {accessToken, expires: expiresStr, expiresIn} = JSON.parse(str);
          const expires = new Date(expiresStr);
          resolve({hasError: false, data: {accessToken, expires, expiresIn}});
        } catch (error) {
          resolve({hasError: true, error});
        }
      });
    });
  }

  static async create(data) {
    const id = data.id;
    if (data.cooldownError) return console.log('Skipping session', id, 'cooldown error');
    if (data.authError) return console.log('Skipping session', id, 'auth error');

    if (!data.auth) {
      const res = await this.requestSessionAuth(data);
      if (res.hasError) {
        console.log('Session', id, 'failed at loading auth', res.error);
        data.authError = true;
        DB.setSession(id, data);
        return;
      }
      data.auth = res.data;
      console.log('Session', id, 'loaded auth successfully', data.auth.accessToken);
      DB.setSession(id, data);
    } else {
      const auth = data.auth;
      const expiresIn = new Date(auth.expires).getTime() - Date.now();
      if (expiresIn <= 60000) {
        console.log('Session', id, 'expired, renewing...');
        
        const res = await this.requestSessionAuth(data);
        if (res.hasError) {
          console.log('Session', id, 'failed at loading auth on renew', res.error);
          data.authError = true;
          DB.setSession(id, data);
          return;
        }
        data.auth = res.data;
        console.log('Session', id, 'loaded auth renewed successfully', data.auth.accessToken);
        DB.setSession(id, data);
      } else {
        console.log('Session', id, 'expires in', expiresIn);
      }
    }

    return new Session(data);
  }

  createGraphClient() {
    return GraphQLClient({
      url: 'https://gql-realtime-2.reddit.com/query',
      headers: {
        'authorization': 'Bearer ' + this.getToken(),
        'origin': 'https://hot-potato.reddit.com',
        'apollographql-client-name': 'mona-lisa',
        'apollographql-client-version': '0.0.1',
        'Referer': 'https://hot-potato.reddit.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:98.0) Gecko/20100101 Firefox/' + (Math.floor(Math.random() * 5) + 95) + '.0',
      }
    });
  }

  isOnCooldown() {
    return this.getLeftCooldown() > 0;
  }

  getLeftCooldown() {
    return this.data.cooldown - Date.now();
  }

  async place(x, y, color) {
    console.log('Session', this.getId(), 'placing at', x, y, 'color', color);
    const client = this.createGraphClient();
    const placeMutation = `mutation setPixel($input: ActInput!) {  act(input: $input) {    data {      ... on BasicMessage {        id        data {          ... on GetUserCooldownResponseMessageData {            nextAvailablePixelTimestamp            __typename          }          ... on SetPixelResponseMessageData {            timestamp            __typename          }          __typename        }        __typename      }      __typename    }    __typename  }}`;
    const variables = {
      "input": {
        "actionName": "r/replace:set_pixel",
        "PixelMessageData": {
          "canvasIndex": Math.floor(x / 1000) % 2, // TODO: support canvas 2 and 3
          "colorIndex": color,
          "coordinate": {
            "x": x % 1000,
            "y": y % 1000,
          }
        }
      }
    };
    const res = await client.query(placeMutation, variables, () => {});
    let nextPlaceTime = -1;
    if (Array.isArray(res.errors) && res.errors.length > 0) {
      const rateLimit = res.errors.find(x => x.message === 'Ratelimited');
      if (rateLimit) {
        const {nextAvailablePixelTimestamp, nextAvailablePixelTs} = rateLimit.extensions;
        nextPlaceTime = nextAvailablePixelTimestamp || nextAvailablePixelTs;
      } else {
        console.log('Session', this.getId(), 'unhandled error:', res);
      }
    }
    if (res.data && res.data.act && Array.isArray(res.data.act.data)) {
      const cooldownMessage = res.data.act.data.find(x => x.data.__typename === 'GetUserCooldownResponseMessageData');
      if (cooldownMessage && cooldownMessage.data && cooldownMessage.data.nextAvailablePixelTimestamp) {
        nextPlaceTime = cooldownMessage.data.nextAvailablePixelTimestamp;
      }
    }
    if (nextPlaceTime != -1) {
      const availableIn = Math.floor((nextPlaceTime - Date.now()) / 1000);
      console.log('Session', this.getId(), 'next place time', nextPlaceTime, 'in', availableIn, 'seconds');
      this.data.cooldown = nextPlaceTime;
      DB.setSession(this.getId(), this.data);
      return true;
    } else {
      console.log('Session', this.getId(), 'cooldown -1 error:', res);
      this.data.cooldownError = true;
      DB.setSession(this.getId(), this.data);
      return false;
    }
  }

  startMonitoring(onFull, onDiff, onConfig) {
    let seq = 1;

    const socket = new WebSocket('wss://gql-realtime-2.reddit.com/query', {
      origin: 'https://hot-potato.reddit.com',
    });

    const subscribe = (canvasId) => {
      socket.send(JSON.stringify({
        id: String(seq++),
        type: 'start',
        payload: {
          variables: {
            input: {
              channel: {
                teamOwner: 'AFD2022',
                category: 'CANVAS',
                tag: String(canvasId),
              }
            }
          },
          extensions: {},
          operationName: 'replace',
          query: 'subscription replace($input: SubscribeInput!) {\n  subscribe(input: $input) {\n    id\n    ... on BasicMessage {\n      data {\n        __typename\n        ... on FullFrameMessageData {\n          __typename\n          name\n          timestamp\n        }\n        ... on DiffFrameMessageData {\n          __typename\n          name\n          currentTimestamp\n          previousTimestamp\n        }\n      }\n      __typename\n    }\n    __typename\n  }\n}\n',
        }
      }));
    };
    
    socket.onopen = () => {
      console.log('Session', this.getId(), 'monitor socket open');
      socket.send(JSON.stringify({
        type: 'connection_init',
        payload: {
          Authorization: 'Bearer ' + this.getToken()
        }
      }));
      socket.send(JSON.stringify({
        id: String(seq++),
        type: 'start',
        payload: {
          variables: {
            input: {
              channel:{
                teamOwner: 'AFD2022',
                category: 'CONFIG'
              }
            }
          },
          extensions:{},
          operationName: 'configuration',
          query: 'subscription configuration($input: SubscribeInput!) {\n  subscribe(input: $input) {\n    id\n    ... on BasicMessage {\n      data {\n        __typename\n        ... on ConfigurationMessageData {\n          colorPalette {\n            colors {\n              hex\n              index\n              __typename\n            }\n            __typename\n          }\n          canvasConfigurations {\n            index\n            dx\n            dy\n            __typename\n          }\n          canvasWidth\n          canvasHeight\n          __typename\n        }\n      }\n      __typename\n    }\n    __typename\n  }\n}\n',
        }
      }));
    };
    socket.onmessage = (message) => {
      const data = message.data;
      try {
        const json = JSON.parse(data);
        const aux = json?.payload?.data?.subscribe?.data;
        if (!aux) return;
        const type = aux.__typename;
        const url = aux?.name;
        switch (type) {
          case 'DiffFrameMessageData':
            onDiff(url);
            break;
          case 'FullFrameMessageData':
            onFull(url);
            break;
          case 'ConfigurationMessageData':
            const {colorPalette: palette, canvasConfigurations: regions, canvasWidth: regionWidth, canvasHeight: regionHeight} = aux;
            for (const region of regions) {
              subscribe(region.index);
            }
            onConfig({palette, regions, regionWidth, regionHeight});
            break;
        }
      } catch (exc) {
        console.error('Failed to parse socket message to json:', message, exc);
      }
    };
  }

  getToken() {
    return this.data.auth && this.data.auth.accessToken;
  }

  getId() {
    return this.data.id;
  }
}
