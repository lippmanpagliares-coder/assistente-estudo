import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ---------- estado em memória ----------
let telaAtual = "tela-login";
let historicoTelas = [];
let provaEmEdicao = null; // { id?, materia, dataProva, conteudo }
let paginasAtual = []; // [{ dataUrl, mediaType, base64 }]
let materialAtual = null; // resultado gerado pela IA para a prova aberta
let listaProvasCache = [];
let filaRevisao = [];
let indiceRevisaoAtual = 0;
let resultadosRevisao = [];

// ---------- navegação ----------
function mostrarTela(id, { empilhar = true } = {}) {
  if (empilhar && telaAtual && telaAtual !== id) historicoTelas.push(telaAtual);
  document.querySelectorAll(".tela").forEach((el) => (el.hidden = el.id !== id));
  telaAtual = id;
  document.getElementById("btn-voltar").hidden = historicoTelas.length === 0;
}
function voltar() {
  const anterior = historicoTelas.pop();
  if (anterior) mostrarTela(anterior, { empilhar: false });
  document.getElementById("btn-voltar").hidden = historicoTelas.length === 0;
}
document.getElementById("btn-voltar").addEventListener("click", voltar);

// ---------- login ----------
const telaLogin = document.getElementById("tela-login");
const formLogin = document.getElementById("form-login");
const loginErro = document.getElementById("login-erro");
const btnCriarAcesso = document.getElementById("btn-criar-acesso");
const btnSair = document.getElementById("btn-sair");

function mostrarErroLogin(erro) {
  const mapa = {
    "auth/invalid-email": "E-mail inválido.",
    "auth/missing-password": "Digite uma senha.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/user-not-found": "Não existe conta com esse e-mail. Use \"Criar acesso\".",
    "auth/email-already-in-use": "Já existe uma conta com esse e-mail. Faça login.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
  };
  loginErro.textContent = mapa[erro.code] || `Não foi possível entrar (${erro.code || erro.message}).`;
  loginErro.hidden = false;
}

formLogin.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  loginErro.hidden = true;
  const email = document.getElementById("login-email").value.trim();
  const senha = document.getElementById("login-senha").value;
  try {
    await signInWithEmailAndPassword(auth, email, senha);
  } catch (erro) {
    mostrarErroLogin(erro);
  }
});

btnCriarAcesso.addEventListener("click", async () => {
  loginErro.hidden = true;
  const email = document.getElementById("login-email").value.trim();
  const senha = document.getElementById("login-senha").value;
  if (!email || senha.length < 6) {
    loginErro.textContent = "Preencha e-mail e uma senha com pelo menos 6 caracteres para criar o acesso.";
    loginErro.hidden = false;
    return;
  }
  try {
    await createUserWithEmailAndPassword(auth, email, senha);
  } catch (erro) {
    mostrarErroLogin(erro);
  }
});

btnSair.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (usuario) => {
  if (usuario) {
    btnSair.hidden = false;
    historicoTelas = [];
    mostrarTela("tela-inicial", { empilhar: false });
    carregarProvas();
  } else {
    btnSair.hidden = true;
    historicoTelas = [];
    mostrarTela("tela-login", { empilhar: false });
  }
});

// ---------- tela inicial: lista de provas ----------
const listaProvasEl = document.getElementById("lista-provas");
const msgSemProvas = document.getElementById("msg-sem-provas");

async function carregarProvas() {
  listaProvasEl.innerHTML = "";
  msgSemProvas.hidden = true;
  try {
    const q = query(collection(db, "provas"), orderBy("criadoEm", "desc"));
    const snap = await getDocs(q);
    listaProvasCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (erro) {
    console.error("Erro ao carregar provas:", erro);
    listaProvasCache = [];
  }
  if (listaProvasCache.length === 0) {
    msgSemProvas.hidden = false;
    return;
  }
  for (const prova of listaProvasCache) {
    const cartao = document.createElement("div");
    cartao.className = "cartao-prova";
    const dataFormatada = prova.dataProva
      ? new Date(prova.dataProva + "T00:00:00").toLocaleDateString("pt-BR")
      : "sem data";
    cartao.innerHTML = `
      <div>
        <h3>${escapeHtml(prova.materia)}</h3>
        <p>Prova em ${dataFormatada}${prova.conteudo ? " · " + escapeHtml(prova.conteudo) : ""}</p>
      </div>
      <div class="linha-cartao-prova">
        <span class="estado-prova ${prova.status === "pronta" ? "pronta" : ""}">${
          prova.status === "pronta" ? "Material pronto" : "Em preparação"
        }</span>
        <button class="btn-excluir-prova" type="button">Excluir</button>
      </div>
    `;
    cartao.addEventListener("click", () => abrirProva(prova));
    cartao.querySelector(".btn-excluir-prova").addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (!confirm(`Excluir a prova de ${prova.materia}? Essa ação não pode ser desfeita.`)) return;
      try {
        await deleteDoc(doc(db, "provas", prova.id));
        await carregarProvas();
      } catch (erro) {
        alert("Não foi possível excluir: " + erro.message);
      }
    });
    listaProvasEl.appendChild(cartao);
  }
}

