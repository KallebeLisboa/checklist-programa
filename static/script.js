const API_URL = '/api';
let ordenarPorPeso = false;
let pastasGlobais = [];
let tarefasGlobais = [];

async function carregarTudo() {
    const [resPastas, resTarefas] = await Promise.all([
        fetch(`${API_URL}/pastas/`),
        fetch(`${API_URL}/tarefas/?ordenar_por_peso=${ordenarPorPeso}`)
    ]);

    pastasGlobais = await resPastas.json();
    tarefasGlobais = await resTarefas.json();

    atualizarSelects();
    renderizarArvore();
}

function construirCaminho(pastaId) {
    if (!pastaId) return '';
    const pasta = pastasGlobais.find(p => p.id === pastaId);
    if (!pasta) return '';
    if (!pasta.pasta_pai_id) return pasta.nome;
    return `${construirCaminho(pasta.pasta_pai_id)} / ${pasta.nome}`;
}

function atualizarSelects() {
    const selects = [
        document.getElementById('select-pasta-pai'),
        document.getElementById('select-pasta-tarefa'),
        document.getElementById('edit-pasta')
    ];

    // Memoriza escolhas atuais
    const memorizados = selects.map(s => s.value);

    // Constrói caminhos amigáveis (Ex: Faculdade / Álgebra 1)
    const pastasFormatadas = pastasGlobais.map(p => ({
        id: p.id,
        caminho: construirCaminho(p.id)
    })).sort((a, b) => a.caminho.localeCompare(b.caminho));

    selects.forEach((select, index) => {
        select.innerHTML = '<option value="">Raiz (Solta)</option>';
        pastasFormatadas.forEach(pf => {
            select.innerHTML += `<option value="${pf.id}">${pf.caminho}</option>`;
        });
        select.value = memorizados[index]; // Restaura a escolha
    });
}

// Renderização Recursiva
function renderizarArvore() {
    const container = document.getElementById('container-blocos');
    container.innerHTML = '';
    renderizarNode(null, container); // Inicia na Raiz (pai null)
}

function renderizarNode(pastaPaiId, containerDOM) {
    // 1. Renderiza Pastas dentro deste nível
    const pastasFilhas = pastasGlobais.filter(p => p.pasta_pai_id === pastaPaiId);
    const divListaPastas = document.createElement('div');
    divListaPastas.className = 'lista-pastas';
    divListaPastas.dataset.pastaId = pastaPaiId || '';

    pastasFilhas.forEach(pasta => {
        const blocoPasta = document.createElement('div');
        blocoPasta.className = 'bloco-pasta';
        blocoPasta.dataset.id = pasta.id;
        blocoPasta.innerHTML = `<h3 class="pasta-titulo">📁 ${pasta.nome}</h3>`;
        
        // Chamada recursiva: renderiza o que há dentro desta pasta
        renderizarNode(pasta.id, blocoPasta);
        divListaPastas.appendChild(blocoPasta);
    });
    containerDOM.appendChild(divListaPastas);

    // Ativa Drag and Drop para PASTAS
    new Sortable(divListaPastas, {
        group: 'pastas',
        animation: 150,
        fallbackOnBody: true,
        swapThreshold: 0.65,
        onEnd: async function (evt) {
            const idPasta = parseInt(evt.item.dataset.id);
            const idNovoPai = evt.to.dataset.pastaId ? parseInt(evt.to.dataset.pastaId) : null;
            
            if (evt.from !== evt.to) {
                if (verificarDescendente(idPasta, idNovoPai)) {
                    alert("Operação inválida: Não pode arrastar uma pasta para dentro dela mesma ou dos seus filhos.");
                    carregarTudo();
                    return;
                }
                await fetch(`${API_URL}/pastas/${idPasta}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pasta_pai_id: idNovoPai })
                });
                carregarTudo();
            }
        }
    });

    // 2. Renderiza Tarefas dentro deste nível
    const tarefasDesteNivel = tarefasGlobais.filter(t => t.pasta_id === pastaPaiId);
    containerDOM.appendChild(criarListaTarefasHTML(tarefasDesteNivel, pastaPaiId));
}

function criarListaTarefasHTML(tarefas, pastaId) {
    const ul = document.createElement('ul');
    ul.dataset.pastaId = pastaId || '';
    
    tarefas.forEach(t => {
        const li = document.createElement('li');
        li.dataset.id = t.id;
        if (t.concluida) li.classList.add('concluida');

        li.innerHTML = `
            <div class="tarefa-info">
                <input type="checkbox" class="checkbox-custom" ${t.concluida ? 'checked' : ''} onchange="alternarStatus(${t.id}, this.checked)">
                <span class="badge-peso">Peso ${t.peso}</span>
                <span>${t.titulo}</span>
            </div>
            <div class="acoes-tarefa">
                <button class="btn-editar" onclick="abrirModal(${t.id})">✏️</button>
                <button class="btn-deletar" onclick="deletarTarefa(${t.id})">X</button>
            </div>
        `;
        ul.appendChild(li);
    });

    if (!ordenarPorPeso) {
        new Sortable(ul, {
            group: 'tarefas',
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: async function (evt) {
                const toList = evt.to; 
                const idTarefa = parseInt(evt.item.dataset.id);
                const novaPastaId = toList.dataset.pastaId ? parseInt(toList.dataset.pastaId) : null;

                if (evt.from !== evt.to) {
                    await fetch(`${API_URL}/tarefas/${idTarefa}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pasta_id: novaPastaId })
                    });
                }
                const itens = Array.from(toList.children);
                const atualizacoes = itens.map((li, index) => ({ id: parseInt(li.dataset.id), nova_ordem: index }));
                
                await fetch(`${API_URL}/tarefas/reordenar/`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(atualizacoes)
                });
                carregarTudo();
            }
        });
    }
    return ul;
}

