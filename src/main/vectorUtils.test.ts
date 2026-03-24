import { describe, expect, it } from 'vitest'
import {
  cosineSimilarity,
  deserializeEmbedding,
  normalizeVector,
  serializeEmbedding,
} from './vectorUtils'

describe('cosineSimilarity', () => {
  it('returns 1 for identical unit vectors', () => {
    const a = new Float32Array([1, 0, 0])
    expect(cosineSimilarity(a, a)).toBeCloseTo(1)
  })

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([0, 1, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0)
  })

  it('returns -1 for opposite unit vectors', () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([-1, 0, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1)
  })

  it('throws on dimension mismatch', () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([1, 0, 0])
    expect(() => cosineSimilarity(a, b)).toThrow('Vector dimension mismatch')
  })
})

describe('normalizeVector', () => {
  it('produces unit vector', () => {
    const v = new Float32Array([3, 4, 0])
    const result = normalizeVector(v)
    const norm = Math.sqrt(result[0] ** 2 + result[1] ** 2 + result[2] ** 2)
    expect(norm).toBeCloseTo(1)
  })

  it('returns zero vector unchanged', () => {
    const v = new Float32Array([0, 0, 0])
    expect(normalizeVector(v)).toEqual(v)
  })
})

describe('serialize/deserialize round-trip', () => {
  it('restores original values', () => {
    const original = new Float32Array([0.1, -0.5, 0.9, 0.3])
    const buffer = serializeEmbedding(original)
    const restored = deserializeEmbedding(buffer)
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i], 5)
    }
  })

  it('handles non-zero byteOffset correctly', () => {
    const original = new Float32Array([1, 2, 3, 4])
    const buf = serializeEmbedding(original)
    const padded = Buffer.alloc(buf.length + 8)
    buf.copy(padded, 8)
    const sliced = padded.slice(8)
    const restored = deserializeEmbedding(sliced)
    expect(Array.from(restored)).toEqual(Array.from(original))
  })
})