function abrirProva(prova) {
  provaEmEdicao = {
    id: prova.id,
    materia: prova.materia,
    dataProva: prova.dataProva,
    conteudo: prova.conteudo,
    questoesErradas: prova.questoesErradas || [],
  };
  if (prova.status === "pronta" && prova.material) {
    materialAtual = prova.material;
    exibirMaterial();
  } else {
    paginasAtual = [];
    renderListaPaginas();
    document.getElementById("titulo-paginas").textContent = `Adicionar páginas — ${prova.materia}`;
    mostrarTela("tela-paginas");
  }
}

document.getElementById("btn-nova-prova").addEventListener("click", () => {
  document.getElementById("form-nova-prova").reset();
  mostrarTela("tela-nova-prova");
});

// ---------- nova prova ----------
document.getElementById("form-nova-prova").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const materia = document.getElementById("campo-materia").value.trim();
  const dataProva = document.getElementById("campo-data").value;
  const conteudo = document.getElementById("campo-conteudo").value.trim();

  const docRef = await addDoc(collection(db, "provas"), {
    materia,
    dataProva,
    conteudo,
    status: "preparando",
    material: null,
    criadoEm: serverTimestamp(),
  });

  provaEmEdicao = { id: docRef.id, materia, dataProva, conteudo };
  paginasAtual = [];
  renderListaPaginas();
  document.getElementById("titulo-paginas").textContent = `Adicionar páginas — ${materia}`;
  mostrarTela("tela-paginas");
});

// ---------- adicionar páginas (fotos) ----------
const campoFoto = document.getElementById("campo-foto");
const msgFotoStatus = document.getElementById("msg-foto-status");
const listaPaginasEl = document.getElementById("lista-paginas");
const btnAnalisar = document.getElementById("btn-analisar");

const LADO_MAXIMO_FOTO = 1600; // reduz fotos grandes de celular para não estourar o limite de upload

function comprimirImagem(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      const imagem = new Image();
      imagem.onload = () => {
        let { width, height } = imagem;
        if (width > LADO_MAXIMO_FOTO || height > LADO_MAXIMO_FOTO) {
          if (width > height) {
            height = Math.round(height * (LADO_MAXIMO_FOTO / width));
            width = LADO_MAXIMO_FOTO;
          } else {
            width = Math.round(width * (LADO_MAXIMO_FOTO / height));
            height = LADO_MAXIMO_FOTO;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(imagem, 0, 0, width, height);
        resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.8), mediaType: "image/jpeg" });
      };
      imagem.onerror = reject;
      imagem.src = leitor.result;
    };
    leitor.onerror = reject;
    leitor.readAsDataURL(arquivo);
  });
}

campoFoto.addEventListener("change", async () => {
  const arquivos = Array.from(campoFoto.files || []);
  if (arquivos.length === 0) return;

  msgFotoStatus.textContent = `Processando ${arquivos.length} foto${arquivos.length > 1 ? "s" : ""}...`;
  msgFotoStatus.hidden = false;

  for (const arquivo of arquivos) {
    try {
      const resultado = await comprimirImagem(arquivo);
      paginasAtual.push({ ...resultado, id: crypto.randomUUID() });
      renderListaPaginas();
    } catch (erro) {
      console.error("Falha ao processar foto:", erro);
    }
  }

  campoFoto.value = "";
  msgFotoStatus.hidden = true;
});

function renderListaPaginas() {
  listaPaginasEl.innerHTML = "";
  paginasAtual.forEach((pagina, indice) => {
    const cartao = document.createElement("div");
    cartao.className = "cartao-pagina";
    cartao.innerHTML = `
      <img src="${pagina.dataUrl}" alt="Página ${indice + 1}">
      <div class="texto-pagina">Página ${indice + 1}</div>
      <button class="remover-pagina" type="button">Remover</button>
    `;
    cartao.querySelector(".remover-pagina").addEventListener("click", () => {
      paginasAtual = paginasAtual.filter((p) => p.id !== pagina.id);
      renderListaPaginas();
    });
    listaPaginasEl.appendChild(cartao);
  });
  btnAnalisar.disabled = paginasAtual.length === 0;
}

