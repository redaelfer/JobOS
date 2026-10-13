import test from 'node:test';
import assert from 'node:assert/strict';
import { latexTextSlots, applyLatexTextEdits } from '../lib/latex-template.js';
import { validateTailoring, tailoringPrompt } from '../lib/tailoring.js';
const template = String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[french]{babel}
\usepackage[margin=0.6cm]{geometry}
\definecolor{maincolor}{RGB}{0,128,128}
\newcommand{\cvitem}[4]{\textbf{#1}\hfill\textit{#2}\\\textit{#3}\hfill #4}
\begin{document}
% Preserve this comment and the layout.
\begin{center}{\huge\bfseries\color{maincolor} Synthetic Person}\vspace{0.25cm}\end{center}
\begin{minipage}{0.95\textwidth}Profile sentence for a junior engineer.\end{minipage}
\section{Experience}
\cvitem{Engineer}{2023 -- 2026}{Software engineering}{Rabat}
\href{https://example.com/cv}{Professional profile}
\begin{itemize}[leftmargin=0.4cm,itemsep=0.02cm,label=\textbullet]
\item Built a reliable service with \textbf{23\%} improvement.
\end{itemize}
\begin{tabularx}{\textwidth}{@{}l X l l@{}}
\textbf{Languages} & Python, SQL & English & B2 \\[0.25em]
\end{tabularx}
\end{document}
`;
test('CV text changes preserve every byte outside the selected text positions', () => {
  const slots = latexTextSlots(template), slot = slots.find(item => item.text === 'Profile sentence for a junior engineer.');
  assert.ok(slot); const edited = applyLatexTextEdits(template, [{ id: slot.id, text: 'Junior software engineer building reliable applications.' }]);
  assert.equal(edited, template.replace(slot.text, 'Junior software engineer building reliable applications.'));
  for (const fixed of ['0.6cm', '0.25cm', '0.95', '@{}l X l l@{}', 'leftmargin', 'https://example.com/cv', 'RGB', 'Preserve this comment']) assert.ok(!slots.some(item => item.text.includes(fixed)), fixed);
  assert.equal(applyLatexTextEdits(template, []), template);
});
test('template editing rejects commands, duplicate slots and unknown positions, and escapes plain text', () => {
  const slot = latexTextSlots(template).find(item => item.text === 'Profile sentence for a junior engineer.');
  for (const edits of [[{ id: slot.id, text: String.raw`\vspace{-1cm}` }], [{ id: 'new-section', text: 'New section' }], [{ id: slot.id, text: 'First' }, { id: slot.id, text: 'Second' }], [{ id: slot.id, text: 'New\nparagraph' }]]) assert.throws(() => applyLatexTextEdits(template, edits));
  const edited = applyLatexTextEdits(template, [{ id: slot.id, text: 'A & B: 50% improvement' }]); assert.ok(edited.includes(String.raw`A \& B: 50\% improvement`));
});
test('tailoring prepares complete documents from text edits and instructs the model to preserve structure', () => {
  const slot = latexTextSlots(template).find(item => item.text === 'Profile sentence for a junior engineer.');
  const result = validateTailoring({ replacements: [{ id: slot.id, text: 'Updated truthful profile.' }], email: { subject: 'Application', body: 'Hello hiring team.' }, changes: ['Profile emphasis'], questions: [] }, template);
  assert.equal(result.latex, template.replace(slot.text, 'Updated truthful profile.'));
  const prompt = tailoringPrompt({ source: template, resume: '', job: {}, language: 'French' }); assert.match(prompt, /Do not reorder sections/); assert.match(prompt, /replacement plain text/); assert.ok(!('replacements' in result));
});
