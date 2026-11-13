/**
 * ============================================================================
 * PATRIOT-AD: Platform Analisis Trafik & Respons Infrastruktur Operasional Terpadu
 * Kartika Cyber Hackathon 2026 - PUSSIBERAD
 * ============================================================================
 * 
 * Production Firmware for ESP32 DevKit V1 (Maket Testbed Edge Node)
 * ID Simpul    : esp32_gudang
 * Deskripsi    : Pengawasan Siber-Fisik Fasilitas Gudang Amunisi TNI-AD
 * Fitur Kunci  :
 *   1. Telemetri Multi-Sensor (DHT22 Suhu/Kelembapan + INA226 Arus/Tegangan Shunt)
 *   2. Autentikasi Perintah & Interlock Mandiri (Edge Defense-in-Depth Safety Gate)
 *   3. Deteksi Failsafe Pemutusan Jaringan (Autonomous Offline Protection)
 *   4. Kendali Aktuator Kipas 5010 via Relay Aktif-LOW & Pembuktian Arus Lapis 3
 *   5. Sistem Indikator Fisik Bertingkat (LED Hijau/Kuning/Merah & Buzzer KY-012)
 *   6. CLI Diagnostik Serial Interaktif untuk Benchmarking & Pengujian Meja
 * 
 * Lisensi / Hak Cipta : Tim PATRIOT-AD (Kartika Cyber Hackathon 2026)
 * ============================================================================
 */

#include "config.h"
#include <WiFi.h>
#include <Wire.h>
#include <DHT.h>
#include <INA226_WE.h>
#include <PubSubClient.h>
#include "mbedtls/md.h"

// =============================================================================
// GLOBAL INSTANCES & STATE VARIABLES
// =============================================================================
DHT dht(PIN_DHT, DHT_TYPE);
INA226_WE ina226(INA226_I2C_ADDR_DEFAULT);
WiFiClient espWifiClient;
PubSubClient mqttClient(espWifiClient);

// Status Perangkat Fisik
bool relayFanActive        = false;  // false = OFF, true = ON
bool relayActiveHigh       = false;  // false = Active-LOW (LOW=ON, HIGH=OFF), true = Active-HIGH
bool buzzerActiveLow       = true;   // true = Active-LOW (LOW=Bunyi), false = Active-HIGH (HIGH=Bunyi)
bool ina226Detected        = false;  // Status deteksi sensor arus I2C
uint8_t activeInaAddress   = INA226_I2C_ADDR_DEFAULT;
int     activeSdaPin       = PIN_I2C_SDA;
int     activeSclPin       = PIN_I2C_SCL;

inline void setRelayState(bool fanOn) {
  if (relayActiveHigh) {
    digitalWrite(PIN_RELAY_IN1, fanOn ? HIGH : LOW);
  } else {
    digitalWrite(PIN_RELAY_IN1, fanOn ? LOW : HIGH);
  }
}

// Variabel Buzzer Non-Blocking (Mode Alarm Taktis Penuh)
unsigned long lastBuzzerToggleMillis = 0;
unsigned long buzzerOnDurationMs     = 200;
unsigned long buzzerOffDurationMs    = 130;
bool buzzerState           = false;
int  buzzerBeepPhase       = 0;
int  buzzerBeepsRemaining  = 0;

inline void setBuzzerSound(bool soundOn) {
  if (!soundOn) {
    // High-Z (Open-Drain) memutus arus bocor baik pada buzzer Active-LOW maupun Active-HIGH
    pinMode(PIN_BUZZER, INPUT);
  } else {
    pinMode(PIN_BUZZER, OUTPUT);
    unsigned long elapsed = millis() - lastBuzzerToggleMillis;
    unsigned long third   = buzzerOnDurationMs / 3;
    if (elapsed < third) {
      // Tahap 1: DC HIGH penuh (Active-HIGH KY-012)
      digitalWrite(PIN_BUZZER, HIGH);
    } else if (elapsed < (third * 2)) {
      // Tahap 2: DC LOW penuh (Active-LOW Buzzer)
      digitalWrite(PIN_BUZZER, LOW);
    } else {
      // Tahap 3: Osilasi ~2 kHz murni GPIO (Passive Buzzer & efek sirine taktis, bebas crash LEDC)
      digitalWrite(PIN_BUZZER, ((micros() >> 8) & 1) ? HIGH : LOW);
    }
  }
}

void triggerBuzzerAlarm(int level) {
  if (level <= 0) {
    buzzerBeepsRemaining = 0;
    setBuzzerSound(false);
    buzzerState = false;
    return;
  }
  if (level == 1) {
    buzzerBeepsRemaining = 3;
    buzzerOnDurationMs   = 240;
    buzzerOffDurationMs  = 140;
  } else if (level == 2) {
    buzzerBeepsRemaining = 5;
    buzzerOnDurationMs   = 240;
    buzzerOffDurationMs  = 120;
  } else {
    buzzerBeepsRemaining = 8;
    buzzerOnDurationMs   = 180;
    buzzerOffDurationMs  = 90;
  }
  buzzerState = true;
  lastBuzzerToggleMillis = millis();
  setBuzzerSound(true);
}

