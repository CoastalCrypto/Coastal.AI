// Generates a 1024x1024 PLACEHOLDER source icon (dependency-free PNG encoder)
// for the desktop shell so tauri-build can produce platform icons. This is a
// throwaway mark in Coastal's palette — NOT final brand art. Replace with a real
// logo before shipping (tracked as a branding follow-up).
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 1024
const bg = [5, 13, 26] // #050d1a deep navy (matches the app window background)
const ring = [34, 182, 166] // #22b6a6 coastal teal
const core = [110, 231, 168] // #6ee7a8 mint accent

function px(x, y) {
  // Centered concentric mark: filled mint core, teal ring, navy field.
  const dx = x - SIZE / 2
  const dy = y - SIZE / 2
  const r = Math.sqrt(dx * dx + dy * dy)
  if (r < 210) return core
  if (r > 300 && r < 360) return ring
  return bg
}

// Build raw RGBA scanlines, each prefixed with a 0 filter byte.
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
let o = 0
for (let y = 0; y < SIZE; y++) {
  raw[o++] = 0
  for (let x = 0; x < SIZE; x++) {
    const [r, g, b] = px(x, y)
    raw[o++] = r
    raw[o++] = g
    raw[o++] = b
    raw[o++] = 255
  }
}

// CRC32 (PNG chunk checksums).
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])

const out = resolve(dirname(fileURLToPath(import.meta.url)), 'placeholder-icon.png')
writeFileSync(out, png)
console.log('[gen-icon] wrote', out, `(${png.length} bytes)`)
