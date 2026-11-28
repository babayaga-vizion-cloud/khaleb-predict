(function executerTestsBankroll() {
  function assert(condition, message) {
    if (!condition) {
      throw new Error(`Échec de vérification : ${message}`);
    }
  }

  const estNavigateur = typeof window !== 'undefined' && typeof document !== 'undefined';

  if (estNavigateur && window.KhalebAIAdvisor) {
    const stats = window.KhalebAIAdvisor.analyserBankroll([
      { event_label: 'Match A', odds: 2.0, stake: 1000, pnl: 1000, currency: 'XAF', status: 'won' },
      { event_label: 'Match B', odds: 1.5, stake: 50, pnl: -50, currency: 'EUR', status: 'lost' }
    ]);
    assert(stats.totalTickets === 2, 'Le total de tickets doit être égal à 2');
    assert(stats.totauxParDevise.length === 2, 'Les totaux doivent être séparés par devise');
  }

  if (estNavigateur && window.KhalebGlobal) {
    const formated = window.KhalebGlobal.formaterDeviseMondiale(2500, 'XAF');
    assert(typeof formated === 'string' && formated.length > 0, 'Le formatage XAF doit retourner une chaîne non vide');
  }

  if (estNavigateur && window.KhalebSauvegardeJson) {
    const exp = window.KhalebSauvegardeJson.exporterTicketsJson(
      [{ event_label: 'Test Unitaire', odds: 1.9, stake: 500, currency: 'XAF', status: 'pending' }],
      { declencherTelechargement: false }
    );
    assert(exp.ok === true && exp.count === 1, 'L export JSON de test doit réussir');
    const impInvalide = window.KhalebSauvegardeJson.importerTicketsJson('{"app":"autre","tickets":[]}');
    assert(impInvalide.ok === false, 'Un JSON avec mauvais app doit être rejeté');
  }

  if (!estNavigateur) {
    const fs = require('fs');
    const path = require('path');
    const racine = path.resolve(__dirname, '..');
    const indexHtml = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
    const requis = [
      'khaleb-bankroll-module',
      'bk-ticket-form',
      'bk-export-json-btn',
      'bk-import-json-input',
      './assets/bankroll.js',
      './assets/formulaire-bankroll.js',
      './assets/sauvegarde-json.js'
    ];
    for (const r of requis) {
      assert(indexHtml.includes(r), `Élément manquant dans index.html : ${r}`);
    }
    console.log('verify-bankroll.js : toutes les assertions Node et structurelles sont validées.');
  }
})();