// Nilai Sensor Terakhir
float lastTemperatureC     = -999.0;
float lastHumidityPct      = -999.0;
float lastCurrentMa        = 0.0;
float lastBusVoltageV      = 0.0;
float lastShuntVoltageMv   = 0.0;
float lastPowerMw          = 0.0;

// Status Logika Pertahanan
int   currentAlertLevel    = 0;      // 0=Aman, 1=Peringatan, 2=Tahan/Safety Gate, 3=Karantina
bool  localInterlockActive = false;  // True bila suhu lokal >= 32.0 C
bool  failsafeActive       = false;  // True bila koneksi broker terputus > 5 detik

// Sequence Number Monotonik & Identitas Boot Acak (Anti-Replay)
uint32_t telemetrySeq           = 0;
uint32_t lastApprovedGatewaySeq = 0;
uint32_t deviceBootId           = 0;
int      dhtFailStreak          = 0;

// Penanda Waktu Non-Blocking (millis)
unsigned long lastTelemetryMillis = 0;
unsigned long lastHeartbeatMillis = 0;
unsigned long lastWifiRetryMillis = 0;
unsigned long lastMqttRetryMillis = 0;
unsigned long lastBrokerContactMillis = 0;

// =============================================================================
// FUNCTION PROTOTYPES
// =============================================================================
void setupPins();
void initI2CAndSensors();
void connectWiFi();
void connectMQTT();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void handleApprovedDirective(const char* jsonStr);
void readSensors();
void sendTelemetry();
void updateActuatorsAndAlarms();
void updateBuzzerPattern();
void processSerialCLI();
bool testI2CAddress(uint8_t addr);

// =============================================================================
// HARDWARE INITIALIZATION (SETUP)
// =============================================================================
void setup() {
  Serial.begin(SERIAL_BAUD_RATE);
  delay(600);
  deviceBootId = esp_random();

  Serial.println("\n");
  Serial.println("================================================================================");
  Serial.println("  PATRIOT-AD | FIRMWARE ESP32 PRODUKSI FINAL (v1.0.0)");
  Serial.println("  Sistem Pengawasan Siber-Fisik Gudang Amunisi TNI-AD");
  Serial.println("  Kartika Cyber Hackathon 2026 - PUSSIBERAD");
  Serial.println("================================================================================");
  Serial.printf("[INIT] ID Simpul       : %s\n", MQTT_CLIENT_ID);
  Serial.printf("[INIT] Ambang Interlock: %.1f C | Batas Kritis: %.1f C\n", 
                LOCAL_INTERLOCK_TEMP_C, LOCAL_CRITICAL_TEMP_C);
  Serial.printf("[INIT] Ambang Arus Fan : >= %.1f mA (INA226 R100)\n", 
                CURRENT_FAN_ACTIVE_MIN_MA);

  // 1. Inisialisasi Pin GPIO
  setupPins();

  // 2. Inisialisasi Bus I2C & Sensor
  initI2CAndSensors();

  // 3. Konfigurasi MQTT Client Buffer Size (512 bytes untuk payload telemetri lengkap)
  mqttClient.setBufferSize(512);
  mqttClient.setServer(MQTT_BROKER_IP, MQTT_BROKER_PORT);
  mqttClient.setCallback(mqttCallback);

  // 4. Mulai Koneksi WiFi (Non-blocking background)
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WIFI] Memulai koneksi ke SSID: '%s'...\n", WIFI_SSID);

  lastBrokerContactMillis = millis();
  Serial.println("[SYSTEM] Booting selesai. Siap melayani telemetri & pertahanan siber-fisik.\n");
  Serial.println(">> PETUNJUK BENCH TEST SERIAL (Ketik di Serial Monitor):");
  Serial.println("   '1' = Nyalakan Kipas (Relay ON)");
  Serial.println("   '0' = Matikan Kipas (Relay OFF, tunduk pada Interlock Suhu)");
  Serial.println("   's' = Cek Snapshot Sensor Lengkap (DHT22 & INA226)");
  Serial.println("   'l' = Siklus Uji Indikator LED & Alarm (Level 0 -> 1 -> 2 -> 3)");
  Serial.println("   'h' = Bantuan & Konfigurasi Pin\n");
}

// =============================================================================
// MAIN OPERATIONAL LOOP (NON-BLOCKING ASYNCHRONOUS)
// =============================================================================
void loop() {
  unsigned long now = millis();

  // 1. Tangani Konektivitas WiFi & MQTT Secara Non-blocking
  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) {
      if (now - lastMqttRetryMillis >= MQTT_RETRY_INTERVAL_MS) {
        lastMqttRetryMillis = now;
        connectMQTT();
      }
    } else {
      mqttClient.loop();
      lastBrokerContactMillis = now;
    }
  } else {
    if (now - lastWifiRetryMillis >= WIFI_RETRY_INTERVAL_MS) {
      lastWifiRetryMillis = now;
      Serial.printf("[WIFI] Menghubungkan ulang ke '%s'...\n", WIFI_SSID);
      WiFi.reconnect();
    }
  }

  // 2. Lingkar Keselamatan Mandiri (Local Failsafe Blackout Protection)
  // Failsafe aktif jika sensor DHT22 rusak/terputus atau suhu gudang darurat >= 32.0 C
  if ((dhtFailStreak >= DHT_MAX_FAIL_STREAK) || localInterlockActive) {
    failsafeActive = true;
  } else if (mqttClient.connected() || (now - lastBrokerContactMillis < 30000)) {
    failsafeActive = false;
  }

  // 3. Eksekusi Pembacaan Sensor & Pengiriman Telemetri Sesuai Siklus
  if (now - lastTelemetryMillis >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMillis = now;
    readSensors();
    sendTelemetry();
  }

  // 4. Perbarui Status Fisik Aktuator & Indikator LED
  updateActuatorsAndAlarms();

  // 5. Pola Suara Alarm Buzzer Non-Blocking
  updateBuzzerPattern();

  // 6. Kedipan Heartbeat Builtin LED (Setiap 500ms)
  if (now - lastHeartbeatMillis >= 500) {
    lastHeartbeatMillis = now;
    digitalWrite(PIN_LED_BUILTIN, !digitalRead(PIN_LED_BUILTIN));
  }

  // 7. Proses Perintah Interaktif dari Serial Monitor
  processSerialCLI();
}