// ---------- analisar conteúdo (chama a IA) ----------
const msgAnalisando = document.getElementById("msg-analisando");
const msgErroAnalise = document.getElementById("msg-erro-analise");
const LIMITE_ENVIO_BYTES = 3.5 * 1024 * 1024; // margem de segurança abaixo do limite da Vercel (4.5 MB)

function agruparPaginasPorTamanho(paginas) {
  const grupos = [];
  let grupoAtual = [];
  let tamanhoAtual = 0;
  for (const pagina of paginas) {
    const tamanho = pagina.dataUrl.length;
    if (grupoAtual.length > 0 && tamanhoAtual + tamanho > LIMITE_ENVIO_BYTES) {
      grupos.push(grupoAtual);
      grupoAtual = [];
      tamanhoAtual = 0;
    }
    grupoAtual.push(pagina);
    tamanhoAtual += tamanho;
  }
  if (grupoAtual.length > 0) grupos.push(grupoAtual);
  return grupos;
}

function mesclarMateriais(materiais) {
  if (materiais.length === 1) return materiais[0];
  const resumo = materiais.map((m) => m.resumo || "").filter(Boolean).join("\n\n");
  const precisoSaber = materiais.flatMap((m) => m.precisoSaber || []);
  const glossarioPorTermo = new Map();
  materiais.forEach((m) =>
    (m.glossario || []).forEach((g) => {
      const chave = (g.termo || "").trim().toLowerCase();
      if (chave && !glossarioPorTermo.has(chave)) glossarioPorTermo.set(chave, g);
    })
  );
  const questoes = materiais.flatMap((m) => m.questoes || []);
  return { resumo, precisoSaber, glossario: [...glossarioPorTermo.values()], questoes };
}

btnAnalisar.addEventListener("click", async () => {
  msgErroAnalise.hidden = true;
  msgAnalisando.hidden = false;
  btnAnalisar.disabled = true;
  try {
    const grupos = agruparPaginasPorTamanho(paginasAtual);
    const materiais = [];
    for (let i = 0; i < grupos.length; i++) {
      msgAnalisando.textContent =
        grupos.length > 1 ? `Analisando páginas (parte ${i + 1} de ${grupos.length})...` : "Analisando páginas com IA...";
      const resposta = await fetch("/api/analisar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materia: provaEmEdicao.materia,
          conteudo: provaEmEdicao.conteudo,
          imagens: grupos[i].map((p) => ({
            mediaType: p.mediaType,
            base64: p.dataUrl.split(",")[1],
          })),
        }),
      });
      if (!resposta.ok) {
        const detalhe = await resposta.json().catch(() => ({}));
        throw new Error(detalhe.error || `Falha ao analisar (HTTP ${resposta.status})`);
      }
      materiais.push(await resposta.json());
    }
    materialAtual = mesclarMateriais(materiais);
    await updateDoc(doc(db, "provas", provaEmEdicao.id), {
      status: "pronta",
      material: materialAtual,
    });
    exibirMaterial();
  } catch (erro) {
    console.error(erro);
    msgErroAnalise.textContent =
      "Não foi possível analisar as páginas: " +
      erro.message +
      ". Verifique se o site está publicado no Vercel com a chave da IA configurada.";
    msgErroAnalise.hidden = false;
  } finally {
    msgAnalisando.hidden = true;
    msgAnalisando.textContent = "Analisando páginas com IA...";
    btnAnalisar.disabled = paginasAtual.length === 0;
  }
});

// ---------- exibir material gerado ----------
const materialTitulo = document.getElementById("material-titulo");
const materialSubtitulo = document.getElementById("material-subtitulo");
const parteQuestoes = document.getElementById("parte-questoes");
const btnMostrarGabarito = document.getElementById("btn-mostrar-gabarito");

