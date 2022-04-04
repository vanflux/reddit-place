
module.exports.rgbToInt = ({r,g,b}) => (255 << 24) + (b << 16) + (g << 8) + r;

module.exports.sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