// =============================================================================
// KONFIGURASI PIN GPIO
// =============================================================================
void setupPins() {
  pinMode(PIN_LED_BUILTIN, OUTPUT);
  pinMode(PIN_LED_HIJAU,   OUTPUT);
  pinMode(PIN_LED_KUNING,  OUTPUT);
  pinMode(PIN_LED_MERAH,   OUTPUT);
  pinMode(PIN_BUZZER,      OUTPUT);
  pinMode(PIN_RELAY_IN1,   OUTPUT);

  // Default Boot: Kipas AKTIF untuk sirkulasi udara gudang
  relayFanActive = true;
  setRelayState(true);

  // Tes Lampu Indikator Sekilas saat Boot (High-Z Buzzer = Hening Total)
  setBuzzerSound(false);
  digitalWrite(PIN_LED_HIJAU,  HIGH);
  digitalWrite(PIN_LED_KUNING, HIGH);
  digitalWrite(PIN_LED_MERAH,  HIGH);
  delay(300);
  digitalWrite(PIN_LED_HIJAU,  HIGH);
  digitalWrite(PIN_LED_KUNING, LOW);
  digitalWrite(PIN_LED_MERAH,  LOW);
}

// =============================================================================
// INISIALISASI I2C DAN SENSOR FISIK
// =============================================================================
bool testI2CAddress(uint8_t addr) {
  Wire.beginTransmission(addr);
  return (Wire.endTransmission() == 0);
}

void diagnoseI2CPins() {
  const int diagPins[] = {15, 16, 17, 5, 18, 19, 21, 22, 23};
  int vals[9] = {0};
  for (int i = 0; i < 9; i++) {
    pinMode(diagPins[i], INPUT_PULLDOWN);
    delayMicroseconds(200);
    vals[i] = digitalRead(diagPins[i]);
    pinMode(diagPins[i], INPUT);
  }
  Serial.printf(
    "[I2C-DIAG] Status Pull-Up 3.3V Pin Header Kanan: GPIO15=%d GPIO16=%d GPIO17=%d GPIO5=%d GPIO18=%d GPIO19=%d GPIO21=%d GPIO22=%d GPIO23=%d\n",
    vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], vals[6], vals[7], vals[8]
  );
}

bool scanAndInitINA226() {
  const int pinPairs[][2] = {
    {21, 22}, {22, 21},
    {22, 23}, {23, 22},
    {21, 23}, {23, 21},
    {21, 19}, {19, 21},
    {22, 19}, {19, 22},
    {18, 19}, {19, 18},
    {18, 21}, {21, 18},
    {18, 22}, {22, 18},
    {5, 18},  {18, 5},
    {16, 17}, {17, 16}
  };
  const int numPairs = sizeof(pinPairs) / sizeof(pinPairs[0]);

  for (int p = 0; p < numPairs; p++) {
    int sda = pinPairs[p][0];
    int scl = pinPairs[p][1];
    Wire.end();
    Wire.begin(sda, scl);
    Wire.setClock(100000);
    Wire.setTimeOut(15);
    delay(5);

    for (uint8_t addr = 0x40; addr <= 0x4F; addr++) {
      if (testI2CAddress(addr)) {
        activeInaAddress = addr;
        activeSdaPin = sda;
        activeSclPin = scl;
        ina226 = INA226_WE(activeInaAddress);
        ina226.init();
        ina226.setResistorRange(SHUNT_RESISTOR_OHM, MAX_EXPECTED_CURRENT_A);
        ina226.setAverage(INA226_AVERAGE_16);
        ina226.setConversionTime(INA226_CONV_TIME_1100);
        ina226Detected = true;
        Serial.printf("[INA226] Terdeteksi otomatis pada SDA=%d, SCL=%d, Alamat=0x%02X (Shunt R100=%.2f Ohm)\n",
                      sda, scl, activeInaAddress, SHUNT_RESISTOR_OHM);
        return true;
      }
    }
  }
  Wire.end();
  Wire.begin(activeSdaPin, activeSclPin);
  Wire.setClock(100000);
  Wire.setTimeOut(15);
  return false;
}

void initI2CAndSensors() {
  dht.begin();
  diagnoseI2CPins();
  ina226Detected = scanAndInitINA226();
  if (!ina226Detected) {
    Serial.println("[INA226] PERHATIAN: Modul INA226 belum terdeteksi pada bus I2C (21/22, 22/23, 19/21, dll).");
    Serial.println("         Sistem akan terus mencoba mendeteksi saat siklus runtime.");
  }
}

