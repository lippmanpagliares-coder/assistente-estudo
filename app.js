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
let fotoSelecionada = null;
let materialAtual = null; // resultado gerado pela IA para a prova aberta
let listaProvasCache = [];

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
      <span class="estado-prova ${prova.status === "pronta" ? "pronta" : ""}">${
        prova.status === "pronta" ? "Material pronto" : "Em preparação"
      }</span>
    `;
    cartao.addEventListener("click", () => abrirProva(prova));
    listaProvasEl.appendChild(cartao);
  }
}

function abrirProva(prova) {
  provaEmEdicao = { id: prova.id, materia: prova.materia, dataProva: prova.dataProva, conteudo: prova.conteudo };
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
const previewFoto = document.getElementById("preview-foto");
const msgFotoStatus = document.getElementById("msg-foto-status");
const btnAdicionarPagina = document.getElementById("btn-adicionar-pagina");
const listaPaginasEl = document.getElementById("lista-paginas");
const btnAnalisar = document.getElementById("btn-analisar");

campoFoto.addEventListener("change", () => {
  const arquivo = campoFoto.files[0];
  if (!arquivo) return;
  msgFotoStatus.hidden = true;
  const leitor = new FileReader();
  leitor.onload = () => {
    fotoSelecionada = { dataUrl: leitor.result, mediaType: arquivo.type || "image/jpeg" };
    previewFoto.src = leitor.result;
    previewFoto.hidden = false;
    btnAdicionarPagina.disabled = false;
  };
  leitor.readAsDataURL(arquivo);
});

btnAdicionarPagina.addEventListener("click", () => {
  if (!fotoSelecionada) return;
  paginasAtual.push({ ...fotoSelecionada, id: crypto.randomUUID() });
  fotoSelecionada = null;
  campoFoto.value = "";
  previewFoto.hidden = true;
  btnAdicionarPagina.disabled = true;
  renderListaPaginas();
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

btnAnalisar.addEventListener("click", async () => {
  msgErroAnalise.hidden = true;
  msgAnalisando.hidden = false;
  btnAnalisar.disabled = true;
  try {
    const resposta = await fetch("/api/analisar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        materia: provaEmEdicao.materia,
        conteudo: provaEmEdicao.conteudo,
        imagens: paginasAtual.map((p) => ({
          mediaType: p.mediaType,
          base64: p.dataUrl.split(",")[1],
        })),
      }),
    });
    if (!resposta.ok) {
      const detalhe = await resposta.json().catch(() => ({}));
      throw new Error(detalhe.error || `Falha ao analisar (HTTP ${resposta.status})`);
    }
    materialAtual = await resposta.json();
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
document.getElementById("btn-imprimir").addEventListener("click", () => {
  const area = document.getElementById("area-impressao");
  const dataFormatada = provaEmEdicao.dataProva
    ? new Date(provaEmEdicao.dataProva + "T00:00:00").toLocaleDateString("pt-BR")
    : "";

  const cabecalho = `
    <div class="campo-nome">Nome: <span>&nbsp;</span></div>
    <p><strong>Matéria:</strong> ${escapeHtml(provaEmEdicao.materia)} &nbsp;&nbsp;
       <strong>Prova em:</strong> ${dataFormatada}</p>
  `;

  const parte1 = `<div class="pagina-impressa">
    <h2>Parte 1 — Resumo</h2>
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
    <h2>Parte 4 — Exercícios</h2>
    ${(materialAtual.questoes || [])
      .map((q, i) => {
        const clone = { ...q };
        const html = renderQuestao(clone, i);
        return html.replace(/<div class="gabarito-resposta">[\s\S]*?<\/div>/, "");
      })
      .join("")}
  </div>`;

  const parte5 = `<div class="pagina-impressa">
    <h2>Parte 5 — Gabarito (separado para o responsável)</h2>
    ${(materialAtual.questoes || [])
      .map((q, i) => `<p>${i + 1}. ${escapeHtml(q.resposta)}</p>`)
      .join("")}
  </div>`;

  area.innerHTML = parte1 + parte2e3 + parte4 + parte5;
  window.print();
});

// ---------- utilidades ----------
function escapeHtml(texto) {
  if (texto === undefined || texto === null) return "";
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
