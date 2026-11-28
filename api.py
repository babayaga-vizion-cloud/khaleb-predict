from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import io
import json
import logging
import os
import re
import time
import unicodedata
import zipfile
from functools import lru_cache
from typing import Any, Optional
from urllib.parse import quote

import joblib
import numpy as np
import pandas as pd
from catboost import CatBoostClassifier
from fastapi import Depends, FastAPI, File, HTTPException, Query as QueryParam, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
from supabase import Client, create_client
from xgboost import XGBClassifier

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("khaleb-predict-api")

BASE = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.getenv("MODELS_DIR", os.path.join(BASE, "models"))
SEED_CSV_PATH = os.getenv("SEED_CSV_PATH", os.path.join(BASE, "modele_babayaga.csv"))
os.makedirs(MODELS_DIR, exist_ok=True)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()  # clé publique anon/publishable uniquement
FRONTEND_URL = os.getenv("FRONTEND_URL", "").strip().rstrip("/")
ALLOWED_ORIGINS = [
    x.strip().rstrip("/")
    for x in os.getenv("ALLOWED_ORIGINS", FRONTEND_URL).split(",")
    if x.strip()
]

OWNER_PIN = os.getenv("OWNER_PIN", "")
OWNER_SESSION_SECRET = os.getenv("OWNER_SESSION_SECRET", "")
OWNER_COOKIE_NAME = "khaleb_owner_session"
OWNER_SESSION_SECONDS = 8 * 60 * 60
MODEL_VERSION = "CatBoost-XGBoost-Elo-v2.1"

FEATURES = [
    "elo_diff",
    "home_n",
    "away_n",
    "home_gf",
    "home_ga",
    "away_gf",
    "away_ga",
    "gf_diff",
    "ga_diff",
    "home_form5",
    "away_form5",
    "form5_diff",
]

_TRAINING_LOCKS: dict[str, asyncio.Lock] = {}


def get_training_lock(user_id: str) -> asyncio.Lock:
    lock = _TRAINING_LOCKS.get(user_id)
    if lock is None:
        lock = asyncio.Lock()
        _TRAINING_LOCKS[user_id] = lock
    return lock


def normalize_team_name(name: str) -> str:
    cleaned = unicodedata.normalize("NFKD", str(name or "").strip())
    cleaned = "".join(c for c in cleaned if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", cleaned).strip()


def normalize_team_key(name: str) -> str:
    return normalize_team_name(name).lower()


app = FastAPI(
    title="KHALEB PREDICT API",
    version="2.1.0",
    description="API d'analyse de matchs, import multi-formats et prédiction IA (CatBoost + XGBoost + Elo).",
)

if ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
    )

security = HTTPBearer(auto_error=True)


def get_user_model_path(user_id: str) -> str:
    safe_id = hashlib.sha256(user_id.encode("utf-8")).hexdigest()
    return os.path.join(MODELS_DIR, f"ensemble_{safe_id}.joblib")


@lru_cache(maxsize=64)
def _load_model_cached(model_path: str, mtime: float) -> dict[str, Any]:
    return joblib.load(model_path)


def load_user_model(user_id: str) -> Optional[dict[str, Any]]:
    path = get_user_model_path(user_id)
    if not os.path.isfile(path):
        return None
    try:
        return _load_model_cached(path, os.path.getmtime(path))
    except Exception as exc:
        logger.exception("Erreur chargement modèle user=%s : %s", user_id[:8], exc)
        return None


def get_supabase_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(status_code=503, detail="Supabase n'est pas configuré.")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


class AuthenticatedContext:
    def __init__(self, client: Client, user_id: str, email: Optional[str] = None):
        self.client = client
        self.user_id = user_id
        self.email = email


