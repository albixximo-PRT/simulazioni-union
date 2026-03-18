"use client"

import { useState } from "react"

export default function Page() {
  const [files, setFiles] = useState<File[]>([])
  const [csv, setCsv] = useState("")
  const [text, setText] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")
    setCsv("")
    setText("")

    try {
      const fd = new FormData()
      for (const f of files) fd.append("files", f)

      const res = await fetch("/api/race", { method: "POST", body: fd })
      const data = await res.json()

      if (!res.ok) {
        setError(JSON.stringify(data, null, 2))
      } else {
        setCsv(data.csv || "")
        setText(data.debugText || "")
      }
    } catch (err: any) {
      setError(String(err?.message || err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <h2>OCR Gara (2 screenshot: P1–P8 + P9–P16 / P9–N)</h2>

      <form onSubmit={onSubmit}>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
        />
        <button disabled={loading || files.length === 0} style={{ marginLeft: 8 }}>
          {loading ? "Elaborazione..." : "Invia"}
        </button>
      </form>

      {error && (
        <pre style={{ marginTop: 12, whiteSpace: "pre-wrap", color: "crimson" }}>
          {error}
        </pre>
      )}

      {csv && (
        <>
          <h3>CSV Gara</h3>
          <textarea value={csv} readOnly rows={12} style={{ width: "100%" }} />
        </>
      )}

      {text && (
        <>
          <h3>Debug grezzo</h3>
          <textarea value={text} readOnly rows={16} style={{ width: "100%" }} />
        </>
      )}
    </div>
  )
}