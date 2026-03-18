import { NextRequest } from "next/server"
import sharp from "sharp"

export const runtime = "nodejs"

function normalizeErrorMessage(x: any) {
  if (!x) return ""
  if (Array.isArray(x)) return x.join(" | ")
  if (typeof x === "string") return x
  return JSON.stringify(x)
}

async function fetchWithTimeout(url: string, opts: RequestInit, ms: number) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

async function callOcrSpace(apiKey: string, jpegBuffer: Buffer, engine: "1" | "2") {
  const fd = new FormData()
  fd.append("apikey", apiKey)
  fd.append("language", "eng")
  fd.append("OCREngine", engine)
  fd.append("scale", "false")
  fd.append("isTable", "false")
  const jpegUint8 = new Uint8Array(jpegBuffer)
  fd.append("file", new Blob([jpegUint8], { type: "image/jpeg" }), "gt7.jpg")

  const res = await fetchWithTimeout(
    "https://api.ocr.space/parse/image",
    { method: "POST", body: fd },
    60000
  )

  const data = await res.json().catch(() => ({}))
  return { res, data }
}

async function preprocessForOcr(input: Buffer) {
  const img = sharp(input)
  const meta = await img.metadata()

  const w = meta.width ?? 0
  const h = meta.height ?? 0

  if (!w || !h) {
    return await sharp(input)
      .resize({ width: 1000, withoutEnlargement: true })
      .grayscale()
      .jpeg({ quality: 65 })
      .toBuffer()
  }

  const left = Math.round(w * 0.04)
  const right = Math.round(w * 0.04)
  const top = Math.round(h * 0.10)
  const bottom = Math.round(h * 0.12)

  const cropW = Math.max(1, w - left - right)
  const cropH = Math.max(1, h - top - bottom)

  return await sharp(input)
    .extract({ left, top, width: cropW, height: cropH })
    .resize({ width: 1100, withoutEnlargement: true })
    .grayscale()
    .sharpen()
    .jpeg({ quality: 65 })
    .toBuffer()
}

type QualiRow = {
  pos: number
  pilota: string
  auto: string
  tempo: string
  distacco: string
}

function normalizePilot(s: string) {
  return s.replace(/_0I\b/g, "_01")
}

function parseQualificaFromColumnText(rawText: string): QualiRow[] {

  const lines = rawText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)

  const startCandidates = [1, 9]

  let startIndex = -1
  let startNum = 0

  for (const s of startCandidates) {
    const idx = lines.findIndex(l => l === String(s))
    if (idx !== -1) {
      startIndex = idx
      startNum = s
      break
    }
  }

  if (startIndex === -1) return []

  const positions: number[] = []

  let cursor = startIndex
  let expected = startNum

  while (cursor < lines.length) {

    if (lines[cursor] === String(expected)) {
      positions.push(expected)
      expected++
      cursor++
      if (positions.length >= 16) break
      continue
    }

    if (/MIGLIOR\s+GIRO|DISTACCO/i.test(lines[cursor])) break

    cursor++

    if (positions.length > 0 && cursor - startIndex > 60) break
  }

  const lastPos = positions[positions.length - 1]

  const lastPosIdx = lastPos
    ? lines.findIndex((l, i) => i >= startIndex && l === String(lastPos))
    : startIndex

  cursor = lastPosIdx === -1 ? startIndex : lastPosIdx + 1

  const n = positions.length

  if (!n) return []

  const isName = (s: string) => {
    if (/^\d+$/.test(s)) return false
    if (/^\+/.test(s)) return false
    if (s.includes(":")) return false
    if (/GT3|LMS|RSR/i.test(s)) return false
    if (/DISTACCO|MIGLIOR|GRAN|UNION|Dragon|Chiudi|Avanti|Alterna/i.test(s)) return false
    return /^[A-Za-z0-9_\-#]+$/.test(s)
  }

  const names: string[] = []

  while (cursor < lines.length && names.length < n) {
    const s = lines[cursor]
    if (isName(s)) names.push(normalizePilot(s))
    cursor++
  }

  while (names.length < n) names.push("")

  const isCar = (s: string) => {
    if (/GT3|LMS|RSR/i.test(s)) return true
    if (/'\d{2}/.test(s)) return true
    if (/\(\d{3}\)/.test(s)) return true
    return false
  }

  const cars: string[] = []

  while (cursor < lines.length && cars.length < n) {
    const s = lines[cursor]
    if (isCar(s) && !/MIGLIOR|DISTACCO/i.test(s))
      cars.push(
  s
    .replace(/\s+/g, " ")
    .replace(/\)\s*(\d{2})\b/g, ") '$1")
    .trim()
)
    cursor++
  }

  while (cars.length < n) cars.push("")

  const isLapTime = (s: string) => /^\d:\d{2}\.\d{3}$/.test(s)

  const times: string[] = []

  while (cursor < lines.length && times.length < n) {
    if (isLapTime(lines[cursor])) times.push(lines[cursor])
    cursor++
  }

  while (times.length < n) times.push("")

  let gapsRaw: string[] = []

  const idxDistacco = lines.findIndex(l => /DISTACCO/i.test(l))

  if (idxDistacco !== -1) {

    const after = lines.slice(idxDistacco + 1)

    const gapRegex = /^(--\.\-\-\-|--\.\-\-\-|\+\d{2}\s*\.\s*\d{3})$/

    gapsRaw = after
      .filter(l => gapRegex.test(l))
      .map(l => l.replace(/\s+/g, ""))
      .slice(0, n)
  }

  let distacchi: string[] = Array(n).fill("")

  const hasLeaderMarker = gapsRaw.some(g => g.startsWith("--"))

  if (hasLeaderMarker) {

    const onlyPlus = gapsRaw.filter(g => g.startsWith("+"))

    distacchi = [""].concat(onlyPlus).slice(0, n)

    while (distacchi.length < n) distacchi.push("")
  } else {

    distacchi = gapsRaw.slice(0, n)

    while (distacchi.length < n) distacchi.push("")
  }

  const out: QualiRow[] = []

  for (let i = 0; i < n; i++) {

    out.push({
      pos: positions[i],
      pilota: names[i] ?? "",
      auto: cars[i] ?? "",
      tempo: times[i] ?? "",
      distacco: distacchi[i] ?? "",
    })
  }

  return out
}

