import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

export async function filesToImageDataUrls(files: File[]): Promise<string[]> {
  const results: string[] = []
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      results.push(await readAsDataUrl(file))
    } else if (file.type === 'application/pdf') {
      const pages = await pdfToImages(file)
      results.push(...pages)
    }
  }
  return results
}

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.readAsDataURL(file)
  })
}

async function pdfToImages(file: File, maxPages = 10): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const numPages = Math.min(pdf.numPages, maxPages)
  const images: string[] = []
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2.0 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    images.push(canvas.toDataURL('image/jpeg', 0.85))
    canvas.remove()
  }
  return images
}