// =============================================================================
// KONEKSI & REKONEKSI MQTT BROKER
// =============================================================================
void connectMQTT() {
  if (mqttClient.connected()) return;

  Serial.printf("[MQTT] Menghubungkan ke broker %s:%d dengan Client ID '%s'...\n",
                MQTT_BROKER_IP, MQTT_BROKER_PORT, MQTT_CLIENT_ID);

  bool connected = false;
  if (strlen(MQTT_USERNAME) > 0) {
    connected = mqttClient.connect(MQTT_CLIENT_ID, MQTT_USERNAME, MQTT_PASSWORD);
  } else {
    connected = mqttClient.connect(MQTT_CLIENT_ID);
  }

  if (connected) {
    Serial.println("[MQTT] Terhubung ke broker! Berlangganan topik perintah disetujui...");
    mqttClient.subscribe(TOPIC_APPROVED_CMD, 1);
    Serial.printf("[MQTT] Berlangganan: %s\n", TOPIC_APPROVED_CMD);
    lastBrokerContactMillis = millis();
  } else {
    Serial.printf("[MQTT] Koneksi gagal (rc=%d). Coba lagi dalam %d ms.\n",
                  mqttClient.state(), MQTT_RETRY_INTERVAL_MS);
  }
}

// =============================================================================
// MQTT INCOMING MESSAGE CALLBACK (MEMPROSES DIRECTIVE DARI POLICY GATEWAY)
// =============================================================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  // Salin payload ke buffer string aman bertanda null-terminator
  char messageBuffer[512];
  if (length >= sizeof(messageBuffer)) {
    Serial.printf("[MQTT] Pesan ditolak: ukuran melebihi batas buffer (%u bytes).\n", length);
    return;
  }
  memcpy(messageBuffer, payload, length);
  messageBuffer[length] = '\0';

  Serial.printf("\n>>> [MQTT DIRECTIVE] Topik: %s | Panjang: %u bytes\n", topic, length);
  Serial.printf("    Payload: %s\n", messageBuffer);

  if (strcmp(topic, TOPIC_APPROVED_CMD) == 0) {
    handleApprovedDirective(messageBuffer);
  }
}

// =============================================================================
// VERIFIKASI HMAC-SHA256 & PARSER DIRECTIVE KEBIJAKAN
// =============================================================================
static bool extractJsonString(const char* json, const char* key, char* outBuf, size_t outSize) {
  char pattern[48];
  snprintf(pattern, sizeof(pattern), "\"%s\":\"", key);
  const char* start = strstr(json, pattern);
  if (!start) return false;
  start += strlen(pattern);
  const char* end = strchr(start, '"');
  if (!end) return false;
  size_t len = (size_t)(end - start);
  if (len >= outSize) len = outSize - 1;
  memcpy(outBuf, start, len);
  outBuf[len] = '\0';
  return true;
}

static void computeDirectiveHmac(
  uint32_t seq,
  const char* targetDevice,
  const char* fanToken,
  int alertLevel,
  const char* origin,
  char* outHex65
) {
  char canonical[256];
  snprintf(canonical, sizeof(canonical), "%lu:%s:%s:%d:%s",
           (unsigned long)seq, targetDevice, fanToken, alertLevel, origin);

  uint8_t hmacResult[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_setup(&ctx, info, 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)COMMAND_HMAC_SECRET, strlen(COMMAND_HMAC_SECRET));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)canonical, strlen(canonical));
  mbedtls_md_hmac_finish(&ctx, hmacResult);
  mbedtls_md_free(&ctx);

  for (int i = 0; i < 32; i++) {
    snprintf(outHex65 + (i * 2), 3, "%02x", hmacResult[i]);
  }
  outHex65[64] = '\0';
}

