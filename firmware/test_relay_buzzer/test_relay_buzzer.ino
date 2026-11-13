#include <Arduino.h>

// =========================================================================
// PATRIOT-AD: STANDALONE TEST BENCH (ACTIVE-LOW FIX UNTUK BUZZER & RELAY)
// =========================================================================

#define PIN_RELAY_IN  26
#define PIN_ALT_1     27
#define PIN_ALT_2     25
#define PIN_ALT_3     14

#define PIN_BUZZER    33
#define PIN_ALT_BUZZ  32
#define PIN_LED_ESP   2

// Buzzer 3-pin dengan transistor PNP adalah ACTIVE-LOW:
// - HIGH = Diam / Hening
// - LOW  = Bunyi Bip
bool buzzerActiveLow = true;

void setBuzzer(bool sound) {
  if (buzzerActiveLow) {
    digitalWrite(PIN_BUZZER, sound ? LOW : HIGH);
    digitalWrite(PIN_ALT_BUZZ, sound ? LOW : HIGH);
  } else {
    digitalWrite(PIN_BUZZER, sound ? HIGH : LOW);
    digitalWrite(PIN_ALT_BUZZ, sound ? HIGH : LOW);
  }
}

void setRelay(bool on) {
  // Kirim sinyal ke GPIO 26 DAN pin tetangga (27, 25, 14)
  // agar jika kabel jumper di breadboard meleset 1 baris, relay TETAP KLIK!
  int level = on ? LOW : HIGH;
  digitalWrite(PIN_RELAY_IN, level);
  digitalWrite(PIN_ALT_1, level);
  digitalWrite(PIN_ALT_2, level);
  digitalWrite(PIN_ALT_3, level);
}

void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(PIN_LED_ESP, OUTPUT);
  pinMode(PIN_RELAY_IN, OUTPUT);
  pinMode(PIN_ALT_1, OUTPUT);
  pinMode(PIN_ALT_2, OUTPUT);
  pinMode(PIN_ALT_3, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_ALT_BUZZ, OUTPUT);

  // MATIKAN SEMUA DI AWAL (Buzzer langsung diam hening!)
  setBuzzer(false);
  setRelay(false);
  digitalWrite(PIN_LED_ESP, LOW);

  Serial.println("\n=======================================================");
  Serial.println("  PATRIOT-AD: UJI RELAY & BUZZER (FIX ACTIVE-LOW) ");
  Serial.println("=======================================================\n");
}

void loop() {
  // SIKLUS 1: RELAY ON + BIP SINGKAT (150ms)
  Serial.println(">>> [ON ] RELAY ON (KLIK!) + BUZZER BIP!");
  digitalWrite(PIN_LED_ESP, HIGH);
  setRelay(true);
  setBuzzer(true);
  delay(150);       // Bip singkat 150 ms (tidak bikin bising kuping!)
  setBuzzer(false); // Langsung diam hening!
  delay(1500);      // Tahan relay menyala 1.5 detik

  // SIKLUS 2: RELAY OFF + DIAM TOTAL
  Serial.println(">>> [OFF] RELAY OFF (KLIK lepas!) + DIAM TOTAL");
  digitalWrite(PIN_LED_ESP, LOW);
  setRelay(false);
  setBuzzer(false);
  delay(1500);      // Tahan relay mati 1.5 detik
}
