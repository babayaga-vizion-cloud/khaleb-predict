(function initialiserModuleBankroll() {
  const CLE_FILE_HORS_LIGNE = 'khaleb_predict_bankroll_queue_v1';
  const STATUTS_VALIDES = new Set(['pending', 'won', 'lost', 'void']);

  const supabase = typeof window !== 'undefined'
    ? (typeof window.supabaseClient !== 'undefined'
        ? window.supabaseClient
        : (typeof window.supabase !== 'undefined' && typeof window.supabase.from === 'function'
            ? window.supabase
            : null))
    : null;

  let ticketsCloud = [];
  let ticketsActuellementVisibles = [];
  let ticketEnEditionId = null;
  let uniquementEnAttenteSync = false;
  let synchronisationEnCours = false;

  const pileUndo = [];
  const pileRedo = [];
  const LIMITE_HISTORIQUE = 30;

  function echapperHtml(valeur) {
    return String(valeur ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formaterMontant(montant, devise = 'XAF') {
    if (typeof window !== 'undefined' && window.KhalebGlobal && typeof window.KhalebGlobal.formaterDeviseMondiale === 'function') {
      return window.KhalebGlobal.formaterDeviseMondiale(montant, devise);
    }
    return `${Number(montant ?? 0).toFixed(2)} ${String(devise || 'XAF').toUpperCase()}`;
  }

  function definirStatutBankroll(message, type = 'normal') {
    const el = typeof document !== 'undefined' ? document.getElementById('bk-status-msg') : null;
    if (!el) return;
    el.textContent = message;
    el.classList.remove('warning', 'syncing');
    if (type === 'warning') el.classList.add('warning');
    if (type === 'syncing') el.classList.add('syncing');
  }

  function mettreAJourEtatReseau() {
    const pill = typeof document !== 'undefined' ? document.getElementById('bk-net-pill') : null;
    if (!pill) return;
    const enLigne = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
    pill.textContent = enLigne ? 'En ligne' : 'Hors-ligne';
    pill.classList.toggle('online', enLigne);
    pill.classList.toggle('offline', !enLigne);
  }

  function calculerPnlSelonStatut(stake, odds, status) {
    const m = Number(stake);
    const c = Number(odds);
    const st = String(status || 'pending').toLowerCase();
    if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(c)) return 0;
    if (st === 'won') return Number((m * (c - 1)).toFixed(2));
    if (st === 'lost') return Number((-m).toFixed(2));
    return 0;
  }

  function lireFileHorsLigne() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return [];
      const brut = window.localStorage.getItem(CLE_FILE_HORS_LIGNE);
      if (!brut) return [];
      const parse = JSON.parse(brut);
      if (!Array.isArray(parse)) return [];
      return parse.filter((item) => item && typeof item === 'object');
    } catch {
      return [];
    }
  }

  function ecrireFileHorsLigne(liste) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const safe = Array.isArray(liste) ? liste : [];
    window.localStorage.setItem(CLE_FILE_HORS_LIGNE, JSON.stringify(safe));
  }

  function estTicketEnAttenteSync(ticket) {
    if (!ticket || typeof ticket !== 'object') return false;
    return Boolean(ticket._offlineQueued) || String(ticket.id || '').startsWith('local-');
  }

  function obtenirTousTicketsCombines() {
    const locaux = lireFileHorsLigne().map((t) => ({ ...t, _offlineQueued: true }));
    const idsLocaux = new Set(locaux.map((t) => String(t.id)));
    const cloudsFiltres = (Array.isArray(ticketsCloud) ? ticketsCloud : []).filter(
      (t) => !idsLocaux.has(String(t.id))
    );
    return [...locaux, ...cloudsFiltres];
  }

  function formaterResumeDevises(tickets) {
    const totaux = new Map();
    for (const t of tickets) {
      const dev = String(t?.currency || 'XAF').toUpperCase();
      const mise = Number(t?.stake ?? 0);
      if (Number.isFinite(mise) && mise > 0) {
        totaux.set(dev, (totaux.get(dev) || 0) + mise);
      }
    }
    if (totaux.size === 0) return '';
    return Array.from(totaux.entries())
      .map(([dev, somme]) => formaterMontant(somme, dev))
      .join(' · ');
  }

  function mettreAJourIndicateurFile() {
    if (typeof document === 'undefined') return;
    const file = lireFileHorsLigne();
    const nb = file.length;
    const resume = formaterResumeDevises(file);

    const pill = document.getElementById('bk-pending-sync-pill');
    const syncBtn = document.getElementById('bk-sync-btn');
    const clearBtn = document.getElementById('bk-clear-queue-btn');
    const pendingFilterBtn = document.getElementById('bk-pending-filter-btn');

    if (pill) {
      if (nb > 0) {
        pill.hidden = false;
        pill.textContent = resume
          ? `${nb} ticket(s) hors-ligne (${resume})`
          : `${nb} ticket(s) hors-ligne`;
      } else {
        pill.hidden = true;
        pill.textContent = '';
      }
    }

    if (syncBtn) {
      syncBtn.hidden = nb === 0;
      syncBtn.disabled = nb === 0 || synchronisationEnCours;
      syncBtn.textContent = `Synchroniser (${nb})`;
    }

    if (clearBtn) {
      clearBtn.hidden = nb === 0;
      clearBtn.disabled = nb === 0 || synchronisationEnCours;
      clearBtn.textContent = `Vider la file (${nb})`;
    }

    if (pendingFilterBtn) {
      pendingFilterBtn.textContent = `En attente de sync (${nb})`;
      pendingFilterBtn.setAttribute('aria-pressed', String(uniquementEnAttenteSync));
    }
  }

  function mettreAJourBoutonsUndoRedo() {
    if (typeof document === 'undefined') return;
    const undoBtn = document.getElementById('bk-undo-btn');
    const redoBtn = document.getElementById('bk-redo-btn');

    if (undoBtn) {
      const dernier = pileUndo[pileUndo.length - 1];
      const dispo = Boolean(dernier);
      undoBtn.hidden = !dispo;
      undoBtn.disabled = !dispo;
      const libelle = dernier?.libelle
        ? `Annuler (${dernier.libelle}) — Ctrl+Z / Cmd+Z`
        : 'Annuler la dernière action (Ctrl+Z / Cmd+Z)';
      undoBtn.title = libelle;
      undoBtn.setAttribute('aria-label', libelle);
    }

    if (redoBtn) {
      const suivant = pileRedo[pileRedo.length - 1];
      const dispo = Boolean(suivant);
      redoBtn.hidden = !dispo;
      redoBtn.disabled = !dispo;
      const libelle = suivant?.libelle
        ? `Rétablir (${suivant.libelle}) — Ctrl+Shift+Z / Cmd+Shift+Z`
        : 'Rétablir la dernière action (Ctrl+Shift+Z / Cmd+Shift+Z)';
      redoBtn.title = libelle;
      redoBtn.setAttribute('aria-label', libelle);
    }
  }

  function enregistrerPointUndo(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    pileUndo.push(snapshot);
    if (pileUndo.length > LIMITE_HISTORIQUE) {
      pileUndo.shift();
    }
    pileRedo.length = 0;
    mettreAJourBoutonsUndoRedo();
  }

  async function obtenirSessionActive() {
    if (!supabase || !supabase.auth || typeof supabase.auth.getSession !== 'function') {
      return null;
    }
    const { data: { session } } = await supabase.auth.getSession();
    return session && session.user ? session : null;
  }

  async function chargerDonneesBankroll() {
    const session = await obtenirSessionActive();
    if (!session || !supabase) {
      ticketsCloud = [];
      appliquerFiltreTableau();
      mettreAJourIndicateurFile();
      return;
    }

    const { data, error } = await supabase
      .from('bankroll_tickets')
      .select('*')
      .eq('user_id', session.user.id)
      .order('placed_at', { ascending: false });

    if (error) {
      definirStatutBankroll(`Erreur : ${error.message}`, 'warning');
      return;
    }

    ticketsCloud = Array.isArray(data) ? data : [];
    appliquerFiltreTableau();
    mettreAJourIndicateurFile();
  }

  async function envoyerTicketsVersSupabase(ticketsAEnvoyer) {
    const session = await obtenirSessionActive();
    if (!session || !supabase) {
      return { envoyesIds: [], erreur: 'Connexion ou session Supabase requise.' };
    }

    const envoyesIds = [];
    for (const item of ticketsAEnvoyer) {
      const row = {
        user_id: session.user.id,
        event_label: String(item.event_label || '').trim(),
        market: item.market ? String(item.market).trim() : null,
        odds: Number(item.odds),
        stake: Number(item.stake),
        pnl: Number(item.pnl ?? calculerPnlSelonStatut(item.stake, item.odds, item.status)),
        currency: String(item.currency || 'XAF').toUpperCase(),
        status: STATUTS_VALIDES.has(String(item.status || '').toLowerCase())
          ? String(item.status).toLowerCase()
          : 'pending',
        placed_at: item.placed_at || new Date().toISOString(),
        settled_at: item.status === 'pending' ? null : (item.settled_at || new Date().toISOString())
      };

      const { error } = await supabase.from('bankroll_tickets').insert([row]);
      if (error) {
        return { envoyesIds, erreur: error.message };
      }
      envoyesIds.push(String(item.id));
    }

    return { envoyesIds, erreur: null };
  }

  async function synchroniserTickets(cibleIds = null) {
    if (synchronisationEnCours) return;
    const file = lireFileHorsLigne();
    if (file.length === 0) {
      definirStatutBankroll('Aucun ticket hors-ligne à synchroniser.', 'normal');
      return;
    }

    const selection = Array.isArray(cibleIds) && cibleIds.length > 0
      ? file.filter((t) => cibleIds.includes(String(t.id)))
      : file;

    if (selection.length === 0) return;

    synchronisationEnCours = true;
    mettreAJourIndicateurFile();
    definirStatutBankroll(`Synchronisation de ${selection.length} ticket(s) en cours...`, 'syncing');

    const { envoyesIds, erreur } = await envoyerTicketsVersSupabase(selection);

    if (envoyesIds.length > 0) {
      const restants = file.filter((t) => !envoyesIds.includes(String(t.id)));
      ecrireFileHorsLigne(restants);
      await chargerDonneesBankroll();
    }

    synchronisationEnCours = false;
    mettreAJourIndicateurFile();

    if (erreur) {
      definirStatutBankroll(`Synchronisation partielle : ${erreur}`, 'warning');
    } else {
      definirStatutBankroll(`${envoyesIds.length} ticket(s) synchronisé(s) avec succès.`, 'syncing');
    }
  }

  async function tenterSynchronisationAutomatique() {
    if (synchronisationEnCours) return;
    const enLigne = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
    if (!enLigne) return;
    const file = lireFileHorsLigne();
    if (file.length === 0) return;
    const session = await obtenirSessionActive();
    if (!session) return;
    await synchroniserTickets(null);
  }

  function mettreAJourConseillerBankroll(ticketsAffiches) {
    if (
      typeof window === 'undefined' ||
      !window.KhalebAIAdvisor ||
      typeof window.KhalebAIAdvisor.rendrePanneauAnalyse !== 'function'
    ) {
      return;
    }
    const liste = Array.isArray(ticketsAffiches) ? ticketsAffiches : [];
    const tous = obtenirTousTicketsCombines();
    const devise = liste[0]?.currency || tous[0]?.currency || 'XAF';
    window.KhalebAIAdvisor.rendrePanneauAnalyse('bk-ai-advisor-panel', liste, devise);
  }

  function mettreAJourBoutonSyncVisibles() {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('bk-sync-visible-btn');
    if (!btn) return;
    const visiblesEnAttente = ticketsActuellementVisibles.filter(estTicketEnAttenteSync);
    const nb = visiblesEnAttente.length;
    btn.hidden = nb === 0;
    btn.disabled = nb === 0 || synchronisationEnCours;
    btn.textContent = `Sync visibles (${nb})`;
  }

  function mettreAJourBoutonActionGroupee() {
    if (typeof document === 'undefined') return;
    const applyBtn = document.getElementById('bk-bulk-apply-btn');
    const deleteBtn = document.getElementById('bk-bulk-delete-btn');
    const nb = ticketsActuellementVisibles.length;
    if (applyBtn) {
      applyBtn.disabled = nb === 0;
      applyBtn.textContent = `Appliquer (${nb})`;
    }
    if (deleteBtn) {
      deleteBtn.disabled = nb === 0;
      deleteBtn.textContent = `Supprimer (${nb})`;
    }
  }

  function appliquerFiltreTableau() {
    const tous = obtenirTousTicketsCombines();
    const statutFiltre = typeof document !== 'undefined'
      ? String(document.getElementById('bk-status-filter')?.value || 'all').toLowerCase()
      : 'all';
    const recherche = typeof document !== 'undefined'
      ? String(document.getElementById('bk-search-input')?.value || '').trim().toLowerCase()
      : '';

    const filtres = tous.filter((ticket) => {
      if (uniquementEnAttenteSync && !estTicketEnAttenteSync(ticket)) {
        return false;
      }
      if (statutFiltre !== 'all' && String(ticket.status || 'pending').toLowerCase() !== statutFiltre) {
        return false;
      }
      if (recherche) {
        const texte = [
          ticket.event_label,
          ticket.market,
          ticket.currency,
          ticket.status
        ].join(' ').toLowerCase();
        if (!texte.includes(recherche)) return false;
      }
      return true;
    });

    ticketsActuellementVisibles = filtres;
    mettreAJourConseillerBankroll(filtres);
    rendreTableauTickets(filtres);
    mettreAJourBoutonSyncVisibles();
    mettreAJourBoutonActionGroupee();
  }

  function dupliquerVersFormulaire(ticket) {
    if (!ticket) return;
    ticketEnEditionId = null;
    if (typeof window.annulerEditionTicket === 'function') {
      window.annulerEditionTicket();
    }
    const eventInput = document.getElementById('bk-event-input');
    const marketInput = document.getElementById('bk-market-input');
    const oddsInput = document.getElementById('bk-odds-input');
    const stakeInput = document.getElementById('bk-stake-input');
    const currencySelect = document.getElementById('bk-currency-select');
    const statusSelect = document.getElementById('bk-status-select');
    const pnlInput = document.getElementById('bk-pnl-input');

    if (eventInput) eventInput.value = String(ticket.event_label || '');
    if (marketInput) marketInput.value = ticket.market ? String(ticket.market) : '';
    if (oddsInput) oddsInput.value = String(Number(ticket.odds ?? 1.5));
    if (stakeInput) stakeInput.value = String(Number(ticket.stake ?? 0));
    if (currencySelect) currencySelect.value = String(ticket.currency || 'XAF').toUpperCase();
    if (statusSelect) statusSelect.value = 'pending';
    if (pnlInput) pnlInput.value = '0';

    if (eventInput) {
      eventInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      eventInput.focus();
    }
    definirStatutBankroll(`Ticket « ${ticket.event_label} » dupliqué dans le formulaire.`, 'normal');
  }

  async function dupliquerEtEnregistrer(ticket, statutChoisi) {
    if (!ticket) return;
    const statutFinal = STATUTS_VALIDES.has(String(statutChoisi || '').toLowerCase())
      ? String(statutChoisi).toLowerCase()
      : 'pending';
    const mise = Number(ticket.stake);
    const cote = Number(ticket.odds);
    const devise = String(ticket.currency || 'XAF').toUpperCase();
    const pnl = calculerPnlSelonStatut(mise, cote, statutFinal);
    const maintenant = new Date().toISOString();
    const settledAt = statutFinal === 'pending' ? null : maintenant;

    const enLigne = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
    const session = await obtenirSessionActive();

    if (enLigne && session && supabase) {
      const row = {
        user_id: session.user.id,
        event_label: String(ticket.event_label || '').trim(),
        market: ticket.market ? String(ticket.market).trim() : null,
        odds: Number(cote.toFixed(2)),
        stake: Number(mise.toFixed(2)),
        pnl,
        currency: devise,
        status: statutFinal,
        placed_at: maintenant,
        settled_at: settledAt
      };
      const { data: inserted, error } = await supabase.from('bankroll_tickets').insert([row]).select();
      if (error) {
        definirStatutBankroll(`Erreur : ${error.message}`, 'warning');
        return;
      }
      const cree = Array.isArray(inserted) && inserted[0] ? inserted[0] : row;
      await chargerDonneesBankroll();
      if (cree.id) {
        enregistrerPointUndo({
          type: 'create-cloud',
          ticketId: cree.id,
          ticketData: { ...cree },
          libelle: `duplication « ${row.event_label} »`
        });
      }
      definirStatutBankroll(`Ticket « ${row.event_label} » dupliqué et enregistré (${statutFinal}).`, 'syncing');
    } else {
      const localCopie = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        event_label: String(ticket.event_label || '').trim(),
        market: ticket.market ? String(ticket.market).trim() : null,
        odds: Number(cote.toFixed(2)),
        stake: Number(mise.toFixed(2)),
        pnl,
        currency: devise,
        status: statutFinal,
        placed_at: maintenant,
        settled_at: settledAt,
        _offlineQueued: true
      };
      const file = lireFileHorsLigne();
      file.push(localCopie);
      ecrireFileHorsLigne(file);
      mettreAJourIndicateurFile();
      appliquerFiltreTableau();
      enregistrerPointUndo({
        type: 'create-local',
        ticketId: localCopie.id,
        ticketData: { ...localCopie },
        libelle: `duplication « ${localCopie.event_label} »`
      });
      definirStatutBankroll(`Ticket « ${localCopie.event_label} » dupliqué dans la file hors-ligne.`, 'warning');
    }
  }

  async function appliquerStatutGroupe() {
    const select = document.getElementById('bk-bulk-status-select');
    const nouveauStatut = String(select?.value || 'won').toLowerCase();
    if (!STATUTS_VALIDES.has(nouveauStatut)) return;

    const cibles = [...ticketsActuellementVisibles];
    if (cibles.length === 0) return;

    const ok = typeof window.confirm === 'function'
      ? window.confirm(`Appliquer le statut « ${nouveauStatut} » à ${cibles.length} ticket(s) visible(s) ?`)
      : true;
    if (!ok) return;

    const maintenant = new Date().toISOString();
    const settledAt = nouveauStatut === 'pending' ? null : maintenant;
    const session = await obtenirSessionActive();
    const avantListe = cibles.map((t) => ({ ...t }));
    const apresListe = [];

    const file = lireFileHorsLigne();
    let fileModifiee = false;

    for (const ticket of cibles) {
      const nouveauPnl = calculerPnlSelonStatut(ticket.stake, ticket.odds, nouveauStatut);
      const misAJour = {
        ...ticket,
        status: nouveauStatut,
        pnl: nouveauPnl,
        settled_at: settledAt
      };
      apresListe.push(misAJour);

      if (estTicketEnAttenteSync(ticket)) {
        const idx = file.findIndex((item) => String(item.id) === String(ticket.id));
        if (idx !== -1) {
          file[idx] = { ...file[idx], status: nouveauStatut, pnl: nouveauPnl, settled_at: settledAt };
          fileModifiee = true;
        }
      } else if (session && supabase && ticket.id) {
        await supabase
          .from('bankroll_tickets')
          .update({ status: nouveauStatut, pnl: nouveauPnl, settled_at: settledAt })
          .eq('id', ticket.id)
          .eq('user_id', session.user.id);
      }
    }

    if (fileModifiee) {
      ecrireFileHorsLigne(file);
    }
    await chargerDonneesBankroll();
    mettreAJourIndicateurFile();

    enregistrerPointUndo({
      type: 'bulk-status',
      avantListe,
      apresListe,
      libelle: `statut groupé (${nouveauStatut}) sur ${cibles.length} ticket(s)`
    });

    definirStatutBankroll(`Statut « ${nouveauStatut} » appliqué à ${cibles.length} ticket(s).`, 'syncing');
  }

  async function supprimerTicketsGroupes() {
    const cibles = [...ticketsActuellementVisibles];
    if (cibles.length === 0) return;

    const ok = typeof window.confirm === 'function'
      ? window.confirm(`Supprimer définitivement ${cibles.length} ticket(s) visible(s) ?`)
      : true;
    if (!ok) return;

    const session = await obtenirSessionActive();
    const idsSupprimes = new Set(cibles.map((t) => String(t.id)));
    const fileActuelle = lireFileHorsLigne();
    const fileRestante = fileActuelle.filter((t) => !idsSupprimes.has(String(t.id)));
    ecrireFileHorsLigne(fileRestante);

    const idsCloud = cibles
      .filter((t) => !estTicketEnAttenteSync(t) && t.id)
      .map((t) => t.id);

    if (idsCloud.length > 0 && session && supabase) {
      await supabase
        .from('bankroll_tickets')
        .delete()
        .in('id', idsCloud)
        .eq('user_id', session.user.id);
    }

    await chargerDonneesBankroll();
    mettreAJourIndicateurFile();

    enregistrerPointUndo({
      type: 'bulk-delete',
      ticketsSupprimes: cibles.map((t) => ({ ...t })),
      libelle: `suppression de ${cibles.length} ticket(s)`
    });

    definirStatutBankroll(`${cibles.length} ticket(s) supprimé(s).`, 'normal');
  }

  async function executerUndoOuRedo(mode) {
    const estUndo = mode === 'undo';
    const sourcePile = estUndo ? pileUndo : pileRedo;
    const ciblePile = estUndo ? pileRedo : pileUndo;
    const action = sourcePile.pop();
    if (!action) return;

    const session = await obtenirSessionActive();

    if (action.type === 'create-local') {
      const file = lireFileHorsLigne();
      if (estUndo) {
        ecrireFileHorsLigne(file.filter((t) => String(t.id) !== String(action.ticketId)));
      } else {
        file.push({ ...action.ticketData, _offlineQueued: true });
        ecrireFileHorsLigne(file);
      }
      ciblePile.push(action);
    } else if (action.type === 'create-cloud') {
      if (session && supabase && action.ticketId) {
        if (estUndo) {
          await supabase
            .from('bankroll_tickets')
            .delete()
            .eq('id', action.ticketId)
            .eq('user_id', session.user.id);
        } else {
          await supabase.from('bankroll_tickets').insert([action.ticketData]);
        }
      }
      ciblePile.push(action);
    } else if (action.type === 'update-local') {
      const etatCible = estUndo ? action.avant : action.apres;
      const file = lireFileHorsLigne().map((t) =>
        String(t.id) === String(etatCible.id) ? { ...etatCible, _offlineQueued: true } : t
      );
      ecrireFileHorsLigne(file);
      ciblePile.push(action);
    } else if (action.type === 'update-cloud') {
      const etatCible = estUndo ? action.avant : action.apres;
      if (session && supabase && etatCible.id) {
        await supabase
          .from('bankroll_tickets')
          .update({
            event_label: etatCible.event_label,
            market: etatCible.market,
            odds: etatCible.odds,
            stake: etatCible.stake,
            pnl: etatCible.pnl,
            currency: etatCible.currency,
            status: etatCible.status,
            settled_at: etatCible.settled_at
          })
          .eq('id', etatCible.id)
          .eq('user_id', session.user.id);
      }
      ciblePile.push(action);
    } else if (action.type === 'bulk-status') {
      const listeEtat = estUndo ? action.avantListe : action.apresListe;
      const file = lireFileHorsLigne();
      for (const item of listeEtat) {
        if (estTicketEnAttenteSync(item)) {
          const idx = file.findIndex((f) => String(f.id) === String(item.id));
          if (idx !== -1) {
            file[idx] = { ...file[idx], status: item.status, pnl: item.pnl, settled_at: item.settled_at };
          }
        } else if (session && supabase && item.id) {
          await supabase
            .from('bankroll_tickets')
            .update({ status: item.status, pnl: item.pnl, settled_at: item.settled_at })
            .eq('id', item.id)
            .eq('user_id', session.user.id);
        }
      }
      ecrireFileHorsLigne(file);
      ciblePile.push(action);
    } else if (action.type === 'bulk-delete') {
      const liste = action.ticketsSupprimes || [];
      if (estUndo) {
        const locaux = liste.filter(estTicketEnAttenteSync).map((t) => ({ ...t, _offlineQueued: true }));
        if (locaux.length > 0) {
          const file = lireFileHorsLigne();
          ecrireFileHorsLigne([...locaux, ...file]);
        }
        const clouds = liste.filter((t) => !estTicketEnAttenteSync(t));
        if (clouds.length > 0 && session && supabase) {
          await supabase.from('bankroll_tickets').insert(clouds);
        }
      } else {
        const idsSuppr = new Set(liste.map((t) => String(t.id)));
        ecrireFileHorsLigne(lireFileHorsLigne().filter((t) => !idsSuppr.has(String(t.id))));
        const idsCloud = liste.filter((t) => !estTicketEnAttenteSync(t) && t.id).map((t) => t.id);
        if (idsCloud.length > 0 && session && supabase) {
          await supabase
            .from('bankroll_tickets')
            .delete()
            .in('id', idsCloud)
            .eq('user_id', session.user.id);
        }
      }
      ciblePile.push(action);
    }

    await chargerDonneesBankroll();
    mettreAJourIndicateurFile();
    mettreAJourBoutonsUndoRedo();
    definirStatutBankroll(
      `${estUndo ? 'Annulation' : 'Rétablissement'} effectué (${action.libelle || 'action'}).`,
      'normal'
    );
  }

  function rendreTableauTickets(tickets) {
    if (typeof document === 'undefined') return;
    const tbody = document.querySelector('#bk-tickets-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!Array.isArray(tickets) || tickets.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="7">Aucun ticket à afficher.</td>';
      tbody.appendChild(tr);
      return;
    }

    for (const ticket of tickets) {
      const tr = document.createElement('tr');
      const devise = String(ticket.currency || 'XAF').toUpperCase();
      const pnlVal = Number(ticket.pnl ?? calculerPnlSelonStatut(ticket.stake, ticket.odds, ticket.status));
      const badgeSync = estTicketEnAttenteSync(ticket) ? ' · Hors-ligne' : '';

      tr.innerHTML = `
        <td>${echapperHtml(ticket.event_label || '-')}</td>
        <td>${echapperHtml(ticket.market || '-')}</td>
        <td>${echapperHtml(Number(ticket.odds ?? 0).toFixed(2))}</td>
        <td>${echapperHtml(formaterMontant(ticket.stake, devise))}</td>
        <td>${echapperHtml(formaterMontant(pnlVal, devise))}</td>
        <td>${echapperHtml(String(ticket.status || 'pending'))}${echapperHtml(badgeSync)}</td>
        <td class="bk-actions-cell"></td>
      `;

      const actionsCell = tr.querySelector('.bk-actions-cell');

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'bk-duplicate-btn';
      editBtn.textContent = 'Modifier';
      editBtn.addEventListener('click', () => {
        if (typeof window.chargerTicketPourEdition === 'function') {
          window.chargerTicketPourEdition(ticket);
        }
      });

      const dupBtn = document.createElement('button');
      dupBtn.type = 'button';
      dupBtn.className = 'bk-duplicate-btn';
      dupBtn.textContent = 'Dupliquer';
      dupBtn.addEventListener('click', () => dupliquerVersFormulaire(ticket));

      const quickGroup = document.createElement('span');
      quickGroup.className = 'bk-quick-dup-group';

      const quickSelect = document.createElement('select');
      quickSelect.className = 'bk-quick-dup-select';
      quickSelect.setAttribute('aria-label', 'Statut de duplication rapide');
      quickSelect.innerHTML = `
        <option value="won">won</option>
        <option value="lost">lost</option>
        <option value="pending">pending</option>
        <option value="void">void</option>
      `;

      const quickDupBtn = document.createElement('button');
      quickDupBtn.type = 'button';
      quickDupBtn.className = 'bk-quick-dup-btn';
      quickDupBtn.textContent = 'Dupliquer + Enregistrer';
      quickDupBtn.addEventListener('click', () => dupliquerEtEnregistrer(ticket, quickSelect.value));

      quickGroup.appendChild(quickSelect);
      quickGroup.appendChild(quickDupBtn);

      actionsCell.appendChild(editBtn);
      actionsCell.appendChild(dupBtn);
      actionsCell.appendChild(quickGroup);

      tbody.appendChild(tr);
    }
  }

  function estChampSaisieActif(target) {
    if (!target || typeof target !== 'object') return false;
    const tag = String(target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target.isContentEditable);
  }

  function attacherEvenements() {
    if (typeof document === 'undefined') return;

    document.getElementById('bk-status-filter')?.addEventListener('change', appliquerFiltreTableau);
    document.getElementById('bk-search-input')?.addEventListener('input', appliquerFiltreTableau);

    document.getElementById('bk-reset-filters-btn')?.addEventListener('click', () => {
      uniquementEnAttenteSync = false;
      const statusSel = document.getElementById('bk-status-filter');
      const searchInp = document.getElementById('bk-search-input');
      if (statusSel) statusSel.value = 'all';
      if (searchInp) searchInp.value = '';
      appliquerFiltreTableau();
      mettreAJourIndicateurFile();
    });

    document.getElementById('bk-pending-filter-btn')?.addEventListener('click', () => {
      uniquementEnAttenteSync = !uniquementEnAttenteSync;
      appliquerFiltreTableau();
      mettreAJourIndicateurFile();
    });

    document.getElementById('bk-sync-visible-btn')?.addEventListener('click', () => {
      const idsVisibles = ticketsActuellementVisibles
        .filter(estTicketEnAttenteSync)
        .map((t) => String(t.id));
      synchroniserTickets(idsVisibles);
    });

    document.getElementById('bk-sync-btn')?.addEventListener('click', () => {
      synchroniserTickets(null);
    });

    document.getElementById('bk-clear-queue-btn')?.addEventListener('click', () => {
      const nb = lireFileHorsLigne().length;
      if (nb === 0) return;
      const ok = typeof window.confirm === 'function'
        ? window.confirm(`Vider la file hors-ligne contenant ${nb} ticket(s) ?`)
        : true;
      if (!ok) {
        definirStatutBankroll(`Purge annulée (${nb} ticket(s) conservé(s)).`, 'normal');
        return;
      }
      ecrireFileHorsLigne([]);
      mettreAJourIndicateurFile();
      appliquerFiltreTableau();
      definirStatutBankroll('File hors-ligne vidée.', 'normal');
    });

    document.getElementById('bk-refresh-btn')?.addEventListener('click', async () => {
      await chargerDonneesBankroll();
      definirStatutBankroll('Données actualisées.', 'normal');
    });

    document.getElementById('bk-bulk-apply-btn')?.addEventListener('click', appliquerStatutGroupe);
    document.getElementById('bk-bulk-delete-btn')?.addEventListener('click', supprimerTicketsGroupes);

    document.getElementById('bk-undo-btn')?.addEventListener('click', () => executerUndoOuRedo('undo'));
    document.getElementById('bk-redo-btn')?.addEventListener('click', () => executerUndoOuRedo('redo'));

    document.addEventListener('keydown', (event) => {
      if (estChampSaisieActif(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const touche = String(event.key || '').toLowerCase();
      if (touche === 'z' && !event.shiftKey) {
        event.preventDefault();
        executerUndoOuRedo('undo');
      } else if ((touche === 'z' && event.shiftKey) || touche === 'y') {
        event.preventDefault();
        executerUndoOuRedo('redo');
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        mettreAJourEtatReseau();
        tenterSynchronisationAutomatique();
      });
      window.addEventListener('offline', () => {
        mettreAJourEtatReseau();
        definirStatutBankroll('Mode hors-ligne actif : les tickets sont conservés localement.', 'warning');
      });
    }

    if (supabase && supabase.auth && typeof supabase.auth.onAuthStateChange === 'function') {
      supabase.auth.onAuthStateChange((eventName) => {
        if (eventName === 'SIGNED_IN' || eventName === 'TOKEN_REFRESHED') {
          chargerDonneesBankroll();
          tenterSynchronisationAutomatique();
        } else if (eventName === 'SIGNED_OUT') {
          ticketsCloud = [];
          appliquerFiltreTableau();
          mettreAJourIndicateurFile();
        }
      });
    }
  }

  attacherEvenements();
  mettreAJourEtatReseau();
  mettreAJourIndicateurFile();
  mettreAJourBoutonsUndoRedo();
  appliquerFiltreTableau();
  chargerDonneesBankroll();
  tenterSynchronisationAutomatique();

  window.KhalebBankroll = {
    enregistrerPointUndo,
    calculerPnlSelonStatut,
    estTicketEnAttenteSync,
    lireFileHorsLigne,
    ecrireFileHorsLigne,
    chargerDonneesBankroll,
    mettreAJourIndicateurFile,
    appliquerFiltreTableau,
    definirStatutBankroll,
    definirTicketEnEdition(id) {
      ticketEnEditionId = id || null;
    }
  };
})();
