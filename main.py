from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey, Text
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

class PastaDB(Base):
    __tablename__ = "pastas"
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    pasta_pai_id = Column(Integer, ForeignKey("pastas.id"), nullable=True)

class TarefaDB(Base):
    __tablename__ = "tarefas"
    id = Column(Integer, primary_key=True, index=True)
    titulo = Column(String, nullable=False)
    descricao = Column(Text, nullable=True) # Suporte a Markdown longo
    concluida = Column(Boolean, default=False)
    ordem = Column(Integer, default=0)
    peso = Column(Integer, default=1)
    progresso_atual = Column(Integer, default=0) # Barra de progresso
    progresso_meta = Column(Integer, default=0)  # Barra de progresso (0 = sem barra)
    pasta_id = Column(Integer, ForeignKey("pastas.id"), nullable=True)

Base.metadata.create_all(bind=engine)

# ==========================================
# 2. SCHEMAS
# ==========================================
class PastaBase(BaseModel):
    nome: str
    pasta_pai_id: Optional[int] = None

class PastaResponse(PastaBase):
    id: int
    class Config: from_attributes = True

class PastaUpdate(BaseModel):
    nome: Optional[str] = None
    pasta_pai_id: Optional[int] = None

class TarefaBase(BaseModel):
    titulo: str
    descricao: Optional[str] = None
    peso: int = 1
    progresso_atual: int = 0
    progresso_meta: int = 0
    pasta_id: Optional[int] = None

class TarefaCreate(TarefaBase): pass

class TarefaUpdate(BaseModel):
    titulo: Optional[str] = None
    descricao: Optional[str] = None
    concluida: Optional[bool] = None
    ordem: Optional[int] = None
    peso: Optional[int] = None
    progresso_atual: Optional[int] = None
    progresso_meta: Optional[int] = None
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
app = FastAPI(title="Gerenciador Avançado")

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

# --- Rotas de Pastas ---
@app.post("/api/pastas/", response_model=PastaResponse)
def criar_pasta(pasta: PastaBase, db: Session = Depends(get_db)):
    nova = PastaDB(**pasta.model_dump())
    db.add(nova)
    db.commit()
    db.refresh(nova)
    return nova

@app.get("/api/pastas/", response_model=List[PastaResponse])
def listar_pastas(db: Session = Depends(get_db)):
    return db.query(PastaDB).all()

@app.put("/api/pastas/{pasta_id}", response_model=PastaResponse)
def atualizar_pasta(pasta_id: int, pasta: PastaUpdate, db: Session = Depends(get_db)):
    pasta_db = db.query(PastaDB).filter(PastaDB.id == pasta_id).first()
    for key, value in pasta.model_dump(exclude_unset=True).items(): setattr(pasta_db, key, value)
    db.commit()
    db.refresh(pasta_db)
    return pasta_db

@app.delete("/api/pastas/{pasta_id}")
def deletar_pasta(pasta_id: int, acao: str = Query(...), destino_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    pasta = db.query(PastaDB).filter(PastaDB.id == pasta_id).first()
    if acao == "mover":
        db.query(PastaDB).filter(PastaDB.pasta_pai_id == pasta_id).update({"pasta_pai_id": destino_id})
        db.query(TarefaDB).filter(TarefaDB.pasta_id == pasta_id).update({"pasta_id": destino_id})
        db.commit()
    elif acao == "excluir_tudo":
        def deletar_recursivo(p_id):
            db.query(TarefaDB).filter(TarefaDB.pasta_id == p_id).delete()
            subpastas = db.query(PastaDB).filter(PastaDB.pasta_pai_id == p_id).all()
            for sub in subpastas: deletar_recursivo(sub.id)
            db.query(PastaDB).filter(PastaDB.id == p_id).delete()
        deletar_recursivo(pasta_id)
        db.commit()
        return {"status": "deletado_com_cascade"}
    db.delete(pasta)
    db.commit()
    return {"status": "sucesso"}

# --- Rotas de Tarefas ---
@app.post("/api/tarefas/", response_model=TarefaResponse)
def criar_tarefa(tarefa: TarefaCreate, db: Session = Depends(get_db)):
    maior_ordem = db.query(TarefaDB).order_by(TarefaDB.ordem.desc()).first()
    nova_ordem = (maior_ordem.ordem + 1) if maior_ordem else 0
    nova_tarefa = TarefaDB(**tarefa.model_dump(), ordem=nova_ordem)
    db.add(nova_tarefa)
    db.commit()
    db.refresh(nova_tarefa)
    return nova_tarefa

@app.get("/api/tarefas/", response_model=List[TarefaResponse])
def listar_tarefas(ordenar_por_peso: bool = Query(False), busca: Optional[str] = Query(None), db: Session = Depends(get_db)):
    query = db.query(TarefaDB)
    # Filtro Global de Busca Inteligente
    if busca:
        termo = f"%{busca}%"
        query = query.filter(TarefaDB.titulo.ilike(termo) | TarefaDB.descricao.ilike(termo))
        
    if ordenar_por_peso:
        return query.order_by(TarefaDB.peso.desc(), TarefaDB.ordem.asc()).all()
    else:
        return query.order_by(TarefaDB.ordem.asc()).all()

@app.put("/api/tarefas/{tarefa_id}", response_model=TarefaResponse)
def atualizar_tarefa(tarefa_id: int, tarefa: TarefaUpdate, db: Session = Depends(get_db)):
    tarefa_db = db.query(TarefaDB).filter(TarefaDB.id == tarefa_id).first()
    for key, value in tarefa.model_dump(exclude_unset=True).items(): setattr(tarefa_db, key, value)
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
    db.query(TarefaDB).filter(TarefaDB.id == tarefa_id).delete()
    db.commit()
    return {"status": "deletado"}

app.mount("/", StaticFiles(directory="static", html=True), name="static")