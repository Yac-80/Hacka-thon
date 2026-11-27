// =====================================================================
// CODE DE LA PAGE DE SUPERVISION
// Ce fichier fait le lien entre la page (HTML) et le backend (l'API).
// Il est organisé en 6 parties, lis-les dans l'ordre :
//   1. Réglages        4. Le graphique et la période affichée
//   2. Mémoire         5. Le formulaire (ajouter / modifier / supprimer)
//   3. Petits outils   6. L'export CSV, puis le démarrage
// Entre les parties 3 et 4 : la liste, les onglets et l'état des automates.
// =====================================================================


// ---------------------------------------------------------------------
// 1. RÉGLAGES
// ---------------------------------------------------------------------

// Adresse de l'API : la même machine que la page, sur le port 3000.
// Si quelqu'un ouvre la page depuis un autre PC (http://192.168.1.20:8080),
// l'API sera automatiquement cherchée à 192.168.1.20:3000.
const API_URL = `http://${window.location.hostname || 'localhost'}:3000/api`;

// Nombre maximum de points demandés pour le graphique (protège le navigateur).
const MAX_POINTS = 2000;

// Noms lisibles des types d'objets Modbus (affichés sous le nom de la variable).
const NOMS_TYPES = {
  holding: 'registre de maintien',
  input: 'registre d\'entrée',
  coil: 'bit (bobine)',
  discrete: 'entrée discrète',
};


// ---------------------------------------------------------------------
// 2. MÉMOIRE : ce que la page a besoin de retenir
// ---------------------------------------------------------------------

let variables = [];          // la liste de toutes les variables (venant de la base)
let variableChoisie = null;  // la variable dont on affiche le graphique
let graphique = null;        // l'objet Chart.js
let minuteur = null;         // le "réveil" qui rafraîchit le graphique
let ongletActif = 'reel';    // 'reel' (automate réel) ou 'simulation'
let periodeSecondes = 300;   // durée affichée sur le graphique (300 s = 5 min)
let numeroRequete = 0;       // sert à ignorer les réponses devenues périmées


// ---------------------------------------------------------------------
// 3. PETITS OUTILS
// ---------------------------------------------------------------------

// Raccourci : $('liste') veut dire document.getElementById('liste')
const $ = (id) => document.getElementById(id);

// Crée un élément HTML : creer('p', 'detail', 'Bonjour') -> <p class="detail">Bonjour</p>
// On utilise "textContent" (et pas innerHTML) : un nom avec du code dedans
// est affiché tel quel, sans risque.
function creer(balise, classe, texte) {
  const element = document.createElement(balise);
  if (classe) element.className = classe;
  if (texte !== undefined) element.textContent = texte;
  return element;
}

// Vrai si la variable est un bit (0 ou 1) : bobine ou entrée discrète.
// Pour un bit, on affiche ON / OFF et une courbe en escalier.
function estBit(v) {
  return Boolean(v) && (v.register_type === 'coil' || v.register_type === 'discrete');
}

// Une variable est "simulée" si son IP est celle de ce PC (127.x.x.x ou localhost).
// Sinon c'est un automate réel. C'est ce qui sépare les deux onglets.
function sourceDe(v) {
  const ip = String(v.plc_ip).trim().toLowerCase();
  return ip.startsWith('127.') || ip === 'localhost' ? 'simulation' : 'reel';
}

