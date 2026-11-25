// Express : le framework qui gère les routes.
const express = require('express');
// Le pool de connexions à la base.
const pool = require('../db');

const router = express.Router();

// ---------- DERNIÈRES MESURES D'UNE VARIABLE (pour le graphique) ----------
// GET /api/variables/3/measures?limit=50
// -> renvoie les 50 dernières mesures de la variable d'id 3, de la plus ancienne
//    à la plus récente (c'est l'ordre dont Chart.js a besoin).
router.get('/variables/:id/measures', async (req, res) => {
  // "limit" vient de l'adresse (?limit=50). Par défaut 50, maximum 1000.
  const limit = Math.min(Number(req.query.limit) || 50, 1000);

  try {
    // On prend les plus récentes (ORDER BY ... DESC) avec une limite.
    const [rows] = await pool.query(
      'SELECT id, value, recorded_at FROM measure WHERE variable_id = ? ORDER BY recorded_at DESC LIMIT ?',
      [req.params.id, limit]
    );
    // .reverse() remet les lignes dans l'ordre chronologique (ancien -> récent).
    res.json(rows.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Met un texte entre guillemets pour le CSV (et double les guillemets internes),
// pour que des caractères comme ";" dans un nom ne cassent pas le fichier.
function csvText(text) {
  return '"' + String(text).replace(/"/g, '""') + '"';
}

// ---------- EXPORT CSV SUR UNE PLAGE DE DATES ----------
// GET /api/export?from=2026-11-01&to=2026-11-30&variable_id=3
// "from" et "to" sont obligatoires, "variable_id" est facultatif
// (sans lui, on exporte toutes les variables).
router.get('/export', async (req, res) => {
  const { from, to, variable_id } = req.query;

  // Vérification : les deux dates sont obligatoires.
  if (!from || !to) {
    return res.status(400).json({ error: 'Paramètres requis : from et to (format AAAA-MM-JJ)' });
  }

  // Si on reçoit seulement une date (2026-11-30), on la complète avec une heure :
  // début de journée pour "from", fin de journée pour "to".
  const start = from.length === 10 ? `${from} 00:00:00` : from;
  const end = to.length === 10 ? `${to} 23:59:59` : to;

  try {
    // On joint les deux tables pour avoir le NOM de la variable à côté de chaque mesure.
    // DATE_FORMAT met la date au format lisible AAAA-MM-JJ HH:MM:SS.
    let sql = `
      SELECT v.name, m.value, DATE_FORMAT(m.recorded_at, '%Y-%m-%d %H:%i:%s') AS recorded_at
      FROM measure m
      JOIN variables v ON v.id = m.variable_id
      WHERE m.recorded_at BETWEEN ? AND ?`;
    const params = [start, end];

    // Filtre facultatif sur une seule variable.
    if (variable_id) {
      sql += ' AND m.variable_id = ?';
      params.push(variable_id);
    }
    sql += ' ORDER BY m.recorded_at';

    const [rows] = await pool.query(sql, params);

    // On construit le CSV : une ligne d'en-tête, puis une ligne par mesure.
    const lines = ['variable;valeur;date'];
    for (const row of rows) {
      lines.push(`${csvText(row.name)};${row.value};${row.recorded_at}`);
    }

    // En-têtes HTTP : disent au navigateur "c'est un fichier CSV à télécharger".
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
    // "\uFEFF" au début : permet à Excel d'afficher correctement les accents.
    res.send('\uFEFF' + lines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// On exporte le router pour le brancher dans server.js.
module.exports = router;