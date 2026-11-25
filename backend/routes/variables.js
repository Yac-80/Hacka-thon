// Express : le framework qui gère les routes (les adresses de l'API).
const express = require('express');

// Le pool de connexions à la base, défini dans db.js (".." = dossier parent).
const pool = require('../db');

// Un Router regroupe plusieurs routes liées au même sujet (ici : les variables).
const router = express.Router();

const scheduler = require('../scheduler'); // pour relancer la collecte après un changement

// ---------- LISTER ----------
// GET /api/variables -> renvoie toutes les variables enregistrées.
router.get('/', async (req, res) => {
  try {
    // pool.query renvoie [lignes, infos] : on garde seulement les lignes.
    const [rows] = await pool.query('SELECT * FROM variables ORDER BY id');
    // On renvoie les lignes au format JSON.
    res.json(rows);
  } catch (err) {
    // En cas d'erreur (base arrêtée, etc.) : code 500 = erreur serveur.
    res.status(500).json({ error: err.message });
  }
});

// ---------- AJOUTER ----------
// POST /api/variables -> crée une nouvelle variable.
router.post('/', async (req, res) => {
  // req.body contient le JSON envoyé par le client.
  // On en extrait les 4 champs dont on a besoin.
  const { name, plc_ip, register_address, frequency_seconds } = req.body;

  // Vérification : si un champ manque, on refuse (400 = requête invalide).
  if (!name || !plc_ip || register_address === undefined || !frequency_seconds) {
    return res.status(400).json({
      error: 'Champs requis : name, plc_ip, register_address, frequency_seconds',
    });
  }

  try {
    // Les "?" sont remplacés par les valeurs du tableau, dans l'ordre.
    // Ça protège contre les injections SQL : ne jamais coller du texte à la main.
    const [result] = await pool.query(
      'INSERT INTO variables (name, plc_ip, register_address, frequency_seconds) VALUES (?, ?, ?, ?)',
      [name, plc_ip, register_address, frequency_seconds]
    );
    await scheduler.reload();
    // 201 = "créé". result.insertId est l'id donné automatiquement par la base.
    res.status(201).json({ id: result.insertId, name, plc_ip, register_address, frequency_seconds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- MODIFIER ----------
// PUT /api/variables/3 -> modifie la variable d'id 3.
// ":id" est un paramètre : on le lit avec req.params.id.
router.put('/:id', async (req, res) => {
  const { name, plc_ip, register_address, frequency_seconds } = req.body;

  try {
    const [result] = await pool.query(
      'UPDATE variables SET name = ?, plc_ip = ?, register_address = ?, frequency_seconds = ? WHERE id = ?',
      [name, plc_ip, register_address, frequency_seconds, req.params.id]
    );

    // affectedRows = nombre de lignes modifiées. 0 = cet id n'existe pas.
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Variable introuvable' }); // 404 = introuvable
    }
    await scheduler.reload();
    res.json({ id: Number(req.params.id), name, plc_ip, register_address, frequency_seconds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- SUPPRIMER ----------
// DELETE /api/variables/3 -> supprime la variable d'id 3.
// Ses mesures sont supprimées aussi (ON DELETE CASCADE dans init.sql).
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM variables WHERE id = ?', [req.params.id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Variable introuvable' });
    }
    await scheduler.reload();
    // 204 = "succès, rien à renvoyer".
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// On exporte le router pour le brancher dans server.js.
module.exports = router;