// lib/booking/llm.js
// Chamada generica ao Gemini pra sintetizar texto livre (relatorios) a partir de dados
// brutos - diferente de extract.js, que forca um JSON com schema fixo. Usada pelos
// relatorios agendados (diario de encoders, semanal de contribuicao Europa), que pedem
// analise/raciocinio em cima dos dados, nao so checagem mecanica de campo.
export async function gerarTextoComGemini(systemInstruction, userContent, { maxOutputTokens = 6000, thinkingBudget = 1024 } = {}) {
  const model = process.env.EXTRACTION_MODEL || 'gemini-3.6-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens, thinkingConfig: { thinkingBudget } },
    }),
  });
  if (!r.ok) throw new Error(`Gemini respondeu ${r.status}: ${(await r.text().catch(() => '')).slice(0, 500)}`);
  const d = await r.json();
  const texto = d.candidates?.[0]?.content?.parts?.map((p) => p.text).join('');
  if (!texto) {
    const motivo = d.candidates?.[0]?.finishReason;
    throw new Error(`Gemini não devolveu texto${motivo ? ` (finishReason: ${motivo})` : ''}.`);
  }
  return texto;
}
