// On importe mysql2 : la bibliothèque qui permet à Node.js de parler à MariaDB.
// "/promise" permet d'utiliser async/await au lieu des anciens callbacks.
const mysql = require('mysql2/promise');

// Un "pool" est un groupe de connexions à la base qui sont réutilisées.
// C'est plus rapide que de rouvrir une connexion à chaque requête.
const pool = mysql.createPool({
  // Adresse de la base : "localhost" quand le backend tourne sur ton PC.
  // Plus tard, dans Docker, on mettra le nom du service ("db") via DB_HOST.
  host: process.env.DB_HOST || 'localhost',

  // Port de MariaDB (celui qu'on a ouvert dans docker-compose.yml).
  port: 3306,

  timezone: 'Z',   // la base est en UTC : on le dit à Node pour que les heures soient justes

  // Identifiants lus dans le fichier .env (jamais écrits en dur dans le code).
  user: process.env.MARIADB_USER,
  password: process.env.MARIADB_PASSWORD,
  database: process.env.MARIADB_DATABASE,
});

// On exporte le pool pour que les autres fichiers puissent l'utiliser
// avec : const pool = require('./db');
module.exports = pool;