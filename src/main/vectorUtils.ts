export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error('Vector dimension mismatch')
  }

  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
  }
  return dot
}

export function normalizeVector(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) {
    norm += v[i] * v[i]
  }

  norm = Math.sqrt(norm)
  if (norm === 0) {
    return v
  }

  for (let i = 0; i < v.length; i++) {
    v[i] /= norm
  }
  return v
}

export function serializeEmbedding(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)
}

export function deserializeEmbedding(blob: Buffer): Float32Array {
  return new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength / Float32Array.BYTES_PER_ELEMENT,
  )
}
