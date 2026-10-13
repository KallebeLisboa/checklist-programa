const API_URL = '/api';
let ordenarPorPeso = false;
let termoBusca = "";
let pastasGlobais = [];
let tarefasGlobais = [];

async function carregarTudo() {
    let urlTarefas = `${API_URL}/tarefas/?ordenar_por_peso=${ordenarPorPeso}`;
    if (termoBusca) urlTarefas += `&busca=${encodeURIComponent(termoBusca)}`;

    const [resPastas, resTarefas] = await Promise.all([
        fetch(`${API_URL}/pastas/`),
        fetch(urlTarefas)
    ]);

    pastasGlobais = await resPastas.json();
    tarefasGlobais = await resTarefas.json();

    atualizarSelects();
    
    // Se estiver buscando, mostra lista reta para não se perder nas pastas
    if (termoBusca) renderizarBuscaPlana();
    else renderizarArvore();
}

// ---------------- PESQUISA GLOBAL ----------------
document.getElementById('input-busca').addEventListener('input', (e) => {
    termoBusca = e.target.value.trim();
    carregarTudo();
});

function renderizarBuscaPlana() {
    const container = document.getElementById('container-blocos');
    container.innerHTML = `<h3 style="margin-bottom:15px;">Resultados para "${termoBusca}"</h3>`;
    container.appendChild(criarListaTarefasHTML(tarefasGlobais, null, true));
}
// -------------------------------------------------

function construirCaminho(pastaId) {
    if (!pastaId) return '';
    const pasta = pastasGlobais.find(p => p.id === pastaId);
    if (!pasta) return '';
    return pasta.pasta_pai_id ? `${construirCaminho(pasta.pasta_pai_id)} / ${pasta.nome}` : pasta.nome;
}

function atualizarSelects() {
    const selects = [document.getElementById('select-pasta-pai'), document.getElementById('select-pasta-tarefa'), document.getElementById('edit-pasta')];
    const memorizados = selects.map(s => s.value);
    
    const pastasFormatadas = pastasGlobais.map(p => ({ id: p.id, caminho: construirCaminho(p.id) })).sort((a, b) => a.caminho.localeCompare(b.caminho));

    selects.forEach((select, index) => {
        select.innerHTML = '<option value="">Raiz (Solta)</option>';
        pastasFormatadas.forEach(pf => select.innerHTML += `<option value="${pf.id}">${pf.caminho}</option>`);
        select.value = memorizados[index];
    });
}

function renderizarArvore() {
    const container = document.getElementById('container-blocos');
    container.innerHTML = '';
    renderizarNode(null, container);
}

