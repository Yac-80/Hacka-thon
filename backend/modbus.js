// Bibliothèque Modbus : permet à notre backend de lire un automate.
const ModbusRTU = require('modbus-serial');

// Port Modbus : 502 par défaut (le port standard). Modifiable via .env si besoin.
const MODBUS_PORT = Number(process.env.MODBUS_PORT) || 502;

// Transforme les mots lus (nombres de 0 à 65535) en la vraie valeur.
//   mots      : tableau des registres lus (1 mot, ou 2 pour un réel)
//   format    : 'uint16' (entier positif), 'int16' (entier signé) ou 'float32' (réel)
//   inverser  : true = on échange les 2 mots (nécessaire selon la marque / config)
function decoder(mots, format, inverser) {
  if (format === 'float32') {
    // Un réel 32 bits est réparti sur 2 registres de 16 bits.
    const [premier, second] = inverser ? [mots[1], mots[0]] : [mots[0], mots[1]];
    const tampon = Buffer.alloc(4);        // 4 octets = 32 bits
    tampon.writeUInt16BE(premier, 0);      // on écrit les 2 mots...
    tampon.writeUInt16BE(second, 2);
    const valeur = tampon.readFloatBE(0);  // ...et on relit l'ensemble comme un réel
    if (!Number.isFinite(valeur)) {
      throw new Error('Réel invalide (essayez d\'inverser les 2 mots)');
    }
    return Math.round(valeur * 1000) / 1000; // 3 décimales
  }
  if (format === 'int16') {
    const tampon = Buffer.alloc(2);
    tampon.writeUInt16BE(mots[0], 0);
    return tampon.readInt16BE(0);          // relu en "signé" : 65535 devient -1
  }
  return mots[0]; // uint16 : la valeur telle quelle
}

// Lit UNE variable décrite par sa ligne de la table "variables".
// Champs utilisés : plc_ip, register_address, unit_id, register_type, data_type, swap_words
async function readVariable(v) {
  const client = new ModbusRTU();
  client.setTimeout(2000); // on abandonne si pas de réponse après 2 secondes
  try {
    await client.connectTCP(v.plc_ip, { port: MODBUS_PORT }); // ouvre la connexion
    client.setID(v.unit_id ?? 1);                              // identifiant de l'automate

    const type = v.register_type || 'holding';
    const adresse = v.register_address;

    // Les bits (0 ou 1) : bobines (FC1) et entrées discrètes (FC2)
    if (type === 'coil') {
      const r = await client.readCoils(adresse, 1);
      return r.data[0] ? 1 : 0;
    }
    if (type === 'discrete') {
      const r = await client.readDiscreteInputs(adresse, 1);
      return r.data[0] ? 1 : 0;
    }

    // Les mots : registres de maintien (FC3) ou d'entrée (FC4)
    const format = v.data_type || 'uint16';
    const nbMots = format === 'float32' ? 2 : 1; // un réel = 2 registres
    const r = type === 'input'
      ? await client.readInputRegisters(adresse, nbMots)
      : await client.readHoldingRegisters(adresse, nbMots);
    return decoder(r.data, format, Boolean(v.swap_words));
  } finally {
    // "finally" s'exécute toujours, même en cas d'erreur : on ferme la connexion.
    client.close(() => {});
  }
}

// Ancienne fonction gardée pour ne rien casser : lit un registre de maintien simple.
function readRegister(ip, address) {
  return readVariable({ plc_ip: ip, register_address: address });
}

module.exports = { readRegister, readVariable };