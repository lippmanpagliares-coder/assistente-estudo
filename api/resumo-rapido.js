// Função serverless (Vercel). Gera uma prévia enxuta (resumo curto + pontos-chave) baseada só no
// nome do conteúdo/capítulo, sem fotos do livro ainda. Usa Haiku por ser uma tarefa pequena e barata.
// Serve como ponto de partida até o responsável fotografar as páginas reais e gerar o material completo.

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

  const { materia, conteudo, idade } = corpo || {};
  if (!materia && !conteudo) {
    res.status(400).json({ error: "Informe matéria ou conteúdo para gerar a prévia." });
    return;
  }

  const idadeTexto = idade ? `${idade} anos` : "aproximadamente 9 anos";
  const prompt = `Uma criança de ${idadeTexto} vai ter uma prova de "${materia || "não informada"}" sobre
"${conteudo || "não informado"}". Ainda não temos as páginas do livro, só o nome do assunto. Escreva uma
PRÉVIA curta e simples (não é o material completo) pra dar um ponto de partida, ensinando o básico do que
esse assunto costuma envolver, com linguagem simples, sem presumir conhecimento prévio.

Responda APENAS com um JSON válido, sem markdown:
{"resumo": "2 parágrafos curtos, no máximo", "precisoSaber": ["3 a 5 pontos essenciais, frases curtas"]}`;

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
        max_tokens: 800,
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
      res.status(502).json({ error: "A IA não retornou um JSON válido. Tente novamente." });
      return;
    }

    res.status(200).json({ resumo: resultado.resumo || "", precisoSaber: resultado.precisoSaber || [], glossario: [], questoes: [] });
  } catch (erro) {
    res.status(500).json({ error: `Falha ao chamar a IA: ${erro.message}` });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 30 };
