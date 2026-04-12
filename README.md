# PDF to JSON OCR App

This project is the hosted converter app for the A Level Search tool.

It converts uploaded PDF documents into OCR JSON with the same core shape as the local search app's OCR files, and it can post the original PDF plus generated JSON back to the local Flask search app through the `Add Paper` workflow.

When the converter is opened from the local search app, the local app passes an `import_url`, `import_token`, and `return_url` in the page URL. After conversion, this app uploads the PDF and JSON back to that `import_url`, and the local Flask app saves them into the correct folders based on `document_type`.

## Supported filename formats

- Exam paper: `N2020_P1_H2 Chem.pdf`
- Examiner report: `N2021_ER_H2 Chem.pdf`

These names are used to route uploads to the correct local folders:

- exam papers -> `Papers/` and `Papers_JSON/`
- examiner reports -> `Examiner Report/` and `Examiner Report_JSON/`

The subject text should match between a paper and its examiner report so the search app can open the related report from a search result.

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
- The app is protected by Supabase authentication.
- Only users signing in with an email ending in `@ri.edu.sg` are allowed through the hosted converter flow.
- Users receive a 6-digit PIN by email and enter it in the hosted login screen.

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
- The Supabase email template must send `{{ .Token }}` if you want users to receive a 6-digit PIN instead of a magic link.
