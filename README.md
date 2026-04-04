# PDF to JSON OCR App

This project is a web app that converts uploaded PDF documents into OCR JSON with the same core shape as the reference file in `OCR/2014 Paper 1.json`.

## Output shape

The generated JSON contains:

- `source_pdf`
- `generated_at`
- `pages[]`
- `pages[n].page_number`
- `pages[n].text`
- `pages[n].words[]`
- `pages[n].image_size`

Each OCR word includes `text`, `left`, `top`, `width`, `height`, and `confidence`.

## How it works

- The browser renders each PDF page with `pdfjs-dist`.
- OCR runs in the browser with `tesseract.js`, so no local Tesseract install is required.
- If `GEMINI_API_KEY` is configured, the app can send each page's raw OCR text to Gemini for cleanup.

## Local setup

```bash
npm install
copy .env.example .env.local
```

Set these values in `.env.local`:

- `GEMINI_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Then run:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Notes

- OCR is CPU-intensive, especially for long PDFs.
- Gemini cleanup is optional. If the API key is missing or a Gemini call fails, the app falls back to raw OCR text.
- Word coordinates come from `tesseract.js` OCR output.
- Supabase authentication is required before the converter page can be used.
