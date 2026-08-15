import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/public/pdfcheck')({
  server: {
    handlers: {
      GET: async () => {
        const { PDFDocument, StandardFonts } = await import('pdf-lib/dist/pdf-lib.esm.js')
        const doc = await PDFDocument.create()
        const page = doc.addPage()
        const font = await doc.embedFont(StandardFonts.Helvetica)
        page.drawText('ok', { font, size: 12 })
        const bytes = await doc.save()
        return new Response(JSON.stringify({ bytes: bytes.length }), { headers: { 'content-type': 'application/json' } })
      },
    },
  },
})
