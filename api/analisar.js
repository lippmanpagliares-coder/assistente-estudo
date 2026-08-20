// Função serverless (Vercel). Recebe fotos de páginas de livro e devolve
// material de estudo gerado pela IA da Claude (resumo, pontos-chave, glossário e questões).

const MODELO = "claude-sonnet-5";

const ESQUEMA_INSTRUCOES = `
Você é um assistente que transforma páginas fotografadas de um livro escolar em material de estudo
para uma criança se preparar para uma prova. Analise o conteúdo de TODAS as imagens enviadas (elas
são páginas em sequência do mesmo livro) e produza uma explicação didática, preservando os conceitos
importantes usados pelo livro — não invente informações que não estejam nas páginas.

Responda APENAS com um JSON válido (sem markdown, sem texto fora do JSON), no formato exato:
{
  "resumo": "texto do resumo, com parágrafos separados por uma linha em branco",
  "precisoSaber": ["ponto essencial 1", "ponto essencial 2", "..."],
  "glossario": [{"termo": "palavra importante", "definicao": "explicação curta e simples"}],
  "questoes": [
    {"tipo": "multipla", "dificuldade": "facil", "enunciado": "...", "opcoes": ["opção a", "opção b", "opção c", "opção d"], "resposta": "texto da opção correta"},
    {"tipo": "vf", "dificuldade": "facil", "enunciado": "afirmação para julgar", "resposta": "Verdadeiro" ou "Falso"},
    {"tipo": "complete", "dificuldade": "medio", "enunciado": "frase com uma lacuna representada por ______", "resposta": "palavra ou expressão que completa a lacuna"},
    {"tipo": "resposta", "dificuldade": "medio", "enunciado": "pergunta aberta para a criança explicar com as próprias palavras", "resposta": "resposta modelo de referência"},
    {"tipo": "desafio", "dificuldade": "dificil", "enunciado": "pergunta que exige aplicar o conceito a uma situação nova", "resposta": "resposta modelo de referência"}
  ]
}

Gere entre 10 e 14 questões no total, cobrindo os 5 tipos acima (pode repetir tipos). Cada questão deve
ter o campo "dificuldade" com um dos valores "facil", "medio" ou "dificil", com uma mistura equilibrada
das três (essas questões serão reaproveitadas depois para montar um simulado por dificuldade). Use
linguagem simples e adequada ao ano escolar indicado pela matéria/conteúdo informados. O resumo deve ter
2 a 4 parágrafos.
`;

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "ANTHROPIC_API_KEY não configurada no servidor. Adicione essa variável de ambiente no painel do Vercel (Settings > Environment Variables) e faça um novo deploy.",
    });
    return;
  }

  let corpo;
  try {
    corpo = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: "JSON inválido no corpo da requisição." });
    return;
  }

  const { materia, conteudo, imagens } = corpo || {};
  if (!Array.isArray(imagens) || imagens.length === 0) {
    res.status(400).json({ error: "Envie ao menos uma imagem de página." });
    return;
  }

  const conteudoMensagem = [
    {
      type: "text",
      text: `Matéria: ${materia || "não informada"}\nConteúdo/capítulos: ${
        conteudo || "não informado"
      }\n\n${ESQUEMA_INSTRUCOES}`,
    },
    ...imagens.map((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.mediaType || "image/jpeg", data: img.base64 },
    })),
  ];

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
        max_tokens: 4096,
        messages: [{ role: "user", content: conteudoMensagem }],
      }),
    });

    if (!respostaApi.ok) {
      const textoErro = await respostaApi.text();
      res.status(502).json({ error: `A IA retornou um erro (HTTP ${respostaApi.status}): ${textoErro}` });
      return;
    }

    const dados = await respostaApi.json();
    const blocoTexto = (dados.content || []).find((b) => b.type === "text");
    const textoResposta = blocoTexto?.text || "";
    if (!textoResposta) {
      res.status(502).json({ error: "A IA não retornou nenhum texto. Tente novamente." });
      return;
    }
    const textoLimpo = textoResposta
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "");

    let material;
    try {
      material = JSON.parse(textoLimpo);
    } catch {
      res.status(502).json({ error: "A IA não retornou um JSON válido. Tente novamente." });
      return;
    }

    res.status(200).json(material);
  } catch (erro) {
    res.status(500).json({ error: `Falha ao chamar a IA: ${erro.message}` });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 60 };
