import { createWorker } from "tesseract.js";
import type { DocumentType, OcrDocument, OcrPage, OcrWord } from "@/lib/types";

const PDFJS_VERSION = "5.6.205";

type ImportConfig = {
  importUrl: string;
  importToken: string;
  returnUrl: string;
};

type StartMessage = {
  type: "start";
  files: File[];
  classifiedFiles: Array<{
    documentType: DocumentType | null;
  }>;
  importConfig: ImportConfig | null;
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

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<StartMessage>) => void) | null;
  postMessage(message: unknown): void;
};

workerScope.onmessage = async (event: MessageEvent<StartMessage>) => {
  if (event.data.type !== "start") {
    return;
  }

  const { files, classifiedFiles, importConfig } = event.data;
  const documents: OcrDocument[] = [];
  let worker: TesseractWorker | null = null;

  try {
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("Background conversion requires a browser with OffscreenCanvas support.");
    }

    postStatus("Loading PDFs and starting OCR worker...");

    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

    worker = await createWorker("eng");

    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const selectedFile = files[fileIndex];
      const classifiedFile = classifiedFiles[fileIndex];
      const document = await convertPdf(
        selectedFile,
        classifiedFile?.documentType ?? "paper",
        fileIndex + 1,
        files.length,
        worker,
        pdfjs
      );

      documents.push(document);
      workerScope.postMessage({ type: "document", document });

      if (importConfig) {
        await importDocument(document, selectedFile, importConfig, fileIndex + 1, files.length);
      }
    }

    workerScope.postMessage({
      type: "complete",
      documents,
      message: importConfig
        ? "Import complete. Returning to the search app..."
        : `Finished ${documents.length} PDF file(s).`
    });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      message: importConfig ? "Automatic import failed." : "Processing stopped.",
      error: error instanceof Error ? error.message : "Unknown error.",
      documents
    });
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
};

async function convertPdf(
  selectedFile: File,
  documentType: DocumentType,
  fileNumber: number,
  totalFiles: number,
  worker: TesseractWorker,
  pdfjs: typeof import("pdfjs-dist")
): Promise<OcrDocument> {
  const buffer = await selectedFile.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  const pages: OcrPage[] = [];

  try {
    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      postStatus(
        `Processing ${selectedFile.name} (${fileNumber}/${totalFiles}), page ${pageIndex} of ${pdf.numPages}...`
      );

      const page = await pdf.getPage(pageIndex);
      const viewport = page.getViewport({ scale: 2 });
      const textContent = await page.getTextContent();
      const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Canvas rendering is not available in this browser.");
      }

      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context,
        viewport
      } as unknown as Parameters<typeof page.render>[0]).promise;

      const pdfTextItems = textContent.items as PdfTextItem[];
      const pdfText = buildPdfText(pdfTextItems);
      const pdfWords = extractPdfWords(pdfTextItems, viewport.height);
      const shouldUsePdfText = isUsablePdfText(pdfText, pdfWords);

      let words = pdfWords;
      let text = pdfText;
      let extractionMethod: OcrPage["extraction_method"] = "pdf_text";

      if (!shouldUsePdfText) {
        postStatus(
          `Running OCR on ${selectedFile.name} (${fileNumber}/${totalFiles}), page ${pageIndex} of ${pdf.numPages}...`
        );

        const result = await worker.recognize(
          canvas as unknown as HTMLCanvasElement,
          {},
          { blocks: true }
        );
        words = extractWords(result.data.blocks as TesseractBlock[] | null | undefined).map(mapWord);
        const rawText = result.data.text.trim();
        text = rawText
          ? await refinePageText(rawText, pageIndex, pdf.numPages, selectedFile.name, fileNumber, totalFiles)
          : rawText;
        extractionMethod = "ocr";
      } else if (pdfWords.length === 0) {
        postStatus(
          `Running OCR word-box fallback on ${selectedFile.name} (${fileNumber}/${totalFiles}), page ${pageIndex} of ${pdf.numPages}...`
        );

        const result = await worker.recognize(
          canvas as unknown as HTMLCanvasElement,
          {},
          { blocks: true }
        );
        words = extractWords(result.data.blocks as TesseractBlock[] | null | undefined).map(mapWord);
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
  } finally {
    await loadingTask.destroy();
  }

  return {
    document_type: documentType,
    source_pdf: selectedFile.name,
    generated_at: new Date().toISOString(),
    pages
  };
}

async function importDocument(
  document: OcrDocument,
  pdfFile: File,
  importConfig: ImportConfig,
  fileNumber: number,
  totalFiles: number
) {
  postStatus(`Uploading ${document.source_pdf} (${fileNumber}/${totalFiles}) to the search app...`);

  const payload = new FormData();
  payload.append("import_token", importConfig.importToken);
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

  const response = await fetch(importConfig.importUrl, {
    method: "POST",
    headers: {
      "X-Import-Token": importConfig.importToken
    },
    body: payload
  });

  const result = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(result.error ?? `Import failed for ${document.source_pdf}.`);
  }

  postStatus(`Imported ${fileNumber} of ${totalFiles}: ${document.source_pdf}`);
}

async function readJsonResponse(response: Response): Promise<{ error?: string }> {
  try {
    return (await response.json()) as { error?: string };
  } catch {
    return {};
  }
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

async function refinePageText(
  rawText: string,
  pageNumber: number,
  totalPages: number,
  filename: string,
  fileNumber: number,
  totalFiles: number
) {
  postStatus(
    `Refining OCR text with Gemini for ${filename} (${fileNumber}/${totalFiles}), page ${pageNumber} of ${totalPages}...`
  );

  try {
    return await refineText(rawText, pageNumber);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini refinement failed.";
    postStatus(
      `Gemini refinement failed on ${filename}, page ${pageNumber}. Using raw OCR text instead.`,
      message
    );
    return rawText;
  }
}

function postStatus(message: string, error?: string | null) {
  workerScope.postMessage({
    type: "status",
    message,
    error
  });
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