void handleApprovedDirective(const char* jsonStr) {
  // Contoh Payload Ber-HMAC:
  // {"schema_version":"1.0","gateway_seq":12,"target_device":"esp32_gudang","fan":"FAN_ON","alert_level":0,"origin":"OPERATOR","hmac":"..."}

  // 0. Ekstraksi & Verifikasi HMAC-SHA256 + Anti-Replay gateway_seq
  const char* seqKey = "\"gateway_seq\":";
  const char* seqPtr = strstr(jsonStr, seqKey);
  const char* levelKey = "\"alert_level\":";
  const char* levelPtr = strstr(jsonStr, levelKey);

  char targetDevice[32] = "esp32_gudang";
  char originStr[32]    = "OPERATOR";
  char receivedHmac[70] = "";
  extractJsonString(jsonStr, "target_device", targetDevice, sizeof(targetDevice));
  extractJsonString(jsonStr, "origin", originStr, sizeof(originStr));
  bool hasHmac = extractJsonString(jsonStr, "hmac", receivedHmac, sizeof(receivedHmac));

  const char* fanToken = "NONE";
  if (strstr(jsonStr, "\"fan\":\"FAN_ON\"")) {
    fanToken = "FAN_ON";
  } else if (strstr(jsonStr, "\"fan\":\"FAN_OFF\"")) {
    fanToken = "FAN_OFF";
  }

  if (!seqPtr || !levelPtr || !hasHmac) {
    Serial.println("[KEAMANAN] DITOLAK: Perintah tanpa tanda tangan HMAC-SHA256 lengkap!");
    currentAlertLevel = 2;
    triggerBuzzerAlarm(3);
    return;
  }

  uint32_t parsedSeq = (uint32_t)strtoul(seqPtr + strlen(seqKey), NULL, 10);
  int parsedLevel = atoi(levelPtr + strlen(levelKey));

  char expectedHmac[65];
  computeDirectiveHmac(parsedSeq, targetDevice, fanToken, parsedLevel, originStr, expectedHmac);

  if (strcmp(receivedHmac, expectedHmac) != 0) {
    Serial.println("[KEAMANAN] DITOLAK: Tanda tangan HMAC-SHA256 palsu / tidak cocok!");
    currentAlertLevel = 2;
    triggerBuzzerAlarm(3);
    return;
  }

  if (parsedSeq != 1 && parsedSeq <= lastApprovedGatewaySeq) {
    Serial.printf("[KEAMANAN] DITOLAK: Paket ulang (replay) terdeteksi (seq=%lu <= %lu)!\n",
                  (unsigned long)parsedSeq, (unsigned long)lastApprovedGatewaySeq);
    return;
  }
  lastApprovedGatewaySeq = parsedSeq;

  // 1. Ekstraksi Level Indikator
  if (parsedLevel >= 0 && parsedLevel <= 3) {
    int prevLevel = currentAlertLevel;
    if (localInterlockActive && parsedLevel < 2) {
      currentAlertLevel = 2;
    } else {
      currentAlertLevel = parsedLevel;
    }
    // Bunyikan alarm taktis bertingkat saat ada peringatan/serangan/eksekusi perintah
    if (parsedLevel >= 1 &&
        (parsedLevel > prevLevel ||
         strcmp(originStr, "KEEP_SAFE") == 0 ||
         strstr(jsonStr, "\"request_id\":\"cmd-") != NULL)) {
      triggerBuzzerAlarm(parsedLevel);
    }
    Serial.printf("[DIRECTIVE] HMAC Sah (seq=%lu) | Level Indikator: Level %d\n",
                  (unsigned long)parsedSeq, currentAlertLevel);
  }

  // 2. Ekstraksi Perintah Kipas
  bool hasFanCmd = false;
  bool requestFanOn = false;

  if (strcmp(fanToken, "FAN_ON") == 0) {
    hasFanCmd = true;
    requestFanOn = true;
  } else if (strcmp(fanToken, "FAN_OFF") == 0) {
    hasFanCmd = true;
    requestFanOn = false;
  }

  // 3. Eksekusi Perintah Kipas dengan Proteksi Interlock Fisik Lokal Mandiri
  if (hasFanCmd) {
    if (requestFanOn) {
      relayFanActive = true;
      setRelayState(true);
      Serial.println("[AKTUATOR] RELAY KIPAS 5010 = ON (Daya Aktif)");
    } else {
      // Perintah Matikan Kipas (FAN_OFF): Tolak bila sensor tidak terbaca ATAU suhu >= 32.0 C!
      if (lastTemperatureC <= -100.0 || lastTemperatureC >= LOCAL_INTERLOCK_TEMP_C) {
        relayFanActive = true;
        setRelayState(true);
        localInterlockActive = true;
        currentAlertLevel = 2;
        triggerBuzzerAlarm(2);
        Serial.printf("[SAFETY INTERLOCK TERTOLAK] Suhu %.1f C (Ambang %.1f C / Sensor Putus)! Kipas DIPAKSA TETAP MENYALA.\n",
                      lastTemperatureC, LOCAL_INTERLOCK_TEMP_C);
      } else {
        relayFanActive = false;
        setRelayState(false);
        localInterlockActive = false;
        Serial.println("[AKTUATOR] RELAY KIPAS 5010 = OFF (Suhu aman)");
      }
    }
  }
}

