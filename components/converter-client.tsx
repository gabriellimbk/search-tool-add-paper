"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { createWorker } from "tesseract.js";
import { downloadJson } from "@/lib/download";
import type { DocumentType, OcrDocument, OcrPage, OcrWord } from "@/lib/types";

const PDFJS_VERSION = "5.6.205";

type ProcessState = {
  busy: boolean;
  message: string;
  error: string | null;
  documents: OcrDocument[];
};

type ImportConfig = {
  importUrl: string;
  importToken: string;
  returnUrl: string;
};

type ImportTokenResponse = {
  ok?: boolean;
  import_url?: string;
  import_token?: string;
  return_url?: string;
  error?: string;
};

type ClassifiedFile = {
  file: File;
  documentType: DocumentType | null;
  error: string | null;
};

type TesseractWord = {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
};

type TesseractBlock = {
  paragraphs: Array<{
    lines: Array<{
      words: TesseractWord[];
    }>;
  }>;
};

type PdfTextItem = {
  str: string;
  width: number;
  height: number;
  transform: number[];
  hasEOL?: boolean;
};

class ImportUploadError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ImportUploadError";
    this.status = status;
  }
}

const initialState: ProcessState = {
  busy: false,
  message: "Upload a PDF to begin.",
  error: null,
  documents: []
};

