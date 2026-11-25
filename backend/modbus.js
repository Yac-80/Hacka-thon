// Bibliothèque Modbus : permet à notre backend de lire un automate.
const ModbusRTU = require('modbus-serial');

// Port Modbus : 502 par défaut (le port standard). Modifiable via .env si besoin.
const MODBUS_PORT = Number(process.env.MODBUS_PORT) || 502;

// Lit UN registre d'un automate et renvoie sa valeur (un nombre).
//   ip      : adresse IP de l'automate (ex. "127.0.0.1" pour le simulateur)
//   address : numéro du registre à lire
async function readRegister(ip, address) {
  const client = new ModbusRTU();
  client.setTimeout(2000); // on abandonne si pas de réponse après 2 secondes
  try {
    await client.connectTCP(ip, { port: MODBUS_PORT }); // ouvre la connexion
    client.setID(1);                                    // identifiant de l'automate
    const result = await client.readHoldingRegisters(address, 1); // lit 1 registre
    return result.data[0];                              // la valeur lue
  } finally {
    // "finally" s'exécute toujours, même en cas d'erreur : on ferme la connexion
    // pour ne pas laisser de connexions ouvertes.
    client.close(() => {});
  }
}

module.exports = { readRegister };