// =============================================================================
// PEMBACAAN SENSOR FISIK SECARA BERKALA
// =============================================================================
void readSensors() {
  // 1. Baca Sensor DHT22 (Tanpa manipulasi steamBoost, murni sensor + kalibrasi offset)
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  if (!isnan(t) && !isnan(h)) {
    bool wasDhtFailing = (dhtFailStreak >= DHT_MAX_FAIL_STREAK);
    dhtFailStreak = 0;
    lastTemperatureC = t + TEMP_CALIBRATION_OFFSET_C;
    lastHumidityPct  = h;

    // Evaluasi Lingkar Keselamatan Suhu Lokal
    if (lastTemperatureC >= LOCAL_INTERLOCK_TEMP_C) {
      if (!localInterlockActive) {
        triggerBuzzerAlarm(2);
      }
      localInterlockActive = true;
      if (currentAlertLevel < 2) {
        currentAlertLevel = 2;
      }
      // Paksa kipas tetap aktif bila suhu >= 32.0 C
      if (!relayFanActive) {
        relayFanActive = true;
        setRelayState(true);
        Serial.printf("[AUTO-COOLING] Suhu mencapai %.1f C! Kipas dinyalakan otomatis secara mandiri.\n",
                      lastTemperatureC);
      }
    } else {
      if (localInterlockActive || wasDhtFailing) {
        localInterlockActive = false;
        // Turunkan kembali ke Level 0 Normal (Lampu Hijau) jika baru pulih dari interlock lokal
        if (currentAlertLevel == 2) {
          currentAlertLevel = 0;
        }
      }
    }
  } else {
    dhtFailStreak++;
    Serial.printf("[DHT22] Gagal membaca data dari GPIO4 (%d/%d).\n", dhtFailStreak, DHT_MAX_FAIL_STREAK);
    if (dhtFailStreak >= DHT_MAX_FAIL_STREAK) {
      // FAIL-SAFE SENSOR PUTUS: Jangan tahan angka lama, kosongkan nilai & nyalakan kipas paksa!
      if (dhtFailStreak == DHT_MAX_FAIL_STREAK) {
        triggerBuzzerAlarm(2);
      }
      lastTemperatureC = -999.0;
      lastHumidityPct  = -999.0;
      localInterlockActive = true;
      if (currentAlertLevel < 2) {
        currentAlertLevel = 2;
      }
      if (!relayFanActive) {
        relayFanActive = true;
        setRelayState(true);
      }
      Serial.println("[FAILSAFE SENSOR] Sensor DHT22 terputus! Kipas dipaksa MENYALA demi keselamatan amunisi.");
    }
  }

  // 2. Baca Sensor INA226 (I2C)
  if (ina226Detected && !testI2CAddress(activeInaAddress)) {
    ina226Detected = false;
    Serial.printf("[INA226] Koneksi I2C terputus di SDA=%d SCL=%d (0x%02X). Memindai ulang...\n",
                  activeSdaPin, activeSclPin, activeInaAddress);
    scanAndInitINA226();
  } else if (!ina226Detected) {
    // Coba deteksi ulang setiap 5 siklus telemetri jika sebelumnya belum terpasang
    if ((telemetrySeq % 5) == 0) {
      scanAndInitINA226();
    }
  }

  if (ina226Detected) {
    lastShuntVoltageMv = ina226.getShuntVoltage_mV();
    lastBusVoltageV    = ina226.getBusVoltage_V();
    lastCurrentMa      = ina226.getCurrent_mA();
    lastPowerMw        = ina226.getBusPower();

    // Re-init jika relay kipas aktif tetapi arus terbaca ~0 mA (indikasi hot-plug / reset register INA226)
    if (relayFanActive && fabs(lastCurrentMa) < 0.1) {
      scanAndInitINA226();
      if (ina226Detected) {
        lastShuntVoltageMv = ina226.getShuntVoltage_mV();
        lastBusVoltageV    = ina226.getBusVoltage_V();
        lastCurrentMa      = ina226.getCurrent_mA();
        lastPowerMw        = ina226.getBusPower();
      }
    }

    // Self-healing jika register kalibrasi INA226 ter-reset (hot-plug atau inrush relay):
    if (ina226Detected && fabs(lastCurrentMa) < 0.1 && fabs(lastShuntVoltageMv) > 0.5) {
      ina226.init();
      ina226.setResistorRange(SHUNT_RESISTOR_OHM, MAX_EXPECTED_CURRENT_A);
      ina226.setAverage(INA226_AVERAGE_16);
      ina226.setConversionTime(INA226_CONV_TIME_1100);
      lastCurrentMa = fabs(lastShuntVoltageMv) / SHUNT_RESISTOR_OHM;
    }
    if (lastCurrentMa < 0.0) {
      lastCurrentMa = fabs(lastCurrentMa);
    }
  } else {
    lastCurrentMa      = 0.0;
    lastBusVoltageV    = 0.0;
  }
}

// =============================================================================
// PENGIRIMAN TELEMETRI KE TOPIK MQTT (SKEMA KANONIK PATRIOT-AD)
// =============================================================================
void sendTelemetry() {
  telemetrySeq++;

  // Buat Payload JSON Kanonik yang Sesuai dengan Skema Pydantic Backend
  char payload[384];

  char tempStr[16];
  char humStr[16];
  char currStr[16];
  char busStr[16];

  if (lastTemperatureC > -100.0) {
    snprintf(tempStr, sizeof(tempStr), "%.1f", lastTemperatureC);
  } else {
    snprintf(tempStr, sizeof(tempStr), "null");
  }

  if (lastHumidityPct > -100.0) {
    snprintf(humStr, sizeof(humStr), "%.1f", lastHumidityPct);
  } else {
    snprintf(humStr, sizeof(humStr), "null");
  }

  if (ina226Detected) {
    snprintf(currStr, sizeof(currStr), "%.1f", lastCurrentMa);
    snprintf(busStr, sizeof(busStr), "%.2f", lastBusVoltageV);
  } else {
    snprintf(currStr, sizeof(currStr), "null");
    snprintf(busStr, sizeof(busStr), "null");
  }

  const char* sensorStatus = (dhtFailStreak >= DHT_MAX_FAIL_STREAK) ? "SENSOR_PUTUS" : "NORMAL";
  bool failsafeActiveCombined = (dhtFailStreak >= DHT_MAX_FAIL_STREAK || failsafeActive);

  snprintf(payload, sizeof(payload),
    "{\"schema_version\":\"1.0\","
    "\"device_id\":\"%s\","
    "\"boot_id\":%lu,"
    "\"seq\":%lu,"
    "\"uptime_ms\":%lu,"
    "\"temperature_c\":%s,"
    "\"humidity_pct\":%s,"
    "\"fan_reported\":\"%s\","
    "\"current_ma\":%s,"
    "\"bus_v\":%s,"
    "\"interlock_active\":%s,"
    "\"failsafe_active\":%s,"
    "\"sensor_status\":\"%s\"}",
    MQTT_CLIENT_ID,
    (unsigned long)deviceBootId,
    telemetrySeq,
    millis(),
    tempStr,
    humStr,
    relayFanActive ? "ON" : "OFF",
    currStr,
    busStr,
    localInterlockActive ? "true" : "false",
    failsafeActiveCombined ? "true" : "false",
    sensorStatus
  );

  // Cetak Diagnostik Ringkas ke Serial Monitor
  Serial.printf("[TELEMETRI #%04lu] Suhu: %s C | RH: %s %% | Fan: %s | Arus INA226: %s mA | Bus: %s V | Lvl: %d | Uptime: %lu ms | Boot: %lu\n",
                telemetrySeq, tempStr, humStr,
                relayFanActive ? "ON" : "OFF",
                currStr, busStr, currentAlertLevel,
                millis(), (unsigned long)deviceBootId);

  // Publish ke MQTT Broker jika terhubung
  if (mqttClient.connected()) {
    mqttClient.publish(TOPIC_TELEMETRY, payload);
  }
}

