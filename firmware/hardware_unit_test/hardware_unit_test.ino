#include <Arduino.h>
#include <Wire.h>
#include <DHT.h>
#include <INA226_WE.h>

// =========================================================================
// PATRIOT-AD: FULL HARDWARE BENCH TEST (PENGUJIAN TOTAL MEJA KERJA)
// =========================================================================
// Menguji integrasi seluruh komponen siber-fisik sebelum masuk maket akrilik:
// 1. ESP32 DevKit V1 30-Pin (Metode Gantung Breadboard)
// 2. Sensor Suhu & Kelembapan DHT22 (GPIO 4)
// 3. Sensor Arus Presisi INA226 (I2C: SDA=21, SCL=22, IN+/IN- Loop Kipas)
// 4. Modul Relay 1-Channel 5V + LED Seri Opsi B (GPIO 26, VCC=VIN)
// 5. Kipas DC Brushless 5010 5V (Ditenagai via Relay COM-NO & INA226)
// 6. Buzzer 3-Pin (GPIO 33, Active-LOW)
// 7. 3 LED Indikator (Hijau=27, Kuning=25, Merah=32) + Resistor 220 Ohm
// =========================================================================

#define PIN_LED_BUILTIN 2
#define PIN_DHT         4
#define PIN_I2C_SDA     21
#define PIN_I2C_SCL     22
#define PIN_RELAY_IN1   26
#define PIN_LED_HIJAU   27
#define PIN_LED_KUNING  25
#define PIN_LED_MERAH   32
#define PIN_BUZZER      33

#define DHTTYPE         DHT22

DHT dht(PIN_DHT, DHTTYPE);
INA226_WE ina226(0x40);

bool inaConnected = false;
uint8_t inaAddress = 0x40;
bool relayActive = false;
bool buzzerActiveLow = true;

unsigned long lastTick = 0;
unsigned long lastLedTick = 0;
int ledStep = 0;
uint32_t seq = 0;

void setBuzzer(bool sound) {
  if (buzzerActiveLow) {
    digitalWrite(PIN_BUZZER, sound ? LOW : HIGH);
  } else {
    digitalWrite(PIN_BUZZER, sound ? HIGH : LOW);
  }
}

void setRelay(bool turnOn) {
  relayActive = turnOn;
  // Opsi B: Pin LOW = Arus mengalir menembus LED seri -> Relay ON (KLIK)
  // Pin HIGH = Tegangan bocor ditahan LED -> Relay OFF (KLIK)
  digitalWrite(PIN_RELAY_IN1, turnOn ? LOW : HIGH);
}

bool scanI2C() {
  uint8_t targetAddrs[] = {0x40, 0x44, 0x41, 0x45};
  for (uint8_t addr : targetAddrs) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      inaAddress = addr;
      return true;
    }
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(PIN_LED_BUILTIN, OUTPUT);
  pinMode(PIN_LED_HIJAU, OUTPUT);
  pinMode(PIN_LED_KUNING, OUTPUT);
  pinMode(PIN_LED_MERAH, OUTPUT);
  pinMode(PIN_RELAY_IN1, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  // Status awal aman
  setBuzzer(false); // Diam hening
  setRelay(false);  // Kipas mati
  digitalWrite(PIN_LED_HIJAU, LOW);
  digitalWrite(PIN_LED_KUNING, LOW);
  digitalWrite(PIN_LED_MERAH, LOW);

  Serial.println("\n=======================================================");
  Serial.println("   PATRIOT-AD: FULL HARDWARE BENCH TEST (MEJA TIM)");
  Serial.println("=======================================================");
  Serial.println("Perintah Serial:");
  Serial.println("  '1' = Nyalakan Kipas (Relay ON)");
  Serial.println("  '0' = Matikan Kipas (Relay OFF)");
  Serial.println("  'b' = Bunyikan Buzzer (Bip Pendek 150ms)");
  Serial.println("  't' = Toggle Relay ON/OFF");
  Serial.println("=======================================================\n");

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  dht.begin();

  if (scanI2C()) {
    ina226 = INA226_WE(inaAddress);
    ina226.init();
    // Resistor R100 pada modul CJMCU-226 = 0.1 Ohm, rentang 0.8A
    ina226.setResistorRange(0.1, 0.8);
    inaConnected = true;
    Serial.printf("[INIT] INA226 DITEMUKAN di alamat I2C 0x%02X!\n", inaAddress);
  } else {
    Serial.println("[INIT] INA226 belum terdeteksi (Cek kabel SDA=21, SCL=22, VCC=3V3, GND=GND)");
  }

  // Bip sambutan tanda siap
  setBuzzer(true);
  delay(100);
  setBuzzer(false);
}