// Met un nombre au format français : 25.347 -> "25,347"
function formater(valeur) {
  return Number(valeur).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

// Transforme un nombre de secondes en texte : 45 -> "45 s", 150 -> "2 min", 7300 -> "2 h"
function duree(secondes) {
  if (secondes < 60) return `${secondes} s`;
  if (secondes < 3600) return `${Math.floor(secondes / 60)} min`;
  return `${Math.floor(secondes / 3600)} h`;
}

// Dit dans quel état est une variable, selon la date de sa dernière mesure.
// Le backend nous envoie "seconds_since_last" = secondes écoulées depuis la dernière mesure.
//   ok      : des mesures arrivent normalement
//   muet    : plus de mesure depuis plus de 3 périodes (l'automate ne répond plus)
//   attente : aucune mesure reçue pour l'instant
function etatDe(v) {
  const age = v.seconds_since_last;
  if (age === null || age === undefined) {
    return { code: 'attente', texte: 'Aucune mesure reçue pour l\'instant' };
  }
  const limite = Math.max(v.frequency_seconds * 3, 10); // 3 périodes, 10 s minimum
  if (age > limite) {
    return { code: 'muet', texte: `Automate muet depuis ${duree(age)}` };
  }
  return { code: 'ok', texte: 'Mesures reçues normalement' };
}

// Décrit une variable en une phrase (utilisé dans la liste et sous le titre).
// Exemple : "127.0.0.1, registre de maintien 0, toutes les 5 s"
function decrire(v) {
  const type = NOMS_TYPES[v.register_type] || NOMS_TYPES.holding;
  return `${v.plc_ip}, ${type} ${v.register_address}, toutes les ${v.frequency_seconds} s`;
}

// Appelle l'API et renvoie sa réponse en JSON.
//   chemin  : la fin de l'adresse, par exemple "/variables"
//   options : la méthode (POST, PUT, DELETE...) et le contenu à envoyer
async function appelApi(chemin, options = {}) {
  const reponse = await fetch(API_URL + chemin, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  // Si le serveur répond par une erreur, on lit son message et on le "lance".
  if (!reponse.ok) {
    const corps = await reponse.json().catch(() => ({}));
    throw new Error(corps.error || `Erreur ${reponse.status}`);
  }

  // 204 = "c'est fait, rien à renvoyer" (cas de la suppression).
  if (reponse.status === 204) return null;
  return reponse.json();
}

// Affiche la grosse valeur, et la fait "clignoter" en jaune si elle a changé.
function afficherValeur(texte) {
  const zone = $('releve-valeur');
  if (zone.textContent === String(texte)) return; // pas de changement : rien à signaler
  zone.textContent = texte;
  zone.classList.remove('maj');
  void zone.offsetWidth;        // astuce : force le navigateur à relancer l'animation
  zone.classList.add('maj');
}


// ---------------------------------------------------------------------
// ÉTAT DU BACKEND (la pastille en haut à droite)
// ---------------------------------------------------------------------

async function verifierBackend() {
  try {
    await appelApi('/health');
    $('statut').className = 'statut ok';
    $('statut').textContent = 'Backend connecté';
  } catch (erreur) {
    $('statut').className = 'statut erreur';
    $('statut').textContent = 'Backend injoignable';
  }
}


// ---------------------------------------------------------------------
// LA LISTE, LES ONGLETS ET L'ÉTAT DES AUTOMATES (colonne de gauche)
// ---------------------------------------------------------------------

// Les variables de l'onglet actuellement ouvert.
function variablesAffichees() {
  return variables.filter((v) => sourceDe(v) === ongletActif);
}

// Met à jour l'aspect des deux onglets (celui qui est ouvert + les compteurs).
function majOnglets() {
  for (const nom of ['reel', 'simulation']) {
    const actif = nom === ongletActif;
    $('onglet-' + nom).classList.toggle('actif', actif);
    $('onglet-' + nom).setAttribute('aria-selected', String(actif));
    $('compte-' + nom).textContent = variables.filter((v) => sourceDe(v) === nom).length;
  }
}

// Quand on clique sur un onglet : on l'ouvre et on sélectionne sa première variable.
function changerOnglet(nom) {
  ongletActif = nom;
  choisirVariable(variablesAffichees()[0] || null);
}

// Charge les variables depuis l'API puis met la page à jour.
//   idACibler : (facultatif) l'id de la variable à sélectionner ensuite
async function chargerVariables(idACibler) {
  variables = await appelApi('/variables');

  // Quelle variable afficher ? Celle demandée, sinon celle déjà choisie.
  const idVoulu = idACibler ?? (variableChoisie ? variableChoisie.id : null);
  let cible = variables.find((v) => v.id === idVoulu) || null;

  if (cible) {
    // On suit la variable : si elle a changé d'onglet (IP modifiée), on ouvre le bon onglet.
    ongletActif = sourceDe(cible);
  } else {
    // Sinon : si l'onglet ouvert est vide mais pas l'autre, on ouvre l'autre.
    if (variablesAffichees().length === 0 && variables.length > 0) {
      ongletActif = ongletActif === 'reel' ? 'simulation' : 'reel';
    }
    cible = variablesAffichees()[0] || null;
  }

  remplirListeExport();
  choisirVariable(cible);
}

// Recharge discrètement les variables (pour mettre à jour les états "muet / ok").
// Contrairement à chargerVariables, ça ne change pas la sélection et ne relance pas le graphique.
async function actualiserEtats() {
  try {
    variables = await appelApi('/variables');
    if (variableChoisie) {
      variableChoisie = variables.find((v) => v.id === variableChoisie.id) || variableChoisie;
    }
    afficherListe();
    afficherEtatReleve();
  } catch (erreur) {
    // On ne dit rien ici : la pastille "Backend injoignable" prévient déjà.
  }
}

// Dessine la liste des variables dans la colonne de gauche.
function afficherListe() {
  majOnglets();

  const liste = $('liste');
  liste.innerHTML = ''; // on vide, puis on reconstruit

  const affichees = variablesAffichees();
  $('liste-vide').textContent = ongletActif === 'simulation'
    ? 'Aucune variable simulée. Ajoutez-en une avec l\'IP 127.0.0.1 pour tester sans automate.'
    : 'Aucune variable sur un automate réel. Ajoutez-en une avec l\'IP de l\'automate.';
  $('liste-vide').hidden = affichees.length > 0;

  for (const v of affichees) {
    // Une ligne de la liste. La classe "choisie" la met en jaune.
    const estChoisie = variableChoisie && v.id === variableChoisie.id;
    const ligne = creer('li', estChoisie ? 'ligne choisie' : 'ligne');
    const etat = etatDe(v);

    // Le nom, précédé d'une pastille de couleur (verte / rouge / grise) = état de l'automate.
    const nom = creer('span', 'ligne-nom');
    nom.append(creer('span', 'pastille ' + etat.code), v.name);

    // Zone cliquable : nom + détails. Un clic affiche le graphique de cette variable.
    const choix = creer('button', 'ligne-choix');
    choix.type = 'button';
    choix.append(nom, creer('span', 'ligne-detail', decrire(v)));
    // Si tout va bien on ne dit rien : on n'écrit l'état que s'il y a un souci.
    if (etat.code !== 'ok') choix.append(creer('span', 'ligne-etat ' + etat.code, etat.texte));
    choix.addEventListener('click', () => choisirVariable(v));

    // Boutons Modifier et Supprimer
    const modifier = creer('button', 'lien', 'Modifier');
    modifier.type = 'button';
    modifier.addEventListener('click', () => ouvrirFormulaire(v));

    const supprimer = creer('button', 'lien lien-danger', 'Supprimer');
    supprimer.type = 'button';
    supprimer.addEventListener('click', () => supprimerVariable(v));

    const actions = creer('div', 'ligne-actions');
    actions.append(modifier, supprimer);

    ligne.append(choix, actions);
    liste.append(ligne);
  }
}

// Affiche l'état de la variable choisie sous son titre.
// Si l'automate est muet, la grosse valeur est grisée (elle n'est plus d'actualité).
function afficherEtatReleve() {
  const ligne = $('releve-etat');
  if (!variableChoisie) {
    ligne.hidden = true;
    $('releve-valeur').classList.remove('perimee');
    return;
  }
  const etat = etatDe(variableChoisie);
  ligne.className = 'etat-ligne ' + etat.code;
  ligne.textContent = etat.texte;
  ligne.hidden = etat.code === 'ok';
  $('releve-valeur').classList.toggle('perimee', etat.code === 'muet');
}

// Sélectionne une variable : met à jour le titre, la liste et le graphique.
function choisirVariable(v) {
  variableChoisie = v;
  afficherListe(); // pour déplacer la barre jaune

  // Aucune variable : on remet l'écran à zéro.
  if (!v) {
    clearInterval(minuteur);
    numeroRequete++; // toute réponse encore en attente sera ignorée
    $('releve-nom').textContent = 'Aucune variable sélectionnée';
    $('releve-detail').textContent = '';
    $('releve-valeur').textContent = '-';
    $('releve-unite').textContent = '';
    $('releve-heure').textContent = '';
    afficherEtatReleve();
    viderGraphique();
    return;
  }

  const unite = estBit(v) ? '' : (v.measure_unit || '');

  $('releve-nom').textContent = v.name;
  $('releve-detail').textContent = decrire(v);
  $('releve-valeur').textContent = '-';
  $('releve-unite').textContent = unite;
  afficherEtatReleve();

  if (graphique) {
    // Pour un bit : courbe en escalier (ça saute de 0 à 1) et axe un peu élargi.
    // Pour une valeur normale : courbe lissée et axe automatique.
    graphique.data.datasets[0].stepped = estBit(v);
    graphique.options.scales.y.suggestedMin = estBit(v) ? -0.1 : undefined;
    graphique.options.scales.y.suggestedMax = estBit(v) ? 1.1 : undefined;
    // L'unité s'écrit le long de l'axe vertical.
    graphique.options.scales.y.title = { display: Boolean(unite), text: unite, color: '#4a5b86' };
  }

  rafraichirGraphique(); // on affiche tout de suite les données...
  relancerMinuteur();    // ...puis on les rafraîchit régulièrement
}

// Les deux onglets : un clic ouvre l'onglet correspondant.
$('onglet-reel').addEventListener('click', () => changerOnglet('reel'));
$('onglet-simulation').addEventListener('click', () => changerOnglet('simulation'));


// ---------------------------------------------------------------------
// 4. LE GRAPHIQUE ET LA PÉRIODE AFFICHÉE
// ---------------------------------------------------------------------

// Crée le graphique (vide) une seule fois au démarrage.
function creerGraphique() {
  // Si Chart.js n'a pas pu se charger (pas d'internet), on prévient.
  if (typeof Chart === 'undefined') {
    $('releve-heure').textContent = 'Le graphique est indisponible : Chart.js n\'a pas pu être chargé.';
    return;
  }

  Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";

  graphique = new Chart($('graphique'), {
    type: 'line',
    data: {
      labels: [], // l'axe horizontal : les heures
      datasets: [{
        data: [],   // l'axe vertical : les valeurs
        borderColor: '#2457c5',
        backgroundColor: 'rgba(36, 87, 197, 0.10)',
        borderWidth: 2.5,
        pointRadius: 0,       // pas de points, juste la courbe
        pointHoverRadius: 4,
        tension: 0.25,        // légère courbure
        fill: true,
        stepped: false,       // passe à true pour les bits (voir choisirVariable)
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false, // le graphique prend la taille de son cadre
      animation: false,           // pas d'animation à chaque rafraîchissement
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            // Texte de la bulle quand on survole la courbe : valeur + unité (ou ON / OFF).
            label: (contexte) => {
              const y = contexte.parsed.y;
              if (estBit(variableChoisie)) return y ? ' ON' : ' OFF';
              const unite = variableChoisie && variableChoisie.measure_unit;
              return ' ' + formater(y) + (unite ? ' ' + unite : '');
            },
          },
        },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 6, color: '#4a5b86' }, grid: { display: false } },
        y: {
          ticks: { color: '#4a5b86' },
          grid: { color: 'rgba(20, 39, 90, 0.15)' },
          title: { display: false, text: '' },
        },
      },
    },
  });
}