// =============================================================================
// PEMBARUAN INDIKATOR LED DAN AKTUATOR
// =============================================================================
void updateActuatorsAndAlarms() {
  // Evaluasi Failsafe Mode: Bila interlock aktif atau sensor putus, pastikan Relay Kipas tetap ON secara aman
  if (localInterlockActive || (dhtFailStreak >= DHT_MAX_FAIL_STREAK)) {
    relayFanActive = true;
    setRelayState(true);
  } else {
    setRelayState(relayFanActive);
  }

  // Kendali LED Indikator Berdasarkan Level Peringatan
  switch (currentAlertLevel) {
    case 0: // Normal / Terlindungi (LED Hijau ON)
      digitalWrite(PIN_LED_HIJAU,  HIGH);
      digitalWrite(PIN_LED_KUNING, LOW);
      digitalWrite(PIN_LED_MERAH,  LOW);
      break;

    case 1: // Peringatan Anomali Sensor (dT/dt atau Stale - LED Kuning ON)
      digitalWrite(PIN_LED_HIJAU,  LOW);
      digitalWrite(PIN_LED_KUNING, HIGH);
      digitalWrite(PIN_LED_MERAH,  LOW);
      break;

    case 2: // Interlock Keselamatan / Sabotase Ditahan (LED Merah ON)
      digitalWrite(PIN_LED_HIJAU,  LOW);
      digitalWrite(PIN_LED_KUNING, LOW);
      digitalWrite(PIN_LED_MERAH,  HIGH);
      break;

    case 3: // Karantina / Insiden Kritis / Network Blackout (LED Merah ON)
    default:
      digitalWrite(PIN_LED_HIJAU,  LOW);
      digitalWrite(PIN_LED_KUNING, LOW);
      digitalWrite(PIN_LED_MERAH,  HIGH);
      break;
  }
}

// =============================================================================
// KENDALI SUARA BUZZER NON-BLOCKING (MODE ALARM TAKTIS PENUH)
// =============================================================================
void updateBuzzerPattern() {
  unsigned long now = millis();

  if (buzzerBeepsRemaining <= 0) {
    setBuzzerSound(false);
    buzzerState = false;
    return;
  }

  if (!buzzerState && (now - lastBuzzerToggleMillis >= buzzerOffDurationMs)) {
    buzzerState = true;
    lastBuzzerToggleMillis = now;
    setBuzzerSound(true);
  } else if (buzzerState && (now - lastBuzzerToggleMillis >= buzzerOnDurationMs)) {
    setBuzzerSound(false); // OFF (Diam High-Z)
    buzzerState = false;
    buzzerBeepsRemaining--;
    lastBuzzerToggleMillis = now;
  } else if (buzzerState) {
    setBuzzerSound(true);  // Pertahankan tahap 1 (DC HIGH) lalu tahap 2 (2.5 kHz)
  }
}

