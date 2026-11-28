# KHALEB PREDICT OS — livraison consolidée

## Fichiers
- `index.html` : interface web existante.
- `api.py` : API FastAPI, authentification Supabase, CRUD, import, entraînement et prédiction.
- `requirements.txt` : dépendances Python.
- `supabase_setup.sql` : schéma de référence et politiques RLS.
- `render.yaml` : modèle de déploiement Render.
- `.env.example` : variables sans secrets.
- `scripts/backup_supabase.sh` et `.github/workflows/` : sauvegarde existante.

## Déploiement
1. Décompresser le ZIP et copier le contenu de `khaleb-predict-main` à la racine du dépôt GitHub, branche `main`.
2. Garder toutes les valeurs secrètes uniquement dans Render > Environment.
3. Build : `pip install -r requirements.txt`
4. Start : `uvicorn api:app --host 0.0.0.0 --port $PORT`
5. Health check : `/health`
6. Vérifier `/health`, `/docs`, puis se connecter via `/auth/login`.
7. Dans Swagger, autoriser le jeton Bearer puis tester `/model-status` et `/matches`.

## Stockage du modèle
Le backend isole les modèles par utilisateur. `MODELS_DIR` doit pointer vers un disque persistant attaché au service Render. Le `render.yaml` fourni donne un exemple de montage sous `/var/data/models`. Vérifier dans Render que le disque est effectivement créé et monté. Sans disque persistant, les artefacts peuvent être perdus lors d'un redémarrage ou redéploiement.

## Données et entraînement
- L'entraînement utilise uniquement les matchs du compte courant avec `validation_status='validated'`, `is_test=false` et scores présents.
- Le seuil technique du code est de 300 matchs exploitables. Ce seuil ne garantit pas la qualité.
- Les données importées sont créées en statut `pending` et doivent être vérifiées/validées.
- Ne pas convertir les enregistrements de test en données réelles.
- Évaluer les métriques sur une période chronologique indépendante.

## Limites connues
- Le bouton de prédiction du frontend n'est pas encore connecté à `/predict`.
- Le module matchs réels n'est pas un registre cloud complet.
- Change/crypto, paiements, transfert d'argent, transporteurs, GPS et données sportives externes nécessitent des fournisseurs et clés API non inclus.
- Navigator et Wheel of Luck 2 ne sont pas intégrés techniquement.
- Les données locales du navigateur (`localStorage`) ne se synchronisent pas automatiquement entre appareils.
- Les prédictions restent des estimations, jamais des garanties de résultat ou de gain.

## Vérifications de cette livraison
- Compilation Python de `api.py` : réussie.
- Vérification syntaxique Node.js des scripts intégrés à `index.html` : réussie.
- Non vérifié ici : authentification réelle Supabase, RLS multi-utilisateur, import sur la base distante, entraînement, prédiction réelle, intégrations tierces et déploiement Render.