// Vide le graphique.
function viderGraphique() {
  if (!graphique) return;
  graphique.data.labels = [];
  graphique.data.datasets[0].data = [];
  graphique.update();
}

// Combien de points faut-il pour couvrir la période choisie ?
// Exemple : 5 minutes (300 s) avec une mesure toutes les 5 s -> 60 points.
function nombreDePoints(variable) {
  const frequence = Math.max(variable.frequency_seconds, 1);
  return Math.min(MAX_POINTS, Math.max(2, Math.ceil(periodeSecondes / frequence)));
}

// Va chercher les dernières mesures de la variable choisie et met le graphique à jour.
async function rafraichirGraphique() {
  if (!variableChoisie || !graphique) return;

  // On note le numéro de cette demande. Si une demande plus récente part pendant l'attente
  // (autre variable choisie, autre période...), cette réponse sera ignorée.
  const variable = variableChoisie;
  const requete = ++numeroRequete;

  try {
    const mesures = await appelApi(`/variables/${variable.id}/measures?limit=${nombreDePoints(variable)}`);
    if (requete !== numeroRequete) return;

    // On sépare les heures (axe X) et les valeurs (axe Y).
    const heures = mesures.map((m) => new Date(m.recorded_at).toLocaleTimeString('fr-FR'));
    const valeurs = mesures.map((m) => m.value);

    graphique.data.labels = heures;
    graphique.data.datasets[0].data = valeurs;
    graphique.update();

    if (mesures.length > 0) {
      // La grosse valeur = la mesure la plus récente.
      // Pour un bit : ON si la valeur est 1, OFF si elle est 0.
      const derniere = valeurs[valeurs.length - 1];
      afficherValeur(estBit(variable) ? (derniere ? 'ON' : 'OFF') : formater(derniere));
      $('releve-heure').textContent = `Dernière mesure à ${heures[heures.length - 1]}`;
    } else {
      $('releve-valeur').textContent = '-';
      $('releve-heure').textContent = 'En attente de la première mesure...';
    }
  } catch (erreur) {
    $('releve-heure').textContent = 'Lecture impossible : ' + erreur.message;
  }
}

