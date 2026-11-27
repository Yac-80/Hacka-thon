// Express : le framework qui gère les routes (les adresses de l'API).
const express = require('express');

// Le pool de connexions à la base, défini dans db.js (".." = dossier parent).
const pool = require('../db');

// Un Router regroupe plusieurs routes liées au même sujet (ici : les variables).
const router = express.Router();

const scheduler = require('../scheduler'); // pour relancer la collecte après un changement

// Valeurs autorisées pour les champs "à choix".
const TYPES_REGISTRE = ['holding', 'input', 'coil', 'discrete'];
const TYPES_DONNEE = ['uint16', 'int16', 'float32'];

// Lit et vérifie les champs "avancés" envoyés par la page.
// Si un champ est absent, on met la valeur par défaut (comportement d'avant).
// Renvoie soit { erreur: '...' }, soit les valeurs propres.
function lireOptions(body) {
  const unit_id = body.unit_id === undefined || body.unit_id === '' ? 1 : Number(body.unit_id);
  const register_type = body.register_type || 'holding';
  const data_type = body.data_type || 'uint16';
  const swap_words = body.swap_words ? 1 : 0;
  const divisor = body.divisor === undefined || body.divisor === '' ? 1 : Number(body.divisor);
  const measure_unit = String(body.measure_unit ?? '').trim().slice(0, 20);

  if (!Number.isInteger(unit_id) || unit_id < 0 || unit_id > 255) {
    return { erreur: 'unit_id doit être un entier entre 0 et 255' };
  }
  if (!TYPES_REGISTRE.includes(register_type)) {
    return { erreur: 'register_type doit être : ' + TYPES_REGISTRE.join(', ') };
  }
  if (!TYPES_DONNEE.includes(data_type)) {
    return { erreur: 'data_type doit être : ' + TYPES_DONNEE.join(', ') };
  }
  if (!Number.isFinite(divisor) || divisor <= 0) {
    return { erreur: 'divisor doit être un nombre supérieur à 0' };
  }
  return { unit_id, register_type, data_type, swap_words, divisor, measure_unit };
}

// ---------- LISTER ----------
// GET /api/variables -> renvoie toutes les variables enregistrées.
// On ajoute "seconds_since_last" : le nombre de secondes écoulées depuis la dernière mesure
// de chaque variable (NULL si aucune mesure). La page s'en sert pour détecter un automate muet.
router.get('/', async (req, res) => {
  try {
    // pool.query renvoie [lignes, infos] : on garde seulement les lignes.
    const [rows] = await pool.query(
      `SELECT v.*,
              (SELECT TIMESTAMPDIFF(SECOND, MAX(m.recorded_at), NOW())
                 FROM measure m
                WHERE m.variable_id = v.id) AS seconds_since_last
         FROM variables v
        ORDER BY v.id`
    );
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
  // On en extrait les 4 champs de base.
  const { name, plc_ip, register_address, frequency_seconds } = req.body;

  // Vérification : si un champ manque, on refuse (400 = requête invalide).
  if (!name || !plc_ip || register_address === undefined || !frequency_seconds) {
    return res.status(400).json({
      error: 'Champs requis : name, plc_ip, register_address, frequency_seconds',
    });
  }

  // Les champs avancés (type de registre, format, unit id, ordre des mots, diviseur, unité).
  const options = lireOptions(req.body);
  if (options.erreur) return res.status(400).json({ error: options.erreur });

  try {
    // Les "?" sont remplacés par les valeurs du tableau, dans l'ordre.
    // Ça protège contre les injections SQL : ne jamais coller du texte à la main.
    const [result] = await pool.query(
      `INSERT INTO variables
         (name, plc_ip, register_address, frequency_seconds,
          unit_id, register_type, data_type, swap_words, divisor, measure_unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, plc_ip, register_address, frequency_seconds,
       options.unit_id, options.register_type, options.data_type, options.swap_words,
       options.divisor, options.measure_unit]
    );
    await scheduler.reload();
    // 201 = "créé". result.insertId est l'id donné automatiquement par la base.
    res.status(201).json({
      id: result.insertId, name, plc_ip, register_address, frequency_seconds, ...options,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- MODIFIER ----------
// PUT /api/variables/3 -> modifie la variable d'id 3.
// ":id" est un paramètre : on le lit avec req.params.id.
router.put('/:id', async (req, res) => {
  const { name, plc_ip, register_address, frequency_seconds } = req.body;

  const options = lireOptions(req.body);
  if (options.erreur) return res.status(400).json({ error: options.erreur });

  try {
    const [result] = await pool.query(
      `UPDATE variables
          SET name = ?, plc_ip = ?, register_address = ?, frequency_seconds = ?,
              unit_id = ?, register_type = ?, data_type = ?, swap_words = ?,
              divisor = ?, measure_unit = ?
        WHERE id = ?`,
      [name, plc_ip, register_address, frequency_seconds,
       options.unit_id, options.register_type, options.data_type, options.swap_words,
       options.divisor, options.measure_unit,
       req.params.id]
    );

    // affectedRows = nombre de lignes modifiées. 0 = cet id n'existe pas.
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Variable introuvable' }); // 404 = introuvable
    }
    await scheduler.reload();
    res.json({
      id: Number(req.params.id), name, plc_ip, register_address, frequency_seconds, ...options,
    });
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