function exibirMaterial() {
  materialTitulo.textContent = provaEmEdicao.materia;
  const dataFormatada = provaEmEdicao.dataProva
    ? new Date(provaEmEdicao.dataProva + "T00:00:00").toLocaleDateString("pt-BR")
    : "";
  materialSubtitulo.textContent = `Prova em ${dataFormatada}${
    provaEmEdicao.conteudo ? " · " + provaEmEdicao.conteudo : ""
  }`;

  document.getElementById("parte-resumo").innerHTML = (materialAtual.resumo || "")
    .split(/\n\s*\n/)
    .map((par) => `<p>${escapeHtml(par.trim())}</p>`)
    .join("");

  document.getElementById("parte-precisa").innerHTML =
    "<h4>Preciso saber para a prova</h4><ul>" +
    (materialAtual.precisoSaber || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") +
    "</ul>";

  document.getElementById("parte-glossario").innerHTML = (materialAtual.glossario || [])
    .map(
      (g) =>
        `<div class="bloco-glossario"><span class="termo">${escapeHtml(g.termo)}:</span> ${escapeHtml(g.definicao)}</div>`
    )
    .join("");

  parteQuestoes.classList.remove("mostrar-gabarito");
  btnMostrarGabarito.textContent = "Mostrar gabarito";
  parteQuestoes.innerHTML = (materialAtual.questoes || []).map(renderQuestao).join("");

  document.querySelectorAll(".aba").forEach((btn, i) => btn.classList.toggle("ativa", i === 0));
  document.querySelectorAll(".parte-conteudo").forEach((el, i) => (el.hidden = i !== 0));

  mostrarTela("tela-material");
}

function renderQuestao(questao, indice) {
  const numero = indice + 1;
  const rotulos = { multipla: "Múltipla escolha", vf: "Verdadeiro ou falso", complete: "Complete", resposta: "Responda", desafio: "Questão-desafio" };
  let corpo = "";
  if (questao.tipo === "multipla") {
    const letras = ["a", "b", "c", "d", "e"];
    corpo = `<ul class="opcoes">${(questao.opcoes || [])
      .map((op, i) => `<li>${letras[i]}) ${escapeHtml(op)}</li>`)
      .join("")}</ul>`;
  } else if (questao.tipo === "vf") {
    corpo = `<div>( &nbsp; ) Verdadeiro &nbsp;&nbsp; ( &nbsp; ) Falso</div>`;
  } else {
    corpo = `<div class="linha-resposta"></div>`;
  }
  return `
    <div class="questao">
      <div class="tipo-tag">${rotulos[questao.tipo] || questao.tipo}</div>
      <div class="enunciado">${numero}. ${escapeHtml(questao.enunciado)}</div>
      ${corpo}
      <div class="gabarito-resposta">Resposta: ${escapeHtml(questao.resposta)}</div>
    </div>
  `;
}

document.querySelectorAll(".aba").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".aba").forEach((b) => b.classList.remove("ativa"));
    btn.classList.add("ativa");
    const alvo = btn.dataset.alvo;
    document.querySelectorAll(".parte-conteudo").forEach((el) => (el.hidden = el.id !== alvo));
  });
});

btnMostrarGabarito.addEventListener("click", () => {
  const mostrando = parteQuestoes.classList.toggle("mostrar-gabarito");
  btnMostrarGabarito.textContent = mostrando ? "Ocultar gabarito" : "Mostrar gabarito";
});

// ---------- impressão / PDF ----------
function gerarCabecalhoImpressao() {
  const dataFormatada = provaEmEdicao.dataProva
    ? new Date(provaEmEdicao.dataProva + "T00:00:00").toLocaleDateString("pt-BR")
    : "";
  return `
    <div class="campo-nome">Nome: <span>&nbsp;</span></div>
    <p><strong>Matéria:</strong> ${escapeHtml(provaEmEdicao.materia)} &nbsp;&nbsp;
       <strong>Prova em:</strong> ${dataFormatada}</p>
  `;
}

