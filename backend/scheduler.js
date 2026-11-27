// node-cron permet de lancer une fonction à intervalles réguliers.
const cron = require('node-cron');
const pool = require('./db');                    // connexion à la base
const { readVariable } = require('./modbus');    // lecture d'un automate (toute la variable)

// Liste des tâches en cours : une tâche par variable.
// La clé est l'id de la variable, la valeur est la tâche cron.
const tasks = new Map();

// Transforme une fréquence en secondes en expression cron.
// node-cron accepte 6 champs : secondes minutes heures jour mois jour-semaine.
function toCron(seconds) {
  // Moins d'une minute : "*/5 * * * * *" = toutes les 5 secondes.
  if (seconds < 60) return `*/${seconds} * * * * *`;
  // Une minute ou plus : on convertit en minutes (59 maximum).
  const minutes = Math.min(Math.round(seconds / 60), 59);
  return `0 */${minutes} * * * *`;
}

// Lit la valeur d'UNE variable sur l'automate et l'enregistre en base.
async function collect(variable) {
  try {
    // 1. On lit la variable sur l'automate (adresse, type d'objet, format, unit id...
    //    sont tous dans l'objet "variable", venant de la base).
    const value = await readVariable(variable);
    // 2. On enregistre la valeur (la date est ajoutée automatiquement par la base).
    await pool.query('INSERT INTO measure (variable_id, value) VALUES (?, ?)', [
      variable.id,
      value,
    ]);
    console.log(`[collecte] ${variable.name} = ${value}`);
  } catch (err) {
    // Si l'automate ne répond pas, on note l'erreur sans arrêter le serveur.
    console.error(`[collecte] erreur sur "${variable.name}" : ${err.message}`);
  }
}

// Arrête toutes les tâches en cours.
function stopAll() {
  for (const task of tasks.values()) task.stop();
  tasks.clear();
}

// (Re)charge les variables depuis la base et crée une tâche pour chacune.
// On l'appelle au démarrage et à chaque modification de la configuration.
async function reload() {
  stopAll(); // on repart de zéro
  const [variables] = await pool.query('SELECT * FROM variables');
  for (const variable of variables) {
    const task = cron.schedule(toCron(variable.frequency_seconds), () => collect(variable));
    tasks.set(variable.id, task);
  }
  console.log(`[collecte] ${variables.length} variable(s) surveillée(s)`);
}

module.exports = { reload };