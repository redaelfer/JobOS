import { extname, basename } from 'node:path';
export async function extractResume({ filename, contentBase64 }) {
  const name = basename(String(filename || ''));
  const ext = extname(name).toLowerCase();
  if (!['.pdf', '.docx', '.txt'].includes(ext)) throw new Error('Upload a PDF, DOCX, or TXT CV.');
  if (typeof contentBase64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) throw new Error('Invalid file encoding.');
  const buffer = Buffer.from(contentBase64, 'base64');
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) throw new Error('Choose a CV between 1 byte and 2 MB.');
  let text;
  if (ext === '.txt') text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  if (ext === '.docx') {
    if (buffer.subarray(0, 2).toString() !== 'PK') throw new Error('This is not a valid DOCX file.');
    const mammoth = await import('mammoth');
    text = (await mammoth.default.extractRawText({ buffer })).value;
  }
  if (ext === '.pdf') {
    if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('This is not a valid PDF file.');
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false });
    try { text = (await parser.getText()).text; } finally { await parser.destroy(); }
  }
  text = String(text || '').replace(/\u0000/g, '').trim();
  if (text.length < 40) throw new Error('Not enough readable text. For scanned PDFs, paste your CV text instead.');
  if (text.length > 50000) throw new Error('This document is too long for a CV. Use a shorter file or paste the relevant text.');
  return { filename: name.slice(0, 200), text };
}
