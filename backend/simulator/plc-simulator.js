// Simulateur d'automate Modbus TCP : il fait semblant d'être un vrai automate
// pour qu'on puisse tester la lecture sans matériel.
const ModbusRTU = require('modbus-serial');

// Le "vector" décrit comment l'automate répond quand on lit un registre.
const vector = {
  // Appelée à chaque lecture d'un "holding register" (registre de maintien).
  // addr = l'adresse du registre demandé.
  getHoldingRegister: (addr) => {
    // Valeur qui oscille doucement autour de 50 (entre 30 et 70),
    // un peu différente selon l'adresse, pour ressembler à une vraie mesure.
    return Math.round(50 + 20 * Math.sin(Date.now() / 10000 + addr));
  },
  // Même chose pour les "input registers" (registres d'entrée).
  getInputRegister: (addr) => {
    return Math.round(50 + 20 * Math.sin(Date.now() / 10000 + addr));
  },
};

// On démarre le serveur Modbus TCP.
// host "0.0.0.0" = accepte les connexions de toutes les adresses de ton PC.
// port 502 = le port standard de Modbus.
const server = new ModbusRTU.ServerTCP(vector, {
  host: '0.0.0.0',
  port: 502,
  unitID: 1,
});

server.on('socketError', (err) => console.error('Erreur socket :', err.message));
console.log('Automate simulé démarré sur le port 502 (Modbus TCP)');
