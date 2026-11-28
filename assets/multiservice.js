(function initKhalebMultiservice() {
  if (typeof document === 'undefined') return;

  const SERVICES_LOCAUX = [
    {
      nom: 'Khaleb Technologie - Support IT & Diagnostic',
      categorie: 'IT & Réseaux',
      ville: 'Yaoundé',
      tarif: 'À partir de 5 000 XAF',
      contact: 'WhatsApp / Appel direct'
    },
    {
      nom: 'Enquêtes & Vérifications Privées',
      categorie: 'Investigation',
      ville: 'Yaoundé / Cameroun',
      tarif: 'Sur devis confidentiel',
      contact: 'Dossier sécurisé'
    },
    {
      nom: 'Crédit sur Gage & Micro-Financement',
      categorie: 'Finance & Gage',
      ville: 'Yaoundé',
      tarif: 'Conditions transparentes',
      contact: 'Évaluation rapide'
    },
    {
      nom: 'Hébergement & Déploiement Web / API',
      categorie: 'Cloud & Web',
      ville: 'En ligne',
      tarif: 'Forfaits mensuels / annuels',
      contact: 'Déploiement GitHub / Cloud'
    }
  ];

  const PLANS_FCFA = [
    { plan: 'Découverte', prixXaf: 0, periode: '/ mois', details: 'Suivi bankroll de base + annuaire services' },
    { plan: 'Pro Analyste', prixXaf: 5000, periode: '/ mois', details: 'Exports JSON illimités + outils d analyse & alertes' },
    { plan: 'Business / Vitrine', prixXaf: 25000, periode: '/ an', details: 'Mise en avant annuaire local + fiche service dédiée' }
  ];

  const TAUX_DEPUIS_XAF = {
    XAF: 1,
    EUR: 1 / 655.957,
    USD: 1 / 600,
    GBP: 1 / 760
  };

  const INITIATIVES = [
    {
      titre: 'Fonds Éducation & Numérique Jeunes',
      type: 'Association / Don',
      region: 'Afrique Centrale',
      statut: 'Vérifié'
    },
    {
      titre: 'Programme Santé & Prévention Communautaire',
      type: 'Initiative solidaire',
      region: 'Cameroun',
      statut: 'Vérifié'
    },
    {
      titre: 'Grand Tirage Voyage & Mobilité Internationale',
      type: 'Sweepstakes / Concours',
      region: 'International',
      statut: 'Actif'
    }
  ];

  function formaterXaf(montant) {
    return `${Number(montant || 0).toLocaleString('fr-FR')} XAF`;
  }

  function renderServices(filtreTexte = '', filtreCat = 'all') {
    const liste = document.getElementById('ms-services-list');
    if (!liste) return;
    const q = filtreTexte.trim().toLowerCase();
    const items = SERVICES_LOCAUX.filter((s) => {
      const okCat = filtreCat === 'all' || s.categorie === filtreCat;
      const okTxt = !q || `${s.nom} ${s.categorie} ${s.ville}`.toLowerCase().includes(q);
      return okCat && okTxt;
    });

    liste.innerHTML = items.length
      ? items.map((s) => `
          <div style="border:1px solid rgba(148,163,184,0.25);border-radius:10px;padding:12px;margin-bottom:10px;background:rgba(15,23,42,0.45);">
            <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
              <strong>${s.nom}</strong>
              <span style="opacity:0.85;">${s.categorie} • ${s.ville}</span>
            </div>
            <div style="margin-top:6px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:0.92em;">
              <span>Tarif : <strong>${s.tarif}</strong></span>
              <span>Contact : ${s.contact}</span>
            </div>
          </div>
        `).join('')
      : '<p>Aucun service ne correspond à ce filtre.</p>';
  }

  function renderPlans() {
    const cont = document.getElementById('ms-plans-list');
    if (!cont) return;
    cont.innerHTML = PLANS_FCFA.map((p) => `
      <div style="border:1px solid rgba(148,163,184,0.25);border-radius:10px;padding:12px;margin-bottom:10px;background:rgba(15,23,42,0.45);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <strong>${p.plan}</strong>
          <span><strong>${formaterXaf(p.prixXaf)}</strong> ${p.periode}</span>
        </div>
        <p style="margin:6px 0 0;font-size:0.92em;opacity:0.9;">${p.details}</p>
      </div>
    `).join('');
  }

  function convertirDevise() {
    const input = document.getElementById('ms-xaf-amount');
    const select = document.getElementById('ms-target-currency');
    const out = document.getElementById('ms-currency-result');
    if (!input || !select || !out) return;
    const xaf = Math.max(0, Number(input.value) || 0);
    const dev = select.value;
    const taux = TAUX_DEPUIS_XAF[dev] || 1;
    const converti = xaf * taux;
    out.textContent = `${formaterXaf(xaf)} ≈ ${converti.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${dev}`;
  }

  function renderInitiatives() {
    const cont = document.getElementById('ms-initiatives-list');
    if (!cont) return;
    cont.innerHTML = INITIATIVES.map((it) => `
      <div style="border:1px solid rgba(148,163,184,0.25);border-radius:10px;padding:12px;margin-bottom:10px;background:rgba(15,23,42,0.45);">
        <strong>${it.titre}</strong>
        <div style="margin-top:4px;font-size:0.9em;opacity:0.9;">${it.type} • ${it.region} • <em>${it.statut}</em></div>
      </div>
    `).join('');
  }

  function activerOnglet(nomOnglet) {
    document.querySelectorAll('[data-ms-panel]').forEach((panel) => {
      const cible = panel.getAttribute('data-ms-panel');
      panel.style.display = (nomOnglet === 'all' || cible === nomOnglet) ? '' : 'none';
    });
    document.querySelectorAll('[data-ms-tab]').forEach((btn) => {
      const actif = btn.getAttribute('data-ms-tab') === nomOnglet;
      btn.setAttribute('aria-pressed', actif ? 'true' : 'false');
      btn.style.outline = actif ? '2px solid #22c55e' : 'none';
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('ms-service-search');
    const catSelect = document.getElementById('ms-service-category');
    const xafInput = document.getElementById('ms-xaf-amount');
    const devSelect = document.getElementById('ms-target-currency');

    renderServices();
    renderPlans();
    convertirDevise();
    renderInitiatives();
    activerOnglet('all');

    document.querySelectorAll('[data-ms-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activerOnglet(btn.getAttribute('data-ms-tab') || 'all');
      });
    });

    if (searchInput) {
      searchInput.addEventListener('input', () => renderServices(searchInput.value, catSelect?.value || 'all'));
    }
    if (catSelect) {
      catSelect.addEventListener('change', () => renderServices(searchInput?.value || '', catSelect.value));
    }
    if (xafInput) xafInput.addEventListener('input', convertirDevise);
    if (devSelect) devSelect.addEventListener('change', convertirDevise);
  });
})();