/// <reference lib="webworker" />
import { PaddleOCR } from '@paddleocr/paddleocr-js'
import cvModule from '@techstark/opencv-js'
import type { OcrResult } from './domain'

const ctx = self as unknown as DedicatedWorkerGlobalScope
let engine: ReturnType<typeof PaddleOCR.create> | null = null

ctx.onmessage = async ({ data }) => {
  let bitmap: ImageBitmap | null = null
  let matrix: { delete(): void } | null = null
  try {
    if (!engine) {
      ctx.postMessage({ id: data.id, progress: 'Φόρτωση ελληνικού μοντέλου (μόνο την πρώτη φορά)…' })
      const base = new URL(`${import.meta.env.BASE_URL}capture/`, self.location.origin).href
      engine = PaddleOCR.create({
        worker: false, // This module already runs in a dedicated worker.
        textDetectionModelName: 'PP-OCRv5_mobile_det',
        textRecognitionModelName: 'el_PP-OCRv5_mobile_rec',
        textDetectionModelAsset: { url: base + 'detection.tar' },
        textRecognitionModelAsset: { url: base + 'greek.tar' },
        ortOptions: { backend: 'wasm', numThreads: 1, simd: true, wasmPaths: base },
        textRecognitionBatchSize: 1,
      })
    }
    const ocr = await engine
    if (data.kind === 'warm') { ctx.postMessage({ id: data.id, ready: true }); return }
    if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') {
      throw new Error('Η συσκευή δεν υποστηρίζει το ελληνικό OCR σε worker. Επίλεξε το εναλλακτικό Tesseract.')
    }
    ctx.postMessage({ id: data.id, progress: 'Αναγνώριση κειμένου…' })
    const started = performance.now()
    bitmap = await createImageBitmap(data.blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Δεν ήταν δυνατή η επεξεργασία της εικόνας.')
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height)
    // PaddleOCR's public pipeline supports OpenCV Mat input. Passing a Mat avoids
    // its DOM-only Blob adapter; all conversion and inference stay in this worker.
    const cv = cvModule instanceof Promise ? await cvModule : cvModule
    matrix = cv.matFromArray(pixels.height, pixels.width, cv.CV_8UC4, pixels.data)
    const [r] = await ocr.predict(matrix, {
      textDetLimitSideLen: data.document ? 1600 : 960,
      textDetLimitType: 'max', textRecScoreThresh: 0,
    })
    const result: OcrResult = {
      engine: 'PaddleOCR.js 0.4.2 / el_PP-OCRv5_mobile_rec',
      width: r.image.width, height: r.image.height, elapsedMs: performance.now() - started,
      lines: r.items.map(line => {
        const xs = line.poly.map(p => p[0]), ys = line.poly.map(p => p[1])
        return { text: line.text, score: Number.isFinite(line.score) ? line.score : null,
          box: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } }
      }),
    }
    ctx.postMessage({ id: data.id, result })
  } catch (error) {
    ctx.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'OCR failed' })
    void engine?.then(instance => instance.dispose()).catch(() => {})
    engine = null
  } finally {
    matrix?.delete()
    bitmap?.close()
  }
}
