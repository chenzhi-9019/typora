// Pixel comparison for the visual parity gate.
// Usage: npx electron scripts/pixel-diff.cjs <left.png> <right.png> [diff.png]
// Prints the differing-pixel ratio, the mismatch bounding box and the mean delta.
const { app, nativeImage } = require('electron')
const fs = require('node:fs')

function load(file) {
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) throw new Error('cannot read image: ' + file)
  const size = image.getSize()
  return { bitmap: image.toBitmap(), width: size.width, height: size.height }
}

app.disableHardwareAcceleration()

app.whenReady().then(() => {
  const [left, right, diffPath] = process.argv.slice(2)
  if (!left || !right) {
    console.error('usage: electron pixel-diff.cjs <left.png> <right.png> [diff.png]')
    app.exit(2)
    return
  }

  const a = load(left)
  const b = load(right)

  if (a.width !== b.width || a.height !== b.height) {
    console.log(JSON.stringify({ ok: false, reason: 'size-mismatch', left: [a.width, a.height], right: [b.width, b.height] }))
    app.exit(1)
    return
  }

  const total = a.width * a.height
  const out = Buffer.from(b.bitmap)
  let differing = 0
  let sum = 0
  let minX = a.width
  let minY = a.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4
      const db = Math.abs(a.bitmap[i] - b.bitmap[i])
      const dg = Math.abs(a.bitmap[i + 1] - b.bitmap[i + 1])
      const dr = Math.abs(a.bitmap[i + 2] - b.bitmap[i + 2])
      const delta = db + dg + dr
      sum += delta
      if (delta > 12) {
        differing++
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        out[i] = 0
        out[i + 1] = 0
        out[i + 2] = 255
      } else {
        const grey = Math.round((a.bitmap[i] + a.bitmap[i + 1] + a.bitmap[i + 2]) / 3 / 3 + 170)
        out[i] = grey
        out[i + 1] = grey
        out[i + 2] = grey
      }
    }
  }

  if (diffPath) {
    const image = nativeImage.createFromBitmap(out, { width: a.width, height: a.height })
    fs.writeFileSync(diffPath, image.toPNG())
  }

  console.log(
    JSON.stringify({
      ok: true,
      size: [a.width, a.height],
      differingRatio: Number((differing / total).toFixed(5)),
      meanDelta: Number((sum / total).toFixed(2)),
      boundingBox: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    })
  )
  app.exit(0)
})
