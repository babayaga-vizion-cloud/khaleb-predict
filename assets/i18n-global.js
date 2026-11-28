(function initialiserGlobalisationKhalebFinal() {
  const CLE_LANGUE = 'khaleb_predict_lang';
  const CLE_DEVISE = 'khaleb_predict_currency';
  const DEVISES_SUPPORT = new Set(['XAF', 'EUR', 'USD', 'GBP', 'NGN', 'KES', 'MAD', 'BRL', 'CAD']);

  const DICTIONNAIRE = {
    fr: {
      undoDefault: 'Annuler dernière action',
      redoDefault: 'Rétablir dernière action',
      online: 'En ligne',
      offline: 'Hors-ligne',
      ready: 'Prêt.',
      syncSuccess: 'Synchronisation terminée avec succès.'
    },
    en: {
      undoDefault: 'Undo last action',
      redoDefault: 'Redo last action',
      online: 'Online',
      offline: 'Offline',
      ready: 'Ready.',
      syncSuccess: 'Synchronization completed successfully.'
    },
    es: {
      undoDefault: 'Deshacer última acción',
      redoDefault: 'Rehacer última acción',
      online: 'En línea',
      offline: 'Sin conexión',
      ready: 'Listo.',
      syncSuccess: 'Sincronización completada con éxito.'
    },
    pt: {
      undoDefault: 'Desfazer última ação',
      redoDefault: 'Refazer última ação',
      online: 'Online',
      offline: 'Offline',
      ready: 'Pronto.',
      syncSuccess: 'Sincronização concluída com sucesso.'
    }
  };

  function lireStockage(cle) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(cle);
      }
    } catch {
      return null;
    }
    return null;
  }

  function ecrireStockage(cle, valeur) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(cle, valeur);
      }
    } catch {
      // Ignorer en cas de quota ou contexte restreint
    }
  }

  function detecterLangueSupportee() {
    const pref = lireStockage(CLE_LANGUE);
    const brut = String(pref || (typeof navigator !== 'undefined' ? navigator.language : 'fr') || 'fr')
      .slice(0, 2)
      .toLowerCase();
    return Object.prototype.hasOwnProperty.call(DICTIONNAIRE, brut) ? brut : 'fr';
  }

  function detecterDeviseDefaut() {
    const pref = String(lireStockage(CLE_DEVISE) || 'XAF').toUpperCase();
    return DEVISES_SUPPORT.has(pref) ? pref : 'XAF';
  }

  let langueActive = detecterLangueSupportee();
  let deviseDefaut = detecterDeviseDefaut();
  let localeActive = typeof navigator !== 'undefined' && navigator.language
    ? navigator.language
    : (langueActive === 'fr' ? 'fr-FR' : 'en-US');

  function definirLangue(nouvelleLangue) {
    const code = String(nouvelleLangue || '').slice(0, 2).toLowerCase();
    langueActive = Object.prototype.hasOwnProperty.call(DICTIONNAIRE, code) ? code : 'fr';
    ecrireStockage(CLE_LANGUE, langueActive);
    localeActive = langueActive === 'fr' ? 'fr-FR' : (langueActive === 'es' ? 'es-ES' : (langueActive === 'pt' ? 'pt-PT' : 'en-US'));
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('lang', langueActive);
    }
    return langueActive;
  }

  function definirDeviseDefaut(nouvelleDevise) {
    const code = String(nouvelleDevise || '').toUpperCase();
    deviseDefaut = DEVISES_SUPPORT.has(code) ? code : 'XAF';
    ecrireStockage(CLE_DEVISE, deviseDefaut);
    return deviseDefaut;
  }

  function traduire(cle) {
    const table = DICTIONNAIRE[langueActive] || DICTIONNAIRE.fr;
    return table[cle] || DICTIONNAIRE.fr[cle] || cle;
  }

  function formaterDeviseMondiale(montant, devise = deviseDefaut) {
    const valeur = Number(montant ?? 0);
    const code = String(devise || deviseDefaut || 'XAF').toUpperCase();
    const safe = Number.isFinite(valeur) ? valeur : 0;
    const sansDecimales = new Set(['XAF', 'XOF', 'JPY', 'NGN', 'KES']);

    try {
      return new Intl.NumberFormat(localeActive, {
        style: 'currency',
        currency: code,
        minimumFractionDigits: sansDecimales.has(code) ? 0 : 2,
        maximumFractionDigits: sansDecimales.has(code) ? 0 : 2
      }).format(safe);
    } catch {
      const fixe = sansDecimales.has(code) ? Math.round(safe).toString() : safe.toFixed(2);
      return `${fixe} ${code}`;
    }
  }

  function formaterDateLocale(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '-';
    try {
      return new Intl.DateTimeFormat(localeActive, {
        dateStyle: 'short',
        timeStyle: 'short'
      }).format(date);
    } catch {
      return date.toISOString();
    }
  }

  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('lang', langueActive);
  }

  window.KhalebGlobal = {
    get langueActive() { return langueActive; },
    get localeActive() { return localeActive; },
    get deviseDefaut() { return deviseDefaut; },
    definirLangue,
    definirDeviseDefaut,
    traduire,
    formaterDeviseMondiale,
    formaterDateLocale
  };
})();