void loop() {
  // 1. Animasi LED Indikator Berjalan (Running Lights)
  if (millis() - lastLedTick >= 350) {
    lastLedTick = millis();
    ledStep = (ledStep + 1) % 4;
    digitalWrite(PIN_LED_BUILTIN, (ledStep % 2));

    if (ledStep == 0) {
      digitalWrite(PIN_LED_HIJAU,  HIGH);
      digitalWrite(PIN_LED_KUNING, LOW);
      digitalWrite(PIN_LED_MERAH,  LOW);
    } else if (ledStep == 1) {
      digitalWrite(PIN_LED_HIJAU,  LOW);
      digitalWrite(PIN_LED_KUNING, HIGH);
      digitalWrite(PIN_LED_MERAH,  LOW);
    } else if (ledStep == 2) {
      digitalWrite(PIN_LED_HIJAU,  LOW);
      digitalWrite(PIN_LED_KUNING, LOW);
      digitalWrite(PIN_LED_MERAH,  HIGH);
    } else {
      digitalWrite(PIN_LED_HIJAU,  HIGH);
      digitalWrite(PIN_LED_KUNING, HIGH);
      digitalWrite(PIN_LED_MERAH,  HIGH);
    }
  }

  // 2. Baca Perintah Keyboard Serial
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '1') {
      setRelay(true);
      Serial.println("\n>>> [MANUAL] RELAY ON (Kipas 5010 Mulai Berputar!)");
    } else if (c == '0') {
      setRelay(false);
      Serial.println("\n>>> [MANUAL] RELAY OFF (Kipas 5010 Berhenti)");
    } else if (c == 'b' || c == 'B') {
      Serial.println("\n>>> [MANUAL] BUZZER TEST (BIP!)");
      setBuzzer(true);
      delay(150);
      setBuzzer(false);
    } else if (c == 't' || c == 'T') {
      setRelay(!relayActive);
      Serial.printf("\n>>> [TOGGLE] RELAY -> %s\n", relayActive ? "ON" : "OFF");
    }
  }

  // 3. Telemetri Sensor & Auto-Cycle Setiap 2 Detik
  if (millis() - lastTick >= 2000) {
    lastTick = millis();
    seq++;

    Serial.printf("\n================ [TELEMETRI #%lu] ================\n", seq);

    // A. Baca Sensor Suhu & Kelembapan DHT22
    float h = dht.readHumidity();
    float t = dht.readTemperature();
    if (isnan(h) || isnan(t)) {
      Serial.println("  [DHT22 ]  STATUS: MENUNGGU KONEKSI (Cek DATA=GPIO4, VCC=3V3, GND=GND)");
    } else {
      Serial.printf("  [DHT22 ]  SUHU: %.1f C  |  KELEMBAPAN: %.1f %%RH\n", t, h);
    }

    // B. Baca Sensor Arus INA226
    if (!inaConnected && scanI2C()) {
      ina226 = INA226_WE(inaAddress);
      ina226.init();
      ina226.setResistorRange(0.1, 0.8);
      inaConnected = true;
    }

    if (inaConnected) {
      float current_mA  = ina226.getCurrent_mA();
      float bus_V       = ina226.getBusVoltage_V();
      float shunt_mV    = ina226.getShuntVoltage_mV();
      float power_mW    = ina226.getBusPower();

      Serial.printf("  [INA226]  ARUS BEBAN : %.2f mA  (Daya: %.1f mW, Tegangan Bus: %.2f V)\n",
                    current_mA, power_mW, bus_V);

      if (current_mA > 35.0) {
        Serial.println("            -> [PEMBUKTIAN FISIK LAPIS 3]: KIPAS 5010 NYATA BERPUTAR (ANTI-SPOOFING OK!)");
      } else if (relayActive) {
        Serial.println("            -> [PERINGATAN]: Relay ON tapi arus < 35 mA (Cek kabel daya kipas / IN+/IN-)");
      }
    } else {
      Serial.println("  [INA226]  STATUS: BELUM TERDETEKSI (Cek SDA=GPIO21, SCL=GPIO22, VCC=3V3, GND)");
    }

    // C. Status Relay & Kipas
    Serial.printf("  [AKTUATOR] RELAY: %s  |  KIPAS: %s\n",
                  relayActive ? "ON (AKTIF)" : "OFF (MATI)",
                  relayActive ? "BERPUTAR" : "BERHENTI");

    // Otomatis ganti status relay tiap 6 detik (3 siklus) untuk pengujian mandiri
    if (seq % 3 == 0) {
      setRelay(!relayActive);
      if (relayActive) {
        // Bunyikan bip saat kipas mulai menyala
        setBuzzer(true);
        delay(100);
        setBuzzer(false);
      }
      Serial.printf("  >>> [AUTO-CYCLE] Mengubah Status Relay -> %s (KLIK!)\n",
                    relayActive ? "ON (KIPAS MENYALA)" : "OFF (KIPAS MATI)");
    }

    Serial.println("==================================================");
  }
}
