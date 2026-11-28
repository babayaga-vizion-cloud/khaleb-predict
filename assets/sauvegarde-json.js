(function initialiserSauvegardeJsonKhaleb() {
  const CLE_FILE_HORS_LIGNE = 'khaleb_predict_bankroll_queue_v1';
  const DEVISES_AUTORISEES = new Set(['XAF', 'EUR', 'USD', 'GBP', 'NGN', 'KES', 'MAD', 'BRL', 'CAD']);
  const STATUTS_VALIDES = new Set(['pending', 'won', 'lost', 'void']);
  const MAX_OCTETS_IMPORT = 1_048_576;
  const MAX_TICKETS_IMPORT = 1000;

  function formaterErreur(err, fallback) {
    return err instanceof Error && err.message ? err.message : fallback;
  }

  function estDateIsoValide(valeur) {
    if (valeur === null || valeur === undefined || valeur === '') return true;
    if (typeof valeur !== 'string') return false;
    return Number.isFinite(Date.parse(valeur));
  }

  function nettoyerChaine(valeur, maxLongueur = 160) {
    if (typeof valeur !== 'string') return '';
    return valeur.trim().slice(0, maxLongueur);
  }

  function validerEtNormaliserTicket(brut, index = 0) {
    if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
      throw new Error(`Ticket #${index + 1} : structure objet invalide.`);
    }

    for (const cle of ['__proto__', 'constructor', 'prototype']) {
      if (Object.prototype.hasOwnProperty.call(brut, cle)) {
        throw new Error(`Ticket #${index + 1} : propriété interdite détectée.`);
      }
    }

    const eventLabel = nettoyerChaine(brut.event_label, 140);
    if (!eventLabel) {
      throw new Error(`Ticket #${index + 1} : le champ event_label est obligatoire.`);
    }

    const marketBrut = brut.market === null || brut.market === undefined
      ? null
      : nettoyerChaine(brut.market, 100);
    const market = marketBrut || null;

    const odds = Number(brut.odds);
    if (!Number.isFinite(odds) || odds <= 1 || odds > 1000) {
      throw new Error(`Ticket #${index + 1} : la cote (odds) doit être comprise entre 1 et 1000.`);
    }

    const stake = Number(brut.stake);
    if (!Number.isFinite(stake) || stake <= 0 || stake > 100_000_000) {
      throw new Error(`Ticket #${index + 1} : la mise (stake) doit être strictement positive.`);
    }

    const currency = String(brut.currency || 'XAF').trim().toUpperCase();
    if (!DEVISES_AUTORISEES.has(currency)) {
      throw new Error(`Ticket #${index + 1} : devise non autorisée (${currency}).`);
    }

    const status = String(brut.status || 'pending').trim().toLowerCase();
    if (!STATUTS_VALIDES.has(status)) {
      throw new Error(`Ticket #${index + 1} : statut invalide (${status}).`);
    }

    let pnl = Number(brut.pnl);
    if (!Number.isFinite(pnl)) {
      if (status === 'won') pnl = Number((stake * (odds - 1)).toFixed(2));
      else if (status === 'lost') pnl = Number((-stake).toFixed(2));
      else pnl = 0;
    }

    if (!estDateIsoValide(brut.placed_at) || !estDateIsoValide(brut.settled_at)) {
      throw new Error(`Ticket #${index + 1} : format de date ISO invalide.`);
    }

    const maintenant = new Date().toISOString();
    const idNettoye = nettoyerChaine(brut.id, 80) || `local-${Date.now()}-${index}`;

    return {
      id: idNettoye.startsWith('local-') ? idNettoye : `local-imp-${idNettoye}`,
      event_label: eventLabel,
      market,
      odds: Number(odds.toFixed(2)),
      stake: Number(stake.toFixed(2)),
      pnl: Number(pnl.toFixed(2)),
      currency,
      status,
      placed_at: brut.placed_at ? new Date(brut.placed_at).toISOString() : maintenant,
      settled_at: status === 'pending'
        ? null
        : (brut.settled_at ? new Date(brut.settled_at).toISOString() : maintenant),
      _offlineQueued: true
    };
  }

  function extraireTableauTicketsDepuisChargeUtile(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }
    if (payload && typeof payload === 'object' && Array.isArray(payload.tickets)) {
      if (payload.app && String(payload.app) !== 'khaleb-predict') {
        throw new Error('Identifiant d’application invalide dans le fichier JSON.');
      }
      return payload.tickets;
    }
    throw new Error('Format JSON non reconnu : un tableau de tickets ou un objet { app, tickets } est attendu.');
  }

  function exporterTicketsJson(ticketsSource = null, options = {}) {
    try {
      const listeSource = Array.isArray(ticketsSource)
        ? ticketsSource
        : (typeof window !== 'undefined' && window.KhalebBankroll && typeof window.KhalebBankroll.lireFileHorsLigne === 'function'
            ? window.KhalebBankroll.lireFileHorsLigne()
            : []);

      const ticketsPropres = listeSource.map((t, idx) => validerEtNormaliserTicket(t, idx));
      const enveloppe = {
        app: 'khaleb-predict',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        count: ticketsPropres.length,
        tickets: ticketsPropres
      };

      const jsonTexte = JSON.stringify(enveloppe, null, 2);

      if (options.declencherTelechargement !== false && typeof document !== 'undefined' && typeof Blob !== 'undefined') {
        const blob = new Blob([jsonTexte], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const lien = document.createElement('a');
        const dateJour = new Date().toISOString().slice(0, 10);
        lien.href = url;
        lien.download = options.nomFichier || `khaleb-predict-tickets-${dateJour}.json`;
        document.body.appendChild(lien);
        lien.click();
        lien.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      window.KhalebBankroll?.definirStatutBankroll?.(
        `Export JSON réussi (${ticketsPropres.length} ticket(s)).`,
        'syncing'
      );

      return { ok: true, count: ticketsPropres.length, json: jsonTexte, tickets: ticketsPropres };
    } catch (err) {
      const msg = formaterErreur(err, 'Échec de l’export JSON.');
      window.KhalebBankroll?.definirStatutBankroll?.(`Erreur export : ${msg}`, 'warning');
      return { ok: false, error: msg, tickets: [] };
    }
  }

  function importerTicketsJson(contenuJson, options = {}) {
    try {
      if (typeof contenuJson !== 'string') {
        throw new Error('Le contenu importé doit être une chaîne JSON.');
      }

      const tailleOctets = typeof Blob !== 'undefined'
        ? new Blob([contenuJson]).size
        : contenuJson.length * 2;
      if (tailleOctets > MAX_OCTETS_IMPORT) {
        throw new Error('Fichier JSON trop volumineux (limite : 1 Mo).');
      }

      const parse = JSON.parse(contenuJson);
      const candidats = extraireTableauTicketsDepuisChargeUtile(parse);

      if (candidats.length > MAX_TICKETS_IMPORT) {
        throw new Error(`Nombre de tickets supérieur à la limite autorisée (${MAX_TICKETS_IMPORT}).`);
      }

      const ticketsValides = candidats.map((item, idx) => validerEtNormaliserTicket(item, idx));
      const fusionner = options.fusionner !== false;

      const fileExistante = typeof window !== 'undefined' && window.KhalebBankroll && typeof window.KhalebBankroll.lireFileHorsLigne === 'function'
        ? window.KhalebBankroll.lireFileHorsLigne()
        : (() => {
            try {
              const brut = window.localStorage?.getItem(CLE_FILE_HORS_LIGNE);
              const p = brut ? JSON.parse(brut) : [];
              return Array.isArray(p) ? p : [];
            } catch {
              return [];
            }
          })();

      const idsExistants = new Set(fileExistante.map((t) => String(t.id)));
      const ajoutsSansDoublon = ticketsValides.filter((t) => !idsExistants.has(String(t.id)));
      const nouvelleFile = fusionner ? [...fileExistante, ...ajoutsSansDoublon] : ticketsValides;

      if (typeof window !== 'undefined' && window.KhalebBankroll && typeof window.KhalebBankroll.ecrireFileHorsLigne === 'function') {
        window.KhalebBankroll.ecrireFileHorsLigne(nouvelleFile);
      } else if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(CLE_FILE_HORS_LIGNE, JSON.stringify(nouvelleFile));
      }

      window.KhalebBankroll?.mettreAJourIndicateurFile?.();
      window.KhalebBankroll?.appliquerFiltreTableau?.();
      window.KhalebBankroll?.definirStatutBankroll?.(
        `Import JSON validé : ${fusionner ? ajoutsSansDoublon.length : ticketsValides.length} ticket(s) enregistré(s) dans la file locale.`,
        'syncing'
      );

      return {
        ok: true,
        importedCount: fusionner ? ajoutsSansDoublon.length : ticketsValides.length,
        totalQueued: nouvelleFile.length,
        tickets: nouvelleFile
      };
    } catch (err) {
      const msg = formaterErreur(err, 'Fichier JSON invalide ou rejeté.');
      window.KhalebBankroll?.definirStatutBankroll?.(`Import refusé : ${msg}`, 'warning');
      return { ok: false, error: msg, importedCount: 0, tickets: [] };
    }
  }

  if (typeof document !== 'undefined') {
    document.getElementById('bk-export-json-btn')?.addEventListener('click', () => {
      exporterTicketsJson(null, { declencherTelechargement: true });
    });

    const inputFichier = document.getElementById('bk-import-json-input');
    inputFichier?.addEventListener('change', async (event) => {
      const fichier = event.target?.files?.[0];
      if (!fichier) return;
      const texte = await fichier.text();
      importerTicketsJson(texte, { fusionner: true });
      event.target.value = '';
    });
  }

  if (typeof window !== 'undefined') {
    window.KhalebSauvegardeJson = {
      validerEtNormaliserTicket,
      exporterTicketsJson,
      importerTicketsJson
    };
  }
})();
