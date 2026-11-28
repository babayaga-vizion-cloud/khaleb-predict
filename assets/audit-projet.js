(function executerAuditProjet() {
  const estNavigateur = typeof window !== 'undefined' && typeof document !== 'undefined';

  if (!estNavigateur) {
    const fs = require('fs');
    const path = require('path');
    const racine = path.resolve(__dirname, '..');
    const motCleInterdit = new RegExp(['service', 'role'].join('_'), 'i');
    const fichiersObligatoires = [
      'index.html',
      'assets/bankroll.css',
      'assets/bankroll.js',
      'assets/formulaire-bankroll.js',
      'assets/sauvegarde-json.js',
      'assets/ai-advisor.js',
      'assets/i18n-global.js',
      'assets/verify-bankroll.js',
      'assets/audit-projet.js',
      'supabase_setup.sql',
      '.github/workflows/deploy-pages.yml'
    ];

    for (const rel of fichiersObligatoires) {
      const complet = path.join(racine, rel);
      if (!fs.existsSync(complet)) {
        throw new Error(`Fichier obligatoire manquant : ${rel}`);
      }
      const contenu = fs.readFileSync(complet, 'utf8');
      if (rel.startsWith('assets/') || rel === 'index.html') {
        if (motCleInterdit.test(contenu)) {
          throw new Error(`Faille sécurité : clé privilégiée détectée dans ${rel}`);
        }
      }
    }

    const indexHtml = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
    if (/src="\/assets\//i.test(indexHtml) || /href="\/assets\//i.test(indexHtml)) {
      throw new Error('Chemin absolu /assets/ détecté dans index.html (incompatible GitHub Pages sous-dossier).');
    }

    console.log('audit-projet.js : contrôle statique, sécurité et chemins relatifs OK.');
    return;
  }

  const idsAttendus = [
    'khaleb-bankroll-module',
    'bk-ticket-form',
    'bk-event-input',
    'bk-odds-input',
    'bk-stake-input',
    'bk-currency-select',
    'bk-status-select',
    'bk-pnl-input',
    'bk-export-json-btn',
    'bk-import-json-input',
    'bk-status-filter',
    'bk-pending-filter-btn',
    'bk-sync-visible-btn',
    'bk-bulk-apply-btn',
    'bk-bulk-delete-btn',
    'bk-undo-btn',
    'bk-redo-btn',
    'bk-ai-advisor-panel',
    'bk-tickets-table'
  ];

  const manquants = idsAttendus.filter((id) => !document.getElementById(id));
  if (manquants.length > 0) {
    console.warn('Éléments DOM manquants :', manquants);
  } else {
    console.info('Audit DOM khaleb-predict : tous les identifiants attendus sont présents.');
  }
})();