function renderizarNode(pastaPaiId, containerDOM) {
    const pastasFilhas = pastasGlobais.filter(p => p.pasta_pai_id === pastaPaiId);
    const divListaPastas = document.createElement('div');
    divListaPastas.className = 'lista-pastas';
    divListaPastas.dataset.pastaId = pastaPaiId || '';

    pastasFilhas.forEach(pasta => {
        const blocoPasta = document.createElement('div');
        blocoPasta.className = 'bloco-pasta';
        blocoPasta.dataset.id = pasta.id;
        blocoPasta.innerHTML = `<h3 class="pasta-titulo">📁 ${pasta.nome}</h3>`;
        renderizarNode(pasta.id, blocoPasta);
        divListaPastas.appendChild(blocoPasta);
    });
    containerDOM.appendChild(divListaPastas);

    new Sortable(divListaPastas, {
        group: 'pastas', animation: 150, fallbackOnBody: true, swapThreshold: 0.65, emptyInsertThreshold: 50,
        onEnd: async function (evt) {
            const idPasta = parseInt(evt.item.dataset.id);
            const idNovoPai = evt.to.dataset.pastaId ? parseInt(evt.to.dataset.pastaId) : null;
            if (evt.from !== evt.to) {
                if (verificarDescendente(idPasta, idNovoPai)) {
                    alert("Inválido: Não pode arrastar uma pasta para dentro de si mesma.");
                    return carregarTudo();
                }
                await fetch(`${API_URL}/pastas/${idPasta}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ pasta_pai_id: idNovoPai }) });
                carregarTudo();
            }
        }
    });

    const tarefasDesteNivel = tarefasGlobais.filter(t => t.pasta_id === pastaPaiId);
    containerDOM.appendChild(criarListaTarefasHTML(tarefasDesteNivel, pastaPaiId, false));
}

function criarListaTarefasHTML(tarefas, pastaId, isBusca) {
    const ul = document.createElement('ul');
    ul.dataset.pastaId = pastaId || '';
    
    tarefas.forEach(t => {
        const li = document.createElement('li');
        li.dataset.id = t.id;
        li.className = 'tarefa-item ' + (t.concluida ? 'concluida' : '');

        // Badge de localização (só para busca)
        const badgeLocal = isBusca && t.pasta_id ? `<div style="font-size:11px; color:#999; margin-bottom:5px;">📍 ${construirCaminho(t.pasta_id)}</div>` : '';

        // Barra de Progresso Inteligente
        let progressoHTML = '';
        if (t.progresso_meta > 0) {
            const pct = Math.min(100, Math.round((t.progresso_atual / t.progresso_meta) * 100));
            progressoHTML = `
                <div class="progress-container">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${pct}%;"></div>
                    </div>
                    <div class="progress-controls">
                        <button onclick="mudarProgresso(${t.id}, -1)">-</button>
                        <span>${t.progresso_atual} / ${t.progresso_meta}</span>
                        <button onclick="mudarProgresso(${t.id}, 1)">+</button>
                    </div>
                </div>
            `;
        }

        // Markdown da Descrição
        let descHTML = '';
        if (t.descricao) {
            descHTML = `<div class="markdown-body">${marked.parse(t.descricao)}</div>`;
        }

        li.innerHTML = `
            <div style="flex:1;">
                ${badgeLocal}
                <div class="tarefa-info">
                    <input type="checkbox" class="checkbox-custom" ${t.concluida ? 'checked' : ''} onchange="alternarStatus(${t.id}, this.checked)">
                    <span class="badge-peso">Peso ${t.peso}</span>
                    <span class="titulo-texto">${t.titulo}</span>
                </div>
                ${progressoHTML}
                ${descHTML}
            </div>
            <div class="acoes-tarefa" style="align-self: flex-start;">
                <button class="btn-editar" onclick="abrirModal(${t.id})">✏️</button>
                <button class="btn-deletar" onclick="deletarTarefa(${t.id})">X</button>
            </div>
        `;
        ul.appendChild(li);
    });

    if (!ordenarPorPeso && !isBusca) {
        new Sortable(ul, {
            group: 'tarefas', animation: 150, emptyInsertThreshold: 50,
            onEnd: async function (evt) {
                const toList = evt.to; 
                const idTarefa = parseInt(evt.item.dataset.id);
                const novaPastaId = toList.dataset.pastaId ? parseInt(toList.dataset.pastaId) : null;

                if (evt.from !== evt.to) {
                    await fetch(`${API_URL}/tarefas/${idTarefa}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ pasta_id: novaPastaId }) });
                }
                const itens = Array.from(toList.children);
                const atualizacoes = itens.map((li, index) => ({ id: parseInt(li.dataset.id), nova_ordem: index }));
                await fetch(`${API_URL}/tarefas/reordenar/`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(atualizacoes) });
                carregarTudo();
            }
        });
    }
    return ul;
}

// ================= API CALLS RAPIDAS =================
async function mudarProgresso(id, delta) {
    const tarefa = tarefasGlobais.find(t => t.id === id);
    let novoValor = tarefa.progresso_atual + delta;
    if (novoValor < 0) novoValor = 0;
    if (novoValor > tarefa.progresso_meta) novoValor = tarefa.progresso_meta;
    
    // Auto completa se bater a meta
    let concluida = novoValor >= tarefa.progresso_meta ? true : tarefa.concluida;
    
    await fetch(`${API_URL}/tarefas/${id}`, { 
        method: 'PUT', headers: {'Content-Type':'application/json'}, 
        body: JSON.stringify({ progresso_atual: novoValor, concluida: concluida }) 
    });
    carregarTudo();
}

