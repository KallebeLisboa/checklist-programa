from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from pydantic import BaseModel
from typing import List, Optional

# ==========================================
# 1. CONFIGURAÇÃO DO BANCO DE DADOS
# ==========================================
SQLALCHEMY_DATABASE_URL = "sqlite:///./tarefas.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- Modelos do Banco ---
class PastaDB(Base):
    __tablename__ = "pastas"
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    # Estrutura recursiva: a pasta pode pertencer a outra pasta (se null, é raiz)
    pasta_pai_id = Column(Integer, ForeignKey("pastas.id"), nullable=True)

class TarefaDB(Base):
    __tablename__ = "tarefas"
    id = Column(Integer, primary_key=True, index=True)
    titulo = Column(String, nullable=False)
    concluida = Column(Boolean, default=False)
    ordem = Column(Integer, default=0)
    peso = Column(Integer, default=1) 
    
    # Relação única: a tarefa pertence apenas a uma pasta
    pasta_id = Column(Integer, ForeignKey("pastas.id"), nullable=True)

Base.metadata.create_all(bind=engine)

# ==========================================
# 2. SCHEMAS (Pydantic)
# ==========================================
class PastaBase(BaseModel):
    nome: str
    pasta_pai_id: Optional[int] = None

class PastaResponse(PastaBase):
    id: int
    class Config: from_attributes = True

class TarefaBase(BaseModel):
    titulo: str
    peso: int = 1
    pasta_id: Optional[int] = None

class TarefaCreate(TarefaBase): pass

class TarefaUpdate(BaseModel):
    titulo: Optional[str] = None
    concluida: Optional[bool] = None
    ordem: Optional[int] = None
    peso: Optional[int] = None
    pasta_id: Optional[int] = None

class TarefaReorder(BaseModel):
    id: int
    nova_ordem: int

class TarefaResponse(TarefaBase):
    id: int
    concluida: bool
    ordem: int
    class Config: from_attributes = True

# ==========================================
# 3. ROTAS DA API
# ==========================================
app = FastAPI(title="Gerenciador Avançado - Pastas Infinitas")

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

# --- Rotas de Pastas ---
@app.post("/api/pastas/", response_model=PastaResponse)
def criar_pasta(pasta: PastaBase, db: Session = Depends(get_db)):
    nova_pasta = PastaDB(nome=pasta.nome, pasta_pai_id=pasta.pasta_pai_id)
    db.add(nova_pasta)
    db.commit()
    db.refresh(nova_pasta)
    return nova_pasta

@app.get("/api/pastas/", response_model=List[PastaResponse])
def listar_pastas(db: Session = Depends(get_db)):
    return db.query(PastaDB).all()

# --- Rotas de Tarefas Atualizadas ---
@app.post("/api/tarefas/", response_model=TarefaResponse)
def criar_tarefa(tarefa: TarefaCreate, db: Session = Depends(get_db)):
    maior_ordem = db.query(TarefaDB).order_by(TarefaDB.ordem.desc()).first()
    nova_ordem = (maior_ordem.ordem + 1) if maior_ordem else 0
    
    nova_tarefa = TarefaDB(
        titulo=tarefa.titulo, 
        ordem=nova_ordem, 
        peso=tarefa.peso,
        pasta_id=tarefa.pasta_id
    )
    db.add(nova_tarefa)
    db.commit()
    db.refresh(nova_tarefa)
    return nova_tarefa

@app.get("/api/tarefas/", response_model=List[TarefaResponse])
def listar_tarefas(ordenar_por_peso: bool = Query(False), db: Session = Depends(get_db)):
    query = db.query(TarefaDB)
    if ordenar_por_peso:
        return query.order_by(TarefaDB.peso.desc(), TarefaDB.ordem.asc()).all()
    else:
        return query.order_by(TarefaDB.ordem.asc()).all()

@app.put("/api/tarefas/{tarefa_id}", response_model=TarefaResponse)
def atualizar_tarefa(tarefa_id: int, tarefa: TarefaUpdate, db: Session = Depends(get_db)):
    tarefa_db = db.query(TarefaDB).filter(TarefaDB.id == tarefa_id).first()
    if not tarefa_db: raise HTTPException(status_code=404, detail="Não encontrada")
    
    for key, value in tarefa.model_dump(exclude_unset=True).items():
        setattr(tarefa_db, key, value)
        
    db.commit()
    db.refresh(tarefa_db)
    return tarefa_db

@app.put("/api/tarefas/reordenar/")
def reordenar_tarefas(atualizacoes: List[TarefaReorder], db: Session = Depends(get_db)):
    for atualizacao in atualizacoes:
        db.query(TarefaDB).filter(TarefaDB.id == atualizacao.id).update({"ordem": atualizacao.nova_ordem})
    db.commit()
    return {"status": "sucesso"}

@app.delete("/api/tarefas/{tarefa_id}")
def deletar_tarefa(tarefa_id: int, db: Session = Depends(get_db)):
    tarefa_db = db.query(TarefaDB).filter(TarefaDB.id == tarefa_id).first()
    db.delete(tarefa_db)
    db.commit()
    return {"status": "deletado"}

class PastaUpdate(BaseModel):
    nome: Optional[str] = None
    pasta_pai_id: Optional[int] = None

@app.put("/api/pastas/{pasta_id}", response_model=PastaResponse)
def atualizar_pasta(pasta_id: int, pasta: PastaUpdate, db: Session = Depends(get_db)):
    pasta_db = db.query(PastaDB).filter(PastaDB.id == pasta_id).first()
    if not pasta_db: raise HTTPException(status_code=404, detail="Não encontrada")
    
    for key, value in pasta.model_dump(exclude_unset=True).items():
        setattr(pasta_db, key, value)
        
    db.commit()
    db.refresh(pasta_db)
    return pasta_db


@app.delete("/api/pastas/{pasta_id}")
def deletar_pasta(
    pasta_id: int, 
    acao: str = Query(..., description="excluir_tudo ou mover"), 
    destino_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    pasta = db.query(PastaDB).filter(PastaDB.id == pasta_id).first()
    if not pasta: 
        raise HTTPException(status_code=404, detail="Pasta não encontrada")

    if acao == "mover":
        # Move as subpastas diretas e tarefas para o novo destino (pode ser null/Raiz)
        db.query(PastaDB).filter(PastaDB.pasta_pai_id == pasta_id).update({"pasta_pai_id": destino_id})
        db.query(TarefaDB).filter(TarefaDB.pasta_id == pasta_id).update({"pasta_id": destino_id})
        db.commit()
    elif acao == "excluir_tudo":
        # Função recursiva para deletar tudo o que está dentro desta pasta em qualquer nível
        def deletar_recursivo(p_id):
            db.query(TarefaDB).filter(TarefaDB.pasta_id == p_id).delete()
            subpastas = db.query(PastaDB).filter(PastaDB.pasta_pai_id == p_id).all()
            for sub in subpastas:
                deletar_recursivo(sub.id)
            db.query(PastaDB).filter(PastaDB.id == p_id).delete()
            
        deletar_recursivo(pasta_id)
        db.commit()
        return {"status": "deletado_com_cascade"}

    # Se a ação foi "mover", as coisas já saíram da pasta. Agora podemos excluí-la com segurança.
    db.delete(pasta)
    db.commit()
    return {"status": "sucesso"}

app.mount("/", StaticFiles(directory="static", html=True), name="static")