// (Re)lance le rafraîchissement automatique.
// Il se fait au rythme de la fréquence de la variable (2 secondes minimum).
function relancerMinuteur() {
  clearInterval(minuteur); // on arrête l'ancien réveil
  if (!variableChoisie) return;
  const periode = Math.max(variableChoisie.frequency_seconds, 2) * 1000; // en millisecondes
  minuteur = setInterval(rafraichirGraphique, periode);
}

// Les boutons "5 min / 30 min / 2 h" : on retient la durée choisie puis on redessine.
for (const bouton of document.querySelectorAll('.periode')) {
  bouton.addEventListener('click', () => {
    periodeSecondes = Number(bouton.dataset.secondes);
    for (const autre of document.querySelectorAll('.periode')) {
      autre.classList.toggle('actif', autre === bouton);
    }
    rafraichirGraphique();
  });
}


// ---------------------------------------------------------------------
// 5. LE FORMULAIRE : ajouter, modifier, supprimer
// ---------------------------------------------------------------------

// Ouvre le formulaire. Sans argument = ajout. Avec une variable = modification.
function ouvrirFormulaire(variable) {
  $('champ-id').value = variable ? variable.id : '';
  $('champ-nom').value = variable ? variable.name : '';
  // Dans l'onglet Simulation, on pré-remplit l'IP de ce PC pour gagner du temps.
  $('champ-ip').value = variable ? variable.plc_ip : (ongletActif === 'simulation' ? '127.0.0.1' : '');
  $('champ-registre').value = variable ? variable.register_address : '';
  $('champ-frequence').value = variable ? variable.frequency_seconds : 5;
  $('champ-diviseur').value = variable ? variable.divisor : 1;
  $('champ-unite').value = variable ? variable.measure_unit : '';

  // Les réglages Modbus (valeurs par défaut pour une nouvelle variable).
  $('champ-type').value = variable ? variable.register_type : 'holding';
  $('champ-format').value = variable ? variable.data_type : 'uint16';
  $('champ-unit').value = variable ? variable.unit_id : 1;
  $('champ-swap').checked = variable ? Boolean(variable.swap_words) : false;

  // On déplie les réglages Modbus seulement si la variable n'a pas les valeurs par défaut.
  $('formulaire-avance').open = Boolean(variable) && (
    variable.register_type !== 'holding' || variable.data_type !== 'uint16' ||
    variable.unit_id !== 1 || Boolean(variable.swap_words)
  );

  $('formulaire-titre').textContent = variable ? 'Modifier la variable' : 'Nouvelle variable';
  $('formulaire-erreur').textContent = '';
  $('formulaire').hidden = false;
  $('champ-nom').focus();
}

