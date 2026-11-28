[Uploading README_FINAL_FR.md…]()
# KHALEB PREDICT OS — paquet de déploiement

Cette archive contient le projet fourni et les fichiers de préparation au déploiement. Elle n'inclut aucune clé, aucun mot de passe ni code PIN.

## Contenu

- `index.html` : interface web actuelle.
- `api.py` : API FastAPI, authentification Supabase, import et entraînement ML.
- `requirements.txt` : dépendances Python.
- `supabase_setup.sql` : schéma et politiques RLS à examiner puis exécuter dans Supabase.
- `render.yaml` : configuration de base Render.
- `.env.example` : noms des variables attendues, sans valeurs secrètes.
- `.github/workflows/` et `scripts/` : sauvegarde Supabase existante.

## Déploiement Render

1. Envoyer le contenu de ce dossier à la racine du dépôt GitHub (branche `main`).
2. Dans Render, créer un **Web Service** depuis ce dépôt.
3. Build command : `pip install -r requirements.txt`
4. Start command : `uvicorn api:app --host 0.0.0.0 --port $PORT`
5. Définir les variables d'environnement listées ci-dessous.
6. Vérifier `https://VOTRE-SERVICE.onrender.com/health` et `/docs`.

`render.yaml` est un modèle de configuration. Vérifier les paramètres affichés par Render avant de confirmer la création du service.

## Variables d'environnement

- `SUPABASE_URL` : URL du projet Supabase.
- `SUPABASE_KEY` : clé publique anon/publishable uniquement.
- `FRONTEND_URL` : origine publique exacte de l'interface si elle est hébergée séparément.
- `ALLOWED_ORIGINS` : liste séparée par virgules des origines autorisées.
- `OWNER_PIN` : code propriétaire configuré uniquement dans les secrets Render.
- `OWNER_SESSION_SECRET` : secret aléatoire long, distinct du PIN.
- `COOKIE_SECURE=true` en HTTPS.
- `MODELS_DIR` : dossier de stockage des modèles.

Ne jamais mettre `service_role`, mot de passe DB, PIN ou secret dans `index.html`, dans GitHub ou dans un message. Le navigateur ne doit utiliser que la clé publique Supabase.

## Configuration Supabase

1. Faire une sauvegarde avant toute modification.
2. Ouvrir SQL Editor dans le projet Supabase.
3. Examiner `supabase_setup.sql` et l'exécuter.
4. Vérifier les politiques RLS avec deux comptes utilisateurs différents.
5. Dans Authentication, configurer les URL de redirection autorisées pour le domaine de l'API.

## État fonctionnel et limites à ne pas masquer

- Le frontend conserve une part importante de son état dans `localStorage`. Cela signifie que ces données ne suivent pas automatiquement l'utilisateur sur un autre appareil.
- Le backend possède des routes Supabase et ML, mais les tests d'intégration avec le vrai projet Supabase, les politiques RLS, l'entraînement sur l'historique réel et les sessions n'ont pas été exécutés dans cet environnement.
- Les matchs réels ne sont pas un registre cloud complet dans cette version.
- Navigator et Wheel of Luck 2 ne sont pas intégrés techniquement : aucun jeu n'est reproduit. Accéder à ces jeux doit se faire sur la plateforme de l'opérateur, si disponible dans le pays et le compte.
- Les cours de change ou de crypto affichés par l'interface sont informatifs et dépendent des API externes accessibles. Ils ne constituent ni un ordre ni un transfert d'argent.
- Les paiements, le transfert d'argent, les transporteurs, les services GPS et les données sportives en direct nécessitent des fournisseurs, contrats, clés API et contrôles réglementaires propres à chaque pays.
- L'entraînement nécessite au moins 300 matchs validés selon le code, mais ce seuil ne prouve pas la fiabilité. Les performances doivent être évaluées sur un jeu chronologique indépendant.
- Le stockage local des modèles n'est pas durable sur un système de fichiers éphémère. Configurer un disque persistant ou un stockage objet avant de dépendre de modèles entraînés en production.

## Vérifications locales effectuées pour ce paquet

- Compilation Python de `api.py` : réussie.
- Vérification syntaxique Node.js des scripts JavaScript intégrés à `index.html` : réussie.

Ces contrôles ne remplacent pas des tests réels d'authentification, de base de données, de paiement, de flux externes, de charge ou de déploiement.
