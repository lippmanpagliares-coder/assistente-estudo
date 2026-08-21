// Função serverless (Vercel). Lê uma foto de calendário/agenda de provas e extrai a lista de
// provas (matéria, data, conteúdo). Usa Haiku (modelo econômico) por ser uma tarefa de extração simples.

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

  const { imagem, dataDeHoje } = corpo || {};
  if (!imagem || !imagem.base64) {
    res.status(400).json({ error: "Envie a foto do calendário." });
    return;
  }

  const prompt = `A imagem em anexo é uma foto de um calendário ou agenda escolar com datas de provas.
Hoje é ${dataDeHoje || "uma data desconhecida"}. Identifique cada prova visível na imagem e extraia:
matéria, data da prova e o conteúdo/capítulos indicados (se houver).

Regras:
- Se o ano não estiver escrito, assuma o ano atual (baseado em "hoje"), a não ser que a data pareça ser
  do ano seguinte (ex.: mês já passou este ano).
- Se não for possível determinar a data com confiança, deixe "dataProva" como null.
- Se não houver conteúdo/capítulos escritos, deixe "conteudo" como uma string vazia.
- Ignore itens que claramente não são provas (trabalhos, eventos, feriados), a não ser que estejam
  explicitamente marcados como prova/avaliação.

Responda APENAS com um JSON válido (sem markdown, sem texto fora do JSON), no formato:
{"provas": [{"materia": "...", "dataProva": "AAAA-MM-DD ou null", "conteudo": "..."}]}`;

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
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image", source: { type: "base64", media_type: imagem.mediaType || "image/jpeg", data: imagem.base64 } },
            ],
          },
        ],
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

    res.status(200).json(resultado);
  } catch (erro) {
    res.status(500).json({ error: `Falha ao chamar a IA: ${erro.message}` });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 45 };