def get_auth_context(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> AuthenticatedContext:
    client = get_supabase_client()
    token = credentials.credentials
    try:
        client.postgrest.auth(token)
        response = client.auth.get_user(token)
        if not response or not response.user:
            raise ValueError("Utilisateur absent")
        return AuthenticatedContext(
            client=client,
            user_id=str(response.user.id),
            email=getattr(response.user, "email", None),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Échec authentification JWT : %s", type(exc).__name__)
        raise HTTPException(status_code=401, detail="Session invalide ou expirée.")


# -----------------------------------------------------------------------------
# Schémas Pydantic
# -----------------------------------------------------------------------------
class PlayerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    alias: Optional[str] = Field(default=None, max_length=120)


class MatchCreate(BaseModel):
    player_home_id: Optional[str] = None
    player_away_id: Optional[str] = None
    home_team: str = Field(min_length=1, max_length=120)
    away_team: str = Field(min_length=1, max_length=120)
    match_date: Optional[str] = None
    home_score: Optional[int] = Field(default=None, ge=0, le=30)
    away_score: Optional[int] = Field(default=None, ge=0, le=30)
    source: Optional[str] = "manual"

    @field_validator("home_team", "away_team")
    @classmethod
    def clean_team(cls, v: str) -> str:
        cleaned = normalize_team_name(v)
        if not cleaned:
            raise ValueError("Nom d'équipe vide.")
        return cleaned


class OddsCreate(BaseModel):
    match_id: str
    home_odds: Optional[float] = Field(default=None, gt=1.0, le=500.0)
    draw_odds: Optional[float] = Field(default=None, gt=1.0, le=500.0)
    away_odds: Optional[float] = Field(default=None, gt=1.0, le=500.0)
    over_25_odds: Optional[float] = Field(default=None, gt=1.0, le=500.0)
    under_25_odds: Optional[float] = Field(default=None, gt=1.0, le=500.0)


class CouponCreate(BaseModel):
    external_coupon_id: Optional[str] = Field(default=None, max_length=120)
    stake: Optional[float] = Field(default=None, ge=0)
    total_odds: Optional[float] = Field(default=None, gt=0)
    potential_return: Optional[float] = Field(default=None, ge=0)
    status: Optional[str] = "pending"
    source: Optional[str] = "manual"


class CouponSelectionCreate(BaseModel):
    coupon_id: str
    match_id: str
    selection_type: str = Field(min_length=1, max_length=60)
    selection_value: str = Field(min_length=1, max_length=120)
    odds: Optional[float] = Field(default=None, gt=0)


class PredictionCreate(BaseModel):
    match_id: str
    model_version: str = Field(min_length=1, max_length=80)
    method: str = Field(min_length=1, max_length=80)
    home_win_probability: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    draw_probability: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    away_win_probability: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    predicted_home_score: Optional[int] = Field(default=None, ge=0, le=30)
    predicted_away_score: Optional[int] = Field(default=None, ge=0, le=30)
    predicted_exact_score: Optional[str] = Field(default=None, max_length=20)
    over_25_probability: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    under_25_probability: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    btts_probability: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class ModelPerformanceCreate(BaseModel):
    model_version: str = Field(min_length=1, max_length=80)
    evaluation_period_start: Optional[str] = None
    evaluation_period_end: Optional[str] = None
    accuracy: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    log_loss: Optional[float] = Field(default=None, ge=0.0)
    brier_score: Optional[float] = Field(default=None, ge=0.0)
    total_matches: Optional[int] = Field(default=None, ge=0)
    metrics: Optional[dict] = None


class SignupRequest(BaseModel):
    email: str = Field(min_length=5, max_length=180)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=180)
    password: str = Field(min_length=1, max_length=128)


class UpdatePasswordRequest(BaseModel):
    access_token: str
    refresh_token: str
    new_password: str = Field(min_length=8, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=5, max_length=180)


class Query(BaseModel):
    home: str = Field(min_length=1, max_length=120)
    away: str = Field(min_length=1, max_length=120)

    @field_validator("home", "away")
    @classmethod
    def clean_query_team(cls, v: str) -> str:
        cleaned = normalize_team_name(v)
        if not cleaned:
            raise ValueError("Nom d'équipe invalide.")
        return cleaned


# -----------------------------------------------------------------------------
# Helpers d'import multi-formats (CSV, XLSX, XLS, ODS, JSON, ZIP sécurisé)
# -----------------------------------------------------------------------------
def read_import_file(filename: str, content: bytes, depth: int = 0) -> pd.DataFrame:
    if depth > 1:
        raise ValueError("Archives ZIP imbriquées non autorisées.")
    extension = os.path.splitext(filename)[1].lower()
    supported = {".xlsx", ".xls", ".csv", ".json", ".ods"}

    if extension == ".zip":
        try:
            frames = []
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                infos = [
                    info for info in archive.infolist()
                    if not info.is_dir()
                    and not info.filename.startswith("__MACOSX/")
                    and os.path.splitext(info.filename)[1].lower() in supported
                ]
                if len(infos) > 50:
                    raise ValueError("Maximum de 50 fichiers par archive ZIP.")
                total_size = sum(info.file_size for info in infos)
                if total_size > 50 * 1024 * 1024:
                    raise ValueError("Archive trop volumineuse : maximum 50 Mo décompressés.")
                for info in infos:
                    if info.compress_size > 0 and (info.file_size / info.compress_size) > 100:
                        raise ValueError(f"Ratio de compression suspect sur {info.filename}.")
                    try:
                        frame = read_import_file(info.filename, archive.read(info), depth=depth + 1)
                        if not frame.empty:
                            frames.append(frame)
                    except ValueError:
                        continue
            if not frames:
                raise ValueError("Aucun fichier compatible trouvé dans le ZIP.")
            return pd.concat(frames, ignore_index=True)
        except zipfile.BadZipFile:
            raise ValueError("Archive ZIP invalide.")

    if extension == ".xlsx":
        frame = pd.read_excel(io.BytesIO(content), engine="openpyxl")
    elif extension == ".xls":
        frame = pd.read_excel(io.BytesIO(content), engine="xlrd")
    elif extension == ".ods":
        frame = pd.read_excel(io.BytesIO(content), engine="odf")
    elif extension == ".csv":
        frame = None
        for encoding in ("utf-8-sig", "cp1252", "latin1"):
            try:
                frame = pd.read_csv(io.BytesIO(content), sep=None, engine="python", encoding=encoding)
                break
            except Exception:
                continue
        if frame is None:
            raise ValueError("Impossible de lire le fichier CSV.")
    elif extension == ".json":
        try:
            data = json.loads(content.decode("utf-8-sig"))
            if isinstance(data, dict):
                data = data.get("matches", data.get("data", data))
            if isinstance(data, dict):
                data = [data]
            frame = pd.json_normalize(data)
        except Exception:
            raise ValueError("Fichier JSON invalide.")
    else:
        raise ValueError("Format non pris en charge. Utilisez CSV, XLSX, XLS, ODS, JSON ou ZIP.")

    if frame.empty:
        raise ValueError("Le fichier ne contient aucune donnée.")
    return frame


def normalize_match_columns(df: pd.DataFrame) -> pd.DataFrame:
    def clean(name: str) -> str:
        norm = unicodedata.normalize("NFKD", str(name).strip().lower())
        norm = "".join(c for c in norm if not unicodedata.combining(c))
        return re.sub(r"[^a-z0-9]+", "_", norm).strip("_")

    df = df.copy()
    df.columns = [clean(col) for col in df.columns]
    aliases = {
        "match_date": ["date", "datetime", "date_match", "timestamp"],
        "home_team": [
            "home", "domicile", "equipe_domicile", "team_home",
            "player_home", "player1", "joueur1", "joueur_domicile",
        ],
        "away_team": [
            "away", "exterieur", "equipe_exterieure", "team_away",
            "player_away", "player2", "joueur2", "joueur_exterieur",
        ],
        "home_score": [
            "hg", "score_home", "score_domicile", "buts_domicile",
            "score1", "goals_home", "home_goals",
        ],
        "away_score": [
            "ag", "score_away", "score_exterieur", "buts_exterieur",
            "score2", "goals_away", "away_goals",
        ],
    }
    for standard, alternatives in aliases.items():
        if standard not in df.columns:
            for alternative in alternatives:
                if alternative in df.columns:
                    df = df.rename(columns={alternative: standard})
                    break
    if "score" in df.columns:
        scores = df["score"].astype(str).str.extract(r"(\d+)\s*[-:]\s*(\d+)")
        if "home_score" not in df.columns:
            df["home_score"] = scores[0]
        if "away_score" not in df.columns:
            df["away_score"] = scores[1]
    return df


def validate_import_data(df: pd.DataFrame) -> pd.DataFrame:
    required = ["match_date", "home_team", "away_team", "home_score", "away_score"]
    missing = [column for column in required if column not in df.columns]
    if missing:
        raise ValueError("Colonnes obligatoires manquantes : " + ", ".join(missing))
    if df.empty:
        raise ValueError("Le fichier ne contient aucun match.")

    df = df.copy().reset_index(drop=True)
    for column in ("home_team", "away_team"):
        df[column] = df[column].astype("string").map(lambda x: normalize_team_name(x) if pd.notna(x) else "")
        invalid = df[column].isna() | df[column].eq("") | df[column].str.lower().eq("nan")
        if invalid.any():
            rows = (df.index[invalid] + 2).tolist()
            raise ValueError(f"Nom d'équipe manquant aux lignes : {rows[:10]}")

    df["match_date"] = pd.to_datetime(df["match_date"], errors="coerce", utc=True)
    invalid_dates = df["match_date"].isna()
    if invalid_dates.any():
        rows = (df.index[invalid_dates] + 2).tolist()
        raise ValueError(f"Dates invalides aux lignes : {rows[:10]}")

    for column in ("home_score", "away_score"):
        scores = pd.to_numeric(df[column], errors="coerce")
        invalid = scores.isna() | (scores < 0) | (scores > 30) | (scores % 1 != 0)
        if invalid.any():
            rows = (df.index[invalid] + 2).tolist()
            raise ValueError(f"Scores invalides dans {column}, lignes : {rows[:10]}")
        df[column] = scores.astype(int)

    df = df.drop_duplicates(
        subset=["match_date", "home_team", "away_team", "home_score", "away_score"]
    ).reset_index(drop=True)
    return df


def load_validated_import(file: UploadFile) -> tuple[pd.DataFrame, bytes]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Nom de fichier manquant.")
    content = file.file.read(50 * 1024 * 1024 + 1)
    if not content:
        raise HTTPException(status_code=400, detail="Le fichier est vide.")
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Fichier trop volumineux : maximum 50 Mo.")
    frame = normalize_match_columns(read_import_file(file.filename, content))
    frame = validate_import_data(frame)
    return frame, content


# -----------------------------------------------------------------------------
# Routes Auth & Pages
# -----------------------------------------------------------------------------
@app.get("/", include_in_schema=False)
def home():
    index_path = os.path.join(BASE, "index.html")
    if not os.path.isfile(index_path):
        raise HTTPException(status_code=404, detail="Interface non installée.")
    return FileResponse(index_path, media_type="text/html")


@app.get("/api/owner-auth")
def owner_session_status(request: Request):
    token = request.cookies.get(OWNER_COOKIE_NAME, "")
    if not token or not OWNER_SESSION_SECRET:
        return {"authenticated": False}
    try:
        payload, signature = token.split(".", 1)
        expected = hmac.new(OWNER_SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return {"authenticated": False}
        decoded = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        valid = decoded.get("exp", 0) > int(time.time())
        return {"authenticated": bool(valid)}
    except Exception:
        return {"authenticated": False}


@app.post("/api/owner-auth")
async def owner_auth(request: Request):
    if not OWNER_PIN or not OWNER_SESSION_SECRET:
        raise HTTPException(status_code=503, detail="Authentification propriétaire non configurée côté serveur.")
    try:
        body = await request.json()
    except Exception:
        body = {}
    supplied = str(body.get("pin", "")) if isinstance(body, dict) else ""
    if not hmac.compare_digest(supplied, OWNER_PIN):
        raise HTTPException(status_code=401, detail="Code propriétaire incorrect.")
    payload = base64.urlsafe_b64encode(
        json.dumps({"exp": int(time.time()) + OWNER_SESSION_SECONDS}).encode()
    ).decode().rstrip("=")
    signature = hmac.new(OWNER_SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    result = JSONResponse({"authenticated": True})
    result.set_cookie(
        OWNER_COOKIE_NAME,
        f"{payload}.{signature}",
        max_age=OWNER_SESSION_SECONDS,
        httponly=True,
        secure=os.getenv("COOKIE_SECURE", "true").lower() == "true",
        samesite="strict",
        path="/",
    )
    return result


@app.delete("/api/owner-auth")
def owner_logout():
    result = JSONResponse({"authenticated": False})
    result.delete_cookie(OWNER_COOKIE_NAME, path="/")
    return result


@app.post("/auth/signup")
def signup(data: SignupRequest):
    client = get_supabase_client()
    try:
        result = client.auth.sign_up({"email": data.email.strip(), "password": data.password})
        return {
            "status": "success",
            "confirmation_required": not bool(result.session),
            "message": "Compte créé. Vérifiez votre adresse e-mail si la confirmation est activée.",
        }
    except Exception:
        raise HTTPException(status_code=400, detail="Inscription impossible. Vérifiez l'adresse e-mail et les paramètres Supabase.")


@app.post("/auth/login")
def login(data: LoginRequest):
    try:
        client = get_supabase_client()
        result = client.auth.sign_in_with_password({
            "email": data.email.strip(),
            "password": data.password,
        })
        if not result.session:
            raise HTTPException(status_code=401, detail="Connexion impossible.")
        return {
            "access_token": result.session.access_token,
            "refresh_token": result.session.refresh_token,
            "token_type": "bearer",
            "expires_in": result.session.expires_in,
            "user": {"id": result.user.id, "email": result.user.email},
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("[AUTH LOGIN ERROR] type=%s msg=%s", type(exc).__name__, str(exc)[:300])
        raise HTTPException(status_code=401, detail="Échec de connexion. Vérifiez vos identifiants.")


@app.post("/auth/update-password")
def update_password(data: UpdatePasswordRequest):
    client = get_supabase_client()
    try:
        client.auth.set_session(data.access_token, data.refresh_token)
        client.auth.update_user({"password": data.new_password})
        return {"status": "success", "message": "Mot de passe modifié avec succès."}
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible de modifier le mot de passe. Vérifiez le lien de récupération.")


@app.post("/auth/forgot-password")
def forgot_password(data: ForgotPasswordRequest, request: Request):
    client = get_supabase_client()
    redirect_base = FRONTEND_URL or str(request.base_url).rstrip("/")
    redirect_to = f"{redirect_base}/auth/reset-password"
    try:
        client.auth.reset_password_for_email(data.email.strip(), options={"redirect_to": redirect_to})
        return {"status": "success", "message": "Si le compte existe, un lien de récupération sera envoyé."}
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible d'envoyer le lien de récupération.")


@app.get("/auth/reset-password", response_class=HTMLResponse)
def reset_password_page():
    html = r'''<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KHALEB PREDICT - Nouveau mot de passe</title><script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script><style>body{font-family:Arial;background:#101827;color:white;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.box{background:#1e293b;padding:30px;border-radius:15px;width:85%;max-width:380px}input,button{width:100%;padding:12px;margin-top:15px;box-sizing:border-box;border-radius:7px}button{background:#16a34a;color:white;border:0;cursor:pointer;font-weight:bold}</style></head><body><div class="box"><h2>KHALEB PREDICT</h2><p>Choisissez votre nouveau mot de passe.</p><form id="resetForm"><input type="password" id="password" placeholder="Nouveau mot de passe" minlength="8" required><input type="password" id="confirm" placeholder="Confirmer le mot de passe" minlength="8" required><button type="submit">Modifier mon mot de passe</button></form><p id="message">Vérification du lien en cours...</p></div><script>const client=window.supabase.createClient("SUPABASE_URL_PLACEHOLDER","SUPABASE_KEY_PLACEHOLDER",{auth:{flowType:"pkce",detectSessionInUrl:true,persistSession:true}});const message=document.getElementById("message"),form=document.getElementById("resetForm");async function check(){const {data,error}=await client.auth.getSession();if(error||!data.session){message.textContent="Lien invalide ou expiré. Demandez un nouveau lien.";form.style.display="none";}else{message.textContent="Lien valide. Choisissez votre nouveau mot de passe.";}}check();form.onsubmit=async e=>{e.preventDefault();const p=document.getElementById("password").value,c=document.getElementById("confirm").value;if(p!==c){message.textContent="Les deux mots de passe ne correspondent pas.";return;}if(p.length<8){message.textContent="Le mot de passe doit contenir au moins 8 caractères.";return;}const {error}=await client.auth.updateUser({password:p});if(error){message.textContent=error.message;}else{message.textContent="Mot de passe modifié avec succès.";form.reset();form.style.display="none";}};</script></body></html>'''
    html = html.replace("SUPABASE_URL_PLACEHOLDER", quote(SUPABASE_URL, safe=":/"))
    html = html.replace("SUPABASE_KEY_PLACEHOLDER", SUPABASE_KEY)
    return html


@app.get("/auth/forgot-password-page", response_class=HTMLResponse)
def forgot_password_page():
    html = r'''<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KHALEB PREDICT - Récupération</title><script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script><style>body{font-family:Arial;background:#101827;color:white;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.box{background:#1e293b;padding:30px;border-radius:15px;width:85%;max-width:380px}input,button{width:100%;padding:12px;margin-top:15px;box-sizing:border-box;border-radius:7px}button{background:#16a34a;color:white;border:0;cursor:pointer}</style></head><body><div class="box"><h2>KHALEB PREDICT</h2><p>Récupération de votre compte</p><form id="recoveryForm"><input type="email" id="email" placeholder="Votre adresse e-mail" required><button type="submit">Envoyer le lien</button></form><p id="message"></p></div><script>const client=window.supabase.createClient("SUPABASE_URL_PLACEHOLDER","SUPABASE_KEY_PLACEHOLDER");document.getElementById("recoveryForm").onsubmit=async e=>{e.preventDefault();const message=document.getElementById("message");message.textContent="Envoi en cours...";const {error}=await client.auth.resetPasswordForEmail(document.getElementById("email").value,{redirectTo:window.location.origin+"/auth/reset-password"});message.textContent=error?"Erreur : "+error.message:"Si le compte existe, un lien a été envoyé.";};</script></body></html>'''
    html = html.replace("SUPABASE_URL_PLACEHOLDER", quote(SUPABASE_URL, safe=":/"))
    html = html.replace("SUPABASE_KEY_PLACEHOLDER", SUPABASE_KEY)
    return html


# -----------------------------------------------------------------------------
# Routes d'import
# -----------------------------------------------------------------------------
@app.post("/import/preview")
def preview_import_file(file: UploadFile = File(...), auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        frame, _ = load_validated_import(file)
        preview = frame.head(10).copy()
        preview["match_date"] = preview["match_date"].astype(str)
        return {
            "status": "success",
            "message": "Fichier vérifié avec succès.",
            "filename": file.filename,
            "total_matches": len(frame),
            "preview_matches": preview.to_dict(orient="records"),
        }
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible de lire ce fichier. Vérifiez son format et son contenu.")
    finally:
        file.file.close()


@app.post("/import/confirm")
def confirm_import_file(
    file: UploadFile = File(...),
    auth: AuthenticatedContext = Depends(get_auth_context),
):
    try:
        frame, _ = load_validated_import(file)
        records = [
            {
                "user_id": auth.user_id,
                "home_team": str(row.home_team),
                "away_team": str(row.away_team),
                "match_date": row.match_date.isoformat(),
                "home_score": int(row.home_score),
                "away_score": int(row.away_score),
                "source": "file_import",
                "validation_status": "pending",
                "is_test": False,
            }
            for row in frame.itertuples(index=False)
        ]
        inserted = 0
        for start in range(0, len(records), 100):
            response = auth.client.table("matches").insert(records[start:start + 100]).execute()
            inserted += len(response.data or [])
        return {
            "status": "success",
            "message": "Importation terminée.",
            "filename": file.filename,
            "total_matches_imported": inserted,
            "validation_status": "pending",
        }
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=500, detail="Erreur pendant l'importation. Vérifiez les droits et la structure de la table matches.")
    finally:
        file.file.close()


# -----------------------------------------------------------------------------
# Moteur Machine Learning (CatBoost + XGBoost + Elo)
# -----------------------------------------------------------------------------
def _build_feature_row(
    home_raw: str,
    away_raw: str,
    elo: dict[str, float],
    stats: dict[str, dict[str, Any]],
) -> tuple[dict[str, float], dict[str, Any]]:
    hk = normalize_team_key(home_raw)
    ak = normalize_team_key(away_raw)
    H = stats.get(hk, {"n": 0, "gf": 0, "ga": 0, "form": []})
    A = stats.get(ak, {"n": 0, "gf": 0, "ga": 0, "form": []})

    home_gf = (H["gf"] + 8.0) / (H["n"] + 3.0)
    home_ga = (H["ga"] + 8.0) / (H["n"] + 3.0)
    away_gf = (A["gf"] + 8.0) / (A["n"] + 3.0)
    away_ga = (A["ga"] + 8.0) / (A["n"] + 3.0)
    home_form5 = float(sum(H["form"][-5:]))
    away_form5 = float(sum(A["form"][-5:]))

    row = {
        "elo_diff": float(elo.get(hk, 1500.0) - elo.get(ak, 1500.0)),
        "home_n": float(H["n"]),
        "away_n": float(A["n"]),
        "home_gf": float(home_gf),
        "home_ga": float(home_ga),
        "away_gf": float(away_gf),
        "away_ga": float(away_ga),
        "gf_diff": float(home_gf - away_gf),
        "ga_diff": float(home_ga - away_ga),
        "home_form5": home_form5,
        "away_form5": away_form5,
        "form5_diff": float(home_form5 - away_form5),
    }
    meta = {
        "home_known_matches": int(H["n"]),
        "away_known_matches": int(A["n"]),
        "home_elo": round(float(elo.get(hk, 1500.0)), 1),
        "away_elo": round(float(elo.get(ak, 1500.0)), 1),
    }
    return row, meta


def make_features(df: pd.DataFrame):
    d = df.copy()
    d["date"] = pd.to_datetime(d["date"], errors="coerce", utc=True)
    d = d.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)
    elo: dict[str, float] = {}
    stats: dict[str, dict[str, Any]] = {}
    rows, labels = [], []

    for match in d.itertuples(index=False):
        home = normalize_team_key(str(match.home))
        away = normalize_team_key(str(match.away))
        if not home or not away:
            continue
        hg = int(match.hg)
        ag = int(match.ag)

        feat_row, _ = _build_feature_row(home, away, elo, stats)
        rows.append(feat_row)

        result = 0 if hg > ag else 1 if hg == ag else 2
        labels.append(result)

        home_outcome = 1.0 if result == 0 else 0.5 if result == 1 else 0.0
        expected_home = 1.0 / (1.0 + 10.0 ** ((elo.get(away, 1500.0) - (elo.get(home, 1500.0) + 35.0)) / 400.0))
        elo[home] = elo.get(home, 1500.0) + 24.0 * (home_outcome - expected_home)
        elo[away] = elo.get(away, 1500.0) + 24.0 * ((1.0 - home_outcome) - (1.0 - expected_home))

        for team_key, gf, ga, form_value in (
            (home, hg, ag, home_outcome),
            (away, ag, hg, 1.0 - home_outcome),
        ):
            item = stats.setdefault(team_key, {"n": 0, "gf": 0, "ga": 0, "form": []})
            item["n"] += 1
            item["gf"] += gf
            item["ga"] += ga
            item["form"].append(float(form_value))

    return d, pd.DataFrame(rows, columns=FEATURES), np.asarray(labels, dtype=int), elo, stats


def _run_training_pipeline(matches_rows: list[dict[str, Any]]) -> dict[str, Any]:
    _, X, y, elo, stats = make_features(pd.DataFrame(matches_rows))
    if len(X) < 300:
        raise ValueError("Nombre insuffisant de matchs exploitables.")
    cut = int(len(X) * 0.8)
    if len(set(y[:cut])) < 3 or len(set(y[cut:])) < 3:
        raise ValueError("Les trois issues 1, N et 2 doivent être présentes dans les ensembles d'entraînement et de test.")

    cat = CatBoostClassifier(
        iterations=350,
        depth=6,
        learning_rate=0.04,
        loss_function="MultiClass",
        verbose=False,
        random_seed=42,
    )
    xgb = XGBClassifier(
        n_estimators=350,
        max_depth=5,
        learning_rate=0.04,
        subsample=0.85,
        colsample_bytree=0.85,
        objective="multi:softprob",
        num_class=3,
        eval_metric="mlogloss",
        random_state=42,
        n_jobs=2,
    )
    cat.fit(X.iloc[:cut], y[:cut])
    xgb.fit(X.iloc[:cut], y[:cut])

    probabilities = (cat.predict_proba(X.iloc[cut:]) + xgb.predict_proba(X.iloc[cut:])) / 2.0
    probabilities = np.clip(probabilities, 1e-6, 1.0 - 1e-6)
    probabilities = probabilities / probabilities.sum(axis=1, keepdims=True)

    accuracy = float(accuracy_score(y[cut:], probabilities.argmax(axis=1)))
    loss = float(log_loss(y[cut:], probabilities, labels=[0, 1, 2]))
    one_hot = np.eye(3, dtype=float)[y[cut:]]
    brier = float(np.mean([brier_score_loss(one_hot[:, k], probabilities[:, k]) for k in range(3)]))

    return {
        "artifact": {
            "cat": cat,
            "xgb": xgb,
            "elo": elo,
            "stats": stats,
            "features": FEATURES,
            "trained_matches": int(len(X)),
            "model_version": MODEL_VERSION,
        },
        "total_matches": int(len(X)),
        "train_matches": int(cut),
        "test_matches": int(len(y) - cut),
        "accuracy": accuracy,
        "log_loss": loss,
        "brier_score": brier,
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": "2.1.0",
        "model_storage": "local_filesystem",
        "supabase_configured": bool(SUPABASE_URL and SUPABASE_KEY),
        "note": "Le modèle est stocké par utilisateur; vérifier /model-status avec une session pour son état.",
    }


@app.get("/model-status")
def model_status(auth: AuthenticatedContext = Depends(get_auth_context)):
    path = get_user_model_path(auth.user_id)
    exists = os.path.isfile(path)
    loaded = load_user_model(auth.user_id) if exists else None
    return {
        "model_trained": bool(exists and loaded is not None),
        "storage": "local_filesystem",
        "model_version": loaded.get("model_version") if loaded else None,
        "trained_matches": loaded.get("trained_matches") if loaded else 0,
    }


@app.post("/train")
async def train(auth: AuthenticatedContext = Depends(get_auth_context)):
    lock = get_training_lock(auth.user_id)
    if lock.locked():
        raise HTTPException(status_code=409, detail="Un entraînement est déjà en cours pour ce compte.")

    async with lock:
        try:
            data: list[dict[str, Any]] = []
            start = 0
            page_size = 1000
            while True:
                response = (
                    auth.client.table("matches")
                    .select("match_date,home_team,away_team,home_score,away_score,validation_status,is_test")
                    .eq("user_id", auth.user_id)
                    .eq("validation_status", "validated")
                    .eq("is_test", False)
                    .not_.is_("home_score", "null")
                    .not_.is_("away_score", "null")
                    .order("match_date")
                    .range(start, start + page_size - 1)
                    .execute()
                )
                page = response.data or []
                for match in page:
                    if (
                        match.get("match_date")
                        and match.get("home_team")
                        and match.get("away_team")
                        and match.get("home_score") is not None
                        and match.get("away_score") is not None
                    ):
                        data.append({
                            "date": match["match_date"],
                            "home": normalize_team_name(match["home_team"]),
                            "away": normalize_team_name(match["away_team"]),
                            "hg": int(match["home_score"]),
                            "ag": int(match["away_score"]),
                        })
                if len(page) < page_size:
                    break
                start += page_size

            if len(data) < 300:
                return {
                    "status": "insufficient_data",
                    "observed_matches": len(data),
                    "minimum_recommended": 300,
                    "message": "Il faut au moins 300 matchs réels validés pour lancer l'entraînement.",
                }

            trained = await asyncio.to_thread(_run_training_pipeline, data)
            model_path = get_user_model_path(auth.user_id)
            os.makedirs(os.path.dirname(model_path), exist_ok=True)
            await asyncio.to_thread(joblib.dump, trained["artifact"], model_path)
            _load_model_cached.cache_clear()

            metrics_saved = False
            try:
                auth.client.table("model_performance").insert({
                    "user_id": auth.user_id,
                    "model_version": MODEL_VERSION,
                    "accuracy": trained["accuracy"],
                    "log_loss": trained["log_loss"],
                    "brier_score": trained["brier_score"],
                    "total_matches": trained["total_matches"],
                    "metrics": {
                        "train_matches": trained["train_matches"],
                        "test_matches": trained["test_matches"],
                        "evaluation": "chronological_holdout_80_20",
                    },
                }).execute()
                metrics_saved = True
            except Exception:
                pass

            return {
                "status": "trained",
                "message": "Entraînement terminé.",
                "model_version": MODEL_VERSION,
                "total_matches": trained["total_matches"],
                "train_matches": trained["train_matches"],
                "test_matches": trained["test_matches"],
                "accuracy_1x2": round(trained["accuracy"], 4),
                "log_loss": round(trained["log_loss"], 4),
                "brier_score": round(trained["brier_score"], 4),
                "metrics_saved_to_supabase": metrics_saved,
                "classes": ["1", "N", "2"],
                "model_storage": "persistent_disk_required",
            }
        except HTTPException:
            raise
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            logger.exception("Échec entraînement user=%s : %s", auth.user_id[:8], exc)
            raise HTTPException(
                status_code=500,
                detail="Échec de l'entraînement. Vérifiez les données, dépendances et journaux du serveur.",
            )


@app.post("/predict")
def predict(q: Query, auth: AuthenticatedContext = Depends(get_auth_context)):
    model = load_user_model(auth.user_id)
    if not model:
        raise HTTPException(status_code=400, detail="Aucun modèle entraîné pour ce compte.")
    try:
        elo = model.get("elo", {})
        stats = model.get("stats", {})
        feat_cols = model.get("features", FEATURES)
        feat_row, meta = _build_feature_row(q.home, q.away, elo, stats)
        features = pd.DataFrame([feat_row], columns=feat_cols)

        p = (model["cat"].predict_proba(features)[0] + model["xgb"].predict_proba(features)[0]) / 2.0
        p_arr = np.clip(np.asarray(p, dtype=float), 0.0, 1.0)
        p_sum = float(p_arr.sum())
        if p_sum > 0:
            p_arr = p_arr / p_sum

        probs = {
            "1": round(float(p_arr[0]), 4),
            "N": round(float(p_arr[1]), 4),
            "2": round(float(p_arr[2]), 4),
        }
        best_idx = int(np.argmax(p_arr))
        most_likely = ["1", "N", "2"][best_idx]
        confidence = "standard" if min(meta["home_known_matches"], meta["away_known_matches"]) >= 5 else "faible_historique"

        return {
            "home": q.home,
            "away": q.away,
            "probabilities": probs,
            "most_likely_outcome": most_likely,
            "confidence": confidence,
            "context": meta,
            "data_type": "estimation_IA",
            "model_version": model.get("model_version", MODEL_VERSION),
            "warning": "Probabilités expérimentales, issues de données historiques validées. Aucun résultat n'est garanti.",
        }
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Erreur pendant la prédiction.")


# -----------------------------------------------------------------------------
# Routes CRUD Base de données
# -----------------------------------------------------------------------------
@app.get("/db/test")
def test_database(auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        result = auth.client.table("players").select("id").eq("user_id", auth.user_id).limit(1).execute()
        return {
            "status": "success",
            "message": "Connexion Supabase réussie.",
            "table": "players",
            "connection": True,
            "visible_rows": len(result.data or []),
        }
    except Exception:
        raise HTTPException(status_code=500, detail="Échec du test de la base de données.")


@app.post("/players")
def create_player(player: PlayerCreate, auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        result = auth.client.table("players").insert({
            "user_id": auth.user_id,
            "name": normalize_team_name(player.name),
            "alias": player.alias.strip() if player.alias else None,
        }).execute()
        return {"status": "success", "data": result.data}
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible d'enregistrer ce joueur.")


@app.get("/players")
def get_players(auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        result = auth.client.table("players").select("*").eq("user_id", auth.user_id).execute()
        return {"status": "success", "total": len(result.data or []), "data": result.data or []}
    except Exception:
        raise HTTPException(status_code=500, detail="Impossible de récupérer les joueurs.")


@app.post("/matches")
def create_match(match: MatchCreate, auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        payload = match.model_dump()
        payload["user_id"] = auth.user_id
        result = auth.client.table("matches").insert(payload).execute()
        return {"status": "success", "data": result.data}
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible d'enregistrer ce match.")


@app.patch("/matches/{match_id}/validate")
def validate_match(
    match_id: str,
    home_score: int = QueryParam(ge=0, le=30),
    away_score: int = QueryParam(ge=0, le=30),
    auth: AuthenticatedContext = Depends(get_auth_context),
):
    try:
        match_check = auth.client.table("matches").select("id").eq("id", match_id).eq("user_id", auth.user_id).execute()
        if not match_check.data:
            raise HTTPException(status_code=404, detail="Match introuvable ou inaccessible.")
        result = auth.client.table("matches").update({
            "home_score": home_score,
            "away_score": away_score,
            "validation_status": "validated",
        }).eq("id", match_id).eq("user_id", auth.user_id).execute()
        return {"status": "success", "data": result.data}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible de valider ce match.")


@app.get("/matches")
def get_matches(auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        result = auth.client.table("matches").select("*").eq("user_id", auth.user_id).execute()
        return {"status": "success", "total": len(result.data or []), "data": result.data or []}
    except Exception:
        raise HTTPException(status_code=500, detail="Impossible de récupérer les matchs.")


@app.post("/odds")
def create_odds(odds: OddsCreate, auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        match_check = auth.client.table("matches").select("id").eq("id", odds.match_id).eq("user_id", auth.user_id).execute()
        if not match_check.data:
            raise HTTPException(status_code=404, detail="Match introuvable ou inaccessible.")
        payload = odds.model_dump()
        payload["user_id"] = auth.user_id
        result = auth.client.table("odds").insert(payload).execute()
        return {"status": "success", "data": result.data}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible d'enregistrer ces cotes.")


@app.get("/odds")
def get_odds(auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        result = auth.client.table("odds").select("*").eq("user_id", auth.user_id).execute()
        return {"status": "success", "total": len(result.data or []), "data": result.data or []}
    except Exception:
        raise HTTPException(status_code=500, detail="Impossible de récupérer les cotes.")


@app.post("/coupons")
def create_coupon(coupon: CouponCreate, auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        payload = coupon.model_dump()
        payload["user_id"] = auth.user_id
        result = auth.client.table("coupons").insert(payload).execute()
        return {"status": "success", "data": result.data}
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible d'enregistrer ce coupon.")


@app.get("/coupons")
def get_coupons(auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        result = auth.client.table("coupons").select("*").eq("user_id", auth.user_id).execute()
        return {"status": "success", "total": len(result.data or []), "data": result.data or []}
    except Exception:
        raise HTTPException(status_code=500, detail="Impossible de récupérer les coupons.")


@app.post("/coupon-selections")
def create_coupon_selection(selection: CouponSelectionCreate, auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        coupon_check = auth.client.table("coupons").select("id").eq("id", selection.coupon_id).eq("user_id", auth.user_id).execute()
        if not coupon_check.data:
            raise HTTPException(status_code=404, detail="Coupon introuvable ou inaccessible.")
        match_check = auth.client.table("matches").select("id").eq("id", selection.match_id).eq("user_id", auth.user_id).execute()
        if not match_check.data:
            raise HTTPException(status_code=404, detail="Match introuvable ou inaccessible.")
        result = auth.client.table("coupon_selections").insert({
            "coupon_id": selection.coupon_id,
            "match_id": selection.match_id,
            "selection_type": selection.selection_type,
            "selection_value": selection.selection_value,
            "odds": selection.odds,
        }).execute()
        return {"status": "success", "data": result.data}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible d'enregistrer cette sélection.")


@app.get("/coupon-selections")
def get_coupon_selections(auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        coupons = auth.client.table("coupons").select("id").eq("user_id", auth.user_id).execute()
        coupon_ids = [item["id"] for item in (coupons.data or [])]
        if not coupon_ids:
            return {"status": "success", "total": 0, "data": []}
        result = auth.client.table("coupon_selections").select("*").in_("coupon_id", coupon_ids).execute()
        return {"status": "success", "total": len(result.data or []), "data": result.data or []}
    except Exception:
        raise HTTPException(status_code=500, detail="Impossible de récupérer les sélections.")


@app.post("/predictions")
def create_prediction(prediction: PredictionCreate, auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        match_check = auth.client.table("matches").select("id").eq("id", prediction.match_id).eq("user_id", auth.user_id).execute()
        if not match_check.data:
            raise HTTPException(status_code=404, detail="Match introuvable ou inaccessible.")
        payload = prediction.model_dump()
        payload["user_id"] = auth.user_id
        result = auth.client.table("predictions").insert(payload).execute()
        return {"status": "success", "data": result.data}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible d'enregistrer cette prédiction.")


@app.get("/predictions")
def get_predictions(auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        result = auth.client.table("predictions").select("*").eq("user_id", auth.user_id).execute()
        return {"status": "success", "total": len(result.data or []), "data": result.data or []}
    except Exception:
        raise HTTPException(status_code=500, detail="Impossible de récupérer les prédictions.")


@app.post("/model-performance")
def create_model_performance(performance: ModelPerformanceCreate, auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        payload = performance.model_dump()
        payload["user_id"] = auth.user_id
        result = auth.client.table("model_performance").insert(payload).execute()
        return {"status": "success", "data": result.data}
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible d'enregistrer les performances.")


@app.get("/model-performance")
def get_model_performance(auth: AuthenticatedContext = Depends(get_auth_context)):
    try:
        result = auth.client.table("model_performance").select("*").eq("user_id", auth.user_id).execute()
        return {"status": "success", "total": len(result.data or []), "data": result.data or []}
    except Exception:
        raise HTTPException(status_code=500, detail="Impossible de récupérer les performances.")
