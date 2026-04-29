"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { downloadJson } from "@/lib/download";
import type { DocumentType, OcrDocument } from "@/lib/types";

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

type ClassifiedFile = {
  file: File;
  documentType: DocumentType | null;
  error: string | null;
};

type WorkerMessage =
  | { type: "status"; message: string; error?: string | null }
  | { type: "document"; document: OcrDocument }
  | { type: "complete"; documents: OcrDocument[]; message: string }
  | { type: "error"; message: string; error: string; documents: OcrDocument[] };

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
  const workerRef = useRef<Worker | null>(null);

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
    if (!state.busy) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [state.busy]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
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
      message: "Starting background conversion worker...",
      error: null,
      documents: []
    });

    const worker = new Worker(new URL("./converter-worker.ts", import.meta.url), {
      type: "module"
    });
    workerRef.current?.terminate();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;

      if (message.type === "status") {
        setState((current) => ({
          ...current,
          message: message.message,
          error: message.error === undefined ? current.error : message.error
        }));
        return;
      }

      if (message.type === "document") {
        setState((current) => ({
          ...current,
          documents: [...current.documents, message.document]
        }));
        return;
      }

      if (message.type === "complete") {
        worker.terminate();
        workerRef.current = null;
        setState({
          busy: false,
          message: importConfig
            ? "Import complete. You can close this tab and return to the search app."
            : message.message,
          error: null,
          documents: message.documents
        });
        return;
      }

      worker.terminate();
      workerRef.current = null;
      setState({
        busy: false,
        message: message.message,
        error: message.error,
        documents: message.documents
      });
    };

    worker.onerror = (event) => {
      worker.terminate();
      workerRef.current = null;
      setState((current) => ({
        ...current,
        busy: false,
        message: "Processing stopped.",
        error: event.message || "Background conversion worker failed."
      }));
    };

    worker.postMessage({
      type: "start",
      files: selectedFiles,
      classifiedFiles: classifiedFiles.map((item) => ({
        documentType: item.documentType
      })),
      importConfig
    });
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
              <input type="file" accept="application/pdf" multiple onChange={onFileChange} disabled={state.busy} />
              <span className="hint">Select one or more PDF files. Each file uploads as soon as its JSON is ready.</span>
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
              {importConfig?.returnUrl && !state.busy && !state.error && state.message.startsWith("Import complete") ? (
                <div style={{ marginTop: 12 }}>
                  <a className="button button-primary" href={importConfig.returnUrl}>
                    Return to search app
                  </a>
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