function toCsv(rows: QualiRow[]) {

  const header = "pos,pilota,auto,tempo,distacco"

  const body = rows
    .map(r => [r.pos, r.pilota, r.auto, r.tempo, r.distacco])
    .map(arr =>
      arr
        .map(v => {
          const s = String(v ?? "").replace(/"/g, '""')
          return s.includes(",") ? `"${s}"` : s
        })
        .join(",")
    )
    .join("\n")

  return header + "\n" + body
}

export async function POST(req: NextRequest) {

  try {

    const formData = await req.formData()

    const files = formData.getAll("files").filter(Boolean) as File[]

    if (!files.length) {
      const single = formData.get("file") as File | null
      if (!single)
        return Response.json({ error: "Nessun file ricevuto" }, { status: 400 })
      files.push(single)
    }

    const apiKey =
      process.env.NEXT_PUBLIC_OCR_API_KEY || process.env.OCR_API_KEY

    if (!apiKey)
      return Response.json(
        { error: "Manca OCR_API_KEY in env" },
        { status: 500 }
      )

    const merged = new Map<number, QualiRow>()

    const debugTexts: string[] = []

    for (const f of files) {

      const input = Buffer.from(await f.arrayBuffer())

      const prepped = await preprocessForOcr(input)

      let { res, data } = await callOcrSpace(apiKey, prepped, "2")

      const err1 = normalizeErrorMessage(data?.ErrorMessage)

      const bad1 = !res.ok || data?.IsErroredOnProcessing

      const e500_1 = err1.includes("E500") || err1.toLowerCase().includes("resource")

      const e101_1 = err1.includes("E101") || err1.toLowerCase().includes("timed")

      if (bad1 && (e500_1 || e101_1)) {

        ;({ res, data } = await callOcrSpace(apiKey, prepped, "2"))

        const err2 = normalizeErrorMessage(data?.ErrorMessage)

        const bad2 = !res.ok || data?.IsErroredOnProcessing

        const e500_2 = err2.includes("E500") || err2.toLowerCase().includes("resource")

        const e101_2 = err2.includes("E101") || err2.toLowerCase().includes("timed")

        if (bad2 && (e500_2 || e101_2)) {

          ;({ res, data } = await callOcrSpace(apiKey, prepped, "1"))
        }
      }

      if (!res.ok || data?.IsErroredOnProcessing) {

        return Response.json(
          {
            error: "OCR.space error",
            httpStatus: res.status,
            ocrStatus: {
              IsErroredOnProcessing: data?.IsErroredOnProcessing,
              ErrorMessage: data?.ErrorMessage,
              ErrorDetails: data?.ErrorDetails,
            },
          },
          { status: 502 }
        )
      }

      const text: string = data?.ParsedResults?.[0]?.ParsedText || ""

      debugTexts.push(text)

      const part = parseQualificaFromColumnText(text)

      for (const r of part) merged.set(r.pos, r)
    }

    const finalRows = Array.from(merged.values())
      .sort((a, b) => a.pos - b.pos)
      .filter(r => r.pos >= 1 && r.pos <= 16 && (r.pilota || r.tempo || r.auto))

    const csv = toCsv(finalRows)

    return Response.json({
      count: finalRows.length,
      rows: finalRows,
      csv,
      debugText: debugTexts.join("\n\n===== NEXT FILE =====\n\n"),
    })

  } catch (err: any) {

    const msg =
      String(err?.name || "") === "AbortError"
        ? "Timeout chiamata OCR.space"
        : "Errore server"

    return Response.json(
      {
        error: msg,
        details: String(err?.stack || err?.message || err),
      },
      { status: 500 }
    )
  }
}