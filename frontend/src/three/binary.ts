import type { Cloud } from '../types'

const PC_MAGIC_V2 = 0x50334332
const PC_MAGIC_V1 = 0x50334331
const FLAG_NORMALS = 1

function computeBounds(positions: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  if (!positions.length) return { min: [0, 0, 0], max: [0, 0, 0] }
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
}

export async function loadCloud(url: string): Promise<Cloud> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Point cloud download failed: ${response.status}`)
  const buffer = await response.arrayBuffer()
  const view = new DataView(buffer)
  const magic = view.getUint32(0, true)
  if (magic !== PC_MAGIC_V2 && magic !== PC_MAGIC_V1) throw new Error('Invalid point-cloud artifact')

  const count = view.getUint32(4, true)
  const width = view.getUint32(8, true)
  const height = view.getUint32(12, true)
  const flags = magic === PC_MAGIC_V2 ? view.getUint32(16, true) : 0
  const posOffset = 20
  const colorOffset = posOffset + count * 3 * 4
  const afterColors = colorOffset + count * 3
  const alignedAfterColors = (afterColors + 3) & ~3
  let cursor = alignedAfterColors
  let normals: Float32Array | null = null

  if ((flags & FLAG_NORMALS) !== 0) {
    normals = new Float32Array(buffer, cursor, count * 3)
    cursor += count * 3 * 4
    cursor = (cursor + 3) & ~3
  }

  const positions = new Float32Array(buffer, posOffset, count * 3)
  const colors = new Uint8Array(buffer, colorOffset, count * 3)
  const pixels = new Uint32Array(buffer, cursor, count)
  const bounds = computeBounds(positions)
  return { count, width, height, positions, colors, normals, pixels, ...bounds }
}
