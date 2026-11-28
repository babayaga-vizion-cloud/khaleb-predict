(function initKhalebFullDirectory() {
  if (typeof document === 'undefined') return;

  const KEY_SVCS = 'khaleb_predict_services_v2';

  const DEFAULT_ENTRIES = [
    // Transport vérifié et certifié
    { nom: 'Finexs Voyages — Agence Mvan', categorie: 'Transport Certifié', ville: 'Yaoundé', info: 'Transport interurbain VIP & colis express certifié', contact: 'Guichet officiel Mvan' },
    { nom: 'Touristique Express — Terminal Tongolo / Mvan', categorie: 'Transport Certifié', ville: 'Yaoundé', info: 'Liaisons nationales & messagerie sécurisée', contact: 'Agence certifiée' },
    { nom: 'DHL Express & EMS Course Cameroun', categorie: 'Transport Certifié', ville: 'Yaoundé / International', info: 'Fret aérien, suivi tracking & livraison certifiée', contact: 'Comptoir officiel' },

    // Groupes WhatsApp
    { nom: 'Communauté Khaleb Predict — Analystes & Entraide', categorie: 'Groupes WhatsApp', ville: 'Yaoundé / En ligne', info: 'Partage d’analyses Elo/Poisson, alertes et entraide membres', contact: 'Lien d’invitation vérifié' },
    { nom: 'Réseau Business & Opportunités Cameroun', categorie: 'Groupes WhatsApp', ville: 'Yaoundé / Douala', info: 'Annonces vérifiées, prestations IT et mise en relation directe', contact: 'Accès modéré' },

    // Lieux de distraction
    { nom: 'CanalOlympia Yaoundé — Cinéma & Spectacles', categorie: 'Lieux de Distraction', ville: 'Yaoundé (Université)', info: 'Salles de cinéma, concerts et événements culturels', contact: 'Billetterie sur place' },
    { nom: 'Bois Sainte-Anastasie & Esplanade Mont Fébé', categorie: 'Lieux de Distraction', ville: 'Yaoundé', info: 'Détente en plein air, restauration et loisirs week-end', contact: 'Accès libre / Réservation' },

    // Coins de rencontre
    { nom: 'Hubs Coworking & Cafés Réseautage (Bastos / Hippodrome)', categorie: 'Coins de Rencontre', ville: 'Yaoundé', info: 'Rencontres professionnelles, espaces calmes et Wi-Fi', contact: 'Accueil sur place' },
    { nom: 'Lounges & Terrasses Conviviales Centre-Ville', categorie: 'Coins de Rencontre', ville: 'Yaoundé', info: 'Cadre sécurisé pour échanges, rendez-vous et détente', contact: 'Réservation directe' },

    // Points de vente et achats
    { nom: 'Khaleb Technologie — Vente Matériel IT, Diagnostic & Gage', categorie: 'Points de Vente & Achats', ville: 'Yaoundé', info: 'Équipements informatiques, dépannage, enquêtes privées & crédit sur gage', contact: 'WhatsApp / Appel direct' },
    { nom: 'Espaces Commerciaux & Boutiques Agréées (Centre-Ville / Bastos)', categorie: 'Points de Vente & Achats', ville: 'Yaoundé', info: 'High-tech, téléphonie, accessoires et achats sécurisés', contact: 'Vente en boutique' }
  ];

  const PLANS_OFFRES = [
    { plan: 'Découverte', prixXaf: 0, periode: '/ mois', details: 'Accès annuaire complet + suivi bankroll local + IA de base' },
    { plan: 'Pro Analyste', prixXaf: 5000, periode: '/ mois', details: 'Studio IA Elo/Poisson complet + groupes privés + exports JSON' },
    { plan: 'Business / Vitrine Certifiée', prixXaf: 25000, periode: '/ an', details: 'Inscription point de vente, transport ou service certifié à Yaoundé' }
  ];

  const TAUX = { XAF: 1, EUR: 1 / 655.957, USD: 1 / 600, GBP: 1 / 760 };

  const INITIATIVES = [
    { titre: 'Fonds Éducation & Numérique Jeunes', type: 'Association caritative', region: 'Afrique Centrale', statut: 'Vérifié' },
    { titre: 'Programme Santé & Prévention Communautaire', type: 'Initiative solidaire', region: 'Cameroun', statut: 'Vérifié' },
    { titre: 'Programmes Mobilité, Bourses & Opportunités Internationales', type: 'Mobilité internationale', region: 'International', statut: 'Actif' }
  ];

  const fmtXaf = (n) => `${Number(n || 0).toLocaleString('fr-FR')} XAF`;
  const fact = (n) => { let r = 1; for (let i = 2; i <= n; i += 1) r *= i; return r; };
  const pois = (l, k) => (Math.pow(l, k) * Math.exp(-l)) / fact(k);

  function loadEntries() {
    try {
      const raw = localStorage.getItem(KEY_SVCS);
      if (!raw) return DEFAULT_ENTRIES.slice();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_ENTRIES.slice();
    } catch (_) {
      return DEFAULT_ENTRIES.slice();
    }
  }

  function saveEntries(list) {
    try { localStorage.setItem(KEY_SVCS, JSON.stringify(list)); } catch (_) {}
  }

  function calcAi() {
    const out = document.getElementById('ms-ai-output');
    if (!out) return;
    const eloA = Number(document.getElementById('ms-ai-elo-a')?.value) || 1560;
    const eloB = Number(document.getElementById('ms-ai-elo-b')?.value) || 1490;
    const xgA = Math.max(0.1, Number(document.getElementById('ms-ai-xg-a')?.value) || 1.65);
    const xgB = Math.max(0.1, Number(document.getElementById('ms-ai-xg-b')?.value) || 1.05);
    const cote = Math.max(1.01, Number(document.getElementById('ms-ai-odds')?.value) || 1.95);
    const br = Math.max(0, Number(document.getElementById('ms-ai-bankroll')?.value) || 50000);

    const pElo = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
    let pPois = 0;
    for (let i = 0; i <= 5; i += 1) {
      for (let j = 0; j < i; j += 1) {
        pPois += pois(xgA, i) * pois(xgB, j);
      }
    }
    const pComb = Math.min(0.95, Math.max(0.02, pElo * 0.45 + pPois * 0.55));
    const edge = pComb * cote - 1;
    const stake = Math.round(br * (edge > 0 ? Math.min(0.05, (edge / (cote - 1)) * 0.25) : 0));

    out.innerHTML = `<div class="ms-card ms-anim-in"><div><strong>Probabilité combinée :</strong> ${(pComb * 100).toFixed(1)}% (Elo ${(pElo * 100).toFixed(1)}% • Poisson ${(pPois * 100).toFixed(1)}%)</div><div style="margin-top:6px;"><strong>Edge :</strong> ${(edge * 100).toFixed(1)}% • <strong>Mise prudente :</strong> ${fmtXaf(stake)}</div></div>`;
  }

  function renderDirectory(q = '', cat = 'all') {
    const el = document.getElementById('ms-services-list');
    if (!el) return;
    const ql = q.trim().toLowerCase();
    const list = loadEntries().filter((s) => (cat === 'all' || s.categorie === cat) && (!ql || `${s.nom} ${s.categorie} ${s.ville} ${s.info}`.toLowerCase().includes(ql)));
    el.innerHTML = list.length
      ? list.map((s) => `<div class="ms-card ms-anim-in"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><strong>${s.nom}</strong><span>${s.categorie} • ${s.ville}</span></div><div style="margin-top:6px;font-size:0.92em;">${s.info}</div><div style="margin-top:6px;font-size:0.9em;opacity:0.9;">Contact / Accès : <strong>${s.contact}</strong></div></div>`).join('')
      : '<p class="ms-card">Aucun élément trouvé pour ce filtre.</p>';
  }

  function renderTransportOnly() {
    const el = document.getElementById('ms-transport-list');
    if (!el) return;
    const list = loadEntries().filter((s) => s.categorie === 'Transport Certifié');
    el.innerHTML = list.map((s) => `<div class="ms-card ms-anim-in"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><strong>${s.nom}</strong><span>Certifié • ${s.ville}</span></div><div style="margin-top:6px;font-size:0.92em;">${s.info}</div><div style="margin-top:6px;font-size:0.9em;">Contact : <strong>${s.contact}</strong></div></div>`).join('');
  }

  function renderPlans() {
    const el = document.getElementById('ms-plans-list');
    if (!el) return;
    el.innerHTML = PLANS_OFFRES.map((p) => `<div class="ms-card ms-anim-in"><div style="display:flex;justify-content:space-between;gap:8px;"><strong>${p.plan}</strong><span><strong>${fmtXaf(p.prixXaf)}</strong> ${p.periode}</span></div><p style="margin:6px 0 0;font-size:0.92em;">${p.details}</p></div>`).join('');
  }

  function calcFx() {
    const inp = document.getElementById('ms-xaf-amount');
    const sel = document.getElementById('ms-target-currency');
    const out = document.getElementById('ms-currency-result');
    if (!inp || !sel || !out) return;
    const xaf = Math.max(0, Number(inp.value) || 0);
    const dev = sel.value;
    out.textContent = `${fmtXaf(xaf)} ≈ ${(xaf * (TAUX[dev] || 1)).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${dev}`;
  }

  function renderInits() {
    const el = document.getElementById('ms-initiatives-list');
    if (!el) return;
    el.innerHTML = INITIATIVES.map((it) => `<div class="ms-card ms-anim-in"><strong>${it.titre}</strong><div style="margin-top:4px;font-size:0.9em;">${it.type} • ${it.region} • <em>${it.statut}</em></div></div>`).join('');
  }

  function setTab(tab) {
    const br = document.getElementById('khaleb-bankroll-module');
    if (br) br.style.display = (tab === 'all' || tab === 'bankroll') ? '' : 'none';
    document.querySelectorAll('[data-ms-panel]').forEach((p) => {
      const show = tab === 'all' || p.getAttribute('data-ms-panel') === tab;
      p.style.display = show ? '' : 'none';
      if (show) { p.classList.remove('ms-anim-in'); void p.offsetWidth; p.classList.add('ms-anim-in'); }
    });
    document.querySelectorAll('[data-ms-tab]').forEach((b) => {
      const active = b.getAttribute('data-ms-tab') === tab;
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
      b.classList.toggle('ms-tab-active', active);
    });
  }

  function start() {
    const sInp = document.getElementById('ms-service-search');
    const cSel = document.getElementById('ms-service-category');
    const xInp = document.getElementById('ms-xaf-amount');
    const dSel = document.getElementById('ms-target-currency');
    const lSel = document.getElementById('ms-lang-select');
    const form = document.getElementById('ms-add-service-form');

    renderDirectory(); renderTransportOnly(); renderPlans(); calcFx(); renderInits(); calcAi(); setTab('all');

    document.querySelectorAll('[data-ms-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        const tab = b.getAttribute('data-ms-tab') || 'all';
        const catFilter = b.getAttribute('data-ms-cat-filter');
        if (catFilter && cSel) {
          cSel.value = catFilter;
          renderDirectory(sInp?.value || '', catFilter);
          setTab('services');
          return;
        }
        if (tab === 'services' && cSel && !catFilter) {
          cSel.value = 'all';
          renderDirectory(sInp?.value || '', 'all');
        }
        setTab(tab);
      });
    });

    if (sInp) sInp.addEventListener('input', () => renderDirectory(sInp.value, cSel?.value || 'all'));
    if (cSel) cSel.addEventListener('change', () => renderDirectory(sInp?.value || '', cSel.value));
    if (xInp) xInp.addEventListener('input', calcFx);
    if (dSel) dSel.addEventListener('change', calcFx);
    if (lSel) {
      lSel.addEventListener('change', () => {
        const t = document.getElementById('ms-hub-title');
        if (t) t.textContent = lSel.value === 'en' ? 'KHALEB PREDICT — Complete Verified Ecosystem & Local AI' : 'KHALEB PREDICT — Écosystème Complet Vérifié & IA Locale';
      });
    }
    ['ms-ai-elo-a', 'ms-ai-elo-b', 'ms-ai-xg-a', 'ms-ai-xg-b', 'ms-ai-odds', 'ms-ai-bankroll'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', calcAi);
    });
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const nom = String(document.getElementById('ms-new-nom')?.value || '').trim();
        if (!nom) return;
        const list = loadEntries();
        list.unshift({
          nom,
          categorie: String(document.getElementById('ms-new-cat')?.value || 'Points de Vente & Achats'),
          ville: String(document.getElementById('ms-new-ville')?.value || 'Yaoundé').trim() || 'Yaoundé',
          info: String(document.getElementById('ms-new-tarif')?.value || 'Service vérifié').trim() || 'Service vérifié',
          contact: String(document.getElementById('ms-new-contact')?.value || 'WhatsApp').trim() || 'WhatsApp'
        });
        saveEntries(list);
        form.reset();
        renderDirectory(sInp?.value || '', cSel?.value || 'all');
        renderTransportOnly();
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();