document.getElementById("btn-gerar-simulado").addEventListener("click", () => {
  const quantidadeSel = document.getElementById("simulado-quantidade").value;
  const dificuldadeSel = document.getElementById("simulado-dificuldade").value;

  let pool = materialAtual.questoes || [];
  if (dificuldadeSel !== "misturado") {
    pool = pool.filter((q) => (q.dificuldade || "medio") === dificuldadeSel);
  }
  if (pool.length === 0) {
    alert('Não há questões suficientes com essa dificuldade. Tente "Misturado".');
    return;
  }
  const embaralhadas = [...pool].sort(() => Math.random() - 0.5);
  const quantidade = quantidadeSel === "todas" ? embaralhadas.length : Math.min(Number(quantidadeSel), embaralhadas.length);
  const questoesProva = embaralhadas.slice(0, quantidade);

  const area = document.getElementById("area-impressao");
  const cabecalho = gerarCabecalhoImpressao();

  // Parte 1 — Revisão: resumo, preciso saber, palavras importantes e exercícios (para ler e estudar)
  const parte1 = `<div class="pagina-impressa">
    <h2>Parte 1 — Revisão: Resumo</h2>
    ${cabecalho}
    ${(materialAtual.resumo || "").split(/\n\s*\n/).map((p) => `<p>${escapeHtml(p.trim())}</p>`).join("")}
  </div>`;

  const parte2e3 = `<div class="pagina-impressa">
    <h2>Parte 2 — O que preciso saber</h2>
    <ul>${(materialAtual.precisoSaber || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
    <h2>Parte 3 — Palavras importantes</h2>
    ${(materialAtual.glossario || [])
      .map((g) => `<p><strong>${escapeHtml(g.termo)}:</strong> ${escapeHtml(g.definicao)}</p>`)
      .join("")}
  </div>`;

  const parte4 = `<div class="pagina-impressa">
    <h2>Parte 4 — Exercícios para estudar</h2>
    ${(materialAtual.questoes || [])
      .map((q, i) => renderQuestao(q, i).replace(/<div class="gabarito-resposta">[\s\S]*?<\/div>/, ""))
      .join("")}
  </div>`;

  // Parte 5 — Prova: o simulado, para responder depois de estudar
  const parte5 = `<div class="pagina-impressa">
    <h2>Parte 5 — Prova (simulado)</h2>
    ${cabecalho}
    ${questoesProva
      .map((q, i) => renderQuestao(q, i).replace(/<div class="gabarito-resposta">[\s\S]*?<\/div>/, ""))
      .join("")}
  </div>`;

  // Parte 6 — Gabarito combinado (exercícios + prova), separado para o responsável
  const parte6 = `<div class="pagina-impressa">
    <h2>Parte 6 — Gabarito (separado para o responsável)</h2>
    <h3>Exercícios</h3>
    ${(materialAtual.questoes || []).map((q, i) => `<p>${i + 1}. ${escapeHtml(q.resposta)}</p>`).join("")}
    <h3>Prova</h3>
    ${questoesProva.map((q, i) => `<p>${i + 1}. ${escapeHtml(q.resposta)}</p>`).join("")}
  </div>`;

  area.innerHTML = parte1 + parte2e3 + parte4 + parte5 + parte6;
  window.print();
});

// ---------- modo revisão ----------
const telaRevisao = document.getElementById("tela-revisao");
const revisaoProgresso = document.getElementById("revisao-progresso");
const revisaoQuestaoArea = document.getElementById("revisao-questao-area");
const revisaoResultado = document.getElementById("revisao-resultado");

document.getElementById("btn-iniciar-revisao").addEventListener("click", () => iniciarRevisao());

function iniciarRevisao(apenasFracas = false) {
  const todas = (materialAtual.questoes || []).map((q, i) => ({ ...q, _indiceOriginal: i }));
  const fracasSet = new Set(provaEmEdicao.questoesErradas || []);
  let fila;
  if (apenasFracas && fracasSet.size) {
    fila = todas.filter((q) => fracasSet.has(q.enunciado));
  } else {
    const fracas = todas.filter((q) => fracasSet.has(q.enunciado));
    const outras = todas.filter((q) => !fracasSet.has(q.enunciado)).sort(() => Math.random() - 0.5);
    fila = [...fracas, ...outras];
  }
  if (fila.length === 0) fila = todas;

  filaRevisao = fila;
  indiceRevisaoAtual = 0;
  resultadosRevisao = [];
  revisaoResultado.hidden = true;
  revisaoQuestaoArea.hidden = false;
  mostrarTela("tela-revisao");
  renderQuestaoRevisao();
}

