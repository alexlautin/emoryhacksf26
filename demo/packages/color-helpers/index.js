const codes = { red: 31, green: 32, yellow: 33, blue: 34 };
module.exports = {
  paint: (text, color) => `\x1b[${codes[color] ?? 0}m${text}\x1b[0m`,
};
