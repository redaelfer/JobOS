import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { extractResume } from '../lib/resume.js';
const text = 'Synthetic CV: React and TypeScript engineer with three years of experience building accessible web applications.';
test('TXT CVs extract Unicode text and reject empty, excessive, unsupported and malformed files', async () => {
  assert.equal((await extractResume({ filename: 'cv.txt', contentBase64: Buffer.from(text).toString('base64') })).text, text);
  for (const input of [{ filename: 'cv.exe', contentBase64: 'QQ==' }, { filename: 'cv.txt', contentBase64: 'QQ==' }, { filename: 'cv.txt', contentBase64: '?' }, { filename: 'cv.pdf', contentBase64: Buffer.from(text).toString('base64') }, { filename: 'cv.docx', contentBase64: Buffer.from(text).toString('base64') }, { filename: 'cv.txt', contentBase64: Buffer.alloc(2100000).toString('base64') }]) await assert.rejects(extractResume(input));
});
test('DOCX CV extracts text without rendering embedded HTML', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  const result = await extractResume({ filename: 'cv.docx', contentBase64: (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64') });
  assert.ok(result.text.includes(text));
});
test('PDF CV extracts text from a genuine one-page PDF fixture', async () => {
  const content = `BT /F1 12 Tf 40 700 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let pdf = '%PDF-1.4\n', offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const result = await extractResume({ filename: 'cv.pdf', contentBase64: Buffer.from(pdf).toString('base64') });
  assert.ok(result.text.includes('React and TypeScript engineer'));
});
