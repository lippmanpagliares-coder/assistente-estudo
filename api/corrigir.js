// Função serverless (Vercel). Corrige uma resposta aberta (tipo "resposta" ou "desafio")
// no modo revisão, usando um modelo bem mais barato (Haiku) já que a tarefa é pequena.

const MODELO = "claude-haiku-4-5-20251001";

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada no servidor." });
    return;
  }

  let corpo;
  try {
    corpo = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: "JSON inválido no corpo da requisição." });
    return;
  }

  const { enunciado, respostaModelo, respostaAluno } = corpo || {};
  if (!enunciado || !respostaModelo || !respostaAluno) {
    res.status(400).json({ error: "Faltam dados para corrigir a resposta." });
    return;
  }

  const prompt = `Uma criança que ainda está aprendendo a digitar no celular/computador respondeu esta
pergunta de estudo. Avalie apenas se a IDEIA/CONTEÚDO da resposta dela está correto, mesmo que com outras
palavras. IGNORE COMPLETAMENTE erros de português, acentuação, pontuação, maiúsculas/minúsculas e
digitação — isso não deve contar contra a criança de jeito nenhum.

Pergunta: ${enunciado}
Resposta modelo (referência): ${respostaModelo}
Resposta da criança: ${respostaAluno}

Responda APENAS com um JSON válido, sem markdown: {"correto": true ou false, "feedback": "uma frase
curta, gentil e simples, direto para a criança, elogiando ou explicando rapidamente o que faltou na
ideia (nunca comente sobre erros de escrita/digitação)"}`;

  try {
    const respostaApi = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!respostaApi.ok) {
      const textoErro = await respostaApi.text();
      res.status(502).json({ error: `A IA retornou um erro (HTTP ${respostaApi.status}): ${textoErro}` });
      return;
    }

    const dados = await respostaApi.json();
    const blocoTexto = (dados.content || []).find((b) => b.type === "text");
    const textoLimpo = (blocoTexto?.text || "")
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "");

    let resultado;
    try {
      resultado = JSON.parse(textoLimpo);
    } catch {
      res.status(502).json({ error: "A IA não retornou um JSON válido." });
      return;
    }

    res.status(200).json(resultado);
  } catch (erro) {
    res.status(500).json({ error: `Falha ao chamar a IA: ${erro.message}` });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 30 };