export default function ConverterClient({ userEmail }: { userEmail: string }) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [state, setState] = useState<ProcessState>(initialState);
  const [importConfig, setImportConfig] = useState<ImportConfig | null>(null);
  const [tabHidden, setTabHidden] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const importUrl = params.get("import_url")?.trim() ?? "";
    const importToken = params.get("import_token")?.trim() ?? "";
    const returnUrl = params.get("return_url")?.trim() ?? "";

    if (importUrl && importToken) {
      setImportConfig({
        importUrl,
        importToken,
        returnUrl
      });
    }
  }, []);

  useEffect(() => {
    const handler = () => setTabHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  const importTargetLabel = importConfig ? formatImportTarget(importConfig.importUrl) : null;

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const classifiedFiles = files.map(classifyFile);
    const invalidFiles = classifiedFiles.filter((item) => item.error);
    setSelectedFiles(files);
    setState((current) => ({
      ...current,
      message: files.length
        ? invalidFiles.length
          ? "Rename the invalid files before converting."
          : `Ready to process ${files.length} PDF file(s).`
        : "Upload a PDF to begin.",
      error: invalidFiles.length ? invalidFiles.map((item) => item.error).join(" ") : null,
      documents: []
    }));
  }

  async function refineText(rawText: string, pageNumber: number) {
    const response = await fetch("/api/refine", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ rawText, pageNumber })
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      throw new Error(payload.error ?? "Gemini refinement failed.");
    }

    const payload = (await response.json()) as { text: string };
    return payload.text;
  }

  async function processPdf() {
    if (selectedFiles.length === 0) {
      setState((current) => ({
        ...current,
        error: "Choose at least one PDF before running extraction."
      }));
      return;
    }

    const classifiedFiles = selectedFiles.map(classifyFile);
    const invalidFiles = classifiedFiles.filter((item) => item.error);
    if (invalidFiles.length) {
      setState((current) => ({
        ...current,
        error: invalidFiles.map((item) => item.error).join(" "),
        message: "Processing stopped. Fix the filenames first."
      }));
      return;
    }

    setState({
      busy: true,
      message: "Loading PDFs and starting OCR worker...",
      error: null,
      documents: []
    });

    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;

    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc =
        `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

      worker = await createWorker("eng");
      const documents: OcrDocument[] = [];

      for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex += 1) {
        const selectedFile = selectedFiles[fileIndex];
        const classifiedFile = classifiedFiles[fileIndex];
        const buffer = await selectedFile.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data: buffer });
        const pdf = await loadingTask.promise;
        const pages: OcrPage[] = [];

        for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
          setState((current) => ({
            ...current,
            message: `Processing ${selectedFile.name} (${fileIndex + 1}/${selectedFiles.length}), page ${pageIndex} of ${pdf.numPages}...`
          }));

          const page = await pdf.getPage(pageIndex);
          const viewport = page.getViewport({ scale: 2 });
          const textContent = await page.getTextContent();
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          if (!context) {
            throw new Error("Canvas rendering is not available in this browser.");
          }

          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);

          await page.render({
            canvas,
            canvasContext: context,
            viewport
          }).promise;

          const pdfTextItems = textContent.items as PdfTextItem[];
          const pdfText = buildPdfText(pdfTextItems);
          const pdfWords = extractPdfWords(pdfTextItems, viewport.height);
          const shouldUsePdfText = isUsablePdfText(pdfText, pdfWords);

          let words = pdfWords;
          let text = pdfText;
          let extractionMethod: OcrPage["extraction_method"] = "pdf_text";

          if (!shouldUsePdfText) {
            setState((current) => ({
              ...current,
              message: `Running OCR on ${selectedFile.name} (${fileIndex + 1}/${selectedFiles.length}), page ${pageIndex} of ${pdf.numPages}...`
            }));

            const result = await worker.recognize(canvas, {}, { blocks: true });
            words = extractWords(result.data.blocks).map(mapWord);
            const rawText = result.data.text.trim();
            text = rawText
              ? await refinePageText(
                  rawText,
                  pageIndex,
                  pdf.numPages,
                  selectedFile.name,
                  fileIndex + 1,
                  selectedFiles.length
                )
              : rawText;
            extractionMethod = "ocr";
          } else if (pdfWords.length === 0) {
            setState((current) => ({
              ...current,
              message: `Running OCR word-box fallback on ${selectedFile.name} (${fileIndex + 1}/${selectedFiles.length}), page ${pageIndex} of ${pdf.numPages}...`
            }));

            const result = await worker.recognize(canvas, {}, { blocks: true });
            words = extractWords(result.data.blocks).map(mapWord);
            extractionMethod = "pdf_text_with_ocr_words";
          }

          pages.push({
            page_number: pageIndex,
            text,
            search_text: normalizeSearchText(text),
            extraction_method: extractionMethod,
            words,
            image_size: {
              width: canvas.width,
              height: canvas.height
            }
          });
        }

        const newDocument: OcrDocument = {
          document_type: classifiedFile.documentType ?? "paper",
          source_pdf: selectedFile.name,
          generated_at: new Date().toISOString(),
          pages
        };
        documents.push(newDocument);

        setState((current) => ({
          ...current,
          documents: [...current.documents, newDocument]
        }));

        if (importConfig) {
          await importSingleDocument(newDocument, selectedFile, fileIndex);
        }
      }

      if (importConfig) {
        setState((current) => ({
          ...current,
          busy: false,
          message: "Import complete. Returning to the search app...",
          error: null
        }));
        if (importConfig.returnUrl) {
          window.setTimeout(() => {
            window.location.href = importConfig.returnUrl;
          }, 1200);
        }
      } else {
        setState((current) => ({
          ...current,
          busy: false,
          message: `Finished ${documents.length} PDF file(s).`
        }));
      }
    } catch (error) {
      setState((current) => ({
        ...current,
        busy: false,
        message: "Processing stopped.",
        error: error instanceof Error ? error.message : "Unknown error."
      }));
    } finally {
      if (worker) {
        await worker.terminate();
      }
    }
  }

  async function importSingleDocument(document: OcrDocument, pdfFile: File, index: number) {
    const currentConfig = importConfig;
    if (!currentConfig) {
      throw new Error("Local import target is not configured.");
    }

    setState((current) => ({
      ...current,
      message: `Preparing upload ${index + 1} of ${selectedFiles.length}: ${document.source_pdf}...`
    }));

    const uploadConfig = await refreshImportConfig(currentConfig, false);

    try {
      await postImportedDocument(document, pdfFile, index, uploadConfig);
    } catch (error) {
      if (!isExpiredImportTokenError(error)) {
        throw error;
      }

      setState((current) => ({
        ...current,
        message: `Import token expired while uploading ${document.source_pdf}. Requesting a fresh token...`
      }));

      const retryConfig = await refreshImportConfig(uploadConfig, true);
      await postImportedDocument(document, pdfFile, index, retryConfig);
    }

    setState((current) => ({
      ...current,
      message: `Uploaded ${index + 1} of ${selectedFiles.length}: ${document.source_pdf}`
    }));
  }

  async function refreshImportConfig(currentConfig: ImportConfig, required: boolean) {
    try {
      const response = await fetch(buildImportTokenUrl(currentConfig.importUrl), {
        method: "GET",
        cache: "no-store"
      });

      const payload = (await response.json()) as ImportTokenResponse;
      if (!response.ok || !payload.import_token?.trim()) {
        throw new Error(payload.error ?? "Local search app did not return a fresh import token.");
      }

      const nextConfig = {
        importUrl: payload.import_url?.trim() || currentConfig.importUrl,
        importToken: payload.import_token.trim(),
        returnUrl: payload.return_url?.trim() ?? currentConfig.returnUrl
      };
      setImportConfig(nextConfig);
      return nextConfig;
    } catch (error) {
      if (!required) {
        return currentConfig;
      }

      const message = error instanceof Error ? error.message : "Unknown error.";
      throw new Error(`Could not refresh the local import token: ${message}`);
    }
  }

  async function postImportedDocument(
    document: OcrDocument,
    pdfFile: File,
    index: number,
    config: ImportConfig
  ) {
    setState((current) => ({
      ...current,
      message: `Uploading paper ${index + 1} of ${selectedFiles.length}: ${document.source_pdf}...`
    }));

    const payload = new FormData();
    payload.append("import_token", config.importToken);
    payload.append("document_type", document.document_type);
    payload.append("pdf", pdfFile, pdfFile.name);
    payload.append(
      "json",
      new File(
        [JSON.stringify(document, null, 2)],
        document.source_pdf.replace(/\.pdf$/i, ".json"),
        { type: "application/json" }
      )
    );

    const response = await fetch(config.importUrl, {
      method: "POST",
      headers: {
        "X-Import-Token": config.importToken
      },
      body: payload
    });

    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new ImportUploadError(
        result.error ?? `Import failed for ${document.source_pdf}.`,
        response.status
      );
    }
  }

  async function refinePageText(
    rawText: string,
    pageNumber: number,
    totalPages: number,
    filename: string,
    fileNumber: number,
    totalFiles: number
  ) {
    setState((current) => ({
      ...current,
      message: `Refining OCR text with Gemini for ${filename} (${fileNumber}/${totalFiles}), page ${pageNumber} of ${totalPages}...`
    }));

    try {
      return await refineText(rawText, pageNumber);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gemini refinement failed.";
      setState((current) => ({
        ...current,
        message: `Gemini refinement failed on ${filename}, page ${pageNumber}. Using raw OCR text instead.`,
        error: message
      }));
      return rawText;
    }
  }

  function exportJson() {
    if (state.documents.length === 0) {
      return;
    }

    for (const document of state.documents) {
      const baseName = document.source_pdf.replace(/\.pdf$/i, "");
      downloadJson(`${baseName}.json`, document);
    }
  }

  return (
    <main className="page-shell">
      <section className="single-column">
        <aside className="panel controls">
          <div className="auth-bar">
            <div>
              Signed in as <strong>{userEmail}</strong>
            </div>
            <form action="/auth/signout" method="post">
              <button className="button button-secondary" type="submit">
                Sign Out
              </button>
            </form>
          </div>

          <div className="section">
            <h1>Add Paper</h1>
            <ul className="requirements-list">
              <li>All uploads must be <strong>PDF</strong> files</li>
              <li>Name your files in the correct format shown below before uploading</li>
              <li>Test the uploading of just 1 PDF file before you proceed to upload multiple PDF files</li>
            </ul>
          </div>

          <div className="section">
            <h2>Filename Format Examples</h2>
            <div className="format-grid">
              <div className="format-group">
                <div className="format-label">Examination Papers</div>
                <div className="format-examples">
                  <code>N2020_P1_H2 Chem.pdf</code>
                  <code>RI2020_P1_H2 Chem.pdf</code>
                  <code>SP_P1_H2_Chem.pdf</code>
                </div>
              </div>
              <div className="format-group">
                <div className="format-label">Examiner Reports</div>
                <div className="format-examples">
                  <code>N2021_ER_H2 Chem.pdf</code>
                </div>
              </div>
            </div>
          </div>

          <div className="section">
            <h2>Upload</h2>
            <label className="dropzone">
              <strong>
                {selectedFiles.length ? `${selectedFiles.length} file(s) selected` : "No file selected"}
              </strong>
              <input type="file" accept="application/pdf" multiple onChange={onFileChange} />
              <span className="hint">Select one or more PDF files. They will be converted one after another.</span>
            </label>
          </div>

          {selectedFiles.length ? (
            <div className="section">
              <h2>Detected File Types</h2>
              <div className="status-box">
                {selectedFiles.map((file) => {
                  const classified = classifyFile(file);
                  return (
                    <div key={file.name} style={{ marginBottom: 8 }}>
                      <strong>{file.name}</strong>:{" "}
                      {classified.documentType === "paper"
                        ? "Exam paper"
                        : classified.documentType === "examiner_report"
                          ? "Examiner report"
                          : "Invalid filename"}
                      {classified.error ? (
                        <div className="status-error" style={{ marginTop: 4 }}>
                          {classified.error}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="section">
            <h2>Run</h2>
            <div className="actions">
              <button
                className="button button-primary"
                onClick={processPdf}
                disabled={state.busy || selectedFiles.length === 0}
              >
                {state.busy ? "Processing..." : "Convert PDF"}
              </button>
              <button
                className="button button-secondary"
                onClick={exportJson}
                disabled={state.documents.length === 0 || state.busy || Boolean(importConfig)}
              >
                {importConfig ? "Auto Import Enabled" : "Download JSON"}
              </button>
            </div>
          </div>

          <div className="section">
            <h2>Status</h2>
            <div className="status-box">
              <div>{state.message}</div>
              {importConfig ? (
                <div style={{ marginTop: 8 }}>
                  Auto upload enabled. Target: <code>{importTargetLabel}</code>
                </div>
              ) : (
                <div style={{ marginTop: 8 }}>No local import target detected. Use Download JSON instead.</div>
              )}
              {tabHidden && state.busy ? (
                <div style={{ marginTop: 8, color: "#92400e", background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 4, padding: "6px 10px" }}>
                  Processing may be slower while this tab is in the background. Keep this tab active for best performance.
                </div>
              ) : null}
              {state.error ? (
                <div className="status-error" style={{ marginTop: 8 }}>
                  {state.error}
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

function normalizeStem(filename: string) {
  return filename
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatImportTarget(importUrl: string) {
  try {
    const parsed = new URL(importUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return importUrl;
  }
}

function buildImportTokenUrl(importUrl: string) {
  const parsed = new URL(importUrl);
  parsed.pathname = "/api/import-token";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function isExpiredImportTokenError(error: unknown) {
  return (
    error instanceof ImportUploadError &&
    error.status === 401 &&
    /token expired/i.test(error.message)
  );
}

function classifyFile(file: File): ClassifiedFile {
  const normalized = normalizeStem(file.name);

  if (/^(?:[A-Za-z]{0,4}\d{4}|SP)\s+ER\s+.+$/i.test(normalized)) {
    return {
      file,
      documentType: "examiner_report",
      error: null
    };
  }

  if (/^(?:[A-Za-z]{0,4}\d{4}|SP)\s+P\d\s+.+$/i.test(normalized)) {
    return {
      file,
      documentType: "paper",
      error: null
    };
  }

  return {
    file,
    documentType: null,
    error:
      `${file.name} is not in a supported format. Use names like N2020_P1_H2 Chem.pdf or N2021_ER_H2 Chem.pdf.`
  };
}

function mapWord(word: TesseractWord): OcrWord {
  return {
    text: word.text,
    left: Math.round(word.bbox.x0),
    top: Math.round(word.bbox.y0),
    width: Math.round(word.bbox.x1 - word.bbox.x0),
    height: Math.round(word.bbox.y1 - word.bbox.y0),
    confidence: Number(word.confidence.toFixed(2))
  };
}

function extractWords(blocks: TesseractBlock[] | null | undefined) {
  if (!blocks) {
    return [];
  }

  return blocks.flatMap((block) =>
    block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words))
  );
}

function buildPdfText(items: PdfTextItem[]) {
  let output = "";

  for (const item of items) {
    const chunk = item.str?.trim();
    if (!chunk) {
      if (item.hasEOL && !output.endsWith("\n")) {
        output += "\n";
      }
      continue;
    }

    const needsSpace =
      output.length > 0 &&
      !output.endsWith(" ") &&
      !output.endsWith("\n") &&
      !/^[,.;:!?)}\]]/.test(chunk);

    output += `${needsSpace ? " " : ""}${chunk}`;

    if (item.hasEOL && !output.endsWith("\n")) {
      output += "\n";
    }
  }

  return output.trim();
}

function extractPdfWords(items: PdfTextItem[], pageHeight: number): OcrWord[] {
  return items
    .filter((item) => item.str?.trim())
    .map((item) => {
      const [a, , , d, e, f] = item.transform;
      const left = Math.round(e);
      const height = Math.max(Math.round(Math.abs(d || item.height || 0)), 1);
      const width = Math.max(Math.round(item.width || Math.abs(a) || 0), 1);
      const top = Math.max(Math.round(pageHeight - f - height), 0);

      return {
        text: item.str.trim(),
        left,
        top,
        width,
        height,
        confidence: 99
      };
    });
}

function isUsablePdfText(text: string, words: OcrWord[]) {
  const normalized = normalizeSearchText(text);
  return normalized.length >= 120 && words.length >= 40;
}

function normalizeSearchText(text: string) {
  return text
    .toLowerCase()
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}
