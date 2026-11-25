// "path" aide à construire des chemins de fichiers valables sur Windows et Linux.
const path = require('path');

// dotenv lit le fichier .env (à la racine du projet, donc ".." depuis backend)
// et met ses valeurs dans process.env.
// IMPORTANT : à faire avant d'importer db.js, qui a besoin de ces valeurs.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express'); // le framework du serveur web
const cors = require('cors');       // autorise le frontend (autre port) à appeler l'API
const pool = require('./db');       // la connexion à la base
const variablesRouter = require('./routes/variables'); // les routes des variables
const scheduler = require('./scheduler'); // collecte automatique des mesures

// On crée l'application Express.
const app = express();

// Middleware : s'exécute avant chaque route.
app.use(cors());          // autorise les appels depuis un autre site/port
app.use(express.json());  // permet de lire le JSON reçu dans req.body

// Route de test : vérifie que le serveur ET la base répondent.
app.get('/api/health', async (req, res) => {
  try {
    // Requête minimale : si elle marche, la base est joignable.
    const [rows] = await pool.query('SELECT 1 AS ok');
    res.json({ status: 'ok', db: rows[0].ok });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Toutes les routes de routes/variables.js sont préfixées par /api/variables.
// Ex. : GET /api/variables, POST /api/variables, PUT /api/variables/3...
app.use('/api/variables', variablesRouter);

// Port d'écoute : lu dans .env s'il existe, sinon 3000.
const PORT = process.env.BACKEND_PORT || 3000;

// On démarre le serveur et on affiche un message dans le terminal.
app.listen(PORT, () => {
  console.log(`Backend sur http://localhost:${PORT}`);
  // Au démarrage, on lance la collecte des variables déjà en base.
  scheduler.reload().catch((err) => console.error('Erreur au démarrage de la collecte :', err.message));
});