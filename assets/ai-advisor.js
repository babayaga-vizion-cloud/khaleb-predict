(function initialiserConseillerBankrollFinal() {
  function analyserBankroll(tickets) {
    const liste = Array.isArray(tickets) ? tickets : [];
    const totalTickets = liste.length;

    let enAttente = 0;
    let gagnes = 0;
    let perdus = 0;
    let annules = 0;
    let miseTotale = 0;
    let pnlTotal = 0;
    let coteSomme = 0;
    const parDevise = new Map();

    for (const t of liste) {
      const statut = String(t?.status || 'pending').toLowerCase();
      const mise = Number(t?.stake ?? 0);
      const cote = Number(t?.odds ?? 0);
      const pnl = Number(t?.pnl ?? 0);
      const devise = String(t?.currency || 'XAF').toUpperCase();

      const entreeDevise = parDevise.get(devise) || { currency: devise, stake: 0, pnl: 0, count: 0 };
      entreeDevise.count += 1;
      if (Number.isFinite(mise) && mise > 0) {
        miseTotale += mise;
        entreeDevise.stake = Number((entreeDevise.stake + mise).toFixed(2));
      }
      if (Number.isFinite(pnl)) {
        pnlTotal += pnl;
        entreeDevise.pnl = Number((entreeDevise.pnl + pnl).toFixed(2));
      }
      parDevise.set(devise, entreeDevise);

      if (Number.isFinite(cote) && cote > 1) coteSomme += cote;

      if (statut === 'pending') enAttente += 1;
      else if (statut === 'won') gagnes += 1;
      else if (statut === 'lost') perdus += 1;
      else if (statut === 'void') annules += 1;
    }

    const resolus = gagnes + perdus;
    const tauxReussite = resolus > 0 ? Number(((gagnes / resolus) * 100).toFixed(1)) : 0;
    const roiPourcent = miseTotale > 0 ? Number(((pnlTotal / miseTotale) * 100).toFixed(2)) : 0;
    const coteMoyenne = totalTickets > 0 ? Number((coteSomme / totalTickets).toFixed(2)) : 0;
    const miseMoyenne = totalTickets > 0 ? Number((miseTotale / totalTickets).toFixed(2)) : 0;

    const alertes = [];
    if (perdus >= 3 && pnlTotal < 0) {
      alertes.push('Série de pertes détectée : réduisez la taille de mise temporairement pour protéger la bankroll.');
    }
    if (coteMoyenne >= 3.5 && resolus >= 5 && tauxReussite < 25) {
      alertes.push('Cotes moyennes élevées avec un taux de réussite faible : vérifiez la sélectivité des marchés.');
    }
    if (enAttente >= 8) {
      alertes.push('Nombre élevé de tickets en attente : surveillez votre exposition globale avant d’engager de nouvelles mises.');
    }
    if (alertes.length === 0) {
      alertes.push('Discipline de bankroll stable : maintenez une mise constante et suivez chaque résultat.');
    }

    return {
      totalTickets,
      resolus,
      enAttente,
      gagnes,
      perdus,
      annules,
      miseTotale: Number(miseTotale.toFixed(2)),
      pnlTotal: Number(pnlTotal.toFixed(2)),
      tauxReussite,
      roiPourcent,
      coteMoyenne,
      miseMoyenne,
      totauxParDevise: Array.from(parDevise.values()),
      alertes
    };
  }

  function rendrePanneauAnalyse(conteneurId, tickets, devise = 'XAF') {
    const conteneur = typeof document !== 'undefined' ? document.getElementById(conteneurId) : null;
    if (!conteneur) return null;

    const stats = analyserBankroll(tickets);
    const fmt = typeof window !== 'undefined' && window.KhalebGlobal && typeof window.KhalebGlobal.formaterDeviseMondiale === 'function'
      ? (val, curr) => window.KhalebGlobal.formaterDeviseMondiale(val, curr || devise)
      : (val, curr) => `${Number(val || 0).toFixed(2)} ${curr || devise}`;

    const breakdownHtml = stats.totauxParDevise.length > 0
      ? stats.totauxParDevise
          .map((d) => `<span><strong>PNL ${d.currency} :</strong> ${fmt(d.pnl, d.currency)} (${d.count})</span>`)
          .join('')
      : `<span><strong>PNL cumulé :</strong> ${fmt(stats.pnlTotal, devise)}</span>`;

    const listeAlertesHtml = stats.alertes
      .map((item) => `<li>${String(item).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</li>`)
      .join('');

    conteneur.innerHTML = `
      <div class="bk-ai-summary">
        <div class="bk-ai-metrics">
          <span><strong>Tickets :</strong> ${stats.totalTickets} (${stats.enAttente} en attente)</span>
          <span><strong>Win rate :</strong> ${stats.tauxReussite}%</span>
          <span><strong>ROI :</strong> ${stats.roiPourcent}%</span>
          <span><strong>Cote moy. :</strong> ${stats.coteMoyenne}</span>
          ${breakdownHtml}
        </div>
        <ul class="bk-ai-tips">${listeAlertesHtml}</ul>
      </div>
    `;

    return stats;
  }

  window.KhalebAIAdvisor = {
    analyserBankroll,
    rendrePanneauAnalyse
  };
})();