// =============================================================================
// BENCH TEST SERIAL CLI INTERAKTIF (UNTUK PENGUJIAN MEJA SEBELUM DEMO)
// =============================================================================
void processSerialCLI() {
  while (Serial.available()) {
    char cmd = Serial.read();
    if (cmd == '\r' || cmd == '\n' || cmd == ' ') continue;

    Serial.println("\n--------------------------------------------------");
    switch (cmd) {
      case '1':
        relayFanActive = true;
        failsafeActive = false;
        lastBrokerContactMillis = millis();
        setRelayState(true);
        Serial.printf(">>> [MANUAL CLI] RELAY KIPAS 5010 = ON (%s)\n", relayActiveHigh ? "HIGH" : "LOW");
        break;

      case '0':
        failsafeActive = false;
        lastBrokerContactMillis = millis();
        if (lastTemperatureC >= LOCAL_INTERLOCK_TEMP_C) {
          Serial.printf(">>> [MANUAL CLI DITOLAK] Suhu %.1f C >= %.1f C! Interlock lokal aktif, kipas tetap ON.\n",
                        lastTemperatureC, LOCAL_INTERLOCK_TEMP_C);
        } else {
          relayFanActive = false;
          setRelayState(false);
          Serial.printf(">>> [MANUAL CLI] RELAY KIPAS 5010 = OFF (%s)\n", relayActiveHigh ? "LOW" : "HIGH");
        }
        break;

      case 'x':
      case 'X':
        relayActiveHigh = !relayActiveHigh;
        setRelayState(relayFanActive);
        Serial.printf(">>> [INVERT RELAY] Polaritas relay dibalik: %s | Status Fan: %s\n",
                      relayActiveHigh ? "ACTIVE-HIGH" : "ACTIVE-LOW",
                      relayFanActive ? "ON" : "OFF");
        break;

      case 'N':
        currentAlertLevel = 0;
        triggerBuzzerAlarm(0);
        Serial.println(">>> [SYNC] Level Pertahanan diubah ke: LEVEL 0 (NORMAL / HIJAU)");
        break;

      case 'W':
        if (currentAlertLevel < 1) {
          triggerBuzzerAlarm(1);
        }
        currentAlertLevel = 1;
        Serial.println(">>> [SYNC] Level Pertahanan diubah ke: LEVEL 1 (WASPADA / KUNING)");
        break;

      case 'I':
        if (currentAlertLevel < 2) {
          triggerBuzzerAlarm(2);
        }
        currentAlertLevel = 2;
        Serial.println(">>> [SYNC] Level Pertahanan diubah ke: LEVEL 2 (INTERLOCK / MERAH)");
        break;

      case 'Q':
        if (currentAlertLevel < 3) {
          triggerBuzzerAlarm(3);
        }
        currentAlertLevel = 3;
        Serial.println(">>> [SYNC] Level Pertahanan diubah ke: LEVEL 3 (KARANTINA / MERAH)");
        break;

      case 't':
      case 'T':
        Serial.println(">>> [TES LED BREADBOARD] Menguji 3 Lampu Indikator bergantian...");
        Serial.println("    1. Menyalakan LED HIJAU (GPIO 27) selama 1 detik...");
        digitalWrite(PIN_LED_HIJAU, HIGH);
        digitalWrite(PIN_LED_KUNING, LOW);
        digitalWrite(PIN_LED_MERAH, LOW);
        delay(1000);
        Serial.println("    2. Menyalakan LED KUNING (GPIO 25) selama 1 detik...");
        digitalWrite(PIN_LED_HIJAU, LOW);
        digitalWrite(PIN_LED_KUNING, HIGH);
        digitalWrite(PIN_LED_MERAH, LOW);
        delay(1000);
        Serial.println("    3. Menyalakan LED MERAH (GPIO 32) selama 1 detik...");
        digitalWrite(PIN_LED_HIJAU, LOW);
        digitalWrite(PIN_LED_KUNING, LOW);
        digitalWrite(PIN_LED_MERAH, HIGH);
        delay(1000);
        digitalWrite(PIN_LED_MERAH, LOW);
        Serial.println("    Selesai tes LED.");
        break;

      case 's':
      case 'S':
        Serial.println(">>> [DIAGNOSTIK SENSOR MEJA]");
        Serial.printf("    Suhu Ruangan (DHT22) : %.1f C\n", lastTemperatureC);
        Serial.printf("    Kelembapan Relatif   : %.1f %%RH\n", lastHumidityPct);
        Serial.printf("    Status Relay Kipas   : %s\n", relayFanActive ? "AKTIF (BERPUTAR)" : "MATI");
        Serial.printf("    Arus Beban (INA226)  : %.2f mA\n", lastCurrentMa);
        Serial.printf("    Tegangan Bus 5V      : %.2f V\n", lastBusVoltageV);
        Serial.printf("    Tegangan Shunt R100  : %.3f mV\n", lastShuntVoltageMv);
        Serial.printf("    Daya Terukur         : %.2f mW\n", lastPowerMw);
        Serial.printf("    Status Interlock     : %s\n", localInterlockActive ? "AKTIF (TERKUNCI)" : "NORMAL");
        Serial.printf("    Status Broker MQTT   : %s\n", mqttClient.connected() ? "TERHUBUNG" : "TERPUTUS");
        break;

      case 'l':
      case 'L':
        currentAlertLevel = (currentAlertLevel + 1) % 4;
        Serial.printf(">>> [UJI INDIKATOR] Level Peringatan diubah manual ke: LEVEL %d\n", currentAlertLevel);
        break;

      case 'b':
      case 'B':
        Serial.println(">>> [UJI BUZZER] Membunyikan Alarm Buzzer Taktis...");
        triggerBuzzerAlarm(2);
        break;

      case 'h':
      case 'H':
      case '?':
      default:
        Serial.println(">>> BANTUAN PERINTAH SERIAL PATRIOT-AD:");
        Serial.println("    1 = Paksa Kipas Menyala (Relay ON)");
        Serial.println("    0 = Matikan Kipas (Relay OFF, tunduk pada Interlock)");
        Serial.println("    s = Cetak Snapshot Lengkap Sensor");
        Serial.println("    l = Ganti Level Indikator Fisik (0..3)");
        Serial.println("    b = Tes Suara Buzzer");
        Serial.println("    h = Cetak Menu Bantuan Ini");
        break;
    }
    Serial.println("--------------------------------------------------");
  }
}
