const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE = ALPHABET.length;

/**
 * Encodes a non-negative integer to a base62 string.
 * @param {number} num - The non-negative integer to encode.
 * @returns {string} The base62 encoded string.
 */
function encodeBase62(num) {
  if (typeof num !== 'number' || Number.isNaN(num) || !Number.isInteger(num) || num < 0) {
    throw new Error('Input must be a non-negative integer');
  }
  if (num === 0) {
    return ALPHABET[0];
  }
  let result = '';
  let temp = num;
  while (temp > 0) {
    result = ALPHABET[temp % BASE] + result;
    temp = Math.floor(temp / BASE);
  }
  return result;
}

/**
 * Decodes a base62 string back to an integer.
 * @param {string} str - The base62 encoded string.
 * @returns {number} The decoded integer.
 */
function decodeBase62(str) {
  if (typeof str !== 'string' || str.length === 0) {
    throw new Error('Input must be a non-empty string');
  }
  let result = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const index = ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid character "${char}" in base62 string`);
    }
    result = result * BASE + index;
  }
  return result;
}

module.exports = {
  encodeBase62,
  decodeBase62,
  ALPHABET
};
