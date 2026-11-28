(function initialiserFormulaireBankrollFinal() {
  const STATUTS_VALIDES = new Set(['pending', 'won', 'lost', 'void']);
  let ticketEnCoursEdition = null;

  const supabase = typeof window !== 'undefined'
    ? (typeof window.supabaseClient !== 'undefined'
        ? window.supabaseClient
        : (typeof window.supabase !== 'undefined' && typeof window.supabase.from === 'function'
            ? window.supabase
            : null))
    : null;

  function calculerPnl(stake, odds, status) {
    if (typeof window !== 'undefined' && window.KhalebBankroll && typeof window.KhalebBankroll.calculerPnlSelonStatut === 'function') {
      return window.KhalebBankroll.calculerPnlSelonStatut(stake, odds, status);
    }
    const m = Number(stake);
    const c = Number(odds);
    const st = String(status || 'pending').toLowerCase();
    if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(c)) return 0;
    if (st === 'won') return Number((m * (c - 1)).toFixed(2));
    if (st === 'lost') return Number((-m).toFixed(2));
    return 0;
  }

  function notifierStatut(message, type = 'normal') {
    if (typeof window !== 'undefined' && window.KhalebBankroll && typeof window.KhalebBankroll.definirStatutBankroll === 'function') {
      window.KhalebBankroll.definirStatutBankroll(message, type);
      return;
    }
    const el = typeof document !== 'undefined' ? document.getElementById('bk-status-msg') : null;
    if (el) el.textContent = message;
  }

  function actualiserApercuPnl() {
    if (typeof document === 'undefined') return;
    const odds = Number(document.getElementById('bk-odds-input')?.value);
    const stake = Number(document.getElementById('bk-stake-input')?.value);
    const status = String(document.getElementById('bk-status-select')?.value || 'pending').toLowerCase();
    const pnlInput = document.getElementById('bk-pnl-input');
    if (pnlInput) {
      pnlInput.value = String(calculerPnl(stake, odds, status));
    }
  }

  function annulerEditionTicket() {
    ticketEnCoursEdition = null;
    if (typeof window !== 'undefined' && window.KhalebBankroll && typeof window.KhalebBankroll.definirTicketEnEdition === 'function') {
      window.KhalebBankroll.definirTicketEnEdition(null);
    }
    if (typeof document === 'undefined') return;
    const submitBtn = document.getElementById('bk-submit-btn');
    const cancelBtn = document.getElementById('bk-cancel-edit-btn');
    const statusSel = document.getElementById('bk-status-select');
    if (submitBtn) submitBtn.textContent = 'Enregistrer le ticket';
    if (cancelBtn) cancelBtn.hidden = true;
    if (statusSel) statusSel.value = 'pending';
    actualiserApercuPnl();
  }

  function chargerTicketPourEdition(ticket) {
    if (!ticket || typeof document === 'undefined') return;
    ticketEnCoursEdition = { ...ticket };
    if (typeof window !== 'undefined' && window.KhalebBankroll && typeof window.KhalebBankroll.definirTicketEnEdition === 'function') {
      window.KhalebBankroll.definirTicketEnEdition(ticket.id || null);
    }

    const eventInput = document.getElementById('bk-event-input');
    const marketInput = document.getElementById('bk-market-input');
    const oddsInput = document.getElementById('bk-odds-input');
    const stakeInput = document.getElementById('bk-stake-input');
    const currencySelect = document.getElementById('bk-currency-select');
    const statusSelect = document.getElementById('bk-status-select');
    const submitBtn = document.getElementById('bk-submit-btn');
    const cancelBtn = document.getElementById('bk-cancel-edit-btn');

    if (eventInput) eventInput.value = String(ticket.event_label || '');
    if (marketInput) marketInput.value = ticket.market ? String(ticket.market) : '';
    if (oddsInput) oddsInput.value = String(Number(ticket.odds ?? 1.5));
    if (stakeInput) stakeInput.value = String(Number(ticket.stake ?? 0));
    if (currencySelect) currencySelect.value = String(ticket.currency || 'XAF').toUpperCase();
    if (statusSelect) statusSelect.value = STATUTS_VALIDES.has(String(ticket.status || '').toLowerCase())
      ? String(ticket.status).toLowerCase()
      : 'pending';
    if (submitBtn) submitBtn.textContent = 'Mettre à jour le ticket';
    if (cancelBtn) cancelBtn.hidden = false;

    actualiserApercuPnl();
    if (eventInput) {
      eventInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      eventInput.focus();
    }
    notifierStatut(`Modification du ticket « ${ticket.event_label} ».`, 'normal');
  }

  async function obtenirSession() {
    if (!supabase || !supabase.auth || typeof supabase.auth.getSession !== 'function') return null;
    const { data: { session } } = await supabase.auth.getSession();
    return session && session.user ? session : null;
  }

  async function soumettreFormulaire(event) {
    event.preventDefault();
    if (typeof document === 'undefined') return;

    const eventLabel = String(document.getElementById('bk-event-input')?.value || '').trim();
    const marketBrut = String(document.getElementById('bk-market-input')?.value || '').trim();
    const market = marketBrut || null;
    const odds = Number(document.getElementById('bk-odds-input')?.value);
    const stake = Number(document.getElementById('bk-stake-input')?.value);
    const currency = String(document.getElementById('bk-currency-select')?.value || 'XAF').toUpperCase();
    const statusBrut = String(document.getElementById('bk-status-select')?.value || 'pending').toLowerCase();
    const status = STATUTS_VALIDES.has(statusBrut) ? statusBrut : 'pending';

    if (!eventLabel) {
      notifierStatut('Veuillez saisir un intitulé d’événement ou match.', 'warning');
      return;
    }
    if (!Number.isFinite(odds) || odds <= 1 || odds > 1000) {
      notifierStatut('La cote doit être supérieure à 1.00 (et <= 1000).', 'warning');
      return;
    }
    if (!Number.isFinite(stake) || stake <= 0 || stake > 100_000_000) {
      notifierStatut('La mise doit être strictement supérieure à 0.', 'warning');
      return;
    }

    const pnl = calculerPnl(stake, odds, status);
    const maintenant = new Date().toISOString();
    const settledAt = status === 'pending' ? null : maintenant;
    const enLigne = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
    const session = await obtenirSession();
    const bk = typeof window !== 'undefined' ? window.KhalebBankroll : null;

    if (ticketEnCoursEdition) {
      const avant = { ...ticketEnCoursEdition };
      const apres = {
        ...ticketEnCoursEdition,
        event_label: eventLabel,
        market,
        odds: Number(odds.toFixed(2)),
        stake: Number(stake.toFixed(2)),
        currency,
        status,
        pnl,
        settled_at: settledAt
      };

      const estLocal = bk && typeof bk.estTicketEnAttenteSync === 'function'
        ? bk.estTicketEnAttenteSync(ticketEnCoursEdition)
        : String(ticketEnCoursEdition.id || '').startsWith('local-');

      if (estLocal && bk && typeof bk.lireFileHorsLigne === 'function' && typeof bk.ecrireFileHorsLigne === 'function') {
        const file = bk.lireFileHorsLigne().map((t) =>
          String(t.id) === String(ticketEnCoursEdition.id) ? { ...apres, _offlineQueued: true } : t
        );
        bk.ecrireFileHorsLigne(file);
        bk.mettreAJourIndicateurFile?.();
        bk.appliquerFiltreTableau?.();
        bk.enregistrerPointUndo?.({
          type: 'update-local',
          avant,
          apres,
          libelle: `modification « ${eventLabel} »`
        });
        annulerEditionTicket();
        notifierStatut(`Ticket « ${eventLabel} » mis à jour localement.`, 'normal');
        return;
      }

      if (enLigne && session && supabase && ticketEnCoursEdition.id) {
        const { error } = await supabase
          .from('bankroll_tickets')
          .update({
            event_label: apres.event_label,
            market: apres.market,
            odds: apres.odds,
            stake: apres.stake,
            currency: apres.currency,
            status: apres.status,
            pnl: apres.pnl,
            settled_at: apres.settled_at
          })
          .eq('id', ticketEnCoursEdition.id)
          .eq('user_id', session.user.id);

        if (error) {
          notifierStatut(`Erreur mise à jour : ${error.message}`, 'warning');
          return;
        }
        await bk?.chargerDonneesBankroll?.();
        bk?.enregistrerPointUndo?.({
          type: 'update-cloud',
          avant,
          apres,
          libelle: `modification « ${eventLabel} »`
        });
        annulerEditionTicket();
        notifierStatut(`Ticket « ${eventLabel} » mis à jour.`, 'syncing');
        return;
      }
    }

    if (enLigne && session && supabase) {
      const row = {
        user_id: session.user.id,
        event_label: eventLabel,
        market,
        odds: Number(odds.toFixed(2)),
        stake: Number(stake.toFixed(2)),
        pnl,
        currency,
        status,
        placed_at: maintenant,
        settled_at: settledAt
      };
      const { data: inserted, error } = await supabase.from('bankroll_tickets').insert([row]).select();
      if (error) {
        notifierStatut(`Erreur enregistrement : ${error.message}`, 'warning');
        return;
      }
      const cree = Array.isArray(inserted) && inserted[0] ? inserted[0] : row;
      await bk?.chargerDonneesBankroll?.();
      if (cree.id) {
        bk?.enregistrerPointUndo?.({
          type: 'create-cloud',
          ticketId: cree.id,
          ticketData: { ...cree },
          libelle: `ajout « ${eventLabel} »`
        });
      }
      document.getElementById('bk-ticket-form')?.reset();
      actualiserApercuPnl();
      notifierStatut(`Ticket « ${eventLabel} » enregistré.`, 'syncing');
      return;
    }

    const localTicket = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      event_label: eventLabel,
      market,
      odds: Number(odds.toFixed(2)),
      stake: Number(stake.toFixed(2)),
      pnl,
      currency,
      status,
      placed_at: maintenant,
      settled_at: settledAt,
      _offlineQueued: true
    };

    if (bk && typeof bk.lireFileHorsLigne === 'function' && typeof bk.ecrireFileHorsLigne === 'function') {
      const file = bk.lireFileHorsLigne();
      file.push(localTicket);
      bk.ecrireFileHorsLigne(file);
      bk.mettreAJourIndicateurFile?.();
      bk.appliquerFiltreTableau?.();
      bk.enregistrerPointUndo?.({
        type: 'create-local',
        ticketId: localTicket.id,
        ticketData: { ...localTicket },
        libelle: `ajout « ${eventLabel} »`
      });
    }

    document.getElementById('bk-ticket-form')?.reset();
    actualiserApercuPnl();
    notifierStatut(`Ticket « ${eventLabel} » ajouté dans la file hors-ligne.`, 'warning');
  }

  if (typeof document !== 'undefined') {
    document.getElementById('bk-ticket-form')?.addEventListener('submit', soumettreFormulaire);
    document.getElementById('bk-cancel-edit-btn')?.addEventListener('click', annulerEditionTicket);
    document.getElementById('bk-odds-input')?.addEventListener('input', actualiserApercuPnl);
    document.getElementById('bk-stake-input')?.addEventListener('input', actualiserApercuPnl);
    document.getElementById('bk-status-select')?.addEventListener('change', actualiserApercuPnl);
    actualiserApercuPnl();
  }

  if (typeof window !== 'undefined') {
    window.chargerTicketPourEdition = chargerTicketPourEdition;
    window.annulerEditionTicket = annulerEditionTicket;
  }
})();
