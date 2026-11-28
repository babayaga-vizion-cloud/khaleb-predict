(function initKhalebCompleteHub() {
  if (typeof document === 'undefined') return;
  const KEY = 'khaleb_predict_services_v1';
  const DEFAULTS = [
    { nom: 'Khaleb Technologie - Support IT & Diagnostic', categorie: 'IT & Réseaux', ville: 'Yaoundé', tarif: 'À partir de 5 000 XAF', contact: 'WhatsApp / Appel direct' },
    { nom: 'Enquêtes & Vérifications Privées', categorie: 'Investigation', ville: 'Yaoundé / Cameroun', tarif: 'Sur devis confidentiel', contact: 'Dossier sécurisé' },
    { nom: 'Crédit sur Gage & Micro-Financement', categorie: 'Finance & Gage', ville: 'Yaoundé', tarif: 'Conditions transparentes', contact: 'Évaluation rapide' },
    { nom: 'Hébergement & Déploiement Web / API', categorie: 'Cloud & Web', ville: 'En ligne', tarif: 'Forfaits mensuels / annuels', contact: 'Déploiement GitHub / Cloud' }
  ];
  const PLANS = [
    { plan: 'Découverte', prixXaf: 0, periode: '/ mois', details: 'Suivi bankroll local + annuaire services + moteur IA de base' },
    { plan: 'Pro Analyste', prixXaf: 5000, periode: '/ mois', details: 'Simulation Elo/Poisson + exports JSON + regroupement par devise' },
    { plan: 'Business / Vitrine', prixXaf: 25000, periode: '/ an', details: 'Mise en avant annuaire local + fiche prestataire dédiée' }
  ];
  const TAUX = { XAF: 1, EUR: 1 / 655.957, USD: 1 / 600, GBP: 1 / 760 };
  const INITS = [
    { titre: 'Fonds Éducation & Numérique Jeunes', type: 'Association / Don', region: 'Afrique Centrale', statut: 'Vérifié' },
    { titre: 'Programme Santé & Prévention Communautaire', type: 'Initiative solidaire', region: 'Cameroun', statut: 'Vérifié' },
    { titre: 'Grand Tirage Voyage & Mobilité Internationale', type: 'Sweepstakes / Concours', region: 'International', statut: 'Actif' }
  ];
  const loadSvcs = () => { try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); return Array.isArray(d) && d.length ? d : DEFAULTS.slice(); } catch (_) { return DEFAULTS.slice(); } };
  const saveSvcs = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (_) {} };
  const fmtXaf = (n) => `${Number(n || 0).toLocaleString('fr-FR')} XAF`;
  const fact = (n) => { let r = 1; for (let i = 2; i <= n; i += 1) r *= i; return r; };
  const pois = (l, k) => (Math.pow(l, k) * Math.exp(-l)) / fact(k);

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
    for (let i = 0; i <= 5; i += 1) for (let j = 0; j < i; j += 1) pPois += pois(xgA, i) * pois(xgB, j);
    const pComb = Math.min(0.95, Math.max(0.02, pElo * 0.45 + pPois * 0.55));
    const edge = pComb * cote - 1;
    const stake = Math.round(br * (edge > 0 ? Math.min(0.05, (edge / (cote - 1)) * 0.25) : 0));
    out.innerHTML = `<div class="ms-card ms-anim-in"><div><strong>Probabilité combinée :</strong> ${(pComb * 100).toFixed(1)}% (Elo ${(pElo * 100).toFixed(1)}% • Poisson ${(pPois * 100).toFixed(1)}%)</div><div style="margin-top:6px;"><strong>Edge :</strong> ${(edge * 100).toFixed(1)}% • <strong>Mise prudente :</strong> ${stake.toLocaleString('fr-FR')}</div></div>`;
  }

  function renderSvcs(q = '', cat = 'all') {
    const el = document.getElementById('ms-services-list');
    if (!el) return;
    const ql = q.trim().toLowerCase();
    const list = loadSvcs().filter((s) => (cat === 'all' || s.categorie === cat) && (!ql || `${s.nom} ${s.categorie} ${s.ville}`.toLowerCase().includes(ql)));
    el.innerHTML = list.length ? list.map((s) => `<div class="ms-card ms-anim-in"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><strong>${s.nom}</strong><span>${s.categorie} • ${s.ville}</span></div><div style="margin-top:6px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:0.92em;"><span>Tarif : <strong>${s.tarif}</strong></span><span>Contact : ${s.contact}</span></div></div>`).join('') : '<p class="ms-card">Aucun service.</p>';
  }

  function renderPlans() {
    const el = document.getElementById('ms-plans-list');
    if (!el) return;
    el.innerHTML = PLANS.map((p) => `<div class="ms-card ms-anim-in"><div style="display:flex;justify-content:space-between;gap:8px;"><strong>${p.plan}</strong><span><strong>${fmtXaf(p.prixXaf)}</strong> ${p.periode}</span></div><p style="margin:6px 0 0;font-size:0.92em;">${p.details}</p></div>`).join('');
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
    el.innerHTML = INITS.map((it) => `<div class="ms-card ms-anim-in"><strong>${it.titre}</strong><div style="margin-top:4px;font-size:0.9em;">${it.type} • ${it.region} • <em>${it.statut}</em></div></div>`).join('');
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
    renderSvcs(); renderPlans(); calcFx(); renderInits(); calcAi(); setTab('all');
    document.querySelectorAll('[data-ms-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.getAttribute('data-ms-tab') || 'all')));
    if (sInp) sInp.addEventListener('input', () => renderSvcs(sInp.value, cSel?.value || 'all'));
    if (cSel) cSel.addEventListener('change', () => renderSvcs(sInp?.value || '', cSel.value));
    if (xInp) xInp.addEventListener('input', calcFx);
    if (dSel) dSel.addEventListener('change', calcFx);
    if (lSel) lSel.addEventListener('change', () => {
      const t = document.getElementById('ms-hub-title');
      if (t) t.textContent = lSel.value === 'en' ? 'Multiservice Hub & Local AI — khaleb-predict' : 'Hub Multiservice & IA Locale — khaleb-predict';
    });
    ['ms-ai-elo-a', 'ms-ai-elo-b', 'ms-ai-xg-a', 'ms-ai-xg-b', 'ms-ai-odds', 'ms-ai-bankroll'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', calcAi);
    });
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const nom = String(document.getElementById('ms-new-nom')?.value || '').trim();
        if (!nom) return;
        const list = loadSvcs();
        list.unshift({
          nom,
          categorie: String(document.getElementById('ms-new-cat')?.value || 'IT & Réseaux'),
          ville: String(document.getElementById('ms-new-ville')?.value || 'Yaoundé').trim() || 'Yaoundé',
          tarif: String(document.getElementById('ms-new-tarif')?.value || 'Sur devis').trim() || 'Sur devis',
          contact: String(document.getElementById('ms-new-contact')?.value || 'WhatsApp').trim() || 'WhatsApp'
        });
        saveSvcs(list);
        form.reset();
        renderSvcs(sInp?.value || '', cSel?.value || 'all');
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();