async function alternarStatus(id, concluida) {
    await fetch(`${API_URL}/tarefas/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ concluida }) });
    carregarTudo();
}

async function deletarTarefa(id) {
    await fetch(`${API_URL}/tarefas/${id}`, { method: 'DELETE' });
    carregarTudo();
}

function alternarOrdenacao() {
    ordenarPorPeso = !ordenarPorPeso;
    document.getElementById('btn-ordenar').innerText = ordenarPorPeso ? "✋ Voltar para Ordem Manual" : "🔄 Ordenar por Peso";
    carregarTudo();
}

function verificarDescendente(paiId, possivelFilhoId) {
    if (!possivelFilhoId) return false;
    if (paiId === possivelFilhoId) return true;
    const possivelFilho = pastasGlobais.find(p => p.id === possivelFilhoId);
    if (!possivelFilho || !possivelFilho.pasta_pai_id) return false;
    return verificarDescendente(paiId, possivelFilho.pasta_pai_id);
}

// ================= FORMS E MODAIS =================
document.getElementById('form-pasta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pasta_pai_id = document.getElementById('select-pasta-pai').value || null;
    await fetch(`${API_URL}/pastas/`, { 
        method: 'POST', headers: {'Content-Type':'application/json'}, 
        body: JSON.stringify({ nome: document.getElementById('input-pasta').value, pasta_pai_id: pasta_pai_id ? parseInt(pasta_pai_id) : null }) 
    });
    document.getElementById('input-pasta').value = '';
    carregarTudo();
});

document.getElementById('form-tarefa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pasta_id = document.getElementById('select-pasta-tarefa').value || null;
    await fetch(`${API_URL}/tarefas/`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ 
            titulo: document.getElementById('input-titulo').value, 
            descricao: document.getElementById('input-descricao').value,
            peso: parseInt(document.getElementById('input-peso').value), 
            progresso_meta: parseInt(document.getElementById('input-meta').value || 0),
            pasta_id: pasta_id ? parseInt(pasta_id) : null 
        })
    });
    document.getElementById('input-titulo').value = '';
    document.getElementById('input-descricao').value = '';
    carregarTudo();
});

let tarefaEditando = null;
async function abrirModal(id) {
    tarefaEditando = tarefasGlobais.find(t => t.id === id);
    document.getElementById('edit-id').value = tarefaEditando.id;
    document.getElementById('edit-titulo').value = tarefaEditando.titulo;
    document.getElementById('edit-descricao').value = tarefaEditando.descricao || "";
    document.getElementById('edit-peso').value = tarefaEditando.peso;
    document.getElementById('edit-prog-atual').value = tarefaEditando.progresso_atual;
    document.getElementById('edit-meta').value = tarefaEditando.progresso_meta;
    document.getElementById('edit-pasta').value = tarefaEditando.pasta_id || '';
    document.getElementById('modal-editar').style.display = 'flex';
}
function fecharModal() { document.getElementById('modal-editar').style.display = 'none'; }

document.getElementById('form-editar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-id').value;
    const pasta_id = document.getElementById('edit-pasta').value || null;
    await fetch(`${API_URL}/tarefas/${id}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ 
            titulo: document.getElementById('edit-titulo').value, 
            descricao: document.getElementById('edit-descricao').value, 
            peso: parseInt(document.getElementById('edit-peso').value), 
            progresso_atual: parseInt(document.getElementById('edit-prog-atual').value), 
            progresso_meta: parseInt(document.getElementById('edit-meta').value), 
            pasta_id: pasta_id ? parseInt(pasta_id) : null 
        })
    });
    fecharModal();
    carregarTudo();
});

// Lixeira e Exclusão (Mantido do anterior)
let pastaExcluindoId = null;
new Sortable(document.getElementById('lixeira-dropzone'), {
    group: 'pastas', animation: 150,
    onAdd: function (evt) {
        evt.item.style.display = 'none'; 
        abrirModalExcluir(parseInt(evt.item.dataset.id));
    }
});
function abrirModalExcluir(id) {
    pastaExcluindoId = id;
    const selectDestino = document.getElementById('select-destino-excluir');
    selectDestino.innerHTML = '<option value="">Raiz (Solta)</option>';
    const pastasFormatadas = pastasGlobais.map(p => ({ id: p.id, caminho: construirCaminho(p.id) })).sort((a, b) => a.caminho.localeCompare(b.caminho));
    pastasFormatadas.forEach(pf => { if (!verificarDescendente(id, pf.id) && pf.id !== id) selectDestino.innerHTML += `<option value="${pf.id}">${pf.caminho}</option>`; });
    document.getElementById('modal-excluir').style.display = 'flex';
}
function fecharModalExcluir() { document.getElementById('modal-excluir').style.display = 'none'; pastaExcluindoId = null; carregarTudo(); }
document.querySelectorAll('input[name="acao-excluir"]').forEach(radio => radio.addEventListener('change', (e) => document.getElementById('select-destino-excluir').disabled = (e.target.value !== 'mover')));
document.getElementById('form-excluir').addEventListener('submit', async (e) => {
    e.preventDefault();
    const acao = document.querySelector('input[name="acao-excluir"]:checked').value;
    const destino = document.getElementById('select-destino-excluir').value;
    let url = `${API_URL}/pastas/${pastaExcluindoId}?acao=${acao}`;
    if (acao === 'mover' && destino !== "") url += `&destino_id=${destino}`;
    await fetch(url, { method: 'DELETE' });
    fecharModalExcluir();
});

carregarTudo();