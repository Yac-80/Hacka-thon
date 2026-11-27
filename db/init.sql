CREATE TABLE variables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  plc_ip VARCHAR(45) NOT NULL,
  register_address INT NOT NULL,
  frequency_seconds INT NOT NULL,
  unit_id INT NOT NULL DEFAULT 1,
  register_type VARCHAR(20) NOT NULL DEFAULT 'holding',
  data_type VARCHAR(10) NOT NULL DEFAULT 'uint16',
  swap_words TINYINT(1) NOT NULL DEFAULT 0,
  divisor DOUBLE NOT NULL DEFAULT 1,           -- les valeurs lues sont divisées par ce nombre
  measure_unit VARCHAR(20) NOT NULL DEFAULT '' -- unité affichée (°C, %, m/min...)
);

CREATE TABLE measure (
  id INT AUTO_INCREMENT PRIMARY KEY,
  variable_id INT NOT NULL,
  value DOUBLE NOT NULL,
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (variable_id) REFERENCES variables(id) ON DELETE CASCADE
);

CREATE INDEX idx_measure_var_date ON measure (variable_id, recorded_at);