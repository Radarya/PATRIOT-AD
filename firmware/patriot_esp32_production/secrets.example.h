#ifndef PATRIOT_SECRETS_H
#define PATRIOT_SECRETS_H

// Template kredensial ESP32 PATRIOT-AD.
// Salin file ini menjadi "secrets.h" sebelum mem-flash ke perangkat keras nyata:
//   cp secrets.example.h secrets.h
// File "secrets.h" otomatis diabaikan oleh Git (.gitignore).

#define WIFI_SSID               "YOUR_WIFI_SSID"
#define WIFI_PASSWORD           "YOUR_WIFI_PASSWORD"
#define MQTT_BROKER_IP          "192.168.1.100"
#define MQTT_PASSWORD           "CHANGE_ME_ESP32_MQTT_PASSWORD"
#define COMMAND_HMAC_SECRET     "CHANGE_ME_HMAC_SHA256_SHARED_SECRET"

#endif // PATRIOT_SECRETS_H