// Verifica se a pasta destino é filha da pasta arrastada
function verificarDescendente(paiId, possivelFilhoId) {
    if (!possivelFilhoId) return false;
    if (paiId === possivelFilhoId) return true;
    const possivelFilho = pastasGlobais.find(p => p.id === possivelFilhoId);
    if (!possivelFilho || !possivelFilho.pasta_pai_id) return false;
    return verificarDescendente(paiId, possivelFilho.pasta_pai_id);
}

// ==========================================
// Ações Form e Modal
// ==========================================
document.getElementById('form-pasta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('input-pasta').value;
    const pasta_pai_id = document.getElementById('select-pasta-pai').value || null;
    await fetch(`${API_URL}/pastas/`, { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ nome, pasta_pai_id: pasta_pai_id ? parseInt(pasta_pai_id) : null }) 
    });
    document.getElementById('input-pasta').value = '';
    carregarTudo();
});

document.getElementById('form-tarefa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titulo = document.getElementById('input-titulo').value;
    const peso = document.getElementById('input-peso').value;
    const pasta_id = document.getElementById('select-pasta-tarefa').value || null;

    await fetch(`${API_URL}/tarefas/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo, peso: parseInt(peso), pasta_id: pasta_id ? parseInt(pasta_id) : null })
    });
    
    document.getElementById('input-titulo').value = '';
    carregarTudo();
});

async function alternarStatus(id, concluida) {
    await fetch(`${API_URL}/tarefas/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ concluida }) });
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

async function abrirModal(id) {
    tarefaEditando = tarefasGlobais.find(t => t.id === id);
    document.getElementById('edit-id').value = tarefaEditando.id;
    document.getElementById('edit-titulo').value = tarefaEditando.titulo;
    document.getElementById('edit-peso').value = tarefaEditando.peso;
    document.getElementById('edit-pasta').value = tarefaEditando.pasta_id || '';
    document.getElementById('modal-editar').style.display = 'flex';
}

function fecharModal() { document.getElementById('modal-editar').style.display = 'none'; }

document.getElementById('form-editar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-id').value;
    const pasta_id = document.getElementById('edit-pasta').value || null;

    await fetch(`${API_URL}/tarefas/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            titulo: document.getElementById('edit-titulo').value, 
            peso: parseInt(document.getElementById('edit-peso').value), 
            pasta_id: pasta_id ? parseInt(pasta_id) : null 
        })
    });
    fecharModal();
    carregarTudo();
});

// ==========================================
// 5. LÓGICA DA LIXEIRA DE PASTAS
// ==========================================
let pastaExcluindoId = null;

// Inicializa a lixeira como uma área que aceita pastas (group: 'pastas')
new Sortable(document.getElementById('lixeira-dropzone'), {
    group: 'pastas',
    animation: 150,
    onAdd: function (evt) {
        const idPasta = parseInt(evt.item.dataset.id);
        
        // Esconde a pasta arrastada instantaneamente para o usuário achar que ela "caiu" lá dentro
        evt.item.style.display = 'none'; 
        
        // Abre o modal para perguntar o que fazer com os filhos
        abrirModalExcluir(idPasta);
    }
});

function abrirModalExcluir(id) {
    pastaExcluindoId = id;
    
    // Configura as opções do select de destino
    const selectDestino = document.getElementById('select-destino-excluir');
    selectDestino.innerHTML = '<option value="">Raiz (Solta)</option>';
    
    // Lista todas as pastas formatadas
    const pastasFormatadas = pastasGlobais.map(p => ({
        id: p.id, caminho: construirCaminho(p.id)
    })).sort((a, b) => a.caminho.localeCompare(b.caminho));

    pastasFormatadas.forEach(pf => {
        // Bloqueio de segurança: não podemos extrair ficheiros de uma pasta para dentro dela mesma
        // ou para dentro dos filhos (senão a extração cria um ciclo infinito e quebra o banco)
        if (!verificarDescendente(id, pf.id) && pf.id !== id) {
            selectDestino.innerHTML += `<option value="${pf.id}">${pf.caminho}</option>`;
        }
    });

    document.getElementById('modal-excluir').style.display = 'flex';
}

function fecharModalExcluir() {
    document.getElementById('modal-excluir').style.display = 'none';
    pastaExcluindoId = null;
    carregarTudo(); // Recarrega tudo (se o usuário cancelar, a pasta escondida volta a aparecer no lugar original)
}

// Lógica de Ativar/Desativar o Select do Modal de acordo com a opção escolhida (Radio buttons)
document.querySelectorAll('input[name="acao-excluir"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        document.getElementById('select-destino-excluir').disabled = (e.target.value !== 'mover');
    });
});

// Confirmação de Exclusão e disparo da API
document.getElementById('form-excluir').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const acao = document.querySelector('input[name="acao-excluir"]:checked').value;
    const destino = document.getElementById('select-destino-excluir').value;
    
    // Monta a URL baseada na escolha
    let url = `${API_URL}/pastas/${pastaExcluindoId}?acao=${acao}`;
    if (acao === 'mover' && destino !== "") {
        url += `&destino_id=${destino}`;
    }

    await fetch(url, { method: 'DELETE' });
    
    fecharModalExcluir(); // Fecha a janela e recarrega a árvore limpa
});

carregarTudo();