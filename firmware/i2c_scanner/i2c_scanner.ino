#include <Arduino.h>
#include <Wire.h>

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- I2C SCANNER MULAI ---");
  Wire.begin(21, 22); // SDA = 21, SCL = 22
}

void loop() {
  byte error, address;
  int nDevices = 0;

  Serial.println("Scanning I2C bus (SDA=21, SCL=22)...");

  for (address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    error = Wire.endTransmission();

    if (error == 0) {
      Serial.printf(">>> DITEMUKAN perangkat I2C di alamat 0x%02X !\n", address);
      nDevices++;
    } else if (error == 4) {
      Serial.printf("Error tidak dikenal di alamat 0x%02X\n", address);
    }
  }

  if (nDevices == 0) {
    Serial.println("Tidak ada perangkat I2C yang terdeteksi!");
  } else {
    Serial.printf("Selesai. Total ditemukan: %d perangkat.\n", nDevices);
  }

  delay(3000);
}