function renderQuestaoRevisao() {
  const total = filaRevisao.length;
  const atual = filaRevisao[indiceRevisaoAtual];
  revisaoProgresso.textContent = `Pergunta ${indiceRevisaoAtual + 1} de ${total}`;

  let corpo = "";
  if (atual.tipo === "multipla") {
    corpo = `<div class="opcoes-revisao">${(atual.opcoes || [])
      .map((op) => `<button type="button" class="btn-secundario opcao-revisao" data-valor="${escapeHtml(op)}">${escapeHtml(op)}</button>`)
      .join("")}</div>`;
  } else if (atual.tipo === "vf") {
    corpo = `<div class="opcoes-revisao">
      <button type="button" class="btn-secundario opcao-revisao" data-valor="Verdadeiro">Verdadeiro</button>
      <button type="button" class="btn-secundario opcao-revisao" data-valor="Falso">Falso</button>
    </div>`;
  } else {
    corpo = `<textarea id="revisao-resposta-texto" rows="3" placeholder="Escreva sua resposta..."></textarea>
      <button id="btn-conferir-revisao" type="button" class="btn-primario" style="margin-top:10px">Conferir resposta</button>`;
  }

  revisaoQuestaoArea.innerHTML = `
    <div class="enunciado" style="font-size:1.1rem;margin-bottom:14px">${escapeHtml(atual.enunciado)}</div>
    ${corpo}
    <div id="revisao-feedback"></div>
  `;

  if (atual.tipo === "multipla" || atual.tipo === "vf") {
    revisaoQuestaoArea.querySelectorAll(".opcao-revisao").forEach((btn) => {
      btn.addEventListener("click", () => avaliarRevisao(btn.dataset.valor === atual.resposta, atual));
    });
  } else {
    document.getElementById("btn-conferir-revisao").addEventListener("click", () => {
      document.getElementById("revisao-feedback").innerHTML = `
        <div class="gabarito-resposta" style="display:block">Resposta de referência: ${escapeHtml(atual.resposta)}</div>
        <div style="margin-top:10px;display:flex;gap:10px">
          <button id="btn-acertei" type="button" class="btn-secundario">Acertei</button>
          <button id="btn-errei" type="button" class="btn-secundario">Não acertei</button>
        </div>
      `;
      document.getElementById("btn-acertei").addEventListener("click", () => avaliarRevisao(true, atual));
      document.getElementById("btn-errei").addEventListener("click", () => avaliarRevisao(false, atual));
    });
  }
}

function avaliarRevisao(acertou, questao) {
  resultadosRevisao.push({ enunciado: questao.enunciado, acertou });
  revisaoQuestaoArea.innerHTML += `
    <div class="${acertou ? "gabarito-resposta" : "erro"}" style="display:block;margin-top:14px">
      ${acertou ? "✅ Certinho!" : "❌ Essa não foi — resposta certa: " + escapeHtml(questao.resposta)}
    </div>
    <button id="btn-proxima-revisao" type="button" class="btn-primario" style="margin-top:14px">Próxima</button>
  `;
  document.getElementById("btn-proxima-revisao").addEventListener("click", avancarRevisao);
}

function avancarRevisao() {
  indiceRevisaoAtual++;
  if (indiceRevisaoAtual >= filaRevisao.length) {
    finalizarRevisao();
  } else {
    renderQuestaoRevisao();
  }
}

async function finalizarRevisao() {
  revisaoQuestaoArea.hidden = true;
  revisaoResultado.hidden = false;
  const acertos = resultadosRevisao.filter((r) => r.acertou).length;
  const total = resultadosRevisao.length;
  const erradas = resultadosRevisao.filter((r) => !r.acertou).map((r) => r.enunciado);

  revisaoResultado.innerHTML = `
    <h3>Resultado da revisão</h3>
    <p>Você acertou ${acertos} de ${total} questões.</p>
    ${
      erradas.length
        ? `<h4>Pontos para revisar de novo:</h4><ul>${erradas.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`
        : "<p>Mandou muito bem, sem pontos fracos dessa vez! 🎉</p>"
    }
    <div style="display:flex;gap:12px;margin-top:16px;flex-wrap:wrap">
      <button id="btn-revisao-novamente" type="button" class="btn-secundario">Revisar tudo de novo</button>
      ${erradas.length ? '<button id="btn-revisao-fracas" type="button" class="btn-secundario">Revisar só os erros</button>' : ""}
      <button id="btn-revisao-fechar" type="button" class="btn-primario">Concluir</button>
    </div>
  `;
  document.getElementById("btn-revisao-novamente").addEventListener("click", () => iniciarRevisao());
  document.getElementById("btn-revisao-fechar").addEventListener("click", () => mostrarTela("tela-inicial", { empilhar: false }));
  const btnFracas = document.getElementById("btn-revisao-fracas");
  if (btnFracas) btnFracas.addEventListener("click", () => iniciarRevisao(true));

  try {
    await updateDoc(doc(db, "provas", provaEmEdicao.id), { questoesErradas: erradas });
    provaEmEdicao.questoesErradas = erradas;
  } catch (erro) {
    console.error("Não foi possível salvar o resultado da revisão:", erro);
  }
}

// ---------- utilidades ----------
function escapeHtml(texto) {
  if (texto === undefined || texto === null) return "";
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
