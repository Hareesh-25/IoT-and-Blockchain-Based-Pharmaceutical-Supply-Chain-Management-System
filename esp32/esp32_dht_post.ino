#include <WiFi.h>
#include "DHT.h"
#include <HTTPClient.h>

#define DHTPIN 4
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

const char* ssid = "iqoo9se";
const char* password = "12345678";
const char* serverUrl = "http://YOUR_PC_IP:3000/iot/ingest";

String deviceId = "ESP32-01";
String batchId  = "BATCH-1001";
String role     = "distributor";

void setup() {
  Serial.begin(115200);
  dht.begin();
  WiFi.begin(ssid, password);
  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
  }
  Serial.println("\nConnected.");
}

void loop() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  if (isnan(h) || isnan(t)) {
    Serial.println("Failed to read DHT");
    delay(2000); return;
  }

  float lat = 17.3850 + random(-50,50)/10000.0;
  float lon = 78.4867 + random(-50,50)/10000.0;

  String payload = "{";
  payload += "\"deviceId\":\""+deviceId+"\",";
  payload += "\"batchId\":\""+batchId+"\",";
  payload += "\"role\":\""+role+"\",";
  payload += "\"timestamp\":\""+String((long)time(NULL))+"\",";
  payload += "\"temp\":"+String(t,2)+",";
  payload += "\"hum\":"+String(h,2)+",";
  payload += "\"location\":{\"lat\":"+String(lat,6)+",\"lon\":"+String(lon,6)+"}";
  payload += "}";

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");
    int httpResponseCode = http.POST(payload);
    if (httpResponseCode>0) {
      Serial.println("POST ok: " + String(httpResponseCode));
    } else {
      Serial.println("Error on POST: " + String(httpResponseCode));
    }
    http.end();
  }

  delay(15000);
}