function fermerFormulaire() {
  $('formulaire').hidden = true;
}

// Supprime une variable après confirmation.
async function supprimerVariable(variable) {
  if (!confirm(`Supprimer "${variable.name}" et toutes ses mesures ?`)) return;
  try {
    await appelApi(`/variables/${variable.id}`, { method: 'DELETE' });
    await chargerVariables();
  } catch (erreur) {
    alert('Suppression impossible : ' + erreur.message);
  }
}

// Quand on valide le formulaire : POST (ajout) ou PUT (modification).
$('formulaire').addEventListener('submit', async (evenement) => {
  evenement.preventDefault(); // empêche le rechargement de la page

  const id = $('champ-id').value;
  const donnees = {
    name: $('champ-nom').value,
    plc_ip: $('champ-ip').value.trim(),
    register_address: Number($('champ-registre').value),
    frequency_seconds: Number($('champ-frequence').value),
    divisor: Number($('champ-diviseur').value),
    measure_unit: $('champ-unite').value,
    // Réglages Modbus :
    unit_id: Number($('champ-unit').value),
    register_type: $('champ-type').value,
    data_type: $('champ-format').value,
    swap_words: $('champ-swap').checked,
  };

  try {
    let idACibler;
    if (id) {
      // Modification : on garde la même variable sélectionnée.
      await appelApi(`/variables/${id}`, { method: 'PUT', body: JSON.stringify(donnees) });
      idACibler = Number(id);
    } else {
      // Ajout : l'API renvoie la nouvelle variable, on la sélectionne.
      const creee = await appelApi('/variables', { method: 'POST', body: JSON.stringify(donnees) });
      idACibler = creee.id;
    }
    fermerFormulaire();
    await chargerVariables(idACibler);
  } catch (erreur) {
    $('formulaire-erreur').textContent = erreur.message;
  }
});

