const { encodeBase62, decodeBase62 } = require('../utils/base62');

describe('Base62 Encoder/Decoder', () => {
  describe('encodeBase62', () => {
    test('should encode 0 to first character of alphabet ("0")', () => {
      expect(encodeBase62(0)).toBe('0');
    });

    test('should encode single-digit boundary values correctly', () => {
      expect(encodeBase62(1)).toBe('1');
      expect(encodeBase62(9)).toBe('9');
      expect(encodeBase62(10)).toBe('a');
      expect(encodeBase62(35)).toBe('z');
      expect(encodeBase62(36)).toBe('A');
      expect(encodeBase62(61)).toBe('Z');
    });

    test('should encode base value (62) to "10"', () => {
      expect(encodeBase62(62)).toBe('10');
    });

    test('should encode large numbers correctly', () => {
      expect(encodeBase62(123456789)).toBe('8m0Kx');
    });

    test('should throw error for negative numbers', () => {
      expect(() => encodeBase62(-1)).toThrow('Input must be a non-negative integer');
    });

    test('should throw error for non-integers', () => {
      expect(() => encodeBase62(12.34)).toThrow('Input must be a non-negative integer');
      expect(() => encodeBase62('123')).toThrow('Input must be a non-negative integer');
      expect(() => encodeBase62(null)).toThrow('Input must be a non-negative integer');
      expect(() => encodeBase62(undefined)).toThrow('Input must be a non-negative integer');
      expect(() => encodeBase62(NaN)).toThrow('Input must be a non-negative integer');
    });
  });

  describe('decodeBase62', () => {
    test('should decode "0" to 0', () => {
      expect(decodeBase62('0')).toBe(0);
    });

    test('should decode single-character strings correctly', () => {
      expect(decodeBase62('1')).toBe(1);
      expect(decodeBase62('9')).toBe(9);
      expect(decodeBase62('a')).toBe(10);
      expect(decodeBase62('z')).toBe(35);
      expect(decodeBase62('A')).toBe(36);
      expect(decodeBase62('Z')).toBe(61);
    });

    test('should decode multi-character strings correctly', () => {
      expect(decodeBase62('10')).toBe(62);
      expect(decodeBase62('8m0Kx')).toBe(123456789);
    });

    test('should throw error for empty string or non-string inputs', () => {
      expect(() => decodeBase62('')).toThrow('Input must be a non-empty string');
      expect(() => decodeBase62(123)).toThrow('Input must be a non-empty string');
      expect(() => decodeBase62(null)).toThrow('Input must be a non-empty string');
    });

    test('should throw error for invalid base62 characters', () => {
      expect(() => decodeBase62('abc-123')).toThrow('Invalid character "-" in base62 string');
      expect(() => decodeBase62('abc.xyz')).toThrow('Invalid character "." in base62 string');
      expect(() => decodeBase62('abc_123')).toThrow('Invalid character "_" in base62 string');
    });
  });

  describe('Round-trip property', () => {
    test('should decode back to the original number for a wide range of values', () => {
      const testNumbers = [0, 1, 15, 62, 100, 9999, 123456, 987654321];
      testNumbers.forEach(num => {
        const encoded = encodeBase62(num);
        const decoded = decodeBase62(encoded);
        expect(decoded).toBe(num);
      });
    });
  });
});
