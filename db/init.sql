CREATE TABLE variables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  plc_ip VARCHAR(45) NOT NULL,
  register_address INT NOT NULL,
  frequency_seconds INT NOT NULL,
  unit_id INT NOT NULL DEFAULT 1,              -- identifiant Modbus (255 pour le serveur intégré d'un M580)
  register_type VARCHAR(20) NOT NULL DEFAULT 'holding', -- holding | input | coil | discrete
  data_type VARCHAR(10) NOT NULL DEFAULT 'uint16',      -- uint16 | int16 | float32
  swap_words TINYINT(1) NOT NULL DEFAULT 0     -- 1 = inverser les 2 mots d'un réel
);

CREATE TABLE measure (
  id INT AUTO_INCREMENT PRIMARY KEY,
  variable_id INT NOT NULL,
  value DOUBLE NOT NULL,
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (variable_id) REFERENCES variables(id) ON DELETE CASCADE
);