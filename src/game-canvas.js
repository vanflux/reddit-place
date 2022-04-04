const fs = require('fs');
const { PNG } = require("pngjs");
const request = require("request");
const { rgbToInt } = require('./utils');

module.exports = class GameCanvas {
  static regions = [];

  static async downloadImg(url) {
    return new Promise(resolve => {
      request.get({
        url,
        headers: {
          'origin': 'https://hot-potato.reddit.com',
          'Referer': 'https://hot-potato.reddit.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:98.0) Gecko/20100101 Firefox/' + (Math.floor(Math.random() * 5) + 95) + '.0',
        },
        encoding: null,
      }, (error, response, body) => {
        try {
          if (error) resolve();
          const {data} = new PNG.sync.read(body);
          resolve(data);
        } catch (exc) {
          console.error('Error on download img', url, exc);
          resolve();
        }
      });
    });
  }

  static extractRegionIndex(url) {
    return url.match(/\-(\d+)\-/)?.[1];
  }
  
  static async handleConfig(config) {
    this.paletteMap = config.palette.reduce((a,b) => Object.assign(a, {[rgbToInt(b.rgb)]: b.index}), {});
    this.regionConfigs = config.regions;
    this.regionWidth = config.regionWidth;
    this.regionHeight = config.regionHeight;
  }

  static async handleFull(url) {
    const regionIndex = this.extractRegionIndex(url);
    console.log('Handling full', regionIndex);
    const region = this.regions[regionIndex] = { loading: true, waiters: [] };
    const data = await this.downloadImg(url);
    if (!data) return console.log('Handling full data error', regionIndex);
    region.loading = false;
    region.data = data;
    region.waiters.forEach(waiter => waiter());
    console.log('Full processed', regionIndex);
  }

  static async handleDiff(url) {
    const regionIndex = this.extractRegionIndex(url);
    const region = this.regions[regionIndex];
    if (region.loading) await new Promise(resolve => region.waiters.push(resolve));
    const data = await this.downloadImg(url);
    if (!data) return console.log('Handling diff data error', regionIndex);
    for (let i = 0; i < data.length; i+=4) {
      const a = data[i+3];
      if (a > 0) {
        region.data[i] = data[i];
        region.data[i+1] = data[i+1];
        region.data[i+2] = data[i+2];
        region.data[i+3] = 255;
      }
    }
  }

  static getRegionByLoc(x, y) {
    return this.regionConfigs.find(({index, dx, dy}) => (
      x >= dx && y >= dy && x < dx + this.regionWidth && y < dy + this.regionHeight
    ))?.index;
  }

  static getPixel(x, y) {
    const regionIndex = this.getRegionByLoc(x, y);
    if (regionIndex === undefined) return;
    const region = this.regions[regionIndex];
    const i = (this.regionWidth * (y % this.regionWidth) * 4) + ((x % this.regionHeight) * 4);
    const r = region.data[i];
    const g = region.data[i+1];
    const b = region.data[i+2];
    return this.paletteMap[rgbToInt({r,g,b})];
  }
}