$('btn-nouvelle').addEventListener('click', () => ouvrirFormulaire(null));
$('btn-annuler').addEventListener('click', fermerFormulaire);


// ---------------------------------------------------------------------
// 6. L'EXPORT CSV
// ---------------------------------------------------------------------

// Remplit le menu déroulant de l'export avec les variables.
function remplirListeExport() {
  const menu = $('export-variable');
  menu.innerHTML = '';
  menu.append(new Option('Toutes les variables', '')); // texte affiché, valeur envoyée
  for (const v of variables) {
    menu.append(new Option(v.name, v.id));
  }
  if (variableChoisie) menu.value = variableChoisie.id;
}

// Date d'aujourd'hui au format AAAA-MM-JJ (celui que comprend un champ date).
function dateDuJour() {
  const d = new Date();
  const mois = String(d.getMonth() + 1).padStart(2, '0');
  const jour = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mois}-${jour}`;
}

// Quand on clique sur "Télécharger" : on demande le CSV à l'API.
$('export-form').addEventListener('submit', (evenement) => {
  evenement.preventDefault();

  const debut = $('export-debut').value;
  const fin = $('export-fin').value;

  if (debut > fin) {
    $('export-erreur').textContent = 'La date de début doit être avant la date de fin.';
    return;
  }
  $('export-erreur').textContent = '';

  // On construit l'adresse : /export?from=...&to=...&variable_id=...
  const parametres = new URLSearchParams({ from: debut, to: fin });
  if ($('export-variable').value) parametres.set('variable_id', $('export-variable').value);

  // Le serveur répond avec un fichier à télécharger : le navigateur s'en occupe.
  window.location.href = `${API_URL}/export?${parametres}`;
});


// ---------------------------------------------------------------------
// DÉMARRAGE : ce qui s'exécute quand la page s'ouvre
// ---------------------------------------------------------------------

$('export-debut').value = dateDuJour();
$('export-fin').value = dateDuJour();

creerGraphique();

verifierBackend();
setInterval(verifierBackend, 10000); // on revérifie le backend toutes les 10 secondes

chargerVariables().catch((erreur) => {
  $('liste-vide').textContent = 'Impossible de charger les variables : ' + erreur.message;
  $('liste-vide').hidden = false;
});

setInterval(actualiserEtats, 5000); // on met à jour les états "muet / ok" toutes les 5 secondes