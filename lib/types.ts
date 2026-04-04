export type OcrWord = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
};

export type OcrPage = {
  page_number: number;
  text: string;
  search_text?: string;
  extraction_method?: "pdf_text" | "ocr" | "pdf_text_with_ocr_words";
  words: OcrWord[];
  image_size: {
    width: number;
    height: number;
  };
};

export type OcrDocument = {
  source_pdf: string;
  generated_at: string;
  pages: OcrPage[];
};
