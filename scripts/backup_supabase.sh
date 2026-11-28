#!/usr/bin/env bash

set -Eeuo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
    echo "ERREUR : URL de connexion Supabase manquante."
    exit 1
fi

if [[ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]]; then
    echo "ERREUR : Mot de passe de chiffrement manquant."
    exit 1
fi

umask 077

BACKUP_DIR="backups"
TIMESTAMP="$(date -u +%Y-%m-%d_%H-%M-%S)"

mkdir -p "$BACKUP_DIR"

DUMP_FILE="$BACKUP_DIR/supabase_${TIMESTAMP}.dump"
ENCRYPTED_FILE="${DUMP_FILE}.gpg"

cleanup() {
    rm -f "$DUMP_FILE"
}

trap cleanup EXIT

echo "Début de la sauvegarde Supabase..."

pg_dump \
    --format=custom \
    --no-owner \
    --no-acl \
    --file="$DUMP_FILE" \
    "$SUPABASE_DB_URL"

echo "Chiffrement de la sauvegarde..."

printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | \
gpg --batch \
    --yes \
    --pinentry-mode loopback \
    --passphrase-fd 0 \
    --symmetric \
    --cipher-algo AES256 \
    --output "$ENCRYPTED_FILE" \
    "$DUMP_FILE"

echo "Vérification du fichier chiffré..."

gpg --batch --list-only "$ENCRYPTED_FILE" >/dev/null

sha256sum "$ENCRYPTED_FILE" > "${ENCRYPTED_FILE}.sha256"

echo "Sauvegarde chiffrée créée avec succès."
echo "Fichier : $ENCRYPTED_